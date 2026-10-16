# @deckbuilder/view-terminal

Terminal

- Id: `terminal`.
- `src/view.tsx`: web entry (built with `defineView`).
- `src/server.ts`: server entry (built with `defineServerView`; validates the view's settings and serves its routes).
- `src/i18n.ts`: messages (en, pt-BR) and the view's typed `t`.
- `src/settings.ts`: setting types and schema.

Settings: Terminal view: shell sessions, tabs and splits, profiles and color schemes.
owns the terminal settings (font, cursor, scrollback, profiles, schemes).
Links and capabilities: Settings cards: `src/settings/cards.tsx`, wired through `settingsCards` in `view.tsx`.
