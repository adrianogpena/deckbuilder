# Kedalion codenames and rename plan

This file is the handover for the rename of DeckBuilder to **Kedalion**. It records what was decided, what is still open, and which codename each part received, with the reason for each name. Nothing in the code has been renamed yet.

Kedalion is the smith's guide of Greek myth: a helper of Hephaestus who rode on the shoulders of the blinded Orion and steered him east to the rays of Helios, which restored his sight. The app is that guide: it sits on top of strong but blind machinery and steers it for its owner. **Hephaestus is the user**, the smith Kedalion helps. No part of the code carries his name, and Kedalion did not come from him.

Internal codenames for the app, its views and its packages, taken from Greek mythology. They appear in docs and code comments only. Menu labels, package ids (`view-explorer`, `@deckbuilderkit/ui`) and persisted identifiers stay as they are.

## Status of the rename

Decided:

- The new name is **Kedalion**. The codenames below were chosen to go with it: the story of Kedalion and Orion, and the workshop of Hephaestus.
- The app id (`APP.id` in `apps/gallery/app.ts`, now `deckbuilder`) becomes `kedalion`. The data folder `~/.deckbuilder` must be moved by hand on the owner's machine (`mv ~/.deckbuilder ~/.kedalion`, app closed). Check whether secrets live in that folder or in the OS keychain.
- npm release is dropped. The `@deckbuilderkit/*` packages are not published; users get only the app's executable (the "gallery" release).
- Only the owner uses the app, so there are no other users to migrate. A full rename is acceptable.
- Home, Grid and Tabs stop being main views.

Open (ask the owner before doing these):

- Whether to rename the `apps/gallery` folder (and so the release tag prefix `gallery-v<version>`).
- Whether to rename the GitHub repository. Only the `repository.url` fields and README links change.
- Which view opens first once Home is gone (Agents or the Dashboard are the candidates).

Recommendation given: leave the `@deckbuilderkit` import scope alone (413 files, invisible to users).

## Where the name lives

- `apps/gallery/app.ts`: `APP.name` and `APP.id`, the single source for the window title, tray, autostart entry, quit dialog, toasts, executable and release file names, and (through `appHome(APP.id)`) the data folder, secrets, instance lock and port files. Backup files carry `app: APP.id`, so old backups are refused by a renamed id.
- `.github/workflows/release.yml`: tag `<app>-v<version>` must match `apps/<app>/package.json`. The `v*` tag runs the npm publish job.
- About 25 files mention "gallery" (folder, scripts, `commands.ts`, tests, docs).
- Leave these persistent identifiers alone, since renaming resets saved state: the theme id `deckbuilder-dark` / `deckbuilder-light`, the `x-deckbuilder-token` header, `deckbuilder.token`, `deckbuilder.recentFiles`, the `deckbuilder-backup` format, and the editor plugin keys.

## Cleanup that follows from not publishing to npm

- Remove the `publish` job (the `v*` tag flow) from `release.yml`.
- Remove `deckbuilder new`, `add view`, `upgrade` and `packages/build/template`, plus their tests. Keep `dev`, `build`, `build:web`, `release`, `manifest` and `keygen`, which the app's own build and release use.
- Rewrite the README to "download the app": drop the five install options and the create-an-app and add-packages sections.
- Mark every package `"private": true` and drop the publishing `repository.url` fields.
- If any package was already published, deprecate it on npm by hand.

## Dropping Home, Grid and Tabs

- Home and Tabs live in the app (`apps/gallery/web/src/screens/home.view.tsx`, `tabs.view.tsx`).
- The Grid view and the Dashboard share one package, `view-grid`. The Dashboard (`dashboardServerView`, its panels and sources) must stay; remove only the Grid parts. Its codename is Panoptes.
- Do this as its own commit, apart from the rename.

## Verified against the code

The wordplay pairs below were checked by reading the code (not by running it): `ServerViewDef` at `packages/server-core/src/views.ts:38` and `ViewDef` at `packages/ui/src/views.ts:41`; `dbConnections` in `packages/db/src/app-stores.ts`; `useSqlRunner`, `SqlResults` and `PlanView` in `packages/sql-ui/src`; `projects` in `packages/server-mods/src/app-stores.ts`; the `dev` and `build` commands in `packages/build/src/cli.ts`; the signature check in `packages/server-mods/src/update.ts`.

## Name availability

Not checked yet for Kedalion (npm is irrelevant without publishing). Before any public release, search GitHub user/org/repo names, domains, and the USPTO and EUIPO trademark databases. For personal use this is free in practice.

The scheme follows three groups:

- **Olympian** is the foundation: the app, the shared base, the server core, Agents and Settings.
- **Hero** is every view that runs something, and the package behind it.
- **Smith** is the shared tools and build tooling, the workshop of Hephaestus.

## App

