import { type HighlightTerm, Icon, JsonTree, linesOf, LogView, PanelBanner, PanelNotice, t } from '@deckbuilder/ui';
import { useMemo, useState } from 'react';
import { CodeView } from './CodeView';
import { langOfFile, previewKind } from './languages';
import { MarkdownView } from './MarkdownView';

/** `/api/fs/read` gives text or `{ binary }`; images come as a URL (a blob URL of `/api/fs/raw`). */
export type PreviewContent = { text: string; truncated?: boolean } | { binary: true } | { url: string };

/** Shows a file by its extension: rendered markdown, a JSON tree, highlighted code, a log, an image or plain text. */
export function FilePreview({ name, content, resolveImage }: { name: string; content: PreviewContent; resolveImage?(src: string): string | null }) {
  const kind = previewKind(name);

  if ('binary' in content) return <PanelNotice icon={<Icon name="cube" size={20} />} title={t('preview.binary')} />;
  if ('url' in content) {
    if (kind !== 'image') return <PanelNotice icon={<Icon name="cube" size={20} />} title={t('preview.none')} message={t('preview.noneMessage')} />;
    return (
      <div className="file-preview">
        <div className="file-preview-body file-preview-image"><img src={content.url} alt={name} /></div>
      </div>
    );
  }
  return (
    <div className="file-preview">
      {content.truncated && <PanelBanner tone="warn" icon="alert">{t('preview.truncated')}</PanelBanner>}
      {kind === 'markdown' ? <MarkdownPreview text={content.text} resolveImage={resolveImage} />
        : kind === 'json' ? <JsonPreview text={content.text} />
          : kind === 'log' ? <LogPreview text={content.text} />
          : <div className="file-preview-body"><CodeView value={content.text} lang={kind === 'code' ? langOfFile(name) : 'text'} lineNumbers /></div>}
    </div>
  );
}

function MarkdownPreview({ text, resolveImage }: { text: string; resolveImage?(src: string): string | null }) {
  const [source, setSource] = useState(false);
  return (
    <>
      <div className="file-preview-bar">
        <button className="btn btn-ghost btn-sm" onClick={() => setSource(!source)} aria-pressed={source}>
          {source ? t('preview.rendered') : t('preview.source')}
        </button>
      </div>
      <div className="file-preview-body">
        {source ? <CodeView value={text} lang="markdown" wrap lineNumbers /> : <MarkdownView markdown={text} resolveImage={resolveImage} />}
      </div>
    </>
  );
}

/** A read-only LogView of the text: no follow, no bookmarks. */
function LogPreview({ text }: { text: string }) {
  const lines = useMemo(() => linesOf({ from: 0, to: 0, text }, 0, null), [text]);
  const [highlights, setHighlights] = useState<HighlightTerm[]>([]);
  return <div className="file-preview-body file-preview-log"><LogView lines={lines} highlights={highlights} onHighlightsChange={setHighlights} /></div>;
}

function JsonPreview({ text }: { text: string }) {
  const parsed = useMemo(() => {
    try {
      return { value: JSON.parse(text) as unknown };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [text]);
  if ('value' in parsed) return <div className="file-preview-body"><JsonTree value={parsed.value} /></div>;
  return (
    <>
      <PanelBanner tone="err">{t('preview.jsonError', { message: parsed.error })}</PanelBanner>
      <div className="file-preview-body"><CodeView value={text} lang="json" lineNumbers /></div>
    </>
  );
}
