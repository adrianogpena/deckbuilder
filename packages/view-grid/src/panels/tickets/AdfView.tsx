import type { ReactNode } from 'react';
import { Chip, type Tone } from '../../kit';

interface Mark {
  type: string;
  attrs?: Record<string, any>;
}

interface AdfNode {
  type?: string;
  text?: string;
  attrs?: Record<string, any>;
  marks?: Mark[];
  content?: AdfNode[];
}

const STATUS_TONE: Record<string, Tone> = { green: 'ok', yellow: 'warn', red: 'danger', blue: 'info', purple: 'info' };

const safeHref = (href: unknown): string | undefined => (typeof href === 'string' && /^(https?:|mailto:)/i.test(href) ? href : undefined);

function withMarks(text: ReactNode, marks: Mark[] = []): ReactNode {
  return marks.reduce<ReactNode>((inner, m) => {
    if (m.type === 'strong') return <strong>{inner}</strong>;
    if (m.type === 'em') return <em>{inner}</em>;
    if (m.type === 'code') return <code>{inner}</code>;
    if (m.type === 'strike') return <s>{inner}</s>;
    if (m.type === 'underline') return <u>{inner}</u>;
    if (m.type === 'link') {
      const href = safeHref(m.attrs?.href);
      return href ? <a href={href} target="_blank" rel="noreferrer">{inner}</a> : inner;
    }
    return inner;
  }, text);
}

function children(node: AdfNode): ReactNode[] {
  return (node.content ?? []).map((c, i) => <Node key={i} node={c} />);
}

function Node({ node }: { node: AdfNode }): ReactNode {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'text':
      return withMarks(node.text ?? '', node.marks);
    case 'hardBreak':
      return <br />;
    case 'paragraph':
      return <p>{children(node)}</p>;
    case 'heading': {
      const Tag = `h${Math.min(6, Math.max(3, Number(attrs.level) + 2 || 5))}` as 'h5';
      return <Tag>{children(node)}</Tag>;
    }
    case 'bulletList':
      return <ul>{children(node)}</ul>;
    case 'orderedList':
      return <ol start={Number(attrs.order) || 1}>{children(node)}</ol>;
    case 'listItem':
      return <li>{children(node)}</li>;
    case 'blockquote':
      return <blockquote>{children(node)}</blockquote>;
    case 'codeBlock':
      return <pre><code>{(node.content ?? []).map((c) => c.text ?? '').join('')}</code></pre>;
    case 'rule':
      return <hr />;
    case 'table':
      return (
        <div className="adf-table-wrap">
          <table>
            <tbody>{children(node)}</tbody>
          </table>
        </div>
      );
    case 'tableRow':
      return <tr>{children(node)}</tr>;
    case 'tableHeader':
      return <th colSpan={attrs.colspan} rowSpan={attrs.rowspan}>{children(node)}</th>;
    case 'tableCell':
      return <td colSpan={attrs.colspan} rowSpan={attrs.rowspan}>{children(node)}</td>;
    case 'expand':
    case 'nestedExpand':
      return (
        <details>
          <summary>{String(attrs.title ?? '')}</summary>
          {children(node)}
        </details>
      );
    case 'panel':
      return <blockquote>{children(node)}</blockquote>;
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
      return null;
    case 'status':
      return <Chip tone={STATUS_TONE[String(attrs.color)] ?? 'neutral'}>{String(attrs.text ?? '')}</Chip>;
    case 'mention':
      return <strong>{String(attrs.text ?? '')}</strong>;
    case 'emoji':
      return <>{String(attrs.text ?? attrs.shortName ?? '')}</>;
    case 'inlineCard':
    case 'blockCard': {
      const href = safeHref(attrs.url);
      return href ? <a href={href} target="_blank" rel="noreferrer">{href}</a> : null;
    }
    default:
      return node.content ? <>{children(node)}</> : null;
  }
}

/** A Jira comment: an Atlassian document (API v3) rendered as HTML, or the plain string of API v2. */
export function AdfView({ body }: { body: unknown }) {
  if (typeof body === 'string') return <p className="adf-plain">{body}</p>;
  if (!body || typeof body !== 'object') return null;
  return <div className="adf">{children(body as AdfNode)}</div>;
}
