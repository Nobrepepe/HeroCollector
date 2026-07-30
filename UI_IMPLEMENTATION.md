# Handoff: Hero Collector UI redesign

## Overview

Hero Collector is a menu-first, single-player hero-collection game (vanilla ES modules + Electron). The
game works, but the UI reads as a settings dialog: every screen is a stack of bordered `.panel`
boxes with tables inside. This handoff redesigns the player-facing screens and the Content Creator
into one visual language — **art bleeds, edges are implied, data is available but not shouted** —
without changing a single game rule.

Nothing in `src/core/` changes. This is a presentation-layer job: `styles.css`, the render functions
in `src/ui/`, one new asset folder for fonts, and one genuinely new feature (the relic puzzle, §7).

## About the design files

The two files in this bundle are **design references written as HTML**, not production code:

| File | What it is |
| --- | --- |
| `Current UI (recreation).dc.html` | A faithful recreation of the *existing* Home, Roster and Character screens, rebuilt from `styles.css` and `src/ui/*.js`. Use it as the before-state and as a cross-check that a value in this README really is today's value. |
| `Hero Collector Redesign.dc.html` | The proposed design. Four rounds of options, newest at the top, each option tagged `4a`, `3a`…`1c`. |

Both are single-file HTML documents that stream a small runtime; **do not copy their markup into the
app**. They are inline-styled on purpose (so they paint while streaming) and use a component runtime
the game does not have. Your job is to re-express these designs in the game's own idiom: the
`h('div.class', {attrs}, ...children)` helper in `src/ui/dom.js`, real CSS classes in `styles.css`,
and the existing render-function-per-screen structure.

Open the redesign file in a browser and zoom out to see all options at once.

## Fidelity

**High fidelity.** Colours, type sizes, spacing and layout in this README are final. Match them.
Where the design shows a striped rectangle with a monospace caption (`portrait — square`,
`banner 16:9`, `full body 9:16`), that is an **art placeholder**: real artwork will be commissioned
and imported through the existing Content Creator art pipeline (`src/ui/images.js`). Build the
element at the stated size and aspect ratio, and make the no-art fallback deliberate rather than
broken.

---

## 1. Design tokens

Replace the `:root` block in `styles.css`. Old token names stay (a lot of code references
`var(--panel)`, `var(--accent)`); their values change, and several gain a new meaning.

```css
:root {
  --bg:        #12100f;  /* the single floor colour — every screen sits on it */
  --bg2:       #1a1512;  /* only for rare recessed areas; NOT a panel background */
  --bg3:       #221b16;  /* hover wash */
  --panel:     transparent;   /* panels no longer paint a box (see §2) */
  --line:      rgba(244,236,225,.14);  /* hairlines — always used through a fade, see §2 */
  --text:      #f4ece1;
  --text-dim:  #b8aca1;  /* body copy that is not the headline */
  --muted:     #a2958a;
  --muted-2:   #8e8278;  /* labels, eyebrows */
  --faint:     #6f645c;  /* captions, "done", secondary numerals */
  --accent:    #e9a94f;  /* amber — the one action/attention colour */
  --accent-2:  #b48ade;  /* violet — a second, quieter thread (unlock goals, shadow) */
  --good:      #6fc9a0;
  --warn:      #e9a94f;  /* warn and accent are the same amber on purpose */
  --bad:       #c9705f;
  --pin:       #e9a94f;
  --radius:    12px;
  --scale:     1;
  font-size: calc(16px * var(--scale));
}
```

Character/element accent colours used in mockups (these live in creator content, not CSS — listed so
you can reproduce the screenshots): Ashley `#e2603f` / face `#a8462d`, Liadriel `#c9a35e`, Carol
`#b39433`, Bridget `#6e6045`, Elian `#5f93ab`, Tix `#4f8a57`, Kin `#6d6d80`, Aurora `#b06d8c`, Irina
`#4f6f9e`, Malefia `#7a5fa8`.

### Typography

Two families, both vendored locally — `index.html` ships
`Content-Security-Policy: default-src 'self'`, so **do not add a Google Fonts `<link>`**. Download
the woff2 files, put them in `assets/fonts/`, and declare `@font-face` in `styles.css`. If you would
rather load them from a CDN you must add `font-src`/`style-src` entries to the CSP meta tag — prefer
vendoring; it also keeps the app working offline, which Electron users expect.

| Role | Family | Usage |
| --- | --- | --- |
| Display | **Instrument Serif**, 400 | Screen headlines, character names, every large numeral (power, thresholds, shard counts, node numbers), relic names, section titles. |
| UI | **Figtree**, 300/400/500/600 | Everything else: labels, body copy, buttons, table text. |

Scale (px, at `--scale: 1`):

| Token | Size / weight / family | Where |
| --- | --- | --- |
| `display-xl` | 104 / 400 / serif, line-height .98 | Character name on Character screen |
| `display-l` | 88–92 / 400 / serif, line-height 1 | Results headline; "your power" numeral |
| `display-m` | 60–76 / 400 / serif, line-height 1.06 | Screen headline (Home hook, node name) |
| `display-s` | 44–52 / 400 / serif | Section headline (Collection, Journey, Creator) |
| `title` | 30–38 / 400 / serif | Sub-headline (Continue target, relic name, world name in shelf) |
| `numeral` | 19–46 / 400 / serif, tabular | Any number the player reads as a quantity |
| `eyebrow` | 11 / 400 / Figtree, `letter-spacing:.16em`, `text-transform:uppercase`, colour `--muted-2` | The label above every block. **This replaces `.panel h2`/`h3` entirely.** |
| `body` | 15 / 400, line-height 1.6, colour `--text-dim` | Explanatory copy |
| `ui` | 13.5–14.5 / 400–600 | Rows, actions, filters |
| `caption` | 11.5–12.5 / 400, colour `--faint` | Sub-labels, costs, "done" |
| `mono` | 10–11 / ui-monospace | Art-placeholder captions only |

Body copy uses `text-wrap: pretty`.

### Spacing

