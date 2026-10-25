# Kedalion codenames and rename plan

This file is the handover for the rename of DeckBuilder to **Kedalion**. It records what was decided, what is still open, and which codename each part received. Nothing in the code has been renamed yet.

Kedalion is the smith's guide of Greek myth: Hephaestus gave him to the blinded Orion, and he rode on Orion's shoulders and steered him east to the sun's rays, which restored his sight. The app is the guide that sits on top of strong but blind machinery.

Internal codenames for the app, its views and its packages, taken from Greek mythology. They appear in docs and code comments only. Menu labels, package ids (`view-explorer`, `@deckbuilderkit/ui`) and persisted identifiers stay as they are.

## Status of the rename

Decided:

- The new name is **Kedalion**. The codenames below were chosen to go with it.
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

| Codename | Applies to | Alternatives |
|---|---|---|
| **Kedalion** | The whole app | Daedalus, Argonaut, Pharos |

## Views

| Codename | Group | Applies to | Alternatives |
|---|---|---|---|
| **Labyrinth** | Hero | Explorer | Atlas, Periplus, Odyssey |
| **Hermes** | Hero | Terminal | Charon, Styx, Psychopomp |
| **Iris** | Hero | REST | Pheme, Angelos, Hermes |
| **Pythia** | Hero | Workbench (SQL) | Sibyl, Tiresias, Delphi |
| **Moirai** | Hero | Git | Clio, Chronos, Atropos |
| **Argus** | Hero | Dashboard | Helios, Pharos, Hecatoncheires |
| **Talos** | Olympian | Agents | Myrmidon, Golden Maidens, Pandora |
| **Themis** | Olympian | Settings | Nomos, Hestia, Harmonia |

## Packages and layers

| Codename | Group | Applies to | Alternatives |
|---|---|---|---|
| **Pantheon** | Olympian | `ui` (shared components) | Stoa, Peplos, Kosmos |
| **Orion** | Olympian | `server-core` (strong, blind, ridden by Kedalion) | Atlas, Olympus, Titan |
| **Skene** | Olympian | `shell` (native window host) | Theatron, Proscenium, Thyris |
| **Gaia** | Olympian | `platform` (OS integration) | Tartarus, Chthon, Hades |
| **Mnemosyne** | Olympian | `db` (stores) | Lethe, Alexandria, Mnemon |
| **Helios** | Olympian | Theme and palette | Aglaea, Apollo, Chroma |
| **Talaria** | Hero | `terminal` (the package behind Hermes) | Caduceus, Petasos, Pegasus |
| **Omphalos** | Hero | `sql-ui` (results grid) | Tripod, Tablet, Sibyl |
| **Panoptes** | Hero | `view-grid` (Dashboard panels) | Hecatoncheires, Argos, Gorgon |
| **Cyclopes** | Smith | `server-mods` (fs, http, archive, backup, update) | Telchines, Daktyls, Kabeiroi |
| **Calliope** | Smith | `editor` (rich Markdown) | Clio, Scribe, Erato |
| **Hephaestus** | Smith | `build` (executable build) | Forge, Anvil, Etna |
| **Myrmidon** | Smith | `scripts/` (typecheck, boundary and button checks, screenshots) | Hoplite, Peltast, Satyr |
| **Cerberus** | Olympian | The update signature check: `verifyManifest` (`server-core`), `verifiedRelease` (`server-mods/src/update.ts`) and the signing side in `build` (`keys.ts`, `release.ts`) | Phylax, Sphinx, Argos |

## Wordplay

Pairs where one thing becomes or spawns the other, as in the myths.

| Pair | The play | Mapping |
|---|---|---|
| **Kedalion rides Orion** | The sighted guide on the blind giant's shoulders. | The web UI is Kedalion; the server core (`server-core`) is **Orion**. Strong, does the work, sees nothing until the UI steers it. |
| **Argus has a hundred Eyes** | One watcher made of many eyes. | `view-grid` is **Panoptes**, the Dashboard is Argus. Each Dashboard panel is an **Eye**. |
| **Pilgrim consults Pythia** | A petitioner brings a question; the oracle answers from her seat. | A saved database connection (in `db`) is the **Pilgrim**. Opening it in the Workbench brings it to Pythia. The result grid and explain plan (`sql-ui`) are the **Omphalos**, where the answer is read. |
| **Thread into the Labyrinth** | Ariadne's thread leads into the maze. | A registered project root is the **Thread**. A root opened in Explorer is the **Labyrinth**. |
| **Clay becomes any form** | Prometheus shaped every creature from clay. | **Clay** is the base contract every view implements (`ServerViewDef` and its web counterpart). Each view is what the Clay became. |
| **Ore becomes Bronze** | Hephaestus smelts raw ore into finished work. | The dev run (`kedalion dev`, server plus Vite) is the **Ore**. The executable build (`kedalion build`) is the **Bronze**. Both commands live in Hephaestus (`build`). |

These are naming conventions for docs and comments. No type, function or command is renamed.

## Cerberus

Cerberus guards what the app is allowed to run: an update is installed only if `latest.json` is signed with the app's key (`update-key.pub`). The check is one idea spread over three packages, so it keeps one name wherever it appears: `verifyManifest` in Orion, `verifiedRelease` in the Cyclopes, and the signing in Hephaestus.

## Not taken

Ideas that were shown but not chosen: Hephaestus forges Talos, Pegasus born from Medusa, Hydra heads as parallel panels, Pandora's jar for the settings store, Atlas holding up the shell.
