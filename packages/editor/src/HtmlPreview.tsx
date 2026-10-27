import { useEffect, useState } from 'react';

/**
 * An HTML file in a sandboxed frame. With `viewHtml` the frame loads the page from the server, so its scripts
 * run (the app's CSP blocks them in `srcDoc`) and its relative files resolve; the frame has no same-origin access to the app.
 */
export function HtmlPreview({ name, text, viewHtml }: { name: string; text: string; viewHtml?(): Promise<string> }) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(undefined);
    setFailed(false);
    if (!viewHtml) return;
    let live = true;
    viewHtml().then(
      (u) => live && setUrl(u),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [viewHtml, text]);

  // Without a server page (or when it fails), the frame shows the text with scripts blocked.
  return url
    ? <iframe className="file-preview-html" title={name} sandbox="allow-scripts" src={url} />
    : <iframe className="file-preview-html" title={name} sandbox="" srcDoc={viewHtml && !failed ? '' : text} />;
}
