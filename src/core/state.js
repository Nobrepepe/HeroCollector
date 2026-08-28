// Player state and transactions. Every mutation validates its inputs first and
// either completes fully or changes nothing (GDD 12.3, Appendix B). All
// functions are deterministic given the injected RNG.
import { characterPower, activeTier, cumulativeGearPower } from './power.js';
import { evaluateParty, partyLegality, objectiveSatisfied } from './synergy.js';
import { equipmentRecipe, equipmentName } from './content.js';
import { analyzeEquipmentGoal, analyzePinnedGoals } from './progression.js';
import { makeRng } from './rng.js';
import { grantRewardEntries } from './resources.js';
import { generateCycleBoard, resolveDueCycle } from './expeditions.js';
import { FIELD_SUPPLY_ID, fieldSupplyLimits, frontierMomentumPreview, resetDailyEnergySystems, surgedPower } from './energy.js';
import { FOCUS_SLOTS, applyFocusEnergy, revealCharacter } from './focus.js';
import { grantRelicPiece } from './relics.js';
import { applyMasteryMilestones, unlockedSkins } from './mastery.js';
import { addProcurementEnergy, addDevelopmentShards, deliverProgramPayouts } from './programs.js';
import {
  consumeCrisisNodeBoons, crisisDayRng, crisisNodeRunModifiers,
  expireActiveCrisis, generateCrisisForDay
} from './crises.js';

export const SCHEMA_VERSION = 6;

// ------------------------------------------------------------- new state
export function newPlayerState(content, now = Date.now()) {
  const b = content.balance;
  const characters = {};
  for (const def of content.characters) {
    characters[def.id] = {
      owned: !!def.starting,
      stars: def.starting ? 1 : 0,
      shards: 0,
      gearTier: 0,
      slots: emptySlots(content),
      revealed: !!def.starting,
      selectedSkinId: null
    };
  }
  const parties = [];
  for (let i = 0; i < b.partyPresetCount; i++) {
    parties.push({ name: `Party ${i + 1}`, members: [null, null, null, null, null] });
  }
  // Default first party: the starting characters (padded to five slots).
  const starters = content.characters.filter(d => d.starting).map(d => d.id).slice(0, 5);
  if (starters.length > 0) {
    parties[0].members = [...starters, ...Array(5 - starters.length).fill(null)];
    parties[0].name = 'Starters';
  }
  const state = {
    schemaVersion: SCHEMA_VERSION,
    contentVersion: content.version,
    createdAt: new Date(now).toISOString(),
    energy: b.energy.dailyGrant,
    lastResetKey: null,
    rng: null, // { seed, state } when a dev seed is set
    characters,
    inventory: { materials: {}, components: {}, resources: { intelligence: 2, field_supply: 0 } },
    nodes: {},
    parties,
    activePartyIndex: 0,
    pins: [],
    settings: {
      resetHour: b.energy.resetHour, textScale: 1, reducedMotion: false,
      confirmBulk: true, farmingResults: 'automatic'
    },
    ui: {
      roster: {
        world: 'all', archetype: 'all', faction: 'all', ownership: 'all',
        sort: 'power', direction: 'desc'
      },
      campaignId: 'main',
      nodePartyById: {}
    },
    progressLog: [],
    lastResetSummary: null,
    dayNumber: 1,
    expeditions: {
      cycle: 1, board: null, active: null, reports: [],
      allowances: { freeRerolls: 1, freeRerollsUsed: 0, freePins: 1, freePinsUsed: 0 }
    },
    focus: {
      slots: {
        primary: { characterId: null, progress: 0 },
        secondary: { characterId: null, progress: 0 },
        longTerm: { characterId: null, progress: 0 }
      }
    },
    programs: {},
    relics: { pieces: {} },
    mastery: {},
    surge: null,
    energySystems: { daily: { day: 1, momentumRefunded: 0 } },
    crises: { active: null, lastSpawnDay: null, cycleSeen: [], history: [] }
  };
  applyDailyReset(content, state, now); // establishes the reset-day key
  ensureExpeditionBoard(content, state);
  state.lastResetSummary = null;        // no "welcome back" on a brand-new save
  return state;
}

export function emptySlots(content) {
  const slots = {};
  for (const s of content.characterMeta.slotOrder) slots[s] = false;
  return slots;
}

