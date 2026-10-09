import { useCallback, useEffect, useRef, useState } from 'react';
import { errorOf, type ApiError } from './api';
import { emptyTail, type LogLine, type TailChunkLike, tailReducer, type TailState } from './log';

export interface LogTailOptions {
  /** Identifies the file: a new key starts over from the tail. */
  key: string;
  /** 1000 when omitted. */
  pollMs?: number;
  /** 200_000 when omitted. */
  maxLines?: number;
  paused?: boolean;
}

export interface LogTail {
  lines: LogLine[];
  /** Byte offset up to which the file was read (before a partial last line). */
  end: number;
  loading: boolean;
  error?: ApiError;
  /** The file shrank and was reloaded from the tail; stays set until `dismissRotated`. */
  rotated: boolean;
  /** Starts over from the tail and clears `rotated`. */
  reload(): void;
  dismissRotated(): void;
}

/**
 * Follows a log file: `fetchChunk()` reads the tail, `fetchChunk(end)` what was written since.
 * Polls never overlap, responses for an old `key` are dropped, hidden windows don't poll, and a
 * failed poll keeps polling (the file may come back).
 */
export function useLogTail(fetchChunk: (from?: number) => Promise<TailChunkLike>, opts: LogTailOptions): LogTail {
  const { key, pollMs = 1000, maxLines = 200_000, paused = false } = opts;
  const [state, setState] = useState<TailState>(emptyTail);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError>();
  const current = useRef(state);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const loaded = useRef(false);
  const fetchRef = useRef(fetchChunk);
  fetchRef.current = fetchChunk;
  const maxRef = useRef(maxLines);
  maxRef.current = maxLines;

  const commit = useCallback((next: TailState) => {
    current.current = next;
    setState(next);
  }, []);

  const load = useCallback((rotated: boolean) => {
    const gen = ++generation.current;
    inFlight.current = true;
    setLoading(true);
    fetchRef.current()
      .then((chunk) => {
        if (gen !== generation.current) return;
        commit(tailReducer({ ...emptyTail(), rotated }, chunk, maxRef.current));
        loaded.current = true;
        setError(undefined);
      })
      .catch((err) => {
        if (gen === generation.current) setError(errorOf(err));
      })
      .finally(() => {
        if (gen !== generation.current) return;
        inFlight.current = false;
        setLoading(false);
      });
  }, [commit]);

  const poll = useCallback(() => {
    if (inFlight.current) return;
    if (!loaded.current) {
      load(false);
      return;
    }
    const gen = generation.current;
    inFlight.current = true;
    fetchRef.current(current.current.end)
      .then((chunk) => {
        if (gen !== generation.current) return;
        setError(undefined);
        commit(tailReducer(current.current, chunk, maxRef.current));
        if (chunk.reset) load(true);
      })
      .catch((err) => {
        if (gen === generation.current) setError(errorOf(err));
      })
      .finally(() => {
        if (gen === generation.current) inFlight.current = false;
      });
  }, [commit, load]);

  useEffect(() => {
    commit(emptyTail());
    setError(undefined);
    loaded.current = false;
    load(false);
    return () => {
      generation.current++;
      inFlight.current = false;
    };
  }, [key, commit, load]);

  useEffect(() => {
    if (paused || !(pollMs > 0)) return;
    const id = window.setInterval(() => {
      if (!document.hidden) poll();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [key, pollMs, paused, poll]);

  const reload = useCallback(() => load(false), [load]);
  const dismissRotated = useCallback(() => commit({ ...current.current, rotated: false }), [commit]);

  return { lines: state.lines, end: state.end, loading, error, rotated: state.rotated, reload, dismissRotated };
}
