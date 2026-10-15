import { type HighlightTerm, Icon, JsonTree, linesOf, LogView, PanelBanner, PanelLoading, PanelNotice, t } from '@deckbuilder/ui';
import { lazy, Suspense, useMemo, useState } from 'react';
import { type ArchiveContent, ArchiveView } from './ArchiveView';
import { CodeView } from './CodeView';
import { EnvView } from './EnvView';
import { HarView } from './HarView';
import { HexView } from './HexView';
import { langOfFile, previewKind } from './languages';
import { MarkdownView } from './MarkdownView';
import { MediaView } from './MediaView';
import { NotebookView } from './NotebookView';
import { type SqliteContent, SqliteView } from './SqliteView';
import type { ImageInfo } from './SvgView';
import { TableView } from './TableView';

export type { ImageInfo } from './SvgView';
const SvgView = lazy(() => import('./SvgView').then((m) => ({ default: m.SvgView })));
const PdfView = lazy(() => import('./PdfView').then((m) => ({ default: m.PdfView })));
const FontView = lazy(() => import('./FontView').then((m) => ({ default: m.FontView })));

/** `/api/fs/read` gives text or `{ binary }`; images come as a URL (a blob URL of `/api/fs/raw`). */
export type PreviewContent = { text: string; truncated?: boolean } | { binary: true } | { url: string; source?: string } | { pdf: Uint8Array } | { archive: ArchiveContent }
  | { bytes: Uint8Array } | { sqlite: SqliteContent; load(table: string, offset: number): Promise<SqliteContent> };

/** Shows a file by its extension: rendered markdown, a JSON tree, highlighted code, a log, an image or plain text. */
export function FilePreview({ name, content, resolveImage, onImageInfo, toc = true }: {
  name: string;
  content: PreviewContent;
  resolveImage?(src: string): string | null;
  /** An image's size and zoom, for a status bar. */
  onImageInfo?(info: ImageInfo): void;
  /** Show the heading rail on rendered markdown; default on. */
  toc?: boolean;
}) {
  const kind = previewKind(name);

  if ('binary' in content) return <PanelNotice icon={<Icon name="cube" size={20} />} title={t('preview.binary')} />;
  if ('archive' in content) return <ArchiveView archive={content.archive} />;
  if ('pdf' in content) return <Suspense fallback={<PanelLoading />}><PdfView data={content.pdf} /></Suspense>;
  if ('sqlite' in content) return <SqliteView content={content.sqlite} load={content.load} />;
  if ('bytes' in content) {
    return kind === 'font'
      ? <Suspense fallback={<PanelLoading />}><FontView data={content.bytes} /></Suspense>
      : <HexView bytes={content.bytes} />;
  }
  if ('url' in content) {
    if (kind === 'audio' || kind === 'video') return <MediaView url={content.url} video={kind === 'video'} />;
    if (kind !== 'svg' && kind !== 'image') return <PanelNotice icon={<Icon name="cube" size={20} />} title={t('preview.none')} message={t('preview.noneMessage')} />;
    return <Suspense fallback={<PanelLoading />}><SvgView url={content.url} source={kind === 'svg' ? content.source : undefined} name={name} onInfo={onImageInfo} /></Suspense>;
  }
  return (
    <div className="file-preview">
      {content.truncated && <PanelBanner tone="warn" icon="alert">{t('preview.truncated')}</PanelBanner>}
      {kind === 'markdown' ? <MarkdownPreview text={content.text} resolveImage={resolveImage} toc={toc} />
        : kind === 'table' ? <TableView name={name} text={content.text} />
          : kind === 'notebook' ? <NotebookView text={content.text} />
            : kind === 'har' ? <HarView text={content.text} />
              : kind === 'env' ? <EnvView text={content.text} />
        : kind === 'html' ? <div className="file-preview-body"><iframe className="file-preview-html" title={name} sandbox="" srcDoc={content.text} /></div>
        : kind === 'json' ? <JsonPreview text={content.text} />
          : kind === 'log' ? <LogPreview text={content.text} />
          : <div className="file-preview-body"><CodeView value={content.text} lang={kind === 'code' ? langOfFile(name) : 'text'} lineNumbers /></div>}
    </div>
  );
}

function MarkdownPreview({ text, resolveImage, toc }: { text: string; resolveImage?(src: string): string | null; toc: boolean }) {
  const [source, setSource] = useState(false);
  return (
    <>
      <div className="file-preview-bar">
        <button className="btn btn-ghost btn-sm" onClick={() => setSource(!source)} aria-pressed={source}>
          {source ? t('preview.rendered') : t('preview.source')}
        </button>
      </div>
      <div className="file-preview-body">
        {source ? <CodeView value={text} lang="markdown" wrap lineNumbers /> : <MarkdownView markdown={text} resolveImage={resolveImage} toc={toc} />}
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
