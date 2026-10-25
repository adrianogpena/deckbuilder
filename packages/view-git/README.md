# @kedalion/view-git

Git

- Id: `git`.
- `src/view.tsx`: web entry (built with `defineView`).
- `src/server.ts`: server entry (built with `defineServerView`; validates the view's settings and serves its routes).
- `src/i18n.ts`: messages (en, pt-BR) and the view's typed `t`.
- `src/settings.ts`: setting types and schema.

Settings: Git view: changes, staging, diffs and history for the app's projects.
owns the Git screen state (focused project, sizes, list or tree, sections, history panel). No Settings cards.
Links and capabilities: none.