| Codename | Applies to | Why |
|---|---|---|
| **Kedalion** | The whole app | Chosen by the owner. The guide who sits on strong, blind machinery and steers it; he helps Hephaestus, the user. |

## Views

| Codename | Group | Applies to | Why |
|---|---|---|---|
| **Theseus** | Hero | Explorer | He walks into the Labyrinth (the file tree) and finds his way through it by following a thread. |
| **Charon** | Hero | Terminal | The ferryman who carries you across to the other side; a terminal carries commands to the system and brings the output back. |
| **Hermes** | Hero | REST | The messenger god: carries a request out and the reply back, fast, between two parties that never meet. |
| **Sibyl** | Hero | Workbench (SQL) | A prophetess who answers the questions people bring her; a query is a question and the result is the answer. |
| **Moirai** | Hero | Git | The Fates who spin, measure and cut the thread of each life: commits are the thread of the code, and a revert cuts it. |
| **Argus** | Hero | Dashboard | The giant with a hundred eyes who never stops watching; a dashboard is many eyes on many things at once. |
| **Kourai** | Olympian | Agents | The golden maidens Hephaestus made to help him at the forge; they think and act on their own, like agents. |
| **Themis** | Olympian | Settings | The goddess of order and custom: how things are set and done. |

## Packages and layers

| Codename | Group | Applies to | Why |
|---|---|---|---|
| **Pantheon** | Olympian | `ui` | All the gods together in one place: all the shared components in one place. |
| **Orion** | Olympian | `server-core` | The giant hunter, strong but blind, carried by Kedalion: the server does the work and sees nothing until the UI steers it. |
| **Thyris** | Olympian | `shell` | The Greek word for a window: it is the native window that holds the web UI. |
| **Hestia** | Olympian | `platform` | Goddess of the hearth: the home on the operating system, where the app sits (tray, autostart, files). |
| **Pithos** | Olympian | `db` | The big storage jar of myth (Pandora's jar): it holds what the app keeps. |
| **Iris** | Olympian | Theme and palette | The goddess of the rainbow: colour. |
| **Obol** | Hero | `terminal` | The coin paid to Charon for the crossing: the small package behind the Terminal view. |
| **Tripod** | Hero | `sql-ui` | The seat on which the Pythia sat to give her answer: where the SQL answer is shown. |
| **Panoptes** | Hero | `view-grid` | "All-seeing", the epithet of Argus: the package that holds the Dashboard's panels. |
| **Telchines** | Smith | `server-mods` | The first metalworkers of myth, who made tools for the gods: a kit of ready tools (fs, http, archive, backup, update). |
| **Cadmus** | Smith | `editor` | The hero who brought the alphabet to Greece: writing. |
| **Akmon** | Smith | `build` | The anvil of the forge; the build is where the app is hammered into an executable. |
| **Daktyls** | Smith | `scripts/` | The small craftsmen of the fingers, helpers at the bench: small tools that check and polish. |
| **Cerberus** | Olympian | The update signature check: `verifyManifest` (`server-core`), `verifiedRelease` (`server-mods/src/update.ts`) and the signing side in `build` (`keys.ts`, `release.ts`) | The three-headed dog at the gate: nothing passes unless it belongs, as an update runs only when signed. |

## Wordplay

Pairs where one thing becomes or spawns the other, as in the myths.

| Pair | The play | Mapping |
|---|---|---|
| **Kedalion rides Orion** | The sighted guide on the blind giant's shoulders. | The web UI is Kedalion; the server core (`server-core`) is **Orion**. Strong, does the work, sees nothing until the UI steers it. |
| **Argus has a hundred Eyes** | One watcher made of many eyes. | `view-grid` is **Panoptes**, the Dashboard is Argus. Each Dashboard panel is an **Eye**. |
| **Pilgrim consults the Sibyl** | A petitioner brings a question; the oracle answers from her seat. | A saved database connection (in `db`, the **Pithos**) is the **Pilgrim**. Opening it in the Workbench brings it to Sibyl. The result grid and explain plan (`sql-ui`) are the **Tripod**, where the answer is read. |
| **Theseus follows the Thread** | Ariadne's thread leads him through the maze and back out. | A registered project root is the **Thread**. A root opened in Explorer is the **Labyrinth**, and Theseus walks it. |
| **Charon takes the Obol** | The ferryman carries only those who pay. | A terminal session is a crossing by Charon; the `terminal` package is the **Obol** it takes. |
| **Clay becomes any form** | Prometheus shaped every creature from clay. | **Clay** is the base contract every view implements (`ServerViewDef` and its web counterpart). Each view is what the Clay became. |
| **Ore becomes Bronze** | The smith melts raw ore into finished work. | The dev run (`kedalion dev`, server plus Vite) is the **Ore**. The executable build (`kedalion build`) is the **Bronze**. Both commands live in Akmon (`build`). |

These are naming conventions for docs and comments. No type, function or command is renamed.
