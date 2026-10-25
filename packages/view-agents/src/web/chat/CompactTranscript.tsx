import { useLayoutEffect, useMemo, useRef } from 'react';
import { MarkdownView } from '@kedalion/editor';
import { Button } from '@kedalion/ui';
import { t } from '../../i18n';
import { compactTurns, type CompactTurn } from '../session-summary';
import { toolSummary } from './chat-model';

function Folded({ turn }: { turn: CompactTurn }) {
  if (turn.folded.length === 0) return null;
  const counts = turn.toolCounts.map(([name, n]) => `${name} ×${n}`).join(', ');
  return (
    <details className="chat-fold">
      <summary>{turn.toolCalls > 0 ? t('agents.stopped.fold', { n: turn.toolCalls, tools: counts }) : t('agents.stopped.foldText')}</summary>
      {turn.folded.map((f, i) =>
        f.kind === 'tool' ? (
          <div key={i} className="chat-fold-tool"><span className="chat-tool-name">{f.name}</span> <span className="chat-tool-summary">{toolSummary(f.input)}</span></div>
        ) : (
          <div key={i} className="chat-assistant sub"><MarkdownView markdown={f.text} /></div>
        ),
      )}
    </details>
  );
}

/** Read-only compact transcript: each turn is the prompt, one folded line for its tool calls and intermediate text, and the final reply. Shows the last `limit` turns. */
export function CompactTranscript({ events, limit, onMore, resetKey }: { events: Parameters<typeof compactTurns>[0]; limit: number; onMore(): void; resetKey: string }) {
  const all = useMemo(() => compactTurns(events), [events]);
  const turns = all.slice(Math.max(0, all.length - limit));
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [resetKey, events]);

  return (
    <div className="chat-transcript" ref={ref} role="log">
      {all.length === 0 && <p className="agents-empty chat-empty">{t('agents.chat.empty')}</p>}
      {turns.length < all.length && (
        <Button variant="ghost" size="xs" onClick={onMore}>{t('agents.stopped.loadEarlier', { n: all.length - turns.length })}</Button>
      )}
      {turns.map((turn, i) => (
        <div key={all.length - turns.length + i} className="chat-turn">
          {turn.prompt !== undefined && <div className="chat-user">{turn.prompt}</div>}
          <Folded turn={turn} />
          {turn.final !== undefined && <div className="chat-assistant"><MarkdownView markdown={turn.final} /></div>}
          {turn.errors.map((m, j) => <div key={j} className="chat-note error">{m}</div>)}
        </div>
      ))}
    </div>
  );
}
