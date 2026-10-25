# @kedalion/view-workbench

Workbench

- Id: `workbench`.
- `src/view.tsx`: web entry (built with `defineView`).
- `src/server.ts`: server entry (built with `defineServerView`; validates the view's settings and serves its routes).
- `src/i18n.ts`: messages (en, pt-BR) and the view's typed `t`.
- `src/settings.ts`: setting types and schema.

Settings: SQL Workbench view: editor, query runs, results, history and problems.
owns the `workbench` state (panel sizes, source, row limit, query timeout, history size, copy format, SQL format options).
Links and capabilities: Settings cards: `src/settings/cards.tsx`, wired through `settingsCards` in `view.tsx`.
