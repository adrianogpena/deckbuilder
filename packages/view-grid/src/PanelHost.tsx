import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, errorMessage, errorOf, Icon, PanelBanner, PanelLoading, PanelNotice, validConfig, type ApiError, type GridItem } from '@deckbuilderkit/ui';
import { tKey } from './i18n';
import { fieldsOf, type AnyPanelKind } from './panel';

/** Last data per instance and config, so a collapsed or re-shown panel starts with what it had. */
const cache = new Map<string, unknown>();

const intervalOf = (kind: AnyPanelKind, config: Record<string, unknown>): number => {
  const ms = typeof kind.refreshMs === 'function' ? kind.refreshMs(config) : kind.refreshMs;
  return ms && ms > 0 ? ms : 0;
};

/**
 * The one host every panel renders through: it validates the config, loads the data (with a loading
 * skeleton, an error with Retry, and a banner over the last data when a refresh fails), refreshes on the
 * kind's interval and renders the kind. A collapsed panel is not mounted, so it neither loads nor refreshes.
 */
export function PanelHost({ kind, item }: { kind: AnyPanelKind; item: GridItem }) {
  const config = useMemo(() => validConfig(fieldsOf(kind), item.config), [kind, item.config]);
  const size = { w: item.w, h: item.h };
  if (!kind.load) return <Rendered kind={kind} config={config} data={undefined} size={size} refresh={noop} />;
  return <Loaded kind={kind} id={item.id} config={config} size={size} />;
}

const noop = () => {};

function Rendered({ kind, config, data, size, refresh }: { kind: AnyPanelKind; config: Record<string, unknown>; data: unknown; size: { w: number; h: number }; refresh: () => void }) {
  return <>{kind.render({ config, data, size, refresh })}</>;
}

function Loaded({ kind, id, config, size }: { kind: AnyPanelKind; id: string; config: Record<string, unknown>; size: { w: number; h: number } }) {
  const key = `${id}:${kind.kind}:${JSON.stringify(config)}`;
  const [data, setData] = useState<unknown>(() => cache.get(key));
  const [error, setError] = useState<ApiError>();
  const generation = useRef(0);
  const abort = useRef<AbortController>();
  const latest = useRef({ kind, config, key });
  latest.current = { kind, config, key };

  const run = useCallback(() => {
    const gen = ++generation.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const { kind: k, config: c, key: cacheKey } = latest.current;
    k.load!(c, { signal: controller.signal })
      .then((value) => {
        if (gen !== generation.current) return;
        cache.set(cacheKey, value);
        setData(value);
        setError(undefined);
      })
      .catch((err) => {
        if (gen !== generation.current) return;
        setError(errorOf(err));
      });
  }, []);

  useEffect(() => {
    setData(cache.get(key));
    setError(undefined);
    run();
    return () => {
      generation.current++;
      abort.current?.abort();
    };
  }, [key, run]);

  const ms = intervalOf(kind, config);
  useEffect(() => {
    if (!ms) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, ms);
    return () => window.clearInterval(timer);
  }, [ms, key, run]);

  const retry = (
    <Button size="sm" icon="refresh" title={tKey('common.retry')} onClick={run}>{tKey('common.retry')}</Button>
  );
  if (data === undefined) {
    if (!error) return <PanelLoading />;
    return <PanelNotice icon={<Icon name="alert" size={20} />} tone="err" title={tKey('grid.loadFailed')} message={errorMessage(error)} action={retry} />;
  }
  return (
    <>
      {error && <PanelBanner tone="err" action={retry}>{`${tKey('grid.refreshFailed')}: ${errorMessage(error)}`}</PanelBanner>}
      <Rendered kind={kind} config={config} data={data} size={size} refresh={run} />
    </>
  );
}
