# Hero Collector — Visual Design Philosophy

**Purpose.** The README in this folder was a one-time implementation spec for the redesign. *This*
document is permanent: point any agent building a **new** screen at this file. It states the
reasoning behind the existing screens so a new one arrives already consistent — not a matched
screenshot, but a screen that was designed the same way.

Read §1 and §2 before writing markup. §3–§9 are the reference. §10 is the checklist to run before
calling a screen done.

---

## 1. The thesis

> **The game is about a collection growing. The interface should feel like looking at the collection,
> not like operating it.**

Every decision below descends from that sentence. The old UI was a settings dialog wrapped around a
game: bordered panels, tables, chips, five buttons per row. It was *legible* and it was *dead*. The
redesign's bet is that a player will read a sentence and a large numeral more readily than a table,
and will feel progress in artwork and in a bar that moves — not in a number that silently changes
between renders.

Three consequences, in priority order. When two of them conflict, the earlier one wins.

1. **Art carries the screen.** The most emotionally loaded thing on screen is a character, a place,
   or a relic. Give it the room and let it run off the edge of the frame. Chrome does not compete
   with art.
2. **State is stated in words, once, warmly.** "720 to spare — this clears." beats a green check and
   two numbers. The interface talks to the player like a knowledgeable friend, not a receipt.
3. **Data is available, not shouted.** Nothing is deleted; the itemised breakdown still exists. It
   just lives behind `Power, itemised ⌄` instead of occupying the middle of the screen.

### The five words

If you remember nothing else: **bleed, imply, name, one, quiet.**

- **Bleed** — art exceeds its container and fades into the floor.
- **Imply** — edges are suggested by fading hairlines and grouping, never drawn as boxes.
- **Name** — every block is introduced by a small uppercase eyebrow; every state is written in prose.
- **One** — one accent colour, one pulsing element, one headline, one hero numeral per screen.
- **Quiet** — everything not carrying meaning drops toward `--faint` and gets out of the way.

---

## 2. The non-negotiable rules

These four are structural. A screen that breaks one does not match the app, no matter how good it
looks in isolation.

### Rule 1 — There are no boxes

No filled panel backgrounds, no rectangular borders, no cards-with-borders, no chips, no pills, no
tabs-as-buttons, no bordered inputs. Grouping comes from **proximity, an eyebrow label, and a fading
rule** — that is sufficient, and it is what makes the screens feel like pages rather than dialogs.

