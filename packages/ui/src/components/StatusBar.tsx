import type { ReactNode } from 'react';

export interface StatusItem {
  id: string;
  text: ReactNode;
  /** Tooltip; also the accessible name of a clickable item. */
  title?: string;
  onClick?: () => void;
  /** Default right, like VS Code's editor items. */
  align?: 'left' | 'right';
}

/** A thin row of status items; clickable ones are buttons. Items keep their order within each side. */
export function StatusBar({ items }: { items: StatusItem[] }) {
  const render = (item: StatusItem) =>
    item.onClick ? (
      <button key={item.id} type="button" className="status-item status-action" title={item.title} onClick={item.onClick}>
        {item.text}
      </button>
    ) : (
      <span key={item.id} className="status-item" title={item.title}>
        {item.text}
      </span>
    );
  return (
    <div className="status-bar" role="status">
      {items.filter((i) => i.align === 'left').map(render)}
      <span className="spacer" />
      {items.filter((i) => i.align !== 'left').map(render)}
    </div>
  );
}

/** `512 B`, `1.4 KB`, `12 MB`: sizes the way a status bar shows them (1 KB = 1024 B). */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i === 0 || n >= 10 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}
