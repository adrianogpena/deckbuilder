import { MarkdownView } from '@kedalion/editor';
import { Button } from '@kedalion/ui';
import { tKey } from '../../i18n';
import './misc.css';

export function Notes({ text, configure }: { text: string; configure(): void }) {
  if (!text.trim()) {
    return (
      <div className="misc-empty-action">
        <Button title={tKey('dash.misc.notes.empty')} onClick={configure}>{tKey('dash.misc.notes.empty')}</Button>
      </div>
    );
  }
  return (
    <div className="misc-notes">
      <MarkdownView markdown={text} />
    </div>
  );
}
