# Khala codenames

Internal codenames for the app, its views and its packages, taken from StarCraft. They appear in docs and code comments only. Menu labels, package ids (`view-explorer`, `@deckbuilderkit/ui`) and persisted identifiers stay as they are.

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

## Wordplay

Pairs where one thing becomes or spawns the other, as in the game.

| Pair | The play | Mapping |
|---|---|---|
| **Swarm Host spawns Locusts** | The host spawns small temporary units. | `view-grid` is the Swarm Host. Each Dashboard panel is a **Locust**. |
| **Drone becomes Extractor** | A Zerg building is made by sacrificing a Drone. | A saved database connection (in `db`) is the **Drone**. Opening it in the Workbench turns it into the Extractor. |
| **Hydralisk morphs to Lurker** | One evolves into the other. | Running a query and its result grid is the **Hydralisk**. The explain plan, which sits quietly and shows a line, is the Lurker (`sql-ui`). |
| **Hatchery → Lair → Hive** | The Zerg tech chain. | A registered project root is the **Hatchery**. A root opened in Explorer is the **Lair**. The whole Explorer view is the Hive. |
| **Larva becomes any unit** | Every Zerg unit starts as a Larva. | **Larva** is the base contract every view implements (`ServerViewDef` and its web counterpart). Each view is what the Larva became. |
| **Gateway → Warp Gate** | A building morphs into its faster form. | The dev build (`deckbuilder dev`) is the **Gateway**. The release build (`deckbuilder build`) is the **Warp Gate**. Both are run by the Factory (`build`). |

These are naming conventions for docs and comments. No type, function or command is renamed.

## Reserved

- **Zealot** is free. It was `scripts/` until that moved to Marine to keep the scheme clean. It is a Protoss core name, so it fits a guard that protects the foundation, such as the update signature check (`update-key.pub`) or the package boundary check.

## Not taken

Ideas that were shown but not chosen: Probe builds Pylon, Zergling morphs to Baneling, Creep Colony becomes Spore or Spine, High Templar + High Templar = Archon, Overlord morphs to Overseer.
