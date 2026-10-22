import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ICON_COLOR, iconPng } from './win/icon-png.ts';
import { createToaster, type Toast, type Toaster } from './win/toast.ts';

export interface NotificationsOptions {
  /** Used as the title of a notification without one. */
  appName: string;
  /** App link for a path (`StartContext.link`), read when a notification is sent; without it a click has no target. */
  link: () => ((path: string) => string) | undefined;
  /** True while notifications are muted (do not disturb). */
  dnd?: () => boolean | Promise<boolean>;
  /** Icon name for a view id, e.g. `viewIcons(serverViews)` from server-core. */
  viewIcons?: (viewId: string) => string | undefined;
  /** Badge colour of the icons, `#rrggbb`. */
  color?: string;
  /** Where rendered icons are cached; default `~/.deckbuilder/toast-icons`. */
  iconDir?: string;
  /** Receives every toast instead of the Windows toaster (tests). */
  sink?: (toast: Toast) => void;
  toaster?: Toaster;
}

export interface Notification {
  title?: string;
  body: string;
  /** App path the click opens, resolved with `link`. */
  path?: string;
  /** Raw URI for the click; wins over `path`. */
  launch?: string;
}

export interface Notifier {
  (n: Notification): Promise<void>;
}

export interface Notifications {
  /** A `notify` that shows the icon of a view (by id) or the given icon name. */
  for(view: string | { icon: string }): Notifier;
  /** Ends the Windows toast host. */
  close(): Promise<number | null>;
}

/** The app's one notifier: owns the single toaster, resolves click links and the per-view icon PNG. */
export function createNotifications(opts: NotificationsOptions): Notifications {
  const toaster = opts.sink || opts.toaster ? opts.toaster : createToaster();
  const dir = opts.iconDir ?? join(homedir(), '.deckbuilder', 'toast-icons');
  const send = opts.sink ?? ((toast: Toast) => toaster?.show(toast));
  return {
    for(view) {
      const name = typeof view === 'string' ? opts.viewIcons?.(view) : view.icon;
      return async (n) => {
        if (await opts.dnd?.()) return;
        const link = opts.link();
        const launch = n.launch ?? (n.path !== undefined && link ? link(n.path) : '');
        const icon = name ? await iconPng({ name, color: opts.color ?? DEFAULT_ICON_COLOR, dir }) : undefined;
        send({ title: n.title ?? opts.appName, body: n.body, launch, ...(icon ? { icon } : {}) });
      };
    },
    close: async () => (await toaster?.close()) ?? null,
  };
}
