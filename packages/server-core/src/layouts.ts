// Layouts: switchable structural looks. A layout's CSS lives in `packages/ui/src/layouts/<id>.css`,
// scoped under `:root[data-layout='<id>']`; `original` has no file (it is the base styles.css).
// Pure module, shared by the server (settings validation) and the web UI (applies `data-layout`).

export interface Layout {
  id: string;
  label: string;
}

export const DEFAULT_LAYOUT = 'original';

export const LAYOUTS: readonly Layout[] = [{ id: 'original', label: 'Original' }];

export function layoutById(id: string): Layout | undefined {
  return LAYOUTS.find((l) => l.id === id);
}

/** The layout for `id`; unknown or unset gives the default. */
export function resolveLayout(id?: string): Layout {
  return (id === undefined ? undefined : layoutById(id)) ?? layoutById(DEFAULT_LAYOUT)!;
}
