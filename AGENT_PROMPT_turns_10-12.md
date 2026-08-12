# Implementation prompt — Hero Collector UI, design turns 10–12

Paste this whole file to the coding agent working in `Nobrepepe/HeroCollector` (branch `main`).

---

You are implementing an approved UI redesign into this repository. The design lives in
`Hero Collector Redesign.dc.html` (sections `#t10`, `#t11`, `#t12`; screens are labelled
`10a`, `10b`, `11a`–`11e`, `12a`–`12c`). Read those sections for exact pixel layout and copy —
this document is the spec, the design file is the reference render.

Do not restyle screens outside the scope below. Do not introduce a CSS framework, a build step,
or new dependencies. Match the existing vanilla-JS module structure in `src/ui/` and `src/core/`.

## 0. Scope

| Screen | New/changed | Target files |
| --- | --- | --- |
| 10a Home resynced | change | `src/ui/home.js`, `src/ui/presentation.js`, `src/core/energy.js`, `src/app.js`, `styles.css` |
| 10b Daily-reset summary | new | `src/app.js`, `src/core/expeditions.js`, `src/core/crises.js` |
| 11a Expeditions board | new | `src/ui/expeditions.js`, `src/core/expeditions.js` |
| 11b Expedition party builder | new | `src/ui/expeditions.js`, `src/core/expeditions.js` |
| 11c Headquarters | new | `src/ui/headquarters.js`, `src/core/hq.js`, `src/core/energy.js` |
| 11d Crisis Front | new | `src/ui/crisis.js`, `src/core/crises.js` |
| 11e Crisis resolved / Cache | new | `src/ui/crisis.js`, `src/core/crises.js` |
| 12a World selection | new | `src/ui/worlds.js` (create), `src/app.js` (route) |
| 12b/12c World hub | new | `src/ui/worlds.js`, `src/core/state.js`, `src/core/hq.js` |

## 1. Design language — obey on every screen

These rules are already in the shipped screens; the new ones must not break them.

- **Palette.** Page `#12100f`; text `#f4ece1`; secondary `#b8aca1`; tertiary `#a2958a`;
  muted `#8e8278`; dim `#6f645c`; nearly-off `#4a423c`. Accent/interactive `#e9a94f`.
  Positive `#6fc9a0`. Warning/crisis `#c9705f`. No other colours; no new hues.
- **Type.** Headlines and every large numeral in `Instrument Serif`. Everything else `Figtree`.
  Section eyebrows are 11px Figtree, `letter-spacing:.16em`, uppercase, `#8e8278`.
- **The reading is a serif numeral.** Power/effective-power totals render at 76px serif,
  `#6fc9a0` when the requirement is met, `#c9705f` when it is not, with a plain-language
  sentence underneath ("540 to spare — this predicts an exceptional return.").
- **No buttons.** Every action is a text link in `#e9a94f` ending in `→`, optionally with a
  1px gradient rule under it. Disabled/unavailable actions are `#4a423c` text with the reason
  stated beneath in words, never a greyed button or a tooltip.
- **Requirements are sentences, not badges.** `Ready · Send 5 characters (5/5)` in `#6fc9a0`,
  `Still needed · One character at four stars or better (0/1)` in `#c9705f`,
  `Optional · …` in `#8e8278`.
- **Rules, not cards.** Sections separate with 1px gradient rules that fade out to the right
  (`linear-gradient(to right, rgba(244,236,225,.10), transparent 86%)`). No boxes, no border
  radius, no drop-shadow panels except the modal in 10b.
