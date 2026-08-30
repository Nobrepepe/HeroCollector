# Hero Collector — MVP

A single-player, menu-first hero-collection progression game, implemented as an
Electron desktop application. No combat simulation, no monetization, no
accounts: you spend a daily Energy allowance on campaign nodes, farm materials
while Development Focus converts the same Energy into deterministic character
shards, craft character-themed equipment, raise Stars and Gear Tiers, and build
parties whose tag synergies beat visible Power thresholds.

## Run

```bash
npm install          # once (downloads Electron)
npm start            # launches the desktop app
```

The save lives in the OS user-data folder (Linux: `~/.config/hero-collector/save.json`)
with one rolling backup; Settings offers export/import and a clean reset.

For a quick browser preview without Electron, serve the folder over HTTP
(`python3 -m http.server 8765`) and open `http://localhost:8765` — the save
then uses localStorage instead, and the bundled default content pack carries
the game.

## Development

```bash
npm run generate     # regenerate content/*.json from scripts/generate-content.mjs
npm test             # rules tests (GDD Appendix B invariants) + full simulated playthrough
node scripts/playtest.mjs [days] [seed]   # balance harness on default_content.json
```

The hidden developer panel toggles with **Ctrl+Shift+D** or from Settings:
grants, node unlock/relock, reset-day advancement, RNG seeding, power/synergy
traces, manifest import, content validation, and the hero reveal plan — where
the compiler decided each hero enters the game, so the consequence of
reordering a production is visible before playing it.

## Progression systems (the goal-driven overhaul)

The central principle: ordinary play continuously produces both Gear materials
and shards; the player decides which materials to pursue and which Heroes to
develop.

- **Development Focus** — three global slots (Primary 1 shard/24⚡, Secondary
  1/30, Long-term 1/40). Every point of Energy spent on any campaign node
  advances all three meters; shards apply automatically and progress carries
  between days. 120 Energy ≈ 12 deterministic shards. A revealed Hero can
  receive shards before being recruited.
- **Encounters** — campaign nodes may carry an encounter: the first clear
  reveals that Hero (making them a Focus target) and stakes 2 shards. Every
  Hero needs one, because none of them is guaranteed to start owned.
  Recruitment and Star promotion remain deterministic cumulative thresholds.
- **The starting five** — Heroes are equal in power, so there are no
  acquisition tiers: every Hero recruits for the same 10 shards and joins at
  1★. Which five a save begins with is drawn when the save is created —
  seeded from its own creation timestamp, preferring distinct archetypes —
  and recorded in the save, never marked in the content.
- **World Programs** — each world's Headquarters runs three automatic
  Programs: Procurement (Energy on that world's nodes → material shipments of
  a chosen family), Development (shards applied to that world's heroes →
  bonus shards for a chosen hero), Operations (completed routes → visibly
  improved routes next cycle). No timers, no construction, no currencies.
- **Relics** — one four-piece relic per world, found by first-clearing World
  Campaign nodes 4, 9, 15, and 21. Pieces grant Mastery; the reconstructed
  relic installs into exactly one Program and visibly improves its payouts.
- **Crises** — generated per world from `content/crises.json`: generic Fronts
  (Containment, Relief, Investigation, Evacuation, Intervention) scoped to a
  world, favouring only archetypes and factions its own roster actually
  carries, presented on the world's own cover. Recommended Front Power is
  computed *when the Crisis spawns*, from the strongest disjoint teams the
  roster could field, so a Crisis can never be outgrown — raw Power alone
  falls just short and a matched favoured tag is what carries a Front.
- **World Mastery** — a derived 0–1,000 track per world (350 campaign, 350
  heroes, 200 gear, 100 relic) with the Unfamiliar → Mastered ranks.
  Milestones grant only visible, finite rewards — chosen material caches,
  targeted shards, Field Supplies, skins — never passive percentages.
- **Expeditions** — one board per cycle, read top to bottom: each route is a
  row carrying a 16:9 plate, and that same plate becomes the ground of its
  party screen, so choosing a route and walking into it are one picture. A
  world-scoped route uses its world's backdrop; an across-world route uses the
  production's board art. Choose up to three, assign every party together, and
  everything launches and returns together four days later. The board waits
  indefinitely; rerolls and pins are per-cycle;
  character-lead routes take a *chosen* revealed hero. Routes are generated
  from `content/expeditions.json`: eight archetypes, each owning its party
  size, predicates, reward curve, Power ratio and frequency. A world-scoped
  archetype becomes one route per world (“Supply Line: Hidden Village”), and
  what a route asks is rendered from the predicate itself, never authored.
- **Field Supplies** — stored strategic consumables with three targeted
  modes: a material requisition, hero tutoring, or a one-attempt Surge past a
  near-miss Power gate. No daily use requirement.

## Architecture

