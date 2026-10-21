import { tKey } from '../../i18n';
import { ListRows } from '../../kit';
import { parseLines } from './lines';
import './misc.css';

export function Links({ items, layout }: { items: string; layout: string }) {
  const links = parseLines(items);
  if (layout === 'tiles' && links.length > 0) {
    return (
      <div className="misc-tiles">
        {links.map((l, i) => (
          <a key={`${i}-${l.url}`} className="misc-tile" href={l.url} target="_blank" rel="noreferrer" title={l.url}>
            <span className="misc-tile-label">{l.label}</span>
            <span className="misc-tile-url">{new URL(l.url).host}</span>
          </a>
        ))}
      </div>
    );
  }
  return <ListRows rows={links.map((l, i) => ({ id: `${i}-${l.url}`, title: l.label, href: l.url, trailing: new URL(l.url).host }))} empty={tKey('dash.misc.links.empty')} />;
}
