# @deckbuilderkit/view-rest

REST

- Id: `rest`.
- `src/view.tsx`: web entry (built with `defineView`).
- `src/server.ts`: server entry (built with `defineServerView`; validates the view's settings and serves its routes).
- `src/i18n.ts`: messages (en, pt-BR) and the view's typed `t`.
- `src/settings.ts`: setting types and schema.

Settings: REST client view: requests, environments, saved requests and history.
owns the `rest` state (panel sizes, active environment, history size). No Settings cards.
Links and capabilities: none.
