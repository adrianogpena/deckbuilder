import { useState } from 'react';
import { Button, JsonTree } from '@deckbuilderkit/ui';
import { t } from '../../../i18n';
import type { PanelModule } from '../../workspace/types';
import { format, minify, validate } from './json-tools';
import './style.css';

type Status = { kind: 'none' } | { kind: 'valid' } | { kind: 'error'; message: string; line: number; col: number };

/** Paste JSON, then Format (2 spaces), Minify or Validate (error with line:col); a tree view and copy of the result. */
function JsonPanel() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'none' });
  const parsed = text.trim() ? validate(text) : undefined;
  const apply = (fn: typeof format) => {
    const r = fn(text);
    if (r.ok) {
      setText(r.text);
      setStatus({ kind: 'valid' });
    } else setStatus({ kind: 'error', message: r.message, line: r.line, col: r.col });
  };
  return (
    <div className="agents-panel-json">
      <div className="agents-json-bar">
        <Button size="sm" onClick={() => apply(format)}>
          {t('panel.json.format')}
        </Button>
        <Button size="sm" onClick={() => apply(minify)}>
          {t('panel.json.minify')}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const r = validate(text);
            setStatus(r.ok ? { kind: 'valid' } : { kind: 'error', message: r.message, line: r.line, col: r.col });
          }}
        >
          {t('panel.json.validate')}
        </Button>
        <Button size="sm" icon="copy" onClick={() => void navigator.clipboard.writeText(text)}>
          {t('panel.json.copy')}
        </Button>
        <span className={`agents-json-status${status.kind === 'error' ? ' error' : ''}`} role="status">
          {status.kind === 'valid' && t('panel.json.valid')}
          {status.kind === 'error' && t('panel.json.error', { line: status.line, col: status.col, message: status.message })}
        </span>
      </div>
      <textarea
        className="agents-json-input"
        value={text}
        spellCheck={false}
        placeholder={t('panel.json.placeholder')}
        onChange={(e) => {
          setText(e.target.value);
          setStatus({ kind: 'none' });
        }}
      />
      <div className="agents-json-tree">{parsed?.ok && <JsonTree value={parsed.value} />}</div>
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'json',
  titleKey: 'panel.json.title',
  icon: 'braces',
  placement: 'both',
  Panel: JsonPanel,
};
