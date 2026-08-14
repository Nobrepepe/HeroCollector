# Hero Collector — MVP

A single-player, menu-first hero-collection progression game, implemented from the
*Hero Collection Progression Game MVP GDD* as an Electron desktop application.
No combat simulation, no monetization, no accounts: you spend a daily Energy
allowance on campaign nodes, farm materials and character shards, craft
character-themed equipment, raise Stars and Gear Tiers, and build parties whose
tag synergies beat visible Power thresholds.

## Run

```bash
npm install          # once (downloads Electron)
npm start            # launches the desktop app
```

The save lives in the OS user-data folder (Linux: `~/.config/hero-collector/save.json`)
with one rolling backup; Settings offers export/import and a clean reset.

For a quick browser preview without Electron, serve the folder over HTTP
(`python3 -m http.server 8765`) and open `http://localhost:8765` — the save
then uses localStorage instead.

## Development

```bash
npm run generate     # regenerate content/*.json from scripts/generate-content.mjs
npm test             # rules tests (GDD Appendix B invariants) + full simulated playthrough
node scripts/simulate.mjs [days]   # pacing trace of the greedy playthrough bot
```

The hidden developer panel (GDD 12.5) toggles with **Ctrl+Shift+D** or from
Settings: grants, node unlock/relock, reset-day advancement, RNG seeding, shard
simulation, power/synergy traces, and content validation.

## Content Creator — the game's content is yours

**All playable content is authored in-app.** The shipped files carry only
system data (balance, archetypes, materials, components, recipes, universal
tag rules); worlds, characters, the Main Campaign, and archives live in the
creator database. A fresh install boots into **setup mode** — a readiness
checklist replaces the game screens until the content meets the minimum
prerequisites for a playable save:

1. at least one **published world**,
2. at least **5 starting characters** (Minor characters flagged "starting"),
3. at least one live **Main Campaign chapter**,
4. at least one complete **Shadow Campaign chapter**.

While in setup mode the Content Creator is always in the sidebar; once the
game is playable it moves behind the dev-tools toggle (**Ctrl+Shift+D**).

- **Worlds** — create, edit, delete. A world stays a **draft** until it has at
  least 5 characters, each with a shard source; only then can it be
  **published**. Unpublishing keeps owned progress dormant until republish.
- **Characters** — name, archetype, acquisition tier, starting flag, faction
  (creatable), tags, description, lore, six named equipment lines.
- **Main & Shadow Campaigns** — paired chapters of 10 nodes. Main is an
  unlimited material campaign with checkpoints at 5/10. Every Shadow node is
  a five-runs-per-day shard source unlocked by its matching Main node.
- **World Campaigns & Archives** — each world's 3×10 campaign with editable
  names/thresholds/materials and optional same-world shard drops, plus 3
  collections × 5 relics with lore, art, milestone rewards, and the
  full-Archive character skin.
- **Art import** — cropped/resized in-app, stored in the creator database:
  character portrait (square) + full body (9:16), world banner (16:9), six
  equipment images per character (square), relic art (16:9), skin portrait +
  full body.
- **Sample worlds** — the original two worlds ship as
  `content/sample-pack.json`; one click in the Creator imports them as fully
  editable content (or ignore them and build from scratch).
- Everything lives in `custom-content.json` in the user-data folder (with a
  rolling backup); incomplete content is held back with a readable health
  report instead of breaking the game. Content packs export/import as JSON.

## Architecture (GDD §12)

- `content/*.json` — versioned static content: 2 worlds, 20 characters, tags,
  30 materials, 30 components, 36 recipe templates, 10 tier profiles,
  100 campaign nodes, 30 Archive relics, and all balance constants.
  Generated (and re-generatable) by `scripts/generate-content.mjs`; expansion is
  data entry, not new logic.
- `src/core/` — deterministic domain logic, UI-independent and fully unit-tested:
  - `power.js` — Character Power (1,000 base + Stars + Gear; launch progression
    is capped by the highest freely farmable material grade)
  - `synergy.js` — tag-driven party bonuses in basis points, 25% global cap,
    full explainability (active bonuses + what's missing)
  - `state.js` — all transactions (clear/sweep, craft, upcraft, equip, tier
    completion, promotion, unlock, pins, daily reset); each validates first and
    applies atomically
  - `validate.js` — content and save validation with readable error reports
  - `rng.js` — seedable mulberry32 for reproducible rewards
- `src/ui/` — the ten required screens (Home, Roster, Character, Party Builder,
  Campaign Map, Node, Results, Inventory/Crafting, World Archive, Settings) plus
  the dev panel; screens only call core transactions and re-render.
- `electron/` — desktop shell; save I/O over IPC, content loaded from disk.
- `tests/` — Appendix B transaction invariants, rule correctness, and a full
  greedy-bot playthrough proving a fresh save can complete the campaigns, take all
  20 characters to 7★ / the current Gear Tier cap, and complete both Archives
  using only in-game systems.

## World Hub content

Hero Collector can consume [World Hub](../WorldHub) publications (Package
Protocol 1, Application Contract 1). The authoritative contract lives at
`worldhub/application-contract.json`.

- **Install** — World Hub screen → *Install publication ZIP…*, or link the
  World Hub production folder (the one containing `current.json`) and use
  *Check for update*. Packages are extracted to staging, validated completely
  (safe ZIP paths, manifest, embedded contract, every checksum, references),
  adapted, and still pass the game's own `validateContent()` before
  activation. A rejected package changes nothing; the previous publication is
  retained for *Roll back*.
- **Pipeline** — a package adapts into the same custom-content database shape
  the Creator produces, then flows through the existing
  `mergeContent → buildContent → validateContent` pipeline. World Hub is the
  content authority; the game engine (balance, formulas, recipes) stays
  bundled here.
- **Media** — packaged art is served through the narrow `hcpkg://` protocol,
  which resolves only files inside installed publication directories — no
  data URLs and no filesystem access from the renderer.
- **Hub mode** — while a publication is active the Content Creator is retired
  (navigation replaced by the World Hub screen, mutation IPC disabled) and
  legacy Creator data stays untouched on disk; removing the publication
  returns the app to legacy content. The Creator/merge path becomes removable
  once real content parity is confirmed with your own worlds.
- **Saves** — player state is app-owned and reconciles through the existing
  `syncSaveWithContent` behavior: characters that leave a publication go
  dormant in the save, never deleted. A one-time explicit legacy-ID → Hub-UUID
  migration (`worldhub:migrate-save`) backs up the save first and only applies
  mappings you provide — ambiguous matches are never guessed.
- **Provenance** — installs are copied into the app's own
  `worldhub-content/` with a receipt per publication (source library,
  production, publication, contract version), so the game works offline from
  its cache.
