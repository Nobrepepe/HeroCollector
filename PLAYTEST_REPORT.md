# Hero Collector — Simulated Playthrough & Balance Report

**Date:** 2026-08-06 · **Branch:** `feature/goal-driven-qol-overhaul`
**Content under test:** the live content pack exported from the running game —
v11, **6 worlds, 66 characters, 300 nodes**, 15 Expedition templates, 2 Crises
**Harness:** `scripts/playtest.mjs` — reproduce with `node --max-old-space-size=8192 scripts/playtest.mjs 4300 20260806`

---

## 1. Method

A headless bot plays the real game modules (`src/core/*`) against your content pack. Every action goes
through the same transactions the UI calls (`clearNode`, `craftEquipment`, `launchExpedition`,
`resolveCrisis`, `startConstruction`, `useFieldSupply`), so anything the bot achieves a player can achieve.

The bot's daily loop: daily reset → resolve any Crisis → build/staff HQ → launch Expeditions into all 3 slots
→ spend Energy → burn Field Supply and spend again. Energy priority is campaign frontier first (first clears
refund Energy via Frontier Momentum), then a 45/55 split between shard farming and gear materials until the
squad's gear is finished, then shards.

**Endgame target, as specified:** six characters at 7 Stars with maximum Gear. The bot commits to the five
starting characters plus Mei (cheapest sixth — the starters' 10 unlock shards are already paid).

### Caveats — these numbers are a floor, not an average

The bot never misses a day, never leaves Energy unspent, launches every Expedition every day, and answers
every Crisis. A real player will be slower. Treat **495 days** as *best-case perfect play*, and the
"no Expeditions" counterfactual (**782 days**) as roughly what a player who ignores that system experiences.

---

## 2. Headline results

| Milestone | Day |
|---|---:|
| **Six-character endgame squad complete (7★ + Gear Tier 10)** | **495** |
| All 6 Archives complete (90/90 relics) | 2,710 |
| All 300 campaign nodes cleared | 3,781 |
| All 66 characters maxed | 4,158 |

Variance across 4 RNG seeds for the 6-character goal: **495 – 509 days** (±1.5%). The game has almost no
random pacing spread — shard pity smooths drop luck, and the daily Expedition board and Crisis schedule are
derived from the save's creation time rather than the gameplay RNG, so they are near-identical run to run.

### Squad progression trace

| Day | Event |
|---:|---|
| 11 | Cleared Main 10 (threshold 7,500) |
| 65 | Cleared Main 20 (10,500) |
| 110 | First 7★ (Suzume) |
| 151 | Cleared Main 30 (14,000) |
| 252 | First character Gear Complete (Tier 10) |
| 254 | Cleared Main 40 (18,000) |
| 371 | Cleared Main 50 (22,500) |
| 435 | All six squad members at 7★ |
| 439 | Cleared Main 60 (27,500) — full Main Campaign |
| **495** | **Sixth Gear Complete — endgame squad done** |

Stars now finish **60 days before** Gear, the reverse of the pre-expansion pack — Masterwork tiers 9 and 10
added real weight to the back half of the gear curve. That is a genuine improvement.

### Party power vs. content

Party power peaks at **31,875** around day 500 and never moves again for the remaining 3,600 days.
The hardest node is **27,500**, so the ceiling now sits only **16% above** the hardest content — much better
tuned than before the expansion. But the plateau still arrives at roughly 12% of total playtime.

---

## 3. Economy measurements

### Energy budget (whole 4,158-day run)

| Source | Energy | Share |
|---|---:|---:|
| Daily grant (120/day) | 498,840 | 76.8% |
| Field Supply (Expeditions) | 148,170 | 22.8% |
| Frontier Momentum refunds | 2,484 | 0.4% |
| **Total available** | **649,494** | |
| Spent on node runs | 649,608 | 99.99% |

Field Supply is worth **+29.7% Energy on top of the daily grant** — the second pillar of the economy, not a
minor convenience.

### Where Energy goes

| Purpose | Energy | Share |
|---|---:|---:|
| Shard farming | 376,140 | 58% |
| Gear materials | 270,700 | 42% |

| Node type | Runs | Energy/material |
|---|---:|---:|
| Shard | 34,308 | — |
| Advanced (Main 7–10 of each chapter) | 24,155 | **3.40** |
| Ordinary (Main 1–6 of each chapter) | 13,498 | 4.29 |
| World Campaign | 3,641 | 5.00 |

### Material grade sourcing

| Grade | Ordinary | Advanced | World Campaign |
|---|---:|---:|---:|
| Basic | 6 | 4 | — |
| Improved | 6 | 4 | **116** |
| Advanced | 6 | 4 | **58** |
| Superior | 12 | 8 | — |
| Masterwork | 6 | 4 (Main 51–60) | — |

The expansion made World Campaigns matter: they are now the bulk supply of Improved and Advanced materials,
and the bot ran them 3,641 times (versus 120 in the pre-expansion pack, where it only ever touched them once
each for Archive fragments).

### Shard economy

- 70% drop with guaranteed-after-one-miss pity = **0.769 shards per run**
- 0 → 7★ costs 450 shards = **585 runs = 5,850 Energy = 48.7 days of full daily grant, per character**
- 66 characters = **386,100 Energy ≈ 3,218 days of grant** — this single cost dictates the 4,158-day full clear
- 29,225 shards came from nodes; 6,090 (17.2%) from Expeditions

### System contribution (days to the 6-character goal)

| Configuration | Days | Cost of removing |
|---|---:|---:|
| Everything on (baseline) | 495 | — |
| No Crises | 505 | +10 |
| No Headquarters | 521 | +26 |
| No Field Supply | 633 | +138 |
| No Expeditions | 782 | +287 |

**Expeditions are the entire out-of-campaign economy**, and Field Supply *comes from* Expeditions.
Headquarters and Crises together account for **36 days out of 495 (7%)** — better than the pre-expansion
pack, but still small for two fully authored systems, and most of that is HQ Training's Power bonus.

---

## 4. Bugs

### BUG-1 · Crisis outcome is non-monotonic when a grade has 4+ Fronts — **confirmed**

`previewCrisis()` in `src/core/crises.js:120` hard-codes the outcome table for exactly 2 or 3 Fronts:

```js
const outcome = active.fronts.length === 2
  ? completed === 2 ? 'mastered' : completed === 1 ? 'resolved' : 'endured'
  : completed === 3 ? 'mastered' : completed === 2 ? 'resolved' : 'endured';
```

`validateContent()` (`src/core/validate.js:90`) only floor-checks `grade.frontCount >= 2` — no upper bound.
Your authored Crises carry **5 Fronts each**, so raising a grade's `frontCount` is a natural authoring move.
With `frontCount: 4`:

| Fronts completed | Outcome |
|---:|---|
| 0 / 4 | endured |
| 1 / 4 | endured |
| 2 / 4 | resolved |
| 3 / 4 | **mastered** |
| 4 / 4 | **endured** ← perfect play scores worst |

Clearing every Front loses the Emergency Cache and the boon. Content validates as `ok: true`.

**Fix:** generalise to `completed === n ? 'mastered' : completed >= n - 1 ? 'resolved' : 'endured'`, and add
an upper bound to the `frontCount` validation.

### BUG-2 · Content Creator accepts an Expedition party size its own validator rejects — **confirmed**

`src/ui/creator.js:335` renders the guaranteed Supply route's party size as
`numInput(guaranteed, 'partySize', store, { min: 1, step: 1 })` — **no `max`**. `src/core/validate.js:66`
rejects `partySize > 4`. Typing `5` produces `exp_template_1: invalid party size` and the pack stops loading.
Separately, `src/ui/expeditions.js` hard-codes `Array(5).fill(null)` slots, so the UI could not present a
larger party anyway.

**Fix:** add `max: 4` to the input and derive the slot count from `offer.partySize`.

### BUG-3 · Four of six Headquarters are permanently unbuildable — **confirmed, hard deadlock**

Every HQ facility level costs `renown + @associated_world_asset` (10 / 25 / 50). Four worlds have **no source
at all** for their asset:

| World | Asset | Nodes granting it | Expedition templates | Crisis definitions |
|---|---|---:|---:|---:|
| Eden Hidden Village | `clan_seals` | 30 | 5 | 1 |
| Eden Magic Academy | `arcane_sigils` | 30 | 5 | 1 |
| **Eden Desert** | `asset_cw_ms9wlql71` | **0** | **0** | **0** |
| **Eden Island** | `asset_cw_msb7aaxc1` | **0** | **0** | **0** |
| **Eden Hills** | `asset_cw_msf9mqhk1` | **0** | **0** | **0** |
| **Eden Manor** | `asset_cw_msf9mwc92` | **0** | **0** | **0** |

The only other source would be the HQ *production* facility — which requires level ≥ 1, which requires the
asset. Circular. Across 4,158 simulated days the bot built **24 of 72** possible facility levels: the two
original worlds fully developed, the four newer worlds at zero, forever.

This scaled with the expansion — it was 2 of 4 worlds before, it is 4 of 6 now. Each new world inherits the
same gap: campaign nodes authored without `@associated_world_asset` repeat rewards, no Expedition templates,
no Crisis content.

**Fix:** add `@associated_world_asset` repeat rewards to those worlds' campaign nodes and clone the
Expedition/Crisis templates for them. Worth adding a validation rule: *every live world's asset needs at
least one live source* — that check would have caught this at authoring time and will keep catching it as
you add worlds.

### Not bugs, but worth knowing

- No invariant violations in 4,158 simulated days: no negative Energy, no
  `checkClear`-passes-then-`clearNode`-fails mismatch, no craft-loop non-termination, no preview/commit
  divergence in Expeditions or Field Supply. All 73 existing tests pass.
- `partySize` in `balance.json` is **5**, not 6. You described the endgame as a "six character party" —
  `partyPresetCount: 6` (six saved *presets*) is likely the source of the mix-up. This report treats the
  goal as six maxed characters.

---

## 5. Balance findings

### RESOLVED · Gear Tiers 9–10 are now reachable

In the previously committed pack, `maxGearTier` derived to **8** because the highest repeatable material
grade was Superior — two gear tiers, the Masterwork family and 800 Power per character were dead content.
Main 51–60 now publish Masterwork nodes, so `maxGearTier` is **10/10** and the ceiling is fully reachable.
Nothing to do here; noting it because it was the top finding before the expansion.

### F-1 · Expedition difficulty scales with roster *variance*, not roster *strength* — inverted incentive

`recommendedPower = averageOwnedCharacterPower × partySize × ratio` (ratio 1.00–1.15), but you send your
**strongest** characters:

| Roster | Owned | Avg power | Hardest recommendation | You send | Margin |
|---|---:|---:|---:|---:|---:|
| 5 starters, 1★, no gear | 5 | 1,150 | 5,290 | 4,600 | **−13%** |
| 6 maxed, nobody else | 6 | 5,000 | 23,000 | 20,000 | **−13%** |
| 6 maxed + 20 fresh 1★ | 26 | 2,038 | 9,377 | 20,000 | **+113%** |

A player who focuses six characters can *never* beat the recommendation on a 1.15-ratio route. A player who
unlocks twenty characters they never invest in beats it by 113%. Investment is punished; hoarding is
rewarded. Measured over the run, the "exceptional" rate tracks roster *shape*, not roster power:

| Days | completed (1.0×) | successful (1.25×) | exceptional (1.5×) |
|---|---:|---:|---:|
| 0–199 | 45% | 1% | 53% |
| 400–599 | 17% | 0% | 82% |
| **600–1,999** | **0%** | 0% | **100%** |
| 2,600–2,799 | 31% | 5% | 62% |
| 3,600–3,799 | **54%** | 2% | 43% |

For 1,400 consecutive days every single Expedition is "exceptional". By the end — with **all 66 characters
maxed** — over half fail to beat the recommendation. The strongest possible roster performs worse than the
scruffy mid-game one. The expansion made this more pronounced, not less, because more unlockable characters
means a deeper trough of uninvested ones.

**Fix:** base `recommendedPower` on something independent of roster composition — the campaign chapter the
player has reached, or the top-`partySize` average rather than the whole-roster average.

### F-2 · Crises almost never fail — 745 mastered, 1 endured in 783 spawns

95.1% mastered, 4.7% resolved, **one** endured (day 413, during a roster transition). Recommended Powers sit
2.9–5.0× below what a maxed team brings, and the gap widened with the expansion because the character Power
ceiling rose from 4,200 to 5,000:

| Grade | Team size | Hardest Front | Maxed team delivers | Ratio |
|---|---:|---:|---:|---:|
| Local | 2 | 2,800 | 14,000 | 5.0× |
| Major | 2 | 4,600 | 14,000 | 3.0× |
| World | 3 | 7,200 | 21,000 | 2.9× |

Two 1★ characters with no gear bring 2,300 — already within 20% of the *hardest* Local Front.

**Fix:** multiply `recommendedPowerByGrade` by roughly 3–5×, and scale it with campaign progress rather than
fixing it at authoring time.

### F-3 · Field Supply income (1/day) is below its own use cap (2/day) — Training L2 is dead weight

Exactly one Expedition template carries a Field Supply, and the guaranteed route appears once per board:
**maximum income is 1 Supply/day**. Training facility level 2 raises the *daily use cap* from 1 to 2, and
level 3 raises storage from 3 to 4 — neither can ever bind. Measured: 4,939 Supplies used over 4,158 days
(1.19/day), 0 wasted.

**Fix:** either add Field Supply to a second reward package, or move Training's bonus to something that
binds (Energy storage cap, or Supply restore value above 30).

### F-4 · Two of six worlds carry the entire Expedition and Crisis load

All 15 Expedition templates target Hidden Village, Magic Academy, or no world; both Crisis definitions belong
to the two original worlds. Four worlds contribute campaign nodes and characters only. Combined with BUG-3
this means the four newer worlds have no Headquarters, no Expeditions and no Crises — roughly two thirds of
your world content sits outside three of the game's systems.

### F-5 · World Campaign nodes remain the least efficient farm

10 Energy → 2 guaranteed materials, no bonus roll = **5.00 Energy/material**, versus 3.40 for Main "advanced"
nodes — while carrying thresholds up to 19,500. Unlike the pre-expansion pack they are now unavoidable
(they hold 116 of 126 Improved-grade nodes and 58 of 68 Advanced-grade), so players pay a 47% efficiency
penalty on two whole material grades. Raising `world.repeat.count` to 3 (3.33 Energy/material) or adding a
bonus roll would fix it.

### F-6 · Energy storage cap is 2.0 days

`dailyGrant: 120`, `storageCap: 240`. A player who misses two consecutive days begins losing grant outright.
For a game whose full completion is 4,158 days, that is an unforgiving window.

### F-7 · 88% of the run has no power progression

Power peaks around day 500 and is flat for the remaining 3,600 days. Days 500–4,158 are pure shard
accumulation against content that was already cleared. The expansion pushed the plateau later in absolute
terms (day ~500 vs ~450) but *earlier* as a fraction of total playtime, because it added far more shard grind
than power ceiling. If the 66-character full clear is a goal you want players to pursue, it needs something
to pull against — harder late nodes, or a shard-cost curve that eases as characters are already maxed.

---

## 6. Recommended adjustments, in priority order

| # | Change | Why |
|---|---|---|
| 1 | Give Eden Desert / Island / Hills / Manor world-asset sources (node repeat rewards + Expedition templates + Crisis definitions) | BUG-3 + F-4 — four of six worlds have permanently dead HQ/Expedition/Crisis systems |
| 2 | Fix `previewCrisis()` outcome mapping for N Fronts; bound `frontCount` in validation | BUG-1 — perfect Crisis play currently scores worst |
| 3 | Base Expedition `recommendedPower` on campaign progress, not roster average | F-1 — currently punishes focused investment |
| 4 | Raise Crisis `recommendedPowerByGrade` ~3–5× and scale with progress | F-2 — 1 failure in 783 Crises |
| 5 | Add a second Field Supply source, or re-point Training L2/L3 | F-3 — the cap can never bind |
| 6 | Raise `world` node `repeat.count` to 3 or add a bonus roll | F-5 — now unavoidable *and* 47% less efficient |
| 7 | Add a validation rule: every live world's asset needs ≥1 live source | would have caught BUG-3, and will catch it again on the next world |
| 8 | Add `max: 4` to the Creator's Expedition party-size input | BUG-2 |
| 9 | Consider `storageCap: 360` (3 days) | F-6 |

Items 1–4 are the ones that change how the game actually plays.

---

## 7. Reproducing

```bash
node --max-old-space-size=8192 scripts/playtest.mjs 4300 20260806
```

Arguments: `[maxDays] [seed]`. Flags: `--quiet` (JSON only), and `--no-supply`, `--no-expeditions`,
`--no-hq`, `--no-crises` for the counterfactual table in §3. The harness prints a milestone log followed by
a single JSON line containing full statistics, the per-character final state, campaign/archive progress,
and any invariant violations it detected. The larger heap is required because the content pack embeds art.
