# @deckbuilderkit/view-__VIEW_ID__

__VIEW_TITLE__ view for DeckBuilder.

- `src/view.tsx`: web entry (`__VIEW_CAMEL__View`, built with `defineView`).
- `src/server.ts`: server entry (`__VIEW_CAMEL__ServerView`, built with `defineServerView`).
- `src/i18n.ts`: messages (en, pt-BR) and the view's typed `t`.
- `src/styles.css`: styles; import `@deckbuilderkit/view-__VIEW_ID__/styles.css` in the app.

Settings cards: add `settingsCards` (see `ViewSettingsCards` in `@deckbuilderkit/ui`) to the view definition and put the components in `src/settings/cards.tsx`.