- `content/*.json` — system data only: balance constants, archetypes, 30
  materials, 30 components, 36 recipe templates, 10 tier profiles, universal
  tag rules, every campaign rule the compiler applies, the Expedition route
  archetypes and the Crisis Front templates. Generated by
  `scripts/generate-content.mjs` — never hand-edited.
- **Creative Manifests** — a publication states identities, order, names, lore
  and art; it decides nothing. Thresholds, material families and grades, node
  types and rewards, relic and reveal positions, objectives, acquisition and
  Mastery ranks are all compiled from `content/balance.json`, so renaming a
  node can never move its Power. A manifest arrives from a World Hub
  publication, a dev-panel import, or the bundled `default_content.json`, and
  flows through `normalizeManifest → compileManifest → buildContent →
  validateContent`; incomplete content is held back with a readable health
  report instead of breaking the game. No mechanical library reaches the
  game from a publication any more.
- **What the compiler decides** — world order sets each world's progression
  slot and roster order sets who is revealed where. A Main Campaign chapter
  left without a backdrop borrows the one belonging to the world it
  introduces, so the Journey tracks which world is about to open. The Main Campaign
  introduces every world's opening party of five, because a World Campaign
  stays locked until five of its own heroes are owned; each world's campaign
  then reveals the rest of its roster, evenly spread across its thirty nodes.
- `src/core/compile/` — the content compiler: `campaigns.js` (thresholds,
  materials, node types, rewards, relic positions), `roster.js` (which node
  reveals which hero), `expeditions.js` and `crises.js` (world-scoped routes
  and Fronts from the game's own archetype libraries).
- `src/core/` — deterministic domain logic, UI-independent and fully
  unit-tested: `state.js` (all transactions), `focus.js`, `programs.js`,
  `mastery.js`, `relics.js`, `expeditions.js`, `crises.js`, `energy.js`,
  `power.js`, `synergy.js`, `progression.js`, `validate.js`, `rng.js`.
- `src/ui/` — the screens (Today, Collection, Character, Party, Worlds,
  Journey, Node, Expeditions, Workshop, Programs, Mastery, Crisis, Settings)
  plus the dev panel; screens only call core transactions and re-render.
- `electron/` — desktop shell; save I/O over IPC, content loaded from disk.
- `tests/` — transaction invariants, per-system suites, a pack-upgrade suite,
  World Hub conformance fixtures, and a full greedy-bot playthrough proving a
  fresh save can complete the campaigns, take all 20 sample characters to 7★,
  and reassemble both relics using only in-game systems.

## World Hub content

Hero Collector consumes [World Hub](../WorldHub) publications (Package
Protocol 1, Application Contract 1). The authoritative contract lives at
`worldhub/application-contract.json`, and asks for **30 fields**: the Main
Campaign's chapter titles, backdrops and node names, each world's look, campaign names,
relic fiction and ordered Mastery cosmetics, each character's archetype,
faction and equipment names, and the factions themselves as canonical `group`
entities. Characters carry no glyph (a name already contains its initial) and
no accent colour (they are shown by their art). Art roles: `world.cover` and
`world.background` for worlds, `character.tile` (16:9) and
`character.full_body` for people, `character.collectible` (1:1) for
equipment. Nothing in it decides anything — a
test enumerates every field and fails if the contract grows one back.

A publication published under an older revision of the contract is **refused**
with an instruction to republish, rather than installed with every authored
name silently replaced by “Node 1”.

- **Install** — World Hub screen → *Install publication ZIP…*, or link the
  World Hub production folder (the one containing `current.json`) and use
  *Check for update*. Packages are extracted to staging, validated completely
  (safe ZIP paths, manifest, embedded contract, every checksum, references),
  adapted, and still pass the game's own `validateContent()` before
  activation. A rejected package changes nothing; the previous publication is
  retained for *Roll back*.
- **Pipeline** — a package adapts into a Creative Manifest, which the content
  compiler turns into runtime content:
  `adaptPackageToManifest → normalizeManifest → compileManifest → buildContent
  → validateContent`. World Hub is the authority on what exists and what it is
  called; every number, position and reward is compiled here.
- **Media** — packaged art is served through the narrow `hcpkg://` protocol,
  which resolves only files inside installed publication directories — no
  data URLs and no filesystem access from the renderer.
- **Saves** — player state is app-owned and reconciles through the existing
  `syncSaveWithContent` behavior: characters that leave a publication go
  dormant in the save, never deleted. A one-time explicit legacy-ID → Hub-UUID
  migration (`worldhub:migrate-save`) backs up the save first and only applies
  mappings you provide — ambiguous matches are never guessed.
- **Provenance** — installs are copied into the app's own
  `worldhub-content/` with a receipt per publication (source library,
  production, publication, contract version), so the game works offline from
  its cache.
