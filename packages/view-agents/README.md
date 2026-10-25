# @kedalion/view-agents

Agents view for DeckBuilder.

- `src/view.tsx`: web entry (`agentsView`, built with `defineView`).
- `src/server.ts`: server entry (`agentsServerView`, built with `defineServerView`).
- `src/i18n.ts`: messages (en, pt-BR) and the view's typed `t`.
- `src/styles.css`: styles; import `@kedalion/view-agents/styles.css` in the app.

Settings cards: add `settingsCards` (see `ViewSettingsCards` in `@kedalion/ui`) to the view definition and put the components in `src/settings/cards.tsx`.
