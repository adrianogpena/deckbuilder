# Khala codenames and rename plan

This file is the handover for the rename of DeckBuilder to **Khala**. It records what was decided, what is still open, and which codename each part received. Nothing in the code has been renamed yet; the rename was deliberately postponed.

Internal codenames for the app, its views and its packages, taken from StarCraft. They appear in docs and code comments only. Menu labels, package ids (`view-explorer`, `@deckbuilderkit/ui`) and persisted identifiers stay as they are.

## Status of the rename

Decided:

- The new name is **Khala**. The codenames below were chosen to go with it.
- Only the owner uses the app, so there are no other users to migrate. A full rename is acceptable.
- The `@deckbuilderkit/*` packages are not to be published to npm. Users get only the app's executable (the "gallery" release). This was the stated intent; confirm before deleting anything.
- Home, Grid and Tabs stop being main views.

Open (ask the owner before doing these):

- Whether the app id (`APP.id` in `apps/gallery/app.ts`, now `deckbuilder`) becomes `khala`. If it does, the data folder `~/.deckbuilder` must be moved by hand on the owner's machine (`mv ~/.deckbuilder ~/.khala`, app closed). Check whether secrets live in that folder or in the OS keychain.
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
- The Grid view and the Dashboard share one package, `view-grid`. The Dashboard (`dashboardServerView`, its panels and sources) must stay; remove only the Grid parts. Its codename is Swarm Host.
- Do this as its own commit, apart from the rename.

## Verified against the code

The wordplay pairs below were checked by reading the code (not by running it): `ServerViewDef` at `packages/server-core/src/views.ts:38` and `ViewDef` at `packages/ui/src/views.ts:41`; `dbConnections` in `packages/db/src/app-stores.ts`; `useSqlRunner`, `SqlResults` and `PlanView` in `packages/sql-ui/src`; `projects` in `packages/server-mods/src/app-stores.ts`; the `dev` and `build` commands in `packages/build/src/cli.ts`; the signature check in `packages/server-mods/src/update.ts`.

## Name availability

Checked by web search only. The npm package `khala` is taken (irrelevant without publishing). Phala Network has a parachain called Khala on Kusama. One unrelated U.S. trademark application (MAHA KHALA, meditation software) turned up. Not checked: GitHub user/org/repo names, domains, trademark databases beyond the U.S. For personal use this is free in practice; search the USPTO and EUIPO databases before any public release.

The scheme follows the three races:

- **Protoss** is the foundation: the app, the shared base, the server core, Agents and Settings.
- **Zerg** is every view that runs something, and the package behind it.
- **Terran** is the shared tools and build tooling.

## App

| Codename | Applies to | Alternatives |
|---|---|---|
| **Khala** | The whole app | Magi, Pharos, Wintermute |

## Views

| Codename | Race | Applies to | Alternatives |
|---|---|---|---|
| **Hive** | Zerg | Explorer | Lair, Warren, Burrow |
| **Nydus** | Zerg | Terminal | Conduit, Uplink, Wormhole |
| **Mutalisk** | Zerg | REST | Scourge, Corruptor, Guardian |
| **Extractor** | Zerg | Workbench (SQL) | Assimilator, Refinery, Geyser |
| **Brood** | Zerg | Git | Cerebrate, Egg, Chrysalis |
| **Overseer** | Zerg | Dashboard | Observer, Sensor Tower, Science Vessel |
| **Probe** | Protoss | Agents | Drone, SCV, Queen |
| **Forge** | Protoss | Settings | Evolution Chamber, Engineering Bay, Armory |

## Packages and layers

| Codename | Race | Applies to | Alternatives |
|---|---|---|---|
| **Pylon** | Protoss | `ui` (shared components) | Supply Depot, Overlord, Psionic Matrix |
| **Nexus** | Protoss | `server-core` | Hatchery, Command Center, Mothership |
| **Prism** | Protoss | `shell` (native window host) | Shuttle, Medivac, Arbiter |
| **Aiur** | Protoss | `platform` (OS integration) | Char, Mar Sara, Shakuras |
| **Preserver** | Protoss | `db` (stores) | Khalai, Stasis Ward, Cerebrate |
| **Khaydarin** | Protoss | Theme and palette | Vespene, Void, Nerazim |
| **Zergling** | Zerg | `terminal` (the package behind Nydus) | Broodling, Larva, Baneling |
| **Lurker** | Zerg | `sql-ui` (results grid) | Ravager, Roach, Defiler |
| **Swarm Host** | Zerg | `view-grid` (Dashboard panels) | Brood Lord, Infestor, Carrier |
| **Annex** | Terran | `server-mods` (fs, http, archive, backup, update) | Tech Lab, Reactor, Machine Shop |
| **Raven** | Terran | `editor` (rich Markdown) | Ghost, Scribe, Academy |
| **Factory** | Terran | `build` (executable build) | Starport, Barracks, Spawning Pool |
| **Marine** | Terran | `scripts/` (typecheck, boundary and button checks, screenshots) | Firebat, Reaper, Hellion |
| **Zealot** | Protoss | The update signature check: `verifyManifest` (`server-core`), `verifiedRelease` (`server-mods/src/update.ts`) and the signing side in `build` (`keys.ts`, `release.ts`) | Sentry, Stalker, Photon Cannon |

## Wordplay

Pairs where one thing becomes or spawns the other, as in the game.

| Pair | The play | Mapping |
|---|---|---|
| **Swarm Host spawns Locusts** | The host spawns small temporary units. | `view-grid` is the Swarm Host. Each Dashboard panel is a **Locust**. |
| **Drone becomes Extractor** | A Zerg building is made by sacrificing a Drone. | A saved database connection (in `db`) is the **Drone**. Opening it in the Workbench turns it into the Extractor. |
| **Hydralisk morphs to Lurker** | One evolves into the other. | Running a query and its result grid is the **Hydralisk**. The explain plan, which sits quietly and shows a line, is the Lurker (`sql-ui`). |
| **Hatchery → Lair → Hive** | The Zerg tech chain. | A registered project root is the **Hatchery**. A root opened in Explorer is the **Lair**. The whole Explorer view is the Hive. |
| **Larva becomes any unit** | Every Zerg unit starts as a Larva. | **Larva** is the base contract every view implements (`ServerViewDef` and its web counterpart). Each view is what the Larva became. |
| **Gateway → Warp Gate** | A building morphs into its faster form. | The dev run (`deckbuilder dev`, server plus Vite) is the **Gateway**. The executable build (`deckbuilder build`) is the **Warp Gate**. Both commands live in the Factory (`build`). |

These are naming conventions for docs and comments. No type, function or command is renamed.

## Zealot

Zealot guards what the app is allowed to run: an update is installed only if `latest.json` is signed with the app's key (`update-key.pub`). The check is one idea spread over three packages, so it keeps one name wherever it appears: `verifyManifest` in Nexus, `verifiedRelease` in Annex, and the signing in Factory.

## Not taken

Ideas that were shown but not chosen: Probe builds Pylon, Zergling morphs to Baneling, Creep Colony becomes Spore or Spine, High Templar + High Templar = Archon, Overlord morphs to Overseer.