- **Emptiness is stated, not hidden.** An absent system keeps its row, drops to `opacity:.6`,
  and says what is absent in a sentence ("No grounds have been broken here. Nothing about this
  world is missing while it stays that way.").
- **Art slots.** Character art is the existing 16:9 `preserveAlpha` portrait slot
  (`src/ui/images.js`, `portrait: 640×360`). New slots this design needs:
  world art `1920×1080`, HQ landscape `1024×576`, crisis key art `1280×720`,
  expedition offer art `660×860`. Until art exists, render the dashed placeholder with the
  dimension label, exactly as the design does — never a coloured block with no caption.
- **Art treatment.** Art sits behind content under a two-stop scrim: a vertical
  `linear-gradient(to bottom, rgba(18,16,15,.5), rgba(18,16,15,.15) 34%, #12100f 100%)` and a
  horizontal `linear-gradient(to right, rgba(18,16,15,.84) 20%, transparent 64%)` so the left
  text column always has contrast. Art bands are 340–430px tall on hub/detail screens.
- **Motion.** Only two animations exist: `hc-pulse` (2.8s, on crisis/attention dots) and
  `hc-drift` (9s, on the featured hero). Do not add more.

## 2. Turn 10 — Home resynced and the day-open summary

### 10a Home (`src/ui/home.js`)

1. **Navigation is now eight destinations**, in this order:
   Today · Collection · Party · Journey · Expeditions · Headquarters · Workshop · Archive.
   Expeditions carries a right-aligned count in `#e9a94f` when parties are out (`3 out`).
   Only the active item shows the accent dot; the rest are indented 15px to align.
2. **The Energy well holds a second currency.** Under Energy (`96 / 240`, 2px progress rule,
   `+120 more at 4:00`) add Field Supply: a `◈` glyph in `#6fc9a0`, then
   `2 Field Supply of 3 held` and `one use left today · +30 each`. Read the caps from
   `src/core/energy.js` (`fieldSupplyLimits`), never hardcode.
3. **Today's hook now has four threads, and a Crisis outranks the other three.**
   Extend `rankTodayHook`/`todayHookText` in `src/ui/presentation.js` with the crisis thread at
   top priority; existing shard, gear and campaign threads keep their current order beneath it.
4. **Continue gains a Field Supply prompt.** When Energy is short of the next node's cost and a
   Supply is held, render the green dot + sentence:
   `The day is spent, but one Field Supply is waiting. Restore 30 Energy →`.
   The link spends one Supply and re-renders in place.
5. **"Ready when you are" collapses.** Show two figures inline, then a serif `+4` with
   `more are ready →` linking to the filtered Collection. Do not paginate this row.
6. **Tracking rows get pin controls** — `↑ ↓ open unpin` at 11.5px `#6f645c` beneath each bar;
   the unavailable direction renders `#4a423c`, not hidden.

### 10b The day opens (`src/app.js`)

Blocking modal shown once per game day, **before** Today renders, if anything returned overnight
or a Crisis became active. 720px wide, `#191512`, `padding:52px 56px 44px`, a 1px accent
gradient hairline along its top edge, page dimmed to `rgba(10,9,8,.74)`.

- Eyebrow: `Day 148 · 4:00 · +120 Energy` (real day number, real grant).
- Headline, serif 44px, counts what happened: `Two Expeditions have returned.`
- One row per returned expedition: 64×83 portrait, serif 24px name, tier word right-aligned
  (`exceptional` in `#6fc9a0`, `completed` in `#a2958a`), a sentence naming who went, then the
  reward line with Field Supply called out in `#6fc9a0`.
- If a Crisis is active, a `hc-pulse` dot + the no-cost/no-penalty sentence, then
  `Review the Crisis →` with `Leave it for later` beside it as a plain dismiss.
- Rewards were already granted at reset — the modal reports, it never grants. Copy must not
  imply claiming.

## 3. Turn 11 — Expeditions, Headquarters, Crisis Response

All three are planning screens: read a number, place people, commit.

### 11a Expeditions board (`src/ui/expeditions.js`)

- Header: eyebrow `Day 148 · 340 Intelligence`; serif 46px `Five routes are waiting.`;
  a sentence stating slots left and that away parties stay usable everywhere else.
- Top right, two dim lines: reroll state (`1 free reroll left · then 40 Intelligence`) and pin
  state (`Pin used today · reveal costs 25`).
- **Available offers**: a horizontal drag-scrolled shelf of 230×300 cards (offer art is 660×860,
  cropped). Bottom-anchored caption: world + length eyebrow, serif 21px name, then
  `N characters · recommends N,NNN Power`. Guaranteed-Field-Supply offers get a 2px `#6fc9a0`
  top edge and a green eyebrow; the pinned offer gets a 1px `rgba(233,169,79,.45)` border and a
  `pinned` label. An unarted offer renders as the dashed placeholder card with `awaiting art`.
  A 120px fade panel closes the shelf; caption under it:
  `drag sideways · every offer opens its own party builder`.
- **Away today**: one row per active expedition — name, `Returns on day N · <tier>`, the party
  as small portraits, and a right-aligned action: `Cancel before tomorrow` (accent) for today's
  launches, `Launched yesterday` (`#4a423c`) otherwise. Field Supply held for a route is called
  out in `#6fc9a0` inline.
- **Return reports**: serif count of unread, `thirty are kept`, `Open reports ⌄`, and the note
  that acknowledging is one action for all because rewards were granted at 4:00.

### 11b Offer detail / party builder (`src/ui/expeditions.js`)

- Art band 340px with the offer's own art; back link `← Expeditions`.
- Title block: eyebrow `<world> · returns in N days`, serif 52px offer name, flavour paragraph.
- Left column (392px): **Your party reads** → 76px serif total; the spare/short sentence;
  **Expected return** (guaranteed Field Supply first, in `#6fc9a0`, with "never multiplied by the
  tier"; then the rolled rewards); the concealed rare lead with
  `Reveal for 25 Intelligence →`; **What the route asks** as the requirement sentence list.
- Right column: **Choose five expedition members** — five 168×94 portrait slots with name,
  stars, power. Empty slots are dashed with a `+`, labelled `Open place / choose someone` and a
  hint in accent naming what would satisfy the unmet requirement (`a four-star fits here`).
- Commit: serif 30px `Send them →`, rendered `#4a423c` while any requirement is unmet, with
  `one requirement is still unmet` beneath. Beside it, `Unpin offer` and `Reroll this offer` —
  the reroll shows `— pinned offers cannot reroll` in `#4a423c` when pinned.

### 11c Headquarters (`src/ui/headquarters.js`)

- Top-left world switcher: founded worlds as small stacked name/rank pairs, active one underlined
  in accent, unfounded ones `#4a423c` reading `not founded`.
- Art band 430px, HQ landscape 1024×576. **Place the art caption in the empty middle of the band
  (`left:600px`), clear of the left text column and the right reserves column.**
- Title: eyebrow `World Headquarters`, serif 52px world name + `Rank N` in accent, then the
  next-unlock sentence. If a Crisis is active here, the `hc-pulse` dot + no-cost sentence +
  `Review it →`.
- Right: **Development reserves** — two serif 34px numerals (Renown, world currency).
- **The grounds**: facilities positioned along an irregular path (not a grid, not a row of equal
  cards) — each is a dot, a name, `Level X of Y`, and one effect or cost line. Built facilities
  get a glowing accent dot; unbuilt get a hollow ring, a name in `#a2958a`, and either the cost
  in accent (`220 Renown · 40 Sigils · 1 day`) or the gate in dim (`opens at Rank 4`).
- **Current construction**: serif sentence naming what finishes and when, then the account-wide
  warning — `The construction slot is account-wide — no other Headquarters can build until this
  finishes.` — and `Cancel and refund`. This must be stated on screen, not discovered by tabbing.
- **Staff · N of M placed**: portrait row with dashed empties, and the reassurance that staff
  keep working while they fight.

### 11d Crisis Front (`src/ui/crisis.js`)

- Full-bleed crisis key art (1280×720) under a diagonal scrim; back link
  `← Leave it for later`.
- Header: eyebrow `Grade II · <world>` in `#c9705f`, serif 52px headline naming the ask, flavour
  paragraph ending on the no-loss guarantee — **failure removes nothing; the copy must never
  threaten.**
- **Front stepper**: three 240px columns with a dot and connector — filled green when complete,
  glowing accent for current, hollow for untouched — plus name and `N of 4 assigned`.
- Current Front: eyebrow `Front N · <name>`, serif 30px situation line, and
  `Favored here: <world> and <archetype>.` with the tags in `#f4ece1`.
- **Effective Power** at 76px serif with the spare/short sentence, and the arithmetic spelled out
  beneath in dim: `7,200 base · +20% for one favored tag · 7,400 recommended`.
- Roster: `Choose exactly four · no one may answer two Fronts`, 150×84 slots; favored characters
  labelled `favored · <tag>` in `#6fc9a0`, others `N★ · no favored tag`. Empty slot hints what
  would help (`a Guardian lifts this Front`).
- Bottom right: serif `Next Front →`, with `Previous Front · the response commits on the third`.

### 11e Crisis resolved (`src/ui/crisis.js`)

- Headline states the outcome in world terms (`Eden Magic Academy has room to breathe.`).
- One block per Front: status dot, name, outcome word right-aligned (`excelled` `#6fc9a0`,
  `succeeded` `#a2958a`), a written sentence of what happened, then the effective power in dim.
- If mastered, an accent dot and the boon sentence naming where it lives
  ("The boon sits in the Energy well until it is spent.").
- **Emergency Cache · choose one**: three options as left-bordered blocks (accent border on the
  affordable/recommended one). An option that cannot be taken drops to `opacity:.55` and states
  why in `#c9705f` (storage full) rather than disappearing.
- Footer: `The Cache waits until it is claimed. Nothing here expires at 4:00.`

## 4. Turn 12 — Worlds (new surface, `src/ui/worlds.js`)

Nothing here exists in code. It is grounded in what the code already knows about a world:
`campaignId` + tagline, the owned-character entry gate (`worldCampaignUnlocked` reads
owned/needed), an HQ that may not be founded, a world asset, and a Crisis that may be active.

Two decisions that are not negotiable:

- **Selection is a stage, not a grid.** One world holds the art at a time, so worlds read as
  places rather than menu items.
- **The hub has no tiles.** Each destination is a line with its own live reading, so an untouched
  world is visibly emptier than one you live in.

### 12a World selection

- Eyebrow: `Worlds · six known, three open`.
- Left column, 392px, the full world list in four states, degrading downward:
  - **Selected** — 2px accent left border, faint accent wash, serif 27px name, a state word on
    the right (`crisis` in `#c9705f`, or `2 out` in dim), and the reading line
    `Chapter 4 of 6 · HQ Rank 3 · 9 of 12 characters`.
  - **Open** — serif 25px `#b8aca1`, same reading line in `#6f645c`.
  - **Locked** (below a hairline divider) — serif 23px `#6f645c`, reading replaced by the gate:
    `2 of 3 characters owned · one more opens it`.
  - **Unseen** — `Unnamed` in `#4a423c`, `no characters of this world have been seen`.
- Bottom-left note: `A locked world can still be walked into — the campaign previews, nothing can
  be entered.` Implement this: entering a locked world shows the hub in preview, with every
  destination inert and its gate stated.
- Right, over the art: `Selected` eyebrow, serif 60px name, the tagline, a `hc-pulse` dot with
  the active-crisis sentence, then serif 34px `Enter the <world> →` with a right-fading rule.

### 12b/12c World hub — one template, two readings

- Art band 396px with the world's art; back link `← Worlds`.
  **Art caption sits at `left:620px; top:302px`** — in the empty middle of the band, below the
  headline and clear of the "Held here" column. Do not move it under the title.
- Title block: eyebrow that states the world's relationship to the player
  (`Day 148 · your fourth world`, or `Day 148 · opened yesterday`), serif 60px name, tagline.
- Right: **Held here** — the world currency numeral and `owned / total characters`. At zero the
  currency numeral renders `#6f645c` rather than being hidden.
- Full-width hairline, then the destination list (640px left column). Each destination is a line:
  serif 32px name, a right-aligned reading, and a sentence with the action link.
  - **Crisis** pins to the top of the list *only while active today*, with the pulse dot,
    `crisis · today only` in `#c9705f`, and `Answer it →`. When the world cannot host one it
    drops to the **bottom** of the list at `opacity:.6` and states the gate
    (`not while the roster is this thin` / `Five owned characters of this world before one can
    call.`).
  - **Chapters** — `Chapter 4 of 6 · 7 of 10 cleared`, a 2px two-stage progress rule (cleared in
    accent, in-chapter remainder at `rgba(244,236,225,.14)`), and the next threshold + `Continue →`.
  - **Headquarters** — `Rank 3 · building until day 149` and what finishes/what is affordable,
    with `Visit →`. Unfounded: `not founded`, `opacity:.6`, and the sentence that nothing is
    missing while it stays that way — no "Found HQ" call to action.
  - **Relics** — `5 of 9 recovered` and where the next ones sit, `Open the Archive →`.
- Right column (600px): **`<World>` characters** — 88×50 portrait tiles for owned, dashed empties
  for the remainder up to the world's total, then a sentence of context
  (`Three are away on Expeditions and still count everywhere.`) with
  `Open the Collection, filtered →`. On a thin roster, the sentence instead names the two
  reachable acquisitions and links `Show me →`.
- Below a hairline: **Routes leaving from here** — today's world-tagged offer, the away count and
  return day, and `Expeditions →`. With no world route on the board, replace the three columns
  with one sentence: `No Ashfall route is on the board today. Across-world routes still accept
  these three.`

12c is not a separate screen. It is the same renderer with empty data — verify by loading a world
with no HQ, no relics, no crisis eligibility, and 3 of 9 characters.

## 5. Data gaps — resolve before building the hub

1. **Relics have no world field.** `relicPieceModel` in `src/ui/presentation.js` tracks pieces
   globally, so the hub's `5 of 9 recovered` cannot be computed. Add `world` to each relic
   definition and a per-world selector. Until then, render the Relics line with the reading
   omitted and the sentence only — do not fake a count.
2. **A world's character total** must be derived by filtering `content/characters.json` on
   `world`. Add a memoised `charactersByWorld()` selector rather than counting at render time.
3. **BUG-3** (upstream report): four of six worlds have permanently unbuildable Headquarters.
   That makes the world tabs in 11c and the Headquarters line in 12b/12c mostly dead ends. Fix or
   confirm intended before shipping 11c's world switcher.

## 6. Acceptance

- Every screen renders correctly at 1440×900 and degrades sensibly wider; nothing is absolutely
  positioned against a fixed 1440 assumption except the art bands' heights.
- No new colours, fonts, buttons, cards, border radii, or animations beyond §1.
- Load a fresh save: 12b/12c, 11c and 11a all render their empty states as sentences, with no
  blank regions and no zeroed-out numbers presented as achievements.
- A crisis failure path shows no threatening copy anywhere.
- Field Supply, Energy caps, party size, daily grant and storage cap all read from
  `content/balance.json` and `src/core/energy.js` — grep for hardcoded `120`, `240`, `30`, `5`.