The single exception: a genuinely tabular tool surface (the Creator's chapter editor) may use a flat
per-row `border-bottom: 1px solid rgba(244,236,225,.07)`. Density is correct in exactly one place —
where the author is comparing ten rows of the same shape. If your new screen is a player-facing
screen, you do not get this exception.

### Rule 2 — Every rule fades

A hairline never touches both corners. Always a gradient:

```css
background: linear-gradient(to right,
  transparent, rgba(244,236,225,.14) 6%, rgba(244,236,225,.14) 74%, transparent);
```

Vary the right-hand stop per rule (**55–84%**) so consecutive rules do not end on the same vertical.
That irregularity is deliberate — it is what stops a stack of blocks from reading as a table.

### Rule 3 — Art is masked, never cropped

No image sits inside a hard rectangle. Every image is faded into `--bg` with a radial mask, and
full-bleed art carries a scrim so text stays legible.

```css
mask-image: radial-gradient(72% 72% at 50% 46%, #000 58%, transparent 94%);   /* portrait 1:1 */
mask-image: radial-gradient(70% 64% at 50% 46%, #000 56%, transparent 92%);   /* full body 9:16 */
mask-image: radial-gradient(78% 76% at 50% 46%, #000 56%, transparent 92%);   /* banner 16:9 */
```

```css
/* scrim under full-bleed background art */
linear-gradient(to bottom, rgba(18,16,15,.75), transparent 32%, rgba(18,16,15,.35) 66%, #12100f 100%)
```

Corollary: **let content be cut off by the frame.** The Collection row is intentionally wider than the
viewport; the last card is half-visible. A collection that fits exactly does not feel like a
collection.

**Screens never scroll.** Every screen in this app fits 1440×900. If content does not fit, the answer
is a second screen (Archive world → collection) or a second density (Collection gallery → compact) —
never a vertical scroll and never a horizontal strip inside a section. Art may bleed off the frame;
content may not continue past it.

### Rule 4 — Colour is never the only carrier

Amber means ready, mint means it clears, faint means locked — and every one of those states is *also*
written in text ("ready", "this clears", "locked"). This is both an accessibility requirement and a
tone requirement: the prose is the design, the colour is reinforcement.

---

## 3. Tokens

Do not introduce new colours. If you need a hue the palette lacks, you are probably encoding
something that should be prose.

```css
--bg:       #12100f;   /* the single floor colour — every screen sits directly on it */
--bg2:      #1a1512;   /* rare recessed areas only; never a panel background */
--bg3:      #221b16;   /* hover wash */
--line:     rgba(244,236,225,.14);   /* only ever used through a fade */
--text:     #f4ece1;
--text-dim: #b8aca1;   /* body copy that is not the headline */
--muted:    #a2958a;
--muted-2:  #8e8278;   /* eyebrows and labels — the contrast floor for real information */
--faint:    #6f645c;   /* decorative captions only, never the only copy of a fact */
--accent:   #e9a94f;   /* amber — the one action / attention / ready colour */
--accent-2: #b48ade;   /* violet — a second, quieter thread: unlock goals, shadow content */
--good:     #6fc9a0;   /* clears, gains */
--bad:      #c9705f;   /* short by, blocked */
```

**Amber discipline.** Amber is scarce on purpose. Per screen it may appear on: the primary action, the
one thing that is ready, and the active filter/tab underline. If a third unrelated element wants
amber, one of them is not actually important.

**Character colours** (Ashley `#e2603f`, Liadriel `#c9a35e`, Elian `#5f93ab`, Malefia `#7a5fa8`, …)
live in creator content, not CSS. Use them for a radial behind that character's art and for the
earned portion of *their* power bar — never for UI state.

### Type

Two families, vendored locally in `assets/fonts/` (CSP is `default-src 'self'` — **never add a Google
Fonts link**).

| Family | Role |
| --- | --- |
| **Instrument Serif** 400 | Headlines, character/relic/place names, section titles, and **every number the player reads as a quantity** |
| **Figtree** 300–600 | Everything else — eyebrows, body, rows, actions, captions |

The serif/sans split *is* the information architecture: serif = the thing itself and its magnitude,
sans = the apparatus around it. A power value in Figtree is a bug.

| Token | Size / weight | Where |
| --- | --- | --- |
| `display-xl` | 104 / serif, lh .98 | The subject's own name on a screen about one subject |
| `display-l` | 88–92 / serif, lh 1 | A reactive headline, the single hero numeral |
| `display-m` | 60–76 / serif, lh 1.06 | Screen headline |
| `display-s` | 44–52 / serif | Section headline |
| `title` | 30–38 / serif | Sub-headline, item name in a shelf |
| `numeral` | 19–46 / serif, tabular | Any quantity |
| `eyebrow` | 11 / Figtree, `.16em` tracking, uppercase, `--muted-2` | The label above every block |
| `body` | 15 / lh 1.6, `--text-dim`, `text-wrap: pretty` | Explanatory prose |
| `ui` | 13.5–14.5 / 400–600 | Rows, actions, filters |
| `caption` | 11.5–12.5 / `--faint` | Sub-labels, costs, totals |
| `mono` | 10–11 / ui-monospace | Art-placeholder captions only |

All display sizes in **rem**, so `settings.textScale` (`--scale`) keeps working. Check any new
headline at scale 1.4 — it must wrap, not clip.

### Spacing

Screen gutter **52px**. Between blocks **32–40px**. Eyebrow → its content **10–22px**. Row padding
**11px 0**. Grid gaps: character shelf 20–26px, relic shelf 24px, node circles 30px.

Rhythm over grid: block spacing is regular, but *within* a screen let sizes be uneven (alternating
card heights 560/534, node dots at ±30px off the path line). Perfect alignment reads as a form.

---

## 4. How to compose a new screen

Follow this order. It is the order the existing screens were built in, and it is why they cohere.

**Step 1 — Name the one thing the screen is for.** One sentence, in the player's language. *Today* is
"here is the single most interesting thing waiting for you." *Node* is "can I clear this?" *Results*
is "what did that get me?" If you cannot write that sentence, the screen is two screens.

**Step 2 — Find the art.** Which existing asset shape carries this screen? Character full body 9:16,
world banner 16:9, location key art 16:9, portrait 1:1, equipment 1:1, relic 16:9. Place it first,
large, bleeding off at least one edge, masked. If the screen has genuinely no art (Settings), it is
carried by the headline and generous whitespace instead — do not invent decoration to fill it.

**Step 3 — Write the headline as a reactive sentence.** Not a noun ("Character Roster") but the state
("Ten of twenty met."). Headlines are generated from the save, with a written fallback for the empty
case ("Nothing is waiting — the courtyard is quiet."). Sentence case, full stop.

**Step 4 — Choose the one hero numeral** and set it at `display-l`. Power, a threshold, a count.
Everything else numeric drops to `numeral` or `caption`.

**Step 5 — Reduce the rest to two or three threads,** each an eyebrow + a few lines, separated by
fading rules. Three is comfortable; four is a warning; five means something belongs behind
disclosure.

**Step 6 — Push the tables behind `⌄` disclosure** at the bottom of the frame, as label/value rows
with fading rules. Never `table.data` chrome.

**Step 7 — Place exactly one pulse** on the one thing that is ready or blocking. Then stop.

---

## 5. The pattern library

Reuse these before inventing. Each one already exists in the app; a new screen should read as a
recombination of them.

**Eyebrow block.** 11px uppercase `--muted-2` label, 10–22px gap, content, then a fading rule. The
universal unit of the app. Replaces every `.panel h2`/`h3`.

**Hero numeral + bar.** A serif numeral, an adjacent `--good`/`--bad` delta ("+72 since this
morning"), and beneath it a 2px bar whose fill fades out past the filled portion — the track is never
a closed rectangle. Bars **animate from their previous value on change** (600ms
`cubic-bezier(.2,.8,.2,1)`, via a `data-from` attribute), because progression feedback is the whole
point.

**Verdict line.** A comparison resolved into one warm sentence, with the numbers inline and coloured:
*"720 to spare — this clears. No dice, no surprises."* / *"Short by 480. The attempt cannot start, so
no Energy can be lost."* Guarantees the player cares about are stated explicitly, not implied.

**Reward-as-sentence.** Drop tables become prose: *"Every run, 2 × Advanced Metal — a third turns up
about a third of the time."* Odds in words, exact counts as numerals.

**Text controls.** Filters, tabs and presets are plain text runs. The selected one is `--text`
weight 600 with a short amber rule under it that fades right. **Put the underline on the selected
element itself** (`padding-bottom` + a `border-image` gradient `border-bottom`), **never at a measured
offset** — measured offsets desynchronise on re-render and text scaling. When one row carries two
independent controls (a filter and a view switch), only one underline may be amber; the other is
neutral `rgba(244,236,225,.34)`.

**Underlined inputs.** `background: none; border: 0; border-bottom: 1px solid rgba(244,236,225,.18);
padding: 4px 0`. Textareas auto-grow. Selects are underlined text.

**Text actions.** Primary = serif, 34px, `--accent`, on a rule that gradients from transparent to
amber. Secondary = plain `ui` text in `--muted`. Destructive = `--bad`. Disabled = `--faint`, no
underline, `cursor: not-allowed`. Cost (`⚡ 6 of your 96`) sits beneath the primary in `caption`.

**Circular well.** Portraits and gear as circles — 38px (unowned strip), 56–66px (party, ready row),
84px (gear node), 104px (creator cast). Filled = art on a dark-warm radial with a soft drop shadow;
ready = amber-tinted with a 1px pulsing ring, lifted `translateY(-6px)`; empty = 1px dashed
`rgba(244,236,225,.16)` with no glyph.

**Dot path.** Any sequence — campaign nodes, publish gates, chapter completion — is drawn as dots on a
single fading hairline rather than listed as rows: done = 12px solid at 50% opacity, current/frontier
= amber radial with glow and a pulsing ring, next = hollow ring, locked = 10px hollow at 20%. Names
beneath in serif, status beneath that in `caption`. **Prefer this to any list of steps or checklist.**
A reasons array from validation code is a path, not a bulleted list.

**Ghost preview.** A locked cosmetic or reward renders its real art at **40% opacity** — the ghost of
itself — not a lock icon. Full opacity on unlock.

**Progress-as-artwork.** The Archive relic is the purest form of the thesis: the picture is cut along
an interlocking seam, owned halves show real art, missing halves show a 45° hatch in the exact
silhouette of what is absent, and completing it lights the seam once. When a new feature has a
"partially collected" state, ask whether the *asset itself* can be the meter before reaching for a
bar. If you build another one: complementary clip-path polygons over one image at
`background-size: 100% 100%`, stable piece order (never sort by acquisition), and every missing piece
keeps its "where this drops" link.

---

## 6. Motion

Two keyframes carry the entire app. Do not add a third without a reason you can state in one line.

```css
@keyframes hc-pulse { 0%,100% { opacity:.35; transform:scale(1);    }
                      50%     { opacity:.9;  transform:scale(1.06); } }
@keyframes hc-drift { 0%,100% { transform:translateY(0);    }
                      50%     { transform:translateY(-6px); } }
```

- **Pulse** (2.4–4s, ease-in-out, infinite) marks **exactly one thing per screen**: what is ready, or
  what is blocking. Never two kinds of pulse in view. This scarcity is what makes it mean something.
- **Drift** (4–9s) is for large art only.
- **Bars animate on change**, 600ms `cubic-bezier(.2,.8,.2,1)`, previous fill → new fill.
- **Earned things slot in**, they do not appear: `opacity 0→1` + `translateX(∓14px)→0` over 420ms
  `cubic-bezier(.2,.8,.2,1)`.
- **Route changes** crossfade 180ms with an 8px upward slide. Re-render of the *same* route does not
  transition.
- **Hover** raises text `--muted → --text` and art 2px, 160ms ease. Borders do not change colour,
  because there are no borders.
- **Focus is untouched**: `outline: 3px solid color-mix(in srgb, var(--accent) 70%, white)`, offset
  2px. Accessibility does not get redesigned.
- **`.reduced-motion` must kill all of the above.** Verify it catches anything new you add.

---

## 7. Voice

The copy is half the design. A new screen written in the old app's voice will look wrong even with
perfect CSS.

- **Sentence case, full stops.** "Ten of twenty met." not "10/20 Characters".
- **Spell small numbers in prose, set large ones as numerals.** *"Thirteen more shards and the fifth
  star adds 250."*
- **Say what happens next, not what a thing is.** "Finish it →", "Promote →", "Where they drop →" —
  a verb and a destination.
- **Warm, never cute.** No exclamation marks, no jokes, no second-person scolding. *"The courtyard is
  quiet."* is the register.
- **State guarantees plainly.** "so no Energy can be lost", "Cosmetic. She fights exactly as hard
  either way." Removing anxiety is a feature.
- **Names of things are proper nouns** and get the serif: Lantern Courtyard, the Academy grounds.
- **Empty states are written, not diagrammed.** Every generated headline needs an authored fallback.
- **Emoji** are used only as archetype/slot/material glyphs and portrait fallbacks — never as
  decoration or bullets. Audit any new one for tofu (🌫️ has no glyph in several bundled fonts).

---

## 8. Screens as precedent

When building something new, find the closest existing screen and inherit its shape.

| If the new screen is… | Follow | Because |
| --- | --- | --- |
| A dashboard / hub | **Today** | Backdrop art + one generated hook + three eyebrow threads |
| A browse-many surface | **Collection** | Ragged gallery, text filters, cut-off last card, unowned strip at the bottom |
| About one subject | **Character** | Art bleeding off one corner, `display-xl` name, hero numeral, disclosure at the bottom |
| A go/no-go decision | **Node** | The comparison *is* the screen; verdict sentence; cost under the action |
| A payoff moment | **Results** | Full frame, radial burst, one reactive headline, the rarest reward is the hero |
| A sequence or map | **Journey** | Undulating dot path on a fading line, parallax art behind |
| A collection with partial items | **Archive** | Progress-as-artwork before progress-as-bar |
| A set of sets (worlds → collections) | **Archive world / collection** | Two screens that each fit, big art behind each level, never one long scroll |
| The same content at two densities | **Collection gallery / compact** | One default display case plus a text-switch density; the switch's underline is neutral, not amber |
| An authoring tool | **Creator** | Density permitted, but eyebrows/underlined inputs/text tabs still apply; validation drawn as a path |
| An inventory / making surface | **Workshop** | Lead with what can be done now; the inventory is a shelf of serif numerals with em-dash zeros, and the full grid hides behind disclosure |
| A blocked or empty state | **Workshop, cold** | Same skeleton as the ready state, ghosted art, disabled action, and the shortfall drawn as a path to the way out |

**Not yet designed:** Party, Settings. Apply §1–§7 by analogy — eyebrow labels,
fading rules, serif numerals, no boxes — and **ask before inventing a new layout archetype for them.**

---

## 9. Constraints that outlive the design

- **`src/core/` does not change for visual work.** Everything the UI shows already exists:
  `readyUpgrades()`, `analyzePinnedGoals()`, `evaluateParty()`, `characterPowerBreakdown()`,
  `archiveStatus()`, `canPublishWorld()`, `characterShardAssignments()`. If a screen seems to need
  new core data, first check whether an existing selector already returns it.
- **New transient UI state goes in `store.ui`, unsaved** (e.g. `lastPowerByCharacter`,
  `justCompletedRelics`) and is cleared after render.
- **Keep every `aria-label`, `title`, `role="dialog"`, focus trap and `Escape` handler** when
  restyling. Restyling never removes an accessibility affordance.
- **Contrast floor:** `--muted-2 #8e8278` on `--bg` (~5.2:1) is the darkest colour allowed to carry
  real information. `--faint` (~3.4:1) is decorative only.
- **No CDNs, no web fonts over the network, no new dependencies.** CSP is `default-src 'self'`.
- **Layout is ratios, not absolutes.** The window resizes; express the 1440×900 mockup coordinates as
  flex/grid with the stated gutters and column widths and let the content column grow.
- **Art is placeholder until commissioned.** Build the element at the stated aspect ratio and make the
  no-art fallback deliberate: masked hatch or the deterministic glyph, never a broken image.

---

## 10. Pre-flight checklist

Run this against any new screen before calling it done.

**Structure**
- [ ] No visible rectangular border and no filled panel background anywhere on the screen.
- [ ] Every hairline fades at at least one end, and consecutive rules end at different verticals.
- [ ] Every image is masked and at least one bleeds off a frame edge.
- [ ] Every block is introduced by an 11px uppercase eyebrow.
- [ ] Three or fewer threads below the headline; anything else is behind `⌄` disclosure.

**Type & colour**
- [ ] Every quantity the player reads is set in Instrument Serif; nothing numeric is in Figtree.
- [ ] Exactly one hero numeral.
- [ ] Amber appears on at most: the primary action, the one ready thing, the active tab underline.
- [ ] No new colours introduced. Display sizes in `rem`; headline wraps (not clips) at scale 1.4.

**Voice**
- [ ] The headline is a reactive sentence in sentence case, generated from state, with an authored
      empty-state fallback.
- [ ] Every state shown in colour is also written in words.
- [ ] Actions are verb + destination, not nouns.

**Motion**
- [ ] Exactly one pulsing element, and it is the thing that is ready or blocking.
- [ ] Any bar that can change animates from its previous value.
- [ ] `.reduced-motion` kills every animation added here.

**Correctness**
- [ ] No `src/core/` changes; new transient state lives in `store.ui`.
- [ ] Every pre-existing `aria-label` / `title` / focus behaviour survived.
- [ ] Resizes cleanly — no fixed pixel layout widths outside the stated gutters.

---

## Appendix — the one-paragraph brief

*Paste this at the top of a task when you only have room for one paragraph:*

> Hero Collector's UI has no boxes. Screens sit directly on `#12100f`; art bleeds off the frame with a
> radial mask; groups are introduced by an 11px uppercase `#8e8278` eyebrow and separated by hairlines
> that fade before the corners. Instrument Serif carries headlines, names and every quantity; Figtree
> carries everything else. Amber `#e9a94f` is the only accent and marks the primary action plus the
> single thing that is ready — which is also the only pulsing element on the screen. Headlines are
> reactive sentences generated from the save ("Ten of twenty met."), state is always written in words
> as well as colour, and tables live behind `⌄` disclosure. Progress is felt: bars animate from their
> previous value, earned things slide in, and where possible the artwork itself is the meter. Screen
> gutter 52px, 32–40px between blocks, no `src/core/` changes.
