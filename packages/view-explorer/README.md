# @deckbuilder/view-explorer

Explorer

- Id: `explorer`.
- `src/view.tsx`: web entry (built with `defineView`).
- `src/server.ts`: server entry (built with `defineServerView`; validates the view's settings and serves its routes).
- `src/i18n.ts`: messages (en, pt-BR) and the view's typed `t`.
- `src/settings.ts`: setting types and schema.

Settings: Explorer view: project file tree, file viewer and editor, search, and SQL and curl actions on files.
owns the Explorer state (tree, open files, search, file defaults, excludes, nesting patterns) and the file settings.
Links and capabilities: Settings cards: `src/settings/cards.tsx`, wired through `settingsCards` in `view.tsx`.
