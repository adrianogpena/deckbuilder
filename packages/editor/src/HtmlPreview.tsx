import { useEffect, useState } from 'react';

/**
 * An HTML file in a sandboxed frame. With `viewHtml` the frame loads the page from the server, so its scripts
 * run (the app's CSP blocks them in `srcDoc`) and its relative files resolve; the frame has no same-origin access to the app.
 */
export function HtmlPreview({ name, text, viewHtml }: { name: string; text: string; viewHtml?(): Promise<string> }) {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    setUrl(undefined);
    if (!viewHtml) return;
    let live = true;
    viewHtml().then((u) => live && setUrl(u), () => {});
    return () => {
      live = false;
    };
  }, [viewHtml, text]);

  return url
    ? <iframe className="file-preview-html" title={name} sandbox="allow-scripts" src={url} />
    : <iframe className="file-preview-html" title={name} sandbox="" srcDoc={viewHtml ? '' : text} />;
}