// Reconcile a loaded save with the (possibly changed) content set: create
// state entries for characters that are new to the content, and detach live
// references (party slots, pins) to characters that are gone. Progress for
// missing content is kept dormant in the save — republishing or restoring the
// content brings it back untouched. Returns `changes` (things this call
// actually did to the save) and `notices` (standing observations that changed
// nothing), so callers can report the two honestly rather than as one count.
export function syncSaveWithContent(content, state) {
  const report = [];
  const notices = [];
  for (const def of content.characters) {
    if (!state.characters[def.id]) {
      state.characters[def.id] = {
        owned: false, stars: 0, shards: 0, gearTier: 0,
        slots: emptySlots(content), revealed: false, selectedSkinId: null
      };
    }
    // Starting characters are granted at 1★ — including when content becomes
    // ready after the save was created, or a character is newly flagged.
    const cs = state.characters[def.id];
    cs.revealed ??= cs.owned;
    cs.selectedSkinId ??= null;
    if (cs.selectedSkinId && !content.skinById[cs.selectedSkinId]) {
      cs.selectedSkinId = null;
      report.push(`Cleared a selected skin for ${def.displayName} whose content is no longer live.`);
    }
    if (def.starting && !cs.owned) {
      cs.owned = true;
      cs.stars = Math.max(1, cs.stars);
      cs.revealed = true;
      report.push(`Granted starting character ${def.displayName}.`);
    }
  }
  // Keep the first party preset usable: fill empty slots with owned characters.
  const first = state.parties[0];
  if (first && first.members.every(m => m === null)) {
    const owned = content.characters.filter(d => state.characters[d.id]?.owned).map(d => d.id).slice(0, 5);
    if (owned.length > 0) {
      first.members = [...owned, ...Array(5 - owned.length).fill(null)];
    }
  }
  let dormant = 0;
  for (const id of Object.keys(state.characters)) {
    if (!content.characterById[id] && state.characters[id].owned) dormant++;
  }
  if (dormant > 0) notices.push(`${dormant} owned character${dormant > 1 ? 's are' : ' is'} dormant (their content is not in the game right now); progress is kept and returns if the content does.`);
  for (const party of state.parties) {
    for (let i = 0; i < party.members.length; i++) {
      const m = party.members[i];
      if (m && !content.characterById[m]) {
        party.members[i] = null;
        report.push(`Removed a missing character from party “${party.name}”.`);
      }
    }
  }
  const beforePins = state.pins.length;
  state.pins = state.pins.filter(p => {
    const cs = state.characters[p.characterId];
    if (!content.characterById[p.characterId] || !cs) return false;
    if (p.type === 'equipment') {
      return !!content.characterMeta.slots[p.slot]
        && cs.owned
        && !!activeTier(content.balance, cs, content.maxGearTier)
        && !cs.slots[p.slot];
    }
    if (p.type === 'character') {
      if (p.objective === 'unlock') return !cs.owned;
      if (p.objective === 'promotion') return cs.stars < (p.targetStars ?? cs.stars + 1);
      return cs.stars < 7;
    }
    return false;
  });
  if (state.pins.length < beforePins) report.push(`Removed ${beforePins - state.pins.length} pin(s) for missing content.`);
  state.ui ??= {
    roster: { world: 'all', archetype: 'all', faction: 'all', ownership: 'all', sort: 'power', direction: 'desc' },
    campaignId: 'main', nodePartyById: {}
  };
  state.ui.nodePartyById ??= {};
  for (const [nodeId, index] of Object.entries(state.ui.nodePartyById)) {
    if (!content.nodeById[nodeId] || !Number.isInteger(index) || index < 0 || index >= state.parties.length) {
      delete state.ui.nodePartyById[nodeId];
      report.push(`Removed an invalid saved party preference for ${nodeId}.`);
    }
  }
  const campaigns = new Set(['main', ...content.worlds.map(w => w.campaignId)]);
  if (!campaigns.has(state.ui.campaignId)) state.ui.campaignId = 'main';
  // The world last held on the Worlds stage; forget it if content dropped it.
  if (state.ui.selectedWorldId && !content.worldById[state.ui.selectedWorldId]) {
    delete state.ui.selectedWorldId;
  }
  const roster = state.ui.roster ??= {
    world: 'all', archetype: 'all', faction: 'all', ownership: 'all', sort: 'power', direction: 'desc'
  };
  if (!new Set(['all', ...content.worlds.map(w => w.id)]).has(roster.world)) roster.world = 'all';
  if (!new Set(['all', ...Object.keys(content.archetypes)]).has(roster.archetype)) roster.archetype = 'all';
  if (!new Set(['all', ...content.tags.filter(t => t.category === 'faction').map(t => t.id)]).has(roster.faction)) roster.faction = 'all';
  if (!new Set(['all', 'owned', 'unowned', 'ready']).has(roster.ownership)) roster.ownership = 'all';
  if (!new Set(['name', 'power', 'stars', 'gearTier', 'ready']).has(roster.sort)) roster.sort = 'name';
  if (!new Set(['asc', 'desc']).has(roster.direction)) roster.direction = 'asc';
  if (!Number.isInteger(state.activePartyIndex)
    || state.activePartyIndex < 0 || state.activePartyIndex >= state.parties.length) state.activePartyIndex = 0;
  state.energySystems ??= { daily: { day: state.dayNumber, momentumRefunded: 0 } };
  state.crises ??= { active: null, lastSpawnDay: null, cycleSeen: [], history: [] };
  // Focus slots and Program choices must reference live, still-usable heroes;
  // slot progress is kept either way (it belongs to the slot).
  for (const slot of FOCUS_SLOTS) {
    const entry = state.focus.slots[slot];
    if (entry.characterId && (!content.characterById[entry.characterId] || !state.characters[entry.characterId])) {
      entry.characterId = null;
      report.push(`Cleared the ${slot} Focus slot: its hero is no longer in the game. The slot keeps its progress.`);
    }
  }
  for (const [worldId, ps] of Object.entries(state.programs)) {
    if (!content.worldById[worldId]) continue; // dormant, returns with the world
    if (ps.procurement.family && !content.materialMeta.familyOrder.includes(ps.procurement.family)) {
      ps.procurement.family = null;
      report.push(`Cleared an unknown Procurement material family for ${worldId}.`);
    }
    if (ps.development.heroId) {
      const def = content.characterById[ps.development.heroId];
      if (!def || def.world !== worldId) {
        ps.development.heroId = null;
        report.push(`Cleared the Development hero for ${worldId}: they are no longer in the game.`);
      }
    }
  }
  // A waiting route board referencing content that left the game is simply
  // regenerated; a launched cycle keeps running (reward grants are guarded).
  if (state.expeditions.board) {
    const stale = state.expeditions.board.offers.some(offer =>
      (offer.world && !content.worldById[offer.world])
      || offer.baseRewards.some(entry => entry.kind === 'shards' && entry.characterId && !content.characterById[entry.characterId]));
    if (stale) {
      state.expeditions.board = null;
      report.push('Replaced the waiting route board: some routes referenced content that left the game.');
    }
  }
  const crisis = state.crises.active;
  if (crisis && (!content.worldById[crisis.worldId] || !content.crisisById[crisis.definitionId])) {
    expireActiveCrisis(state, 'The authored Crisis content left the game, so the response expired without penalty.');
    report.push('Expired a Crisis whose authored world or definition is no longer live.');
  } else if (crisis?.status === 'planning') {
    for (const [frontId, slots] of Object.entries(crisis.assignments ?? {})) {
      slots.forEach((characterId, index) => {
        if (characterId && (!content.characterById[characterId] || !state.characters[characterId]?.owned)) {
          crisis.assignments[frontId][index] = null;
          report.push(`Opened a Crisis assignment after ${characterId} left the live roster.`);
        }
      });
    }
  }
  const supplyLimits = fieldSupplyLimits(content, state);
  if (supplyLimits.held > supplyLimits.storageCap) {
    state.inventory.resources[FIELD_SUPPLY_ID] = supplyLimits.storageCap;
    report.push(`Field Supply storage is ${supplyLimits.storageCap}; ${supplyLimits.held - supplyLimits.storageCap} excess Suppl${supplyLimits.held - supplyLimits.storageCap === 1 ? 'y was' : 'ies were'} removed explicitly.`);
  }
  return { changes: report, notices };
}

