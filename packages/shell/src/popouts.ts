const VIEW = /^[\w.-]+$/;
const MAX_TITLE = 200;

/** Validates a `POST /api/window/popout` body; undefined when the view or title is bad. */
export function parsePopoutBody(body: unknown): { view: string; title: string } | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const { view, title } = body as { view?: unknown; title?: unknown };
  if (typeof view !== 'string' || !VIEW.test(view)) return undefined;
  if (typeof title !== 'string' || title.length > MAX_TITLE) return undefined;
  return { view, title };
}

/** The open pop-out windows by view id; a view has at most one. */
export interface Popouts<H> {
  get(view: string): H | undefined;
  add(view: string, handle: H): void;
  /** Removes `view` only while it still holds `handle`. */
  remove(view: string, handle: H): void;
  views(): string[];
}

export function createPopouts<H>(): Popouts<H> {
  const map = new Map<string, H>();
  return {
    get: (view) => map.get(view),
    add: (view, handle) => void map.set(view, handle),
    remove: (view, handle) => {
      if (map.get(view) === handle) map.delete(view);
    },
    views: () => [...map.keys()],
  };
}