Screen gutter **52px** (Home's content column starts at 280px to clear the nav rail). Vertical rhythm
between blocks **32–40px**. Inside a block: eyebrow → content **10–22px**. Row padding **11px 0**.
Grid gaps: character shelf 20–26px, relic shelf 24px, gear nodes 30px.

---

## 2. The three rules that replace panels

Every screen in the redesign obeys these. Read them before writing any CSS.

**Rule 1 — there are no boxes.** Delete the `.panel` background, border and radius. A "panel" becomes
a block of content on the page floor, introduced by an `eyebrow` label. Keep the class name if it
saves churn, but it should paint nothing:

```css
.panel { background: none; border: 0; border-radius: 0; padding: 0; margin: 0 0 36px; }
```

**Rule 2 — every rule fades out.** A hairline never runs corner to corner. Use a gradient, never a
solid `border-top`:

```css
.hr {
  height: 1px; border: 0;
  background: linear-gradient(to right,
    transparent, rgba(244,236,225,.14) 6%, rgba(244,236,225,.14) 74%, transparent);
}
```

The right-hand stop varies (55–84%) so consecutive rules do not end on the same vertical — that
irregularity is the point. Dense tables (§6, Creator chapter editor) may use a flat
`border-bottom: 1px solid rgba(244,236,225,.07)` per row; that is the only exception.

**Rule 3 — art bleeds and is masked, never cropped to a rectangle.** Every image is faded into the
floor with a mask instead of being clipped by a border:

```css
.bleed-portrait { -webkit-mask-image: radial-gradient(72% 72% at 50% 46%, #000 58%, transparent 94%);
                  mask-image: radial-gradient(72% 72% at 50% 46%, #000 58%, transparent 94%); }
.bleed-tall     { -webkit-mask-image: radial-gradient(70% 64% at 50% 46%, #000 56%, transparent 92%);
                  mask-image: radial-gradient(70% 64% at 50% 46%, #000 56%, transparent 92%); }
.bleed-wide     { -webkit-mask-image: radial-gradient(78% 76% at 50% 46%, #000 56%, transparent 92%);
                  mask-image: radial-gradient(78% 76% at 50% 46%, #000 56%, transparent 92%); }
```

Full-bleed background art additionally gets a scrim so text stays legible:
`linear-gradient(to bottom, rgba(18,16,15,.75), transparent 32%, rgba(18,16,15,.35) 66%, #12100f 100%)`.

**Buttons.** `.btn` loses its box too. The primary action is serif text in `--accent` above a
1px rule that fades to the right; secondary actions are plain `ui`-size text in `--muted`. Keep
`:focus-visible` exactly as it is today (3px `--accent` outline, 2px offset) — accessibility does not
get redesigned. Disabled = `--faint`, no underline, `cursor: not-allowed`.

```css
.btn.primary {
  background: none; border: 0; padding: 0 0 8px;
  font-family: 'Instrument Serif', serif; font-size: 34px; line-height: 1; color: var(--accent);
  border-image: linear-gradient(to right, transparent, var(--accent)) 1;
  border-bottom: 1px solid; cursor: pointer;
}
```

---

## 3. Screen-by-screen

Coordinates below are from a 1440×900 frame. They are ratios, not absolutes — the app is a resizable
Electron window, so express them as flex/grid with the stated gutters and column widths, and let the
content column grow.

### 3.1 Navigation shell (`src/app.js` → `renderSidebar`, `renderTopbar`)

- Sidebar: 210px → **keep the width**, drop the `#sidebar` background and right border. The rail sits
  directly on `--bg`, gutter 44px.
- Logo: `Hero Collector` at 26px Instrument Serif, "Collector" in `--accent`.
- Nav items: no pill, no icon column. 14.5px Figtree, `--muted-2`. The active item is `--text`,
  weight 600, prefixed by a 5px amber dot with `box-shadow: 0 0 14px 3px rgba(233,169,79,.55)`;
  inactive items are indented 15px to align their text with the active one. Rename the labels:
  Home → **Today**, Roster → **Collection**, Party Builder → **Party**, Campaign → **Journey**,
  Inventory & Crafting → **Workshop**, World Archive → **Archive**. Settings drops to the bottom of
  the rail at `caption` size. (Route names in `app.js` stay as they are; only `routes[x].title`
  changes.)
- Energy leaves the topbar and becomes a block in the rail: eyebrow "ENERGY", then `96` as a 40px
  serif numeral with `/ 240` in `caption`, then a 2px bar whose track fades out
  (`linear-gradient(to right, accent 0, accent 40%, rgba(244,236,225,.16) 40%, transparent)`), then
  "+120 more at 4:00".
- `#topbar` loses its background, border-bottom and `h1`. The screen headline lives inside each
  screen (they are all different shapes), so `renderTopbar` should render nothing but keep existing
  so route code does not break — or delete the call and the element.

### 3.2 Today (was Home) — option `1a`

The current Home is five stacked boxes. The redesign is one intention, then three threads.

1. **Backdrop.** Full-bleed 16:9 key art of the world you are currently progressing through, plus a
   warm radial (`radial-gradient(120% 90% at 78% 18%, rgba(233,169,79,.22), transparent 58%)`), a
   horizontal scrim so the left column stays readable, and the vertical scrim from Rule 3. A 9:16
   full body of a featured hero bleeds off the right edge, masked, with a slow 9s
   `translateY(0 → -6px)` drift.
2. **The hook** (content column starts at 280px, width 640): eyebrow with the weekday, then a 60px
   serif line generated from the single most interesting fact in the save — *"Ashley is thirteen
   shards from her fifth star."* Then one `body` sentence naming the fastest route to it.
   *Implementation:* extend `readyUpgrades()` / `analyzePinnedGoals()` consumers in `home.js` with a
   small ranking function — smallest remaining shard gap → nearest gear tier completion → nearest
   campaign threshold. Fall back to *"Nothing is waiting — the courtyard is quiet."*
3. **Thread: Continue.** A 126×88 masked thumbnail of the node's art, the node name at `title` size,
   and a `caption` line reading `Main 14 · needs 7,400 Power · your Vanguard reads 8,120` with the
   two numerals coloured (`--text` for required, `--good`/`--bad` for yours). Right-aligned primary
   action "Enter →" with the ⚡ cost beneath.
4. **Thread: Ready when you are.** Replaces the "Ready now" `<details>` list. A horizontal row of up
   to three entries; each is a 56px circular portrait with a 1px amber ring pulsing on a 2.6s
   `hc-pulse`, then the name, what is ready, and an inline amber verb ("Finish it →", "Promote →",
   "Craft →") wired to the same handlers `readyPanel()` uses today. If more than three are ready, the
   third slot becomes "and four more →" linking to Collection filtered to `ownership: 'ready'`.
5. **Thread: Tracking.** The pinned goals from `analyzePinnedGoals()`, one per line: label left,
   `62 / 75` right with the current value as a serif numeral, then a 2px progress line that fades out
   past the fill (amber for star/gear goals, violet `--accent-2` for unlock goals). Pin reorder
   (↑ ↓) and unpin move into a hover-revealed row of `caption` text actions; do not keep five tiny
   buttons per row.
6. **Recent progress** shrinks to three `caption` lines, right-aligned at the top of the frame.

Blocks are separated by fading rules (Rule 2) at y≈352, 520, 716.

### 3.3 Collection (was Roster) — option `1b`

- Headline: `Ten of twenty met.` (`display-s`) + a `body` line naming the worlds.
- Filters become plain text at the top right — `Everyone / Ready to grow / Not yet met / By power ↓`
  — the active one in `--text` weight 600 with an amber rule under it that fades right. **Put that
  rule on the selected element itself** (`padding-bottom:7px` + a `border-image` gradient
  `border-bottom`), never at a measured offset from the row's edge — offsets desynchronise the moment
  a label changes, a control is added, or `--scale` moves. Keep the existing `filterCharacters()`
  preferences object; only the control rendering changes. The search
  input keeps `Ctrl+F` focus behaviour, styled as an underline with a placeholder, no border.
- The grid becomes a **gallery**: 236px-wide cards, heights alternating 560/534 so the row has a
  ragged top edge. Each card is a 9:16 masked full body with a bottom scrim
  (`linear-gradient(to top, #12100f 12%, rgba(18,16,15,.55) 55%, transparent)`), then, overlaid at the
  bottom: archetype eyebrow, name at `title`, stars as `★★★★☆☆☆` in `--accent` with
  `letter-spacing: 3px`, power as a serif numeral with the word "power" in `caption`, a 2px progress
  line to the next star, and an optional amber note ("tier four is ready").
- A character with an upgrade ready gets a 300px radial amber halo behind the art on a 3.2s pulse —
  this is the replacement for the `.ready-dot`.
- **Let the last card be cut off by the frame.** The row is intentionally wider than the viewport;
  horizontal scroll (or the window edge) implies more collection.
- Unowned characters move to a "Still out there" strip along the bottom: 38px circular portraits at
  55% opacity, name, and `74 / 110 shards`.
- The gallery is the **default** density. A second, compact density lives behind a view switch — §11.

### 3.4 Character — option `1c`

- The 9:16 full body bleeds off the bottom-left of the frame (700×940, masked), with a warm radial in
  the character's own colour behind it.
- Right column (starts at 560px): tag eyebrow (`Rebel · Fire · First Years · Eden Magic Academy` —
  the chips are gone), the name at `display-xl`, stars at 17px with 6px letter-spacing (unearned stars
  at `rgba(244,236,225,.22)`).
- **Power is the hero.** 78px serif numeral, and next to it `+72 since this morning` in `--good`
  plus `power · fourth of ten in your roster`. Under it, a 600px 2px bar that gradients from the
  character colour into amber for the earned portion and fades out over the unearned portion.
  Then one sentence: *"Thirteen more shards and the fifth star adds 250."* with `Where they drop →`
  in amber (opens the existing Find Sources flow).
- **Gear becomes six nodes, not a 3×3 grid of tiles.** 84px circles in a row, 30px apart:
  equipped = filled with the equipment art on a radial dark-warm ground and a soft drop shadow;
  craftable = amber-tinted fill, a 1px amber ring pulsing at 2.4s, and the whole node lifted
  `translateY(-6px)`; empty = 1px dashed `rgba(244,236,225,.16)`, no glyph. Label under each in
  `caption`; the ready one's label is amber and reads `Emblem · ready`. Keep every existing click
  target and `aria-label` from `gearSlot()`; keep the `equip-pop` animation, retuned to the ring.
- Everything data-shaped moves behind disclosure at the bottom of the frame:
  `Power, itemised ⌄`, `Her story ⌄`, `Equipment lines ⌄`, with `Add to party` in amber at the right.
  The itemised table is today's `characterPowerBreakdown()` output, rendered as label/value rows with
  fading rules — no `table.data` chrome.

### 3.5 Node — option `2a`

- Full-bleed location art, top scrim, node name at `display-m`, an eyebrow reading
  `Main 14 · chapter two · ordinary ground`, and a sentence of flavour.
- **The comparison is the screen.** Top right: eyebrow "Your Vanguard reads", the effective power as
  an 88px serif numeral in `--good` (or `--bad` when short), a 2px bar that fills from the right,
  then `against a gate of 7,400` with the threshold as a 26px serif numeral, then the verdict in one
  warm line: *"720 to spare — this clears. No dice, no surprises."* When short:
  *"Short by 480. The attempt cannot start, so no Energy can be lost."* — keep that guarantee, it is
  the best thing about the current node screen.
- Party: five 66px circular portraits with name and power beneath; to the right, synergy as prose —
  active bonuses with `+12%` in `--good`, inactive ones as `Faculty Pair — needs Irina and Aurora
  together`, then `+18% of a possible 25%` in `caption`. This is `evaluateParty()`'s existing output,
  reworded. Preset switching stays a `<select>`, restyled as underlined text.
- Rewards become a **sentence**, not a table: *"Every run, 2 × Advanced Metal — a third turns up
  about a third of the time. The first clear also pays 40 Improved Fiber and an Archive fragment."*
  The optional objective is the greyed clause at the end. Compose it from `nodeRepeatText()`,
  `node.firstClear` and `node.objective`.
- Actions, bottom right: `Enter` as the serif primary with `⚡ 6 of your 96` beneath, and
  `or run it six times at once ⚡ 36` as the sweep affordance — the number is the existing sweep
  input, styled as an inline editable numeral rather than a spinner.

### 3.6 Results — option `2b`

Currently a modal with chips. Make it a full-frame beat (the modal container may stay; it must lose
its `max-width`, background and border and cover the screen).

- Centred radial burst behind everything; a 760px amber ring at 16% opacity pulsing at 4s.
- Eyebrow `Lantern Courtyard · six runs · ⚡36`, then a 92px serif line that reacts to what happened —
  *"The courtyard is yours."* on a first clear, *"Six more runs."* on a farming sweep.
- Three reward columns. The **shard drop is the hero**: 56px 🧩 with a red-orange radial behind it,
  drifting on the 4s loop, `+3` at 46px serif, the character's name, then the progress bar **animating
  from its previous fill to its new fill over 600ms** and the line `65 of 75 — ten from her fifth
  star`. Materials and fragments are quieter columns either side, each with a serif count and a
  `· now 96` running total in `--faint`.
- Below a fading rule: what this unlocked — *"Carol's fourth gear tier is finished, and Tix can take
  her third star."* + `Two things are ready.` in amber. Then the leftover materials as one `caption`
  line.
- Actions: `Again` as the serif primary with `⚡6`, plus `Go craft` and `Back to today` as plain text.
- Honour `settings.farmingResults`: the compact mode keeps the same language at a quarter of the
  scale (one line, one numeral, no burst).

### 3.7 Journey (was Campaign) — option `2c`

- Chapter landscape art across the top, eyebrow + `The Academy grounds` at `display-s`, and a `body`
  line naming what the chapter is for.
- Campaign tabs become text (`Main / Shadow / Academy / Hidden Village`) with the amber fading rule
  under the active one.
- **Nodes become a path.** A single hairline runs left→right at y≈596, fading at both ends. Each node
  is a dot on it at a slightly different height (±30px) so the path undulates: cleared = 12px solid
  `rgba(244,236,225,.5)`; the frontier = 26px amber radial with a 40px glow and a 150px pulsing ring;
  next = 14px hollow ring; locked = 10px hollow at 20% opacity. Node name beneath in serif (26px for
  the frontier, 19px otherwise) and a `caption` status — `cleared`, `needs 7,400 · you read 8,120`
  (in `--good`), `needs 7,900`, `locked`. Horizontal scroll moves along the chapter; the landscape
  behind parallaxes at ~0.4×.
- Bottom left: eyebrow "Where you stand" + two sentences of orientation. Bottom right: the serif
  primary `Enter the courtyard` with `⚡ 6 · unlimited runs today`.
- Keep `rankMaterialSources()`/`sourceRow()` behaviour — the sweep controls appear in a hover/click
  popover on the frontier dot rather than inline on every row.

### 3.8 Content Creator — options `3a`–`3d`

The Creator is a tool, so it keeps more structure — but the same three rules apply.

**Overview (`3a`).** Headline is the readiness state as a sentence: `Your game is playable.` (or
`Two things left before your game can start.`), then `Two worlds live, twenty characters, four
chapter pairs.` and the health line in `--good`. Database tools (export / import / sample worlds /
reset) are right-aligned `ui` text; reset in `--bad`. Worlds are 426×250 masked banners with the name
at 32px serif overlaid at the bottom, status as coloured `caption` (`live in the game` /
`draft — two more characters before it can go live`), and a stats line. A dashed masked slot invites
a new world. Chapters are rows: name + span at left, then **ten dots for Main and ten for Shadow**
(filled amber = authored, 35%-amber = shadow assigned, hollow = empty), then the state in words
(`complete pair`, `8 of 10 shadow nodes assigned`), then `open main · open shadow`.

**World editor (`3b`).** The banner is the page header (380px, full width, scrimmed) — dropping an
image anywhere on it replaces it. Name at 62px serif with the status as an amber eyebrow; palette as
three 18px colour dots. Then **the publish gate drawn as a path**: three stations on a horizontal
line — mint dots for satisfied ones, a pulsing amber ring on the current blocker — labelled
`A world with a name / done`, `Three characters written / two more to reach five`, `Every one of them
findable / Sora has no shard source yet`, ending in the `Publish` action which stays `--faint` until
the path completes. This is `canPublishWorld()`'s reasons array, drawn instead of listed. Below:
the world's cast as 104px masked portrait wells with name, `Caretaker · minor`, and a flag line
(`⭐ starts owned` in `--muted-2`, `no shard source yet` in amber), then a dashed `+ new` tile and a
sentence stating what is still missing.

**Character editor (`3c`).** Two art wells at the left — 300px square portrait, 230×400 full body,
both masked, both with a monospace caption saying what they are and that you can drop onto them.
Right column: `Her name` eyebrow over a 64px serif name on a fading underline; glyph and colour as a
row of 22px swatches (selected gets a 1px light ring); archetype as a row of six text options with
the selected one underlined in amber (**put the underline on the selected element itself, never at a
measured offset**); acquisition tier as three columns of name + `4★ · 110 shards`, selected one
underlined, with the Minor/starting rule stated in `caption` beneath; faction and tags as a text run
with `add a tag` in amber; description and lore as auto-growing underlined text areas. Right rail:
`Where her shards drop` (green if authored, amber prompt if not) and the six equipment lines as
158×96 masked wells with an underlined name field each.

**Chapter editor (`3d`).** This is the one place density is correct. `Chapter two` at 44px serif with
`Main`/`Shadow` as text tabs (underline on the selected tab element), `nodes 11–20` in `caption`, and
a `body` line stating the rules. Then a real table with column eyebrows —
`# / Name / Power to enter / What it drops / Kind / Shadow twin` — and ten rows at `padding: 11px 0`
separated by `1px solid rgba(244,236,225,.07)`. The threshold column pairs a 21px serif numeral with
a **3px bar proportional to the threshold**, so the monotonic climb is visible down the column; that
bar is the whole reason this screen works. `Kind` shows `🏁 checkpoint` in amber for positions 5 and
10. `Shadow twin` shows a 30px portrait + name, or a dashed 30px circle + `choose a character` in
amber when unassigned. Bottom bar: `Two shadow nodes still empty. Fill them with whoever needs a
source →` (the existing auto-fill) and `Jump to the shadow chapter`.

Text inputs across the Creator lose their boxes:

```css
.form-grid input[type="text"], .form-grid textarea, .form-grid select {
  background: none; border: 0; border-radius: 0; padding: 4px 0;
  border-bottom: 1px solid rgba(244,236,225,.18); color: var(--text);
}
```

---

## 4. Interaction & motion

Two keyframes carry the whole design; both must be disabled under `.reduced-motion` (that rule
already exists in `styles.css` — verify it still catches these).

```css
@keyframes hc-pulse { 0%,100% { opacity:.35; transform:scale(1); }
                      50%     { opacity:.9;  transform:scale(1.06); } }
@keyframes hc-drift { 0%,100% { transform:translateY(0); }
                      50%     { transform:translateY(-6px); } }
```

- **Pulse (2.4–4s, ease-in-out, infinite)** marks exactly one thing per screen: what is ready. Ready
  gear node, ready character halo, the frontier node on the path, the blocking station on the publish
  path. Never more than one *kind* of pulse in view.
- **Drift (4–9s)** is for large art only — the featured hero on Today, the shard on Results.
- **Progress bars animate on change**, 600ms `cubic-bezier(.2,.8,.2,1)`, from the pre-transaction fill
  to the post-transaction fill. Today the app re-renders wholesale after every transaction, so the
  bar snaps. Give the bar element a `data-from` attribute and animate on mount; this is the single
  highest-value piece of "progression feedback" in the whole redesign.
- **Screen transitions.** The router clears `#screen` and rebuilds. Add a 180ms crossfade + 8px
  upward slide on the new screen root (`opacity 0→1`, `translateY(8px)→0`). No transition on
  re-render of the *same* route (the scroll-restore path in `render()` already distinguishes these
  via `currentRouteKey`).
- **Hover.** No borders change colour any more; hover raises text from `--muted` to `--text`, and
  raises art 2px with a 160ms ease. Keep every existing `title`/`aria-label`.
- **Focus.** Unchanged: `outline: 3px solid color-mix(in srgb, var(--accent) 70%, white)`, offset 2px.

---

## 5. State

No new persisted state, with one exception in §7. Everything the redesign shows already exists:
`readyUpgrades()`, `analyzePinnedGoals()`, `evaluateParty()`, `characterPowerBreakdown()`,
`archiveStatus()`, `canPublishWorld()`, `characterShardAssignments()`.

Two transient additions, both in `store.ui` (not saved):

- `store.ui.lastPowerByCharacter` — a map captured before each transaction so the Character screen
  can render `+72 since this morning` and bars can animate from their previous value.
- `store.ui.enteringRoute` — set for one frame to trigger the screen transition.

---

## 6. Accessibility & correctness (do not regress)

- Every current `aria-label`, `title`, `role="dialog"`, focus trap and `Escape` handler stays.
- The design leans on colour for state (amber = ready, mint = clears, faint = locked). Every one of
  those states must **also** be in text — the mockups already do this ("this clears", "ready",
  "locked"); keep it that way.
- Contrast: `--muted-2 #8e8278` on `--bg #12100f` is ~5.2:1 — fine for the 11px eyebrows. Do not push
  label colours below `#8e8278` on the floor colour; `--faint #6f645c` (~3.4:1) is for decorative
  captions only, never for the only copy of a fact.
- Text still scales with `settings.textScale` via `--scale`. The serif display sizes must be
  expressed in `rem`, not `px`, so that keeps working. **Check the 104px name and the 92px results
  headline at scale 1.4** — they should wrap, not clip.
- `.reduced-motion` must kill pulse, drift, bar animation and the route transition.

---

## 7. The relic puzzle (new behaviour) — option `4a`

> The puzzle below is current and still governs relic rendering. Its **screen layout** is superseded
> by §10 — build the pieces here inside the two screens there, not in one scrolling page.

This is the only part of the handoff that is not a restyle. Today a relic shows `▢` until both
fragments are found, then swaps to the full image. The redesign makes the **artwork itself the
progress meter**.

### Concept

Each relic's 16:9 art is cut down the middle along an interlocking seam. Fragment 1 owns the left
piece, fragment 2 owns the right piece. A piece you have shows the real artwork, correctly aligned; a
piece you do not have is an empty cut in the shelf — a faint 45° hatch in the exact silhouette of the
missing piece. With one of two, half the picture is genuinely there. With two of two, the seam lights
once and settles, and the relic is whole.

### Geometry

Both halves are absolutely positioned over the same 240×136 box, each carrying **the same background
image at the same size and position** (`background-size: 100% 100%`), differing only in clip-path.
The polygons are exact complements, so the pieces tile with no gap and no overlap:

```css
--relic-clip-left:  polygon(0 0, 50% 0, 50% 30%, 57% 38%, 57% 62%, 50% 70%, 50% 100%, 0 100%);
--relic-clip-right: polygon(50% 0, 100% 0, 100% 100%, 50% 100%, 50% 70%, 57% 62%, 57% 38%, 50% 30%);
```

The left piece carries the tab; the right piece carries the matching notch. Set both
`-webkit-clip-path` and `clip-path` (Electron's Chromium accepts the unprefixed form; keep the
prefix for safety).

### Markup

```
.relic                       position:relative; width:240px; aspect-ratio:16/9
  .relic-glow                only when complete — radial amber, closest-side, 16%
  .relic-piece.left          clip-path left;  art when fragment 1 owned, else .relic-piece--empty
  .relic-piece.right         clip-path right; art when fragment 2 owned, else .relic-piece--empty
  .relic-seam                only when complete — see below
.relic-name                  21px serif; the relic name, or "— undiscovered —" in --faint at 0/2
.relic-count                 12px; "0 of 2 fragments" — --faint / --accent at 1 / --good at 2
.relic-hint                  11.5px; per missing piece: "left half — Main 2-7 · Storm Balcony"
```

```css
.relic-piece--empty {
  background: repeating-linear-gradient(45deg,
    rgba(244,236,225,.055) 0 7px, rgba(244,236,225,0) 7px 14px);
}
.relic-seam {                     /* the join, visible only once whole */
  position:absolute; inset:0; pointer-events:none;
  background: linear-gradient(to right,
    transparent 49.4%, rgba(233,169,79,.5) 50%, transparent 50.6%);
  animation: hc-pulse 3.4s ease-in-out infinite;
}
```

### Rules

1. **Fragment order is stable.** `relic.fragments[0]` is always the left piece, `[1]` the right —
   never sort by acquisition order, or the picture would rearrange itself as you play.
2. **No new assets, no image slicing.** One relic image, two clipped layers. If a relic has no
   imported art, both pieces fall back to the hatch and the owned piece additionally shows the
   deterministic `relicIcon(relic.id)` glyph centred in its half.
3. **Missing halves stay actionable.** Each missing piece keeps today's "find this fragment" link,
   reworded to name the side: `left half — Main 2-7 · Storm Balcony`, wired to the same
   `store.go('#/node/' + node.id, { returnContext: … })` call. Hovering a missing piece raises its
   hatch to 9% opacity and highlights its hint line.
4. **The slot-in moment.** When a run awards a fragment, the Results screen (§3.6) shows that relic's
   box with the newly earned piece animating in: `opacity 0→1` plus `translateX(∓14px)→0` over 420ms
   `cubic-bezier(.2,.8,.2,1)`. If that completes the relic, the seam element fades in over 200ms,
   pulses once, then drops to 20% opacity and stops. Detect this with a transient
   `store.ui.justCompletedRelics: Set<relicId>`, cleared after render.
5. **`.relic-card` and `.frag-pips` are deleted.** The two pieces *are* the pips; do not render both.
6. **Shelf layout:** five relics per row, 240px wide, 24px gap, at the 52px screen gutter
   (5 × 240 + 4 × 24 = 1296 in a 1336 content width). Collections stack down the page, each
   introduced by `Collection one · Lantern Nights` at 30px serif plus a `caption` state line
   (`three whole, one half-found, one still buried`). Keep the existing collapse-per-collection
   persistence (`state.ui.archiveCollapsed`).

### The rest of the Archive screen

- Headline `🎓 The Academy Archive` at `display-s`, with `Eleven of fifteen relics whole ·
  twenty-four of thirty fragments recovered` and a 560px fading progress bar. Per-collection counts
  sit top-right as three `ui` lines.
- Collection reward skin: the square and 9:16 skin previews as masked wells at **40% opacity while
  locked** (they read as ghosts of themselves), full opacity when unlocked, with the skin name at
  32px serif, one warm sentence, and `Cosmetic. She fights exactly as hard either way.` in `caption`.
  `Use Skin` is the amber text action.
- Full-Archive reward at the bottom right with four empty 34px rounded slots standing in for the
  relics still missing.

### Files this touches

`src/ui/archive.js` (`relicCard`, `renderArchive`, `skinReward`), `src/ui/results.js` (the slot-in
moment), `styles.css` (`.relic-*`, delete `.relic-card`/`.frag-pips`/`.archive-shelf` box styles).
`src/core/state.js#archiveStatus` already returns `{ relic, owned, total, complete }` and
`relic.fragments[]` with `sourceNode` — **no core changes are required.**

---

## 9. Workshop — options `5a`–`5c`

Added after the first implementation shipped. The current Workshop is unchanged from the old UI: a
resource line, a paragraph, and a 6×5 grid of counts with every zero set in amber. Restyle it whole.

**The reframe.** The old screen answers *"what do I own"*. The screen answers *"what can I make right
now"* — the inventory is the footnote, not the subject. Three states, all the same skeleton:
`5a` something is ready, `5c` nothing is ready, `5b` the itemised grid disclosed.

### 9.1 The bench — `5a`

Layout on the 1440×900 frame:

- Backdrop: `radial-gradient(58% 52% at 80% 26%, rgba(233,169,79,.16), transparent 62%)` plus a
  hatched forge mass at `right:-120px; top:60px; 620×620`, radial-masked, `opacity .5`, on
  `hc-drift 9s`. It bleeds off the right edge (Rule 3).
- Header at `52,48`: eyebrow `Workshop · inventory and crafting`, headline at `display-m` (60px)
  generated from state — **"One piece is ready to forge."** / "Two pieces are ready to forge." — and
  one `body` line. Fading rule at `y 232`.
- **Ready at the bench** (left, 660px wide, from `y 270`): equipment 1:1 art at 150×150 with an
  amber radial behind it; item name at `title` 38px; `Gear tier 4 · hands · Ashley is wearing
  nothing there` in `caption`; the hero numeral **`+72`** at `display-l` (88px) with
  `power for Ashley, the moment it's equipped` in `--good`; a 2px bar in the character's colour
  (`#e2603f`) fading past its fill, captioned `3,164 now · 3,236 after`; then the cost as a
  sentence — *"Five Basic Metal and two Basic Mineral — you hold four and two, and the run you already
  planned brings the fifth."*
- Primary action: `Forge it →` in serif 34px `--accent` on a transparent→amber→transparent rule,
  with `No Energy. Materials only, and nothing is spent until you confirm.` beneath in `caption`.
  **Spacing is tight here** — the block must end by `y ≈656` so the section rule at `y 668` reads
  as a divider and not as the caption's underline.
- **One upcraft away** (right, 560px, from `y 270`): at most two recipes, each a serif 26px name, a
  two-line sentence naming the missing grade, how many you hold and where it drops, and a
  `Where they drop →` text action. Separated by fading rules. Then one `--faint` line about pinned
  reservations.
- Fading rule at `y 668`; **Materials** shelf at `y 702` (below).
- Bottom left: `Materials, itemised ⌄`. Bottom right: development resources, quiet —
  `2 Intelligence` as a serif numeral and *"Renown, Clan Seals and Arcane Sigils not yet earned"*
  in `--faint`. Four separate zero counters are four pieces of noise.

### 9.2 The materials shelf (on `5a` and `5c`)

Replaces the grid on the default view. A 6-column grid, `gap:22px`:

- Row 1: family emoji 19px + family name in serif 22px.
- Row 2: the five grades as a `gap:9px` run of serif tabular numerals — held grade at 24px in
  `--text`, every empty grade an **em dash at 19px in `--faint`**. No column headers, no borders.
  This is the whole point: a family you have nothing of is five quiet dashes, not five amber zeros.
- Row 3: at most one `caption` per family, and only when it says something actionable
  (`one short of an upcraft`, `all of it reserved`). On the cold bench only the blocking family
  keeps its caption, in `--bad`.

### 9.3 Materials, itemised — `5b`

The disclosed grid. This is the second sanctioned dense surface (with the chapter editor), so it may
use flat per-row `border-bottom: 1px solid rgba(244,236,225,.07)` — no other box.

- Header: eyebrow, headline `Nine held, and one upcraft in reach.` at `display-s`, one `body`
  line on the 5→1 rule and the tier ceiling. Top-right: three quiet totals (held / above basic /
  reserved).
- Grid `300px repeat(5,1fr) 150px` from `y 250`: family + its description in `caption`, five
  grade numerals (serif, tabular, em dash for zero), and a trailing `caption` reading the row's
  meaning — `one short of an upcraft`, `held for Woven Sigil Wrap`, `none yet · drops in the
  Dark Quad`. Uppercase 10.5px grade eyebrows above; a fading rule under them.
- Footer: the Headquarters sentence and `Back to the bench ↑`.

### 9.4 The cold bench — `5c`

Same skeleton as `5a`, so it reads as a *state*, not another screen. **Keep it sparse** — the
empty state is where prose piles up fastest; every line below is the trimmed version.

- Headline names the shortfall: **"The bench is cold — two Metal short."** Subline is one clause:
  `One run of the Lantern Courtyard covers it.`
- Nearest piece renders as its own **ghost at `opacity .4`** (Ghost preview pattern) — no lock icon.
  Name and `+72` drop to `--text-dim`; the bar is neutral `rgba(244,236,225,.22)`; the caption is
  `Three of five Metal` in `--bad`.
- `Forge it` is `--faint` with **no underline**, `cursor: not-allowed`, captioned
  `Nothing is spent.`
- **The shortest way there** replaces "one upcraft away": a three-dot path on a fading hairline —
  the node (amber radial + pulsing ring, the screen's single pulse), the material, the piece — with
  serif names and fragment captions (`⚡ 6 · ~3 Metal a run`, `two more`, `no Energy`). Then
  `Go to the Courtyard →`. A shortfall is a path, not a list of reasons.
- Backdrop amber becomes violet `rgba(180,138,222,.09)` and the forge mass cools to
  `#2b2620/#1a1714` at `opacity .34`. Nothing on a cold bench is amber except the way out.

### Data and files

`src/ui/gear.js` / the Workshop route. Everything shown already exists: material counts and
reservations from the inventory + pinned-recipe state, recipe costs from the crafting tables,
`characterPowerBreakdown()` for the `+72` delta, and the drop node from the same lookup the
Journey uses. **No `src/core/` changes.** The "nearest piece" is whichever craftable recipe has the
smallest total shortfall; ties break toward the active party.

### Acceptance

- No zero is printed as `0`, and no zero is amber.
- Exactly one amber action on `5a` (`Forge it →`) and one amber element on `5c` (the node dot,
  which is also the only pulse).
- The default view shows six families and at most two recipes; the 30-cell grid is only reachable
  through `Materials, itemised ⌄`.
- Every count a player reads is Instrument Serif.
- The cold bench states the way out in one path and the guarantee in three words.

---

## 10. Archive, split in two — options `6a`–`6b`

Supersedes §7's single scrolling screen. The relic puzzle itself (geometry, clip-paths, states,
`archiveStatus()`) is unchanged — **§7 still governs it.** What changes is the navigation: one screen
per world, one screen per collection, neither scrolling.

Route: `archive` → world screen; `archive/:worldId/:collectionIndex` → collection screen. Keep the
existing collapse state key if it is easier, but it should no longer be needed.

### 10.1 World — `6a`

- **World key art 16:9, full bleed** behind everything, on `hc-drift 11s`, under a four-stop scrim
  (`rgba(18,16,15,.78)` → `.42` at 30% → `.72` at 62% → `#12100f` at 96%). This is the "big
  picture on the back" the screen is built around.
- Header at `52,56`: eyebrow `Archive · lore and cosmetics only, never power`, world name at
  `display-l` 76px, then the hero numeral — **fragments still out there** at 88px with
  `four of fifteen relics whole` beside it. Count *what is left*, not the zeros you hold.
- Fading rule at `y 322`. Then **three collection columns** (`repeat(3,1fr)`, `gap:44px`), each:
  name at `title` 32px, `Collection one · three whole, one half-found` in `caption`, a row of
  **five 74×42 puzzle chips** (`gap:8px`, radius 5px) carrying the same three states as the big
  tiles, a 2px progress bar fading past its fill, `seven of ten fragments` in `caption`, the reward
  as a 64px circular ghost at `opacity .4` + its name at 22px + `Two relics away`, and
  `Open the collection →`. Only the nearest-to-complete collection's link is amber; the others are
  `--muted`.
- A collection that has not opened yet: name and reward drop to `--muted-2`/`--faint`, the ghost to
  `opacity .24`, the bar is flat `--line`, and the caption says where it opens
  (`none of ten fragments · opens in chapter three`). Reward name reads `Still unnamed` until one
  relic is whole — do not spoil it with a lock icon.
- Foot: fading rule, then the world reward — 52px ghost + `And for all fifteen` eyebrow +
  its name at 26px — and, right-aligned, the standing guarantee
  `Cosmetic, every one of them. They fight exactly as hard either way.`

### 10.2 Collection — `6b`

- **Location key art 16:9, full bleed** behind everything (a place inside the world, not the world
  banner again), scrimmed the same way but darker through the middle so the tiles read.
- Header at `52,52`: eyebrow `Eden Hidden Village · collection one`, name at `display-m` 58px,
  `Three whole, one half-found, two still buried.` in `body`, and a 520px progress bar. Top-right:
  the collection reward as a 76px ghost with its name and `Two relics away · cosmetic`.
- Fading rule at `y 238`. **Six relics in a 3×2 grid** from `y 264`: `repeat(3,1fr)`,
  `gap:24px`, each tile **196px tall** (≈429px wide, radius 8px). Do not grow the tile — at 238px
  the second row collides with the footer. Under each tile: name at `title` 24px and **one** status
  line — `Whole` (`--muted-2`), `One of two · right half in 1-4` (`--accent`),
  `Undiscovered · both halves in 1-5` (`--faint`).
- A whole relic shows a 1px vertical seam glow
  (`linear-gradient(to bottom, transparent, rgba(233,169,79,.5), transparent)`); an undiscovered one
  shows the 45° hatch with a flat `rgba(244,236,225,.08)` seam.
- **The per-fragment source lines come off the tiles.** `left half — Eden Hidden Village 1-1 ·
  Waterfall Veil Approach` under every tile is what made the old screen ugly; the status line names
  the node, and the full source goes in the hover title. Footer says so:
  `Hover a missing half to see the node that holds it.`
- Bottom left: `← Eden Hidden Village`.

### Acceptance

- Neither screen scrolls at 1440×900, and neither has a horizontal strip.
- The world screen names all three collections and both reward tiers without a scroll.
- No tile carries more than one line of status.
- The relic states still read exactly as §7 requires, at both chip and tile size.

---

## 11. Collection, compact — option `7a`

A second density for the same screen, not a new screen. The gallery (§3.3) stays default;
`state.ui.collectionDensity` (`'gallery' | 'compact'`) may persist with the other view preferences.

- The switch is two text controls appended to the existing filter line after a `--faint` `·`
  separator: `Gallery` / `Compact`. Active one in `--text` weight 600 with a **neutral**
  `rgba(244,236,225,.34)` fading rule attached to the element — not amber. Amber already means
  "ready" on this screen; two amber underlines in one row make the selection ambiguous.
- Everything else is identical: same headline, same filters, same sort, same footer semantics.
- Grid from `y 158`: `repeat(8,1fr)`, `gap:34px 20px`, centred cells. Met character: 112px
  circular well (character-colour radial at `inset:-8px`, `box-shadow:0 10px 22px rgba(0,0,0,.5)`),
  name at 20px serif, stars at 10px/2.5px tracking, power as a 19px serif tabular numeral. A ready
  upgrade adds a 1px amber ring on `hc-pulse 2.8s` and an `a star is ready` caption — still exactly
  one pulse per screen.
- **Unmet characters stay in the grid**, in reading order, as the 112px dashed empty well
  (`1px dashed rgba(244,236,225,.16)`, no glyph) with the name in `--muted-2` and
  `74 / 110 shards` or `not yet found` beneath. The "Still out there" strip is not needed here —
  the point of this density is seeing the whole roster, gaps included.
- Footer: fading rule, then `Four are one shard-run from joining you.` left and
  `Ten met · ten still out there` right.

### Acceptance

- Twenty characters fit at 1440×900 with no scroll; the grid reflows by column count, not by cell size.
- Every filter and sort behaves identically in both densities.
- The active view underline is neutral; the active filter underline is amber; both are attached to
  their own label.

---

## 8. Suggested order

1. Tokens + fonts + the three rules in `styles.css`; make `.panel` paint nothing. Every screen will
   look bare and slightly broken — that is expected and it is the fastest way to find every place
   that leaned on a box.
2. Shell: sidebar, energy block, topbar removal, route transition.
3. Today, then Collection, then Character. These three carry the language; get them right before
   touching the rest.
4. Node → Results → Journey.
5. Archive with the relic puzzle (§7).
6. Content Creator (`3a`–`3d`).
7. Workshop (§9).
8. Archive navigation (§10) — the puzzle from §7 stays as built; only the routing and layout change.
9. Collection compact density (§11).
10. Party and Settings — not designed here. Apply §1–§4 by analogy: eyebrow labels, fading rules,
   serif numerals, no boxes. Ask before inventing new layouts for them.

### Acceptance

- No element on any player-facing screen has a visible rectangular border or a filled panel
  background (`.gear-slot`, `.char-card`, `.node-row`, `.relic-card`, `.compact-result`, `.chip`,
  `.tab-btn`, `.btn` all lose theirs).
- Every hairline fades at at least one end.
- Every quantity a player reads is set in Instrument Serif.
- Exactly one pulsing thing per screen, and it is the thing that is ready.
- A relic at 1/2 shows half its real artwork; at 0/2 it shows two hatched silhouettes; at 2/2 it
  shows one seamless image.
- `.reduced-motion` stops all of it, and every state is still legible in text alone.

## Assets

No binary assets ship with this handoff. Needed:

- **Fonts:** Instrument Serif 400, Figtree 300–600, as woff2 in `assets/fonts/` (SIL Open Font
  License; redistribution with the app is fine).
- **Art:** all imagery is placeholder. Sizes to commission — world banner 16:9 (≥1280×720),
  character portrait 1:1 (≥512), character full body 9:16 (≥720×1280), equipment 1:1 (≥256), relic
  16:9 (≥960×540), location/chapter key art 16:9 (≥1920×1080). All import through the existing
  Content Creator art pipeline; no new storage format.
- Emoji are used as archetype/slot/material icons and as portrait fallbacks. One caution: the mist
  emoji 🌫️ has no glyph in several bundled fonts and renders as tofu — audit any emoji you add.

## Files

- `Hero Collector Redesign.dc.html` — the design, options `1a`–`1c`, `2a`–`2c`, `3a`–`3d`, `4a`,
  `5a`–`5c`, `6a`–`6b`, `7a`.
- `DESIGN_PHILOSOPHY.md` — the durable reasoning behind all of them; read it before designing any
  screen this handoff does not cover.
- `Current UI (recreation).dc.html` — the before-state.
- Source read while designing: `index.html`, `styles.css`, `src/app.js`, `src/ui/{home,roster,
  character,gear,party,campaign,node,results,archive,creator,shared,dom,character-picker}.js`,
  `content/{balance,archetypes,characters}.json`, `Eden Magic Academy.md`.