export function nodeState(state, nodeId) {
  return state.nodes[nodeId] ?? { cleared: false, firstClearClaimed: false, objectiveClaimed: false };
}
function ensureNodeState(state, nodeId) {
  if (!state.nodes[nodeId]) state.nodes[nodeId] = { cleared: false, firstClearClaimed: false, objectiveClaimed: false };
  return state.nodes[nodeId];
}

export function logProgress(state, text, now = Date.now()) {
  state.progressLog.unshift({ at: new Date(now).toISOString(), text });
  if (state.progressLog.length > 30) state.progressLog.length = 30;
}

// ------------------------------------------------------------- daily reset
// The reset day rolls over at settings.resetHour local time. Processing is
// idempotent per reset-day key; backward clock movement grants nothing.
export function resetDayKey(now, resetHour) {
  const d = new Date(now - resetHour * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysBetweenKeys(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export function applyDailyReset(content, state, now = Date.now()) {
  const b = content.balance;
  const key = resetDayKey(now, state.settings.resetHour);
  if (state.lastResetKey === null) {
    state.lastResetKey = key;
    ensureExpeditionBoard(content, state);
    return null;
  }
  const days = daysBetweenKeys(state.lastResetKey, key);
  if (days <= 0) return null; // same day, or clock moved backward: never re-grant
  const before = state.energy;
  const cycleReports = [], shipments = [];
  for (let elapsed = 0; elapsed < days; elapsed++) {
    state.dayNumber++;
    state.energy = Math.min(b.energy.storageCap, state.energy + b.energy.dailyGrant);
    resetDailyEnergySystems(state);
    const cycleReport = resolveDueCycle(content, state, dayRng(state, elapsed));
    if (cycleReport) cycleReports.push(cycleReport);
    shipments.push(...deliverProgramPayouts(content, state));
    if (state.crises?.active) expireActiveCrisis(state);
  }
  ensureExpeditionBoard(content, state);
  const crisis = generateCrisisForDay(content, state, crisisDayRng(state));
  state.lastResetKey = key;
  const summary = {
    days,
    energyGained: state.energy - before,
    energy: state.energy,
    cycleReports, shipments, crisis, acknowledged: false
  };
  state.lastResetSummary = summary;
  return summary;
}

function dayRng(state, salt = 0) {
  let hash = 2166136261;
  const text = `${state.createdAt}:${state.dayNumber}:${salt}`;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return makeRng(hash >>> 0);
}

// A cycle board is generated when none is waiting and no cycle is away — on a
// new save, after content changes replaced a stale board, and after a cycle
// resolves. The board then waits for the player indefinitely.
export function ensureExpeditionBoard(content, state) {
  if (!state.expeditions || !content.expeditions?.templates?.length) return null;
  if (state.expeditions.active) return null;
  if (state.expeditions.board) return state.expeditions.board;
  return generateCycleBoard(content, state, dayRng(state));
}

// ------------------------------------------------------------- inventory
export function matQty(state, id) { return state.inventory.materials[id] ?? 0; }
export function compQty(state, id) { return state.inventory.components[id] ?? 0; }
function addMat(state, id, qty) {
  state.inventory.materials[id] = matQty(state, id) + qty;
  if (state.inventory.materials[id] === 0) delete state.inventory.materials[id];
}
function addComp(state, id, qty) {
  state.inventory.components[id] = compQty(state, id) + qty;
  if (state.inventory.components[id] === 0) delete state.inventory.components[id];
}

// Materials reserved by pinned equipment recipes (GDD 6.2, 11.3): the material
// cost of components still missing for each pinned piece.
export function reservedMaterials(content, state) {
  return analyzePinnedGoals(content, state).reservations;
}

// ------------------------------------------------------------- node access
export function worldCampaignUnlocked(content, state, worldId) {
  const owned = content.characters.filter(d => d.world === worldId && state.characters[d.id].owned).length;
  return { unlocked: owned >= content.balance.partySize, owned, needed: content.balance.partySize };
}

export function nodeUnlocked(content, state, node) {
  if (node.campaign !== 'main') {
    const wc = worldCampaignUnlocked(content, state, node.world);
    if (!wc.unlocked) {
      const w = content.worldById[node.world].displayName;
      return { unlocked: false, reason: `Own ${wc.needed} ${w} characters to unlock this campaign (${wc.owned}/${wc.needed}).` };
    }
  }
  if (node.previous && !nodeState(state, node.previous).cleared) {
    const prev = content.nodeById[node.previous];
    return { unlocked: false, reason: `Clear “${prev.displayName}” first.` };
  }
  return { unlocked: true, reason: null };
}

export function nodeEnergyCost(content, node) {
  return content.balance.nodeDefaults[node.type].energy;
}

// Full availability check for a clear/sweep of `count` runs. Never spends
// anything; returns { ok, reasons: [...] } so the UI can explain every block.
// An armed Surge is applied to the Power gate when the party alone falls
// short; `surgeApplied` reports that the Surge is what carries the attempt.
export function checkClear(content, state, nodeId, members, count = 1) {
  const node = content.nodeById[nodeId];
  const reasons = [];
  if (!node) return { ok: false, reasons: ['Unknown node.'] };
  if (!Number.isInteger(count) || count < 1) return { ok: false, reasons: ['Run count must be at least 1.'] };
  if (count > 1 && !nodeState(state, nodeId).cleared) {
    reasons.push('Sweep unlocks after the first clear of this node.');
  }
  const unlock = nodeUnlocked(content, state, node);
  if (!unlock.unlocked) reasons.push(unlock.reason);
  const legal = partyLegality(content, state, members, node);
  if (!legal.legal) reasons.push(legal.reason);
  let evalResult = null;
  let surgeApplied = false;
  if (legal.legal) {
    evalResult = evaluateParty(content, state, members);
    if (evalResult.effectivePower < node.threshold) {
      const surged = surgedPower(state, evalResult.effectivePower);
      if (surged >= node.threshold) {
        surgeApplied = true;
      } else {
        reasons.push(`Effective Power ${fmt(evalResult.effectivePower)} is below the required ${fmt(node.threshold)}. No Energy is spent on attempts that cannot succeed.`);
      }
    }
  }
  const boon = crisisNodeRunModifiers(state, node, count);
  const paidRuns = count - boon.freeRuns;
  const cost = nodeEnergyCost(content, node) * paidRuns;
  if (state.energy < cost) reasons.push(`Not enough Energy (${state.energy}/${cost}). Energy refreshes at the daily reset.`);
  return { ok: reasons.length === 0, reasons, evalResult, cost, node, paidRuns, freeRuns: boon.freeRuns, boon, surgeApplied };
}

export function maxSweepCount(content, state, nodeId) {
  const node = content.nodeById[nodeId];
  if (!node) return 0;
  const free = crisisNodeRunModifiers(state, node, Number.MAX_SAFE_INTEGER).freeRuns;
  return Math.max(0, free + Math.floor(state.energy / nodeEnergyCost(content, node)));
}

// ------------------------------------------------------------- clear / sweep
// Executes `count` paid runs of a node in one batch. First-clear rewards,
// objective rewards, and Archive fragments are each claimable once.
export function clearNode(content, state, nodeId, members, count, rng, now = Date.now()) {
  const check = checkClear(content, state, nodeId, members, count);
  if (!check.ok) return { ok: false, reasons: check.reasons };
  const readyBefore = new Set(content.characters
    .filter(def => state.characters[def.id].owned
      ? checkPromoteStar(content, state, def.id).ok
      : checkUnlockCharacter(content, state, def.id).ok)
    .map(def => def.id));
  const node = check.node;
  const b = content.balance;
  const ns = ensureNodeState(state, nodeId);
  const wasCleared = ns.cleared;

  state.energy -= check.cost;

  const rewards = { materials: {}, shards: {}, relicPieces: [], milestones: [], firstClear: false, objective: false,
    revealed: [], focusShards: [], masteryEvents: [], surgeUsed: false,
    energySpent: check.cost, energyRefunded: 0, paidRuns: check.paidRuns, freeRunsUsed: check.freeRuns, runs: count };
  const gainMat = (id, qty) => { rewards.materials[id] = (rewards.materials[id] ?? 0) + qty; };

  for (let run = 0; run < count; run++) {
    const def = b.nodeDefaults[node.type];
    gainMat(node.material, def.repeat.count);
    if (def.repeat.bonusChanceBp > 0 && rng.chanceBp(def.repeat.bonusChanceBp)) gainMat(node.material, 1);
  }
  if (check.boon.bonusMaterialRuns > 0 && check.boon.bonusMaterialQty > 0) {
    gainMat(node.material, check.boon.bonusMaterialRuns * check.boon.bonusMaterialQty);
    rewards.bonusMaterialRuns = check.boon.bonusMaterialRuns;
  }

  if (!ns.firstClearClaimed && node.firstClear) {
    for (const m of node.firstClear.materials ?? []) gainMat(m.materialId, m.qty);
    if (node.encounterCharacter && revealCharacter(content, state, node.encounterCharacter)) {
      rewards.revealed.push(node.encounterCharacter);
    }
    if (node.firstClear.shards) {
      rewards.shards[node.firstClear.shards.characterId] =
        (rewards.shards[node.firstClear.shards.characterId] ?? 0) + node.firstClear.shards.qty;
    }
    if (node.firstClear.relicPiece && grantRelicPiece(state, node.firstClear.relicPiece)) {
      rewards.relicPieces.push(node.firstClear.relicPiece);
    }
    if (node.firstClear.milestone) rewards.milestones.push(node.firstClear.milestone);
    ns.firstClearClaimed = true;
    rewards.firstClear = true;
  }
  if (!wasCleared && node.firstClearRewards?.length) {
    rewards.extra ??= [];
    rewards.extra.push(...grantRewardEntries(content, state, node.firstClearRewards));
  }
  if (node.repeatRewards?.length) {
    rewards.extra ??= [];
    for (let run = 0; run < count; run++) rewards.extra.push(...grantRewardEntries(content, state, node.repeatRewards));
  }

  if (node.objective && !ns.objectiveClaimed && objectiveSatisfied(content, node.objective, members)) {
    for (const m of node.objective.reward.materials ?? []) gainMat(m.materialId, m.qty);
    ns.objectiveClaimed = true;
    rewards.objective = true;
  }

  for (const [id, qty] of Object.entries(rewards.materials)) addMat(state, id, qty);
  for (const [charId, qty] of Object.entries(rewards.shards)) state.characters[charId].shards += qty;
  ns.cleared = true;
  consumeCrisisNodeBoons(state, node, check.boon);
  if (check.surgeApplied) {
    state.surge = null;
    rewards.surgeUsed = true;
    logProgress(state, `A Field Surge carried the party through ${node.displayName}.`, now);
  }

  // Every point of Energy spent advances Development Focus and, when the node
  // belongs to a world, that world's Procurement Program.
  rewards.focusShards = applyFocusEnergy(content, state, check.cost);
  if (node.world) addProcurementEnergy(content, state, node.world, check.cost);
  const shardsByWorld = {};
  const countShards = (characterId, qty) => {
    const world = content.characterById[characterId]?.world;
    if (world) shardsByWorld[world] = (shardsByWorld[world] ?? 0) + qty;
  };
  for (const [charId, qty] of Object.entries(rewards.shards)) countShards(charId, qty);
  for (const grant of rewards.focusShards) countShards(grant.characterId, grant.shards);
  for (const [world, qty] of Object.entries(shardsByWorld)) addDevelopmentShards(content, state, world, qty);

  // Mastery can move for the node's world and for any world whose hero was
  // just revealed; crossing a rank grants its milestone immediately.
  const masteryWorlds = new Set();
  if (node.world) masteryWorlds.add(node.world);
  for (const characterId of rewards.revealed) {
    const world = content.characterById[characterId]?.world;
    if (world) masteryWorlds.add(world);
  }
  for (const world of masteryWorlds) {
    rewards.masteryEvents.push(...applyMasteryMilestones(content, state, world, now));
  }

  const momentum = frontierMomentumPreview(state, { firstClear: !wasCleared, energySpent: check.cost });
  if (momentum.energyRefunded > 0) {
    state.energy = Math.min(b.energy.storageCap, state.energy + momentum.energyRefunded);
    state.energySystems.daily.momentumRefunded += momentum.energyRefunded;
    rewards.energyRefunded = momentum.energyRefunded;
    logProgress(state, `Frontier Momentum returned ${momentum.energyRefunded} Energy after the first clear of ${node.displayName}.`, now);
  }
  for (const characterId of rewards.revealed) {
    logProgress(state, `Encountered ${content.characterById[characterId].displayName} — now a Development Focus target.`, now);
  }
  if (!wasCleared) {
    logProgress(state, `First clear: ${node.displayName}${rewards.firstClear ? ' (first-clear rewards claimed)' : ''}`, now);
  }
  const newlyReadyCharacters = content.characters
    .filter(def => !readyBefore.has(def.id) && (state.characters[def.id].owned
      ? checkPromoteStar(content, state, def.id).ok
      : checkUnlockCharacter(content, state, def.id).ok))
    .map(def => def.id);
  return { ok: true, rewards, node, evalResult: check.evalResult, newlyReadyCharacters };
}

// ------------------------------------------------------------- crafting
export function checkCraftComponent(content, state, componentId, qty) {
  const def = content.componentById[componentId];
  if (!def) return { ok: false, reasons: ['Unknown component.'] };
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, reasons: ['Quantity must be at least 1.'] };
  const reasons = [];
  for (const input of def.inputs) {
    const need = input.qty * qty, have = matQty(state, input.materialId);
    if (have < need) {
      reasons.push(`Need ${need} ${content.materialById[input.materialId].displayName} (have ${have}).`);
    }
  }
  return { ok: reasons.length === 0, reasons, def };
}

export function craftComponent(content, state, componentId, qty, now = Date.now()) {
  const check = checkCraftComponent(content, state, componentId, qty);
  if (!check.ok) return { ok: false, reasons: check.reasons };
  for (const input of check.def.inputs) addMat(state, input.materialId, -input.qty * qty);
  addComp(state, componentId, qty);
  return { ok: true, componentId, qty };
}

export function maxCraftableComponents(content, state, componentId) {
  const def = content.componentById[componentId];
  if (!def) return 0;
  return Math.min(...def.inputs.map(i => Math.floor(matQty(state, i.materialId) / i.qty)));
}

export function checkUpcraft(content, state, materialId, times) {
  const def = content.materialById[materialId];
  if (!def) return { ok: false, reasons: ['Unknown material.'] };
  if (!def.conversionTarget) return { ok: false, reasons: ['Masterwork materials cannot be upcrafted further.'] };
  const target = content.materialById[def.conversionTarget];
  const targetRank = content.materialMeta.grades[target.grade].rank;
  if (targetRank > content.maxMaterialGradeRank) {
    return { ok: false, reasons: [`${target.displayName} is not unlocked by the current campaigns. Publish a freely repeatable ${content.materialMeta.grades[target.grade].name} material node to raise the progression ceiling.`], def };
  }
  if (!Number.isInteger(times) || times < 1) return { ok: false, reasons: ['Quantity must be at least 1.'] };
  const need = def.conversionCost * times, have = matQty(state, materialId);
  if (have < need) return { ok: false, reasons: [`Need ${need} ${def.displayName} (have ${have}).`], def };
  // Warn (not block) when the upcraft would dip into pinned-recipe reserves.
  const reserved = reservedMaterials(content, state).materials[materialId] ?? 0;
  const warning = reserved > 0 && have - need < reserved
    ? `This would consume materials reserved by pinned recipes (${reserved} ${def.displayName} reserved).`
    : null;
  return { ok: true, reasons: [], def, warning };
}

export function upcraft(content, state, materialId, times) {
  const check = checkUpcraft(content, state, materialId, times);
  if (!check.ok) return { ok: false, reasons: check.reasons };
  addMat(state, materialId, -check.def.conversionCost * times);
  addMat(state, check.def.conversionTarget, times);
  return { ok: true, produced: check.def.conversionTarget, qty: times, warning: check.warning };
}

// ------------------------------------------------------------- equipment
export function checkCraftEquipment(content, state, characterId, slot) {
  const plan = analyzeEquipmentGoal(content, state, characterId, slot);
  return {
    ok: plan.state === 'components-ready',
    reasons: plan.state === 'components-ready' ? [] :
      plan.state === 'chain-ready'
        ? ['Required components can be crafted from available materials.']
        : plan.reasons,
    recipe: plan.recipe,
    tier: plan.tier,
    plan
  };
}

// Crafting an equipment piece equips it immediately (GDD 5.3).
export function craftEquipment(content, state, characterId, slot, now = Date.now()) {
  return craftAndEquipEquipment(content, state, characterId, slot, now);
}

export function checkCraftAndEquipEquipment(content, state, characterId, slot) {
  const currentKey = `equipment:${characterId}:${slot}`;
  const otherPins = state.pins.filter(p =>
    (p.type === 'equipment' ? `equipment:${p.characterId}:${p.slot}` : `${p.type}:${p.characterId}`) !== currentKey);
  const otherReservations = analyzePinnedGoals(content, state, { pins: otherPins }).reservations;
  const plan = analyzeEquipmentGoal(content, state, characterId, slot, { reservedByOthers: otherReservations });
  return { ok: plan.craftable, reasons: plan.reasons, warnings: plan.warnings, plan };
}

export function craftAndEquipEquipment(content, state, characterId, slot, now = Date.now()) {
  const check = checkCraftAndEquipEquipment(content, state, characterId, slot);
  if (!check.ok) return { ok: false, reasons: check.reasons };
  const plan = check.plan;
  const cs = state.characters[characterId];
  const before = characterPower(content, cs);
  const materials = { ...state.inventory.materials };
  const components = { ...state.inventory.components };
  for (const [id, amount] of Object.entries(plan.consumption.materials)) {
    materials[id] = (materials[id] ?? 0) - amount;
    if (materials[id] < 0) return { ok: false, reasons: [`Craft plan would make ${id} negative.`] };
    if (materials[id] === 0) delete materials[id];
  }
  for (const [id, amount] of Object.entries(plan.consumption.components)) {
    components[id] = (components[id] ?? 0) - amount;
    if (components[id] < 0) return { ok: false, reasons: [`Craft plan would make ${id} negative.`] };
    if (components[id] === 0) delete components[id];
  }
  // Missing components are crafted and immediately consumed, so they never
  // need to be committed to the component inventory.
  state.inventory.materials = materials;
  state.inventory.components = components;
  cs.slots[slot] = true;
  const after = characterPower(content, cs);
  const name = equipmentName(content, characterId, slot, plan.tier);
  removePin(state, { type: 'equipment', characterId, slot });
  logProgress(state, `${content.characterById[characterId].displayName} equipped ${name} (+${after - before} Power)`, now);
  return {
    ok: true, tier: plan.tier, name, powerBefore: before, powerAfter: after,
    componentsCrafted: plan.componentsToCraft,
    conversions: plan.conversions,
    resourcesSpent: plan.consumption,
    warnings: plan.warnings,
    reservationConflicts: plan.reservationConflicts ?? []
  };
}

export function checkCompleteTier(content, state, characterId) {
  const cs = state.characters[characterId];
  if (!cs || !cs.owned) return { ok: false, reasons: ['Character not owned.'] };
  const tier = activeTier(content.balance, cs, content.maxGearTier);
  if (!tier) return { ok: false, reasons: [`Current campaigns support Gear Tier ${content.maxGearTier}. Add higher-grade material nodes to continue.`] };
  const missing = content.characterMeta.slotOrder.filter(s => !cs.slots[s]);
  if (missing.length > 0) {
    return { ok: false, reasons: [`Equip all six pieces first (${missing.length} missing).`], missing };
  }
  return { ok: true, reasons: [], tier };
}

// Completion consumes all six pieces and converts their temporary share into
// permanent Gear Power plus the completion bonus. The permanent total is taken
// from the tier table directly, so cumulative Gear Power always matches it.
export function completeGearTier(content, state, characterId, now = Date.now()) {
  const check = checkCompleteTier(content, state, characterId);
  if (!check.ok) return { ok: false, reasons: check.reasons };
  const cs = state.characters[characterId];
  const before = characterPower(content, cs);
  cleanupCompletedPins(content, state);
  cs.gearTier = check.tier;
  cs.slots = emptySlots(content);
  const after = characterPower(content, cs);
  const def = content.characterById[characterId];
  const complete = cs.gearTier >= content.maxGearTier;
  logProgress(state, `${def.displayName} completed Gear Tier ${check.tier}${complete ? ' — Gear Complete!' : ''} (+${after - before} Power)`, now);
  const masteryEvents = applyMasteryMilestones(content, state, def.world, now);
  return { ok: true, tier: check.tier, powerBefore: before, powerAfter: after, gearComplete: complete, masteryEvents };
}

// ------------------------------------------------------------- stars / unlock
export function checkPromoteStar(content, state, characterId) {
  const cs = state.characters[characterId];
  if (!cs || !cs.owned) return { ok: false, reasons: ['Character not owned.'] };
  if (cs.stars >= 7) return { ok: false, reasons: ['Already at the 7-Star maximum.'] };
  const need = content.balance.starShards[cs.stars];
  if (cs.shards < need) {
    return { ok: false, reasons: [`Need ${need} shards for ${cs.stars + 1} Stars (have ${cs.shards}). Use Find Sources to farm more.`], need };
  }
  return { ok: true, reasons: [], need };
}

export function promoteStar(content, state, characterId, now = Date.now()) {
  const check = checkPromoteStar(content, state, characterId);
  if (!check.ok) return { ok: false, reasons: check.reasons };
  const cs = state.characters[characterId];
  const before = characterPower(content, cs);
  cs.shards -= check.need;
  cs.stars += 1;
  cleanupCompletedPins(content, state);
  const after = characterPower(content, cs);
  const def = content.characterById[characterId];
  logProgress(state, `${def.displayName} promoted to ${cs.stars} Stars (+${after - before} Power)`, now);
  const masteryEvents = applyMasteryMilestones(content, state, def.world, now);
  return { ok: true, stars: cs.stars, powerBefore: before, powerAfter: after, masteryEvents };
}

export function checkUnlockCharacter(content, state, characterId) {
  const def = content.characterById[characterId];
  const cs = state.characters[characterId];
  if (!def || !cs) return { ok: false, reasons: ['Unknown character.'] };
  if (cs.owned) return { ok: false, reasons: ['Already owned.'] };
  const tier = content.balance.acquisitionTiers[def.tier];
  if (cs.shards < tier.cumulativeShards) {
    return { ok: false, reasons: [`Need ${tier.cumulativeShards} shards to unlock (have ${cs.shards}).`], tier };
  }
  return { ok: true, reasons: [], tier };
}

// Unlock consumes the cumulative shard threshold and creates the character at
// its acquisition Star (Minor 1★, Medium 4★, Major 7★).
export function unlockCharacter(content, state, characterId, now = Date.now()) {
  const check = checkUnlockCharacter(content, state, characterId);
  if (!check.ok) return { ok: false, reasons: check.reasons };
  const cs = state.characters[characterId];
  cs.shards -= check.tier.cumulativeShards;
  cs.owned = true;
  cs.revealed = true;
  cs.stars = check.tier.unlockStar;
  cleanupCompletedPins(content, state);
  const def = content.characterById[characterId];
  logProgress(state, `Unlocked ${def.displayName} at ${cs.stars} Star${cs.stars > 1 ? 's' : ''}!`, now);
  const masteryEvents = applyMasteryMilestones(content, state, def.world, now);
  return { ok: true, stars: cs.stars, masteryEvents };
}

// ------------------------------------------------------------- parties / pins
export function setPartyMember(content, state, partyIndex, slot, characterId) {
  const party = state.parties[partyIndex];
  if (!party) return { ok: false, reasons: ['Unknown party preset.'] };
  if (characterId !== null) {
    const cs = state.characters[characterId];
    if (!cs || !cs.owned) return { ok: false, reasons: ['Character not owned.'] };
    const existing = party.members.indexOf(characterId);
    if (existing !== -1 && existing !== slot) party.members[existing] = null;
  }
  party.members[slot] = characterId;
  return { ok: true };
}

export function renameParty(state, partyIndex, name) {
  const party = state.parties[partyIndex];
  if (!party || !name.trim()) return { ok: false, reasons: ['A preset needs a name.'] };
  party.name = name.trim().slice(0, 30);
  return { ok: true };
}

export function copyParty(state, targetIndex, sourceIndex) {
  const target = state.parties[targetIndex], source = state.parties[sourceIndex];
  if (!target || !source) return { ok: false, reasons: ['Unknown party preset.'] };
  if (targetIndex === sourceIndex) return { ok: false, reasons: ['Choose a different preset to copy.'] };
  target.members = [...source.members];
  return { ok: true, targetIndex, sourceIndex };
}

export function clearParty(state, partyIndex) {
  const party = state.parties[partyIndex];
  if (!party) return { ok: false, reasons: ['Unknown party preset.'] };
  party.members = [null, null, null, null, null];
  return { ok: true, partyIndex };
}

export function selectPartyPreset(state, partyIndex, nodeId = null) {
  if (!Number.isInteger(partyIndex) || partyIndex < 0 || partyIndex >= state.parties.length) {
    partyIndex = 0;
  }
  state.activePartyIndex = partyIndex;
  if (nodeId) {
    state.ui ??= {};
    state.ui.nodePartyById ??= {};
    state.ui.nodePartyById[nodeId] = partyIndex;
  }
  return { ok: true, partyIndex };
}

export function preferredPartyIndex(state, nodeId = null) {
  const preferred = nodeId ? state.ui?.nodePartyById?.[nodeId] : undefined;
  if (Number.isInteger(preferred) && preferred >= 0 && preferred < state.parties.length) return preferred;
  if (Number.isInteger(state.activePartyIndex)
    && state.activePartyIndex >= 0 && state.activePartyIndex < state.parties.length) return state.activePartyIndex;
  return 0;
}

export const pinKey = p => p.type === 'equipment' ? `equipment:${p.characterId}:${p.slot}` : `${p.type}:${p.characterId}`;
export function togglePin(state, pin, content = null) {
  const key = pinKey(pin);
  const idx = state.pins.findIndex(p => pinKey(p) === key);
  if (idx !== -1) { state.pins.splice(idx, 1); return { ok: true, pinned: false }; }
  const normalized = { ...pin };
  if (pin.type === 'character' && content) {
    const cs = state.characters[pin.characterId];
    const def = content.characterById[pin.characterId];
    if (!cs || !def) return { ok: false, reasons: ['Unknown character.'] };
    if (!cs.owned) {
      normalized.objective = 'unlock';
      normalized.targetStars = content.balance.acquisitionTiers[def.tier].unlockStar;
    } else {
      if (cs.stars >= 7) return { ok: false, reasons: ['This character has no remaining shard goal.'] };
      normalized.objective = 'promotion';
      normalized.targetStars = cs.stars + 1;
    }
  }
  state.pins.push(normalized);
  return { ok: true, pinned: true, pin: normalized, index: state.pins.length - 1 };
}
export function isPinned(state, pin) {
  const key = pinKey(pin);
  return state.pins.some(p => pinKey(p) === key);
}

export function removePin(state, pin) {
  const key = pinKey(pin);
  const index = state.pins.findIndex(p => pinKey(p) === key);
  if (index < 0) return { ok: true, removed: false };
  const [removed] = state.pins.splice(index, 1);
  return { ok: true, removed: true, pin: removed, index };
}

export function movePin(state, index, direction) {
  const target = index + direction;
  if (!Number.isInteger(index) || ![-1, 1].includes(direction)
    || index < 0 || index >= state.pins.length || target < 0 || target >= state.pins.length) {
    return { ok: false, reasons: ['Goal cannot be moved in that direction.'] };
  }
  const [pin] = state.pins.splice(index, 1);
  state.pins.splice(target, 0, pin);
  return { ok: true, index: target, pin };
}

export function cleanupCompletedPins(content, state) {
  const before = state.pins.length;
  state.pins = state.pins.filter(pin => {
    const cs = state.characters[pin.characterId];
    if (!cs || !content.characterById[pin.characterId]) return false;
    if (pin.type === 'equipment') {
      return !!content.characterMeta.slots[pin.slot]
        && cs.owned && !!activeTier(content.balance, cs, content.maxGearTier)
        && !cs.slots[pin.slot];
    }
    if (pin.type === 'character') {
      if (pin.objective === 'unlock') return !cs.owned;
      if (pin.objective === 'promotion') return cs.stars < pin.targetStars;
      return cs.stars < 7;
    }
    return false;
  });
  return { ok: true, removed: before - state.pins.length };
}

// ------------------------------------------------------------- skins
export function selectSkin(content, state, characterId, skinId) {
  const cs = state.characters[characterId];
  if (!cs || !cs.owned) return { ok: false, reasons: ['Character not owned.'] };
  if (skinId === null) {
    cs.selectedSkinId = null;
    return { ok: true, skinId: null };
  }
  const unlocked = unlockedSkins(content, state, characterId);
  if (!unlocked.some(s => s.id === skinId)) return { ok: false, reasons: ['That skin is not unlocked for this character.'] };
  cs.selectedSkinId = skinId;
  return { ok: true, skinId };
}

// ------------------------------------------------------------- ready upgrades
export function readyUpgrades(content, state) {
  const list = [];
  for (const def of content.characters) {
    const cs = state.characters[def.id];
    if (cs.owned) {
      if (checkCompleteTier(content, state, def.id).ok) {
        list.push({ type: 'completeTier', characterId: def.id, text: `${def.displayName}: Gear Tier ${cs.gearTier + 1} ready to complete` });
      }
      if (checkPromoteStar(content, state, def.id).ok) {
        list.push({ type: 'promoteStar', characterId: def.id, text: `${def.displayName}: ${cs.stars + 1}-Star promotion ready` });
      }
      const tier = activeTier(content.balance, cs, content.maxGearTier);
      if (tier) {
        for (const slot of content.characterMeta.slotOrder) {
          if (!cs.slots[slot] && analyzeEquipmentGoal(content, state, def.id, slot).craftable) {
            list.push({ type: 'craftEquipment', characterId: def.id, slot, text: `${def.displayName}: ${equipmentName(content, def.id, slot, tier)} can be crafted` });
          }
        }
      }
    } else if (checkUnlockCharacter(content, state, def.id).ok) {
      list.push({ type: 'unlock', characterId: def.id, text: `${def.displayName} can be unlocked!` });
    }
  }
  return list;
}

function fmt(n) { return n.toLocaleString('en-US'); }
