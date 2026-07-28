// Player state and transactions. Every mutation validates its inputs first and
// either completes fully or changes nothing (GDD 12.3, Appendix B). All
// functions are deterministic given the injected RNG.
import { characterPower, activeTier, cumulativeGearPower } from './power.js';
import { evaluateParty, partyLegality, objectiveSatisfied } from './synergy.js';
import { equipmentRecipe, equipmentName } from './content.js';

export const SCHEMA_VERSION = 1;

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
      pity: false,
      skinUnlocked: false,
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
    inventory: { materials: {}, components: {} },
    nodes: {},
    parties,
    activePartyIndex: 0,
    pins: [],
    archive: { fragments: {} },
    settings: { resetHour: b.energy.resetHour, textScale: 1, reducedMotion: false, confirmBulk: true },
    progressLog: [],
    lastResetSummary: null
  };
  applyDailyReset(content, state, now); // establishes the reset-day key
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
// content brings it back untouched. Returns a report of what changed.
export function syncSaveWithContent(content, state) {
  const report = [];
  for (const def of content.characters) {
    if (!state.characters[def.id]) {
      state.characters[def.id] = {
        owned: false, stars: 0, shards: 0, gearTier: 0,
        slots: emptySlots(content), pity: false, skinUnlocked: false, selectedSkinId: null
      };
    }
    // Starting characters are granted at 1★ — including when content becomes
    // ready after the save was created, or a character is newly flagged.
    const cs = state.characters[def.id];
    if (cs.selectedSkinId === undefined) {
      const archive = content.archiveByWorld[def.world];
      cs.selectedSkinId = cs.useSkin && archive?.fullReward?.characterId === def.id
        ? archive.fullReward.id
        : null;
    }
    delete cs.useSkin;
    if (def.starting && !cs.owned) {
      cs.owned = true;
      cs.stars = Math.max(1, cs.stars);
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
  if (dormant > 0) report.push(`${dormant} owned character${dormant > 1 ? 's are' : ' is'} dormant (their content is not in the game right now); progress is kept and returns if the content does.`);
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
  state.pins = state.pins.filter(p => content.characterById[p.characterId]);
  if (state.pins.length < beforePins) report.push(`Removed ${beforePins - state.pins.length} pin(s) for missing content.`);
  return report;
}

export function nodeState(state, nodeId) {
  return state.nodes[nodeId] ?? { cleared: false, firstClearClaimed: false, objectiveClaimed: false, attemptsToday: 0 };
}
function ensureNodeState(state, nodeId) {
  if (!state.nodes[nodeId]) state.nodes[nodeId] = { cleared: false, firstClearClaimed: false, objectiveClaimed: false, attemptsToday: 0 };
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
    return null;
  }
  const days = daysBetweenKeys(state.lastResetKey, key);
  if (days <= 0) return null; // same day, or clock moved backward: never re-grant
  const before = state.energy;
  state.energy = Math.min(b.energy.storageCap, state.energy + b.energy.dailyGrant * days);
  for (const ns of Object.values(state.nodes)) ns.attemptsToday = 0;
  state.lastResetKey = key;
  const summary = {
    days,
    energyGained: state.energy - before,
    energy: state.energy,
    attemptsReset: true
  };
  state.lastResetSummary = summary;
  return summary;
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
  const reserved = { materials: {}, components: {} };
  const compShort = {};
  for (const pin of state.pins) {
    if (pin.type !== 'equipment') continue;
    const cs = state.characters[pin.characterId];
    if (!cs || !cs.owned) continue;
    const tier = activeTier(content.balance, cs, content.maxGearTier);
    if (!tier || cs.slots[pin.slot]) continue;
    const recipe = equipmentRecipe(content, pin.characterId, pin.slot, tier);
    for (const input of recipe.inputs) {
      compShort[input.componentId] = (compShort[input.componentId] ?? 0) + input.qty;
    }
  }
  for (const [compId, need] of Object.entries(compShort)) {
    const have = compQty(state, compId);
    reserved.components[compId] = (reserved.components[compId] ?? 0) + need;
    const missing = Math.max(0, need - have);
    if (missing > 0) {
      const def = content.componentById[compId];
      for (const input of def.inputs) {
        reserved.materials[input.materialId] = (reserved.materials[input.materialId] ?? 0) + input.qty * missing;
      }
    }
  }
  return reserved;
}

// ------------------------------------------------------------- node access
export function worldCampaignUnlocked(content, state, worldId) {
  const owned = content.characters.filter(d => d.world === worldId && state.characters[d.id].owned).length;
  return { unlocked: owned >= content.balance.partySize, owned, needed: content.balance.partySize };
}

export function nodeUnlocked(content, state, node) {
  if (node.campaign === 'shadow') {
    const mirror = content.nodeById[node.mirrorNode];
    if (!mirror) return { unlocked: false, reason: 'The matching Main Campaign node is not live yet.' };
    if (!nodeState(state, mirror.id).cleared) {
      return { unlocked: false, reason: `Clear Main ${mirror.number} — ${mirror.displayName} first.` };
    }
    return { unlocked: true, reason: '' };
  }
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

export function shardAttemptsLeft(content, state, node) {
  if (!node.shardCharacter) return Infinity;
  return Math.max(0, content.balance.shardAttemptsPerDay - nodeState(state, node.id).attemptsToday);
}

// Full availability check for a clear/sweep of `count` runs. Never spends
// anything; returns { ok, reasons: [...] } so the UI can explain every block.
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
  if (legal.legal) {
    evalResult = evaluateParty(content, state, members);
    if (evalResult.effectivePower < node.threshold) {
      reasons.push(`Effective Power ${fmt(evalResult.effectivePower)} is below the required ${fmt(node.threshold)}. No Energy is spent on attempts that cannot succeed.`);
    }
  }
  const cost = nodeEnergyCost(content, node) * count;
  if (state.energy < cost) reasons.push(`Not enough Energy (${state.energy}/${cost}). Energy refreshes at the daily reset.`);
  const attempts = shardAttemptsLeft(content, state, node);
  if (count > attempts) reasons.push(`Only ${attempts} shard attempt${attempts === 1 ? '' : 's'} left today (${content.balance.shardAttemptsPerDay} per day).`);
  return { ok: reasons.length === 0, reasons, evalResult, cost, node };
}

export function maxSweepCount(content, state, nodeId) {
  const node = content.nodeById[nodeId];
  if (!node) return 0;
  const byEnergy = Math.floor(state.energy / nodeEnergyCost(content, node));
  const byAttempts = shardAttemptsLeft(content, state, node);
  return Math.max(0, Math.min(byEnergy, byAttempts === Infinity ? byEnergy : byAttempts));
}

// ------------------------------------------------------------- clear / sweep
// Executes `count` paid runs of a node in one batch. First-clear rewards,
// objective rewards, and Archive fragments are each claimable once.
export function clearNode(content, state, nodeId, members, count, rng, now = Date.now()) {
  const check = checkClear(content, state, nodeId, members, count);
  if (!check.ok) return { ok: false, reasons: check.reasons };
  const node = check.node;
  const b = content.balance;
  const ns = ensureNodeState(state, nodeId);
  const wasCleared = ns.cleared;

  state.energy -= check.cost;
  if (node.shardCharacter) ns.attemptsToday += count;

  const rewards = { materials: {}, shards: {}, fragments: [], milestones: [], firstClear: false, objective: false, pity: null, energySpent: check.cost, runs: count };
  const gainMat = (id, qty) => { rewards.materials[id] = (rewards.materials[id] ?? 0) + qty; };
  const shardChar = node.shardCharacter ? state.characters[node.shardCharacter] : null;

  for (let run = 0; run < count; run++) {
    const def = b.nodeDefaults[node.type];
    gainMat(node.material, def.repeat.count);
    if (def.repeat.bonusChanceBp > 0 && rng.chanceBp(def.repeat.bonusChanceBp)) gainMat(node.material, 1);
    if (node.shardCharacter) {
      if (shardChar.stars >= 7) {
        // At 7 Stars the shard drop is replaced by the node's normal
        // guaranteed material reward (GDD 4.3).
        gainMat(node.material, 1);
      } else if (shardChar.pity || rng.chanceBp(b.shardChanceBp)) {
        rewards.shards[node.shardCharacter] = (rewards.shards[node.shardCharacter] ?? 0) + 1;
        shardChar.pity = false;
      } else {
        shardChar.pity = true;
      }
    }
  }

  if (!ns.firstClearClaimed && node.firstClear) {
    for (const m of node.firstClear.materials ?? []) gainMat(m.materialId, m.qty);
    if (node.firstClear.shards) {
      rewards.shards[node.firstClear.shards.characterId] =
        (rewards.shards[node.firstClear.shards.characterId] ?? 0) + node.firstClear.shards.qty;
    }
    if (node.firstClear.archiveFragment && !state.archive.fragments[node.firstClear.archiveFragment]) {
      state.archive.fragments[node.firstClear.archiveFragment] = true;
      rewards.fragments.push(node.firstClear.archiveFragment);
    }
    if (node.firstClear.milestone) rewards.milestones.push(node.firstClear.milestone);
    ns.firstClearClaimed = true;
    rewards.firstClear = true;
  }

  if (node.objective && !ns.objectiveClaimed && objectiveSatisfied(content, node.objective, members)) {
    for (const m of node.objective.reward.materials ?? []) gainMat(m.materialId, m.qty);
    ns.objectiveClaimed = true;
    rewards.objective = true;
  }

  for (const [id, qty] of Object.entries(rewards.materials)) addMat(state, id, qty);
  for (const [charId, qty] of Object.entries(rewards.shards)) state.characters[charId].shards += qty;
  if (shardChar && shardChar.stars < 7) {
    rewards.pity = shardChar.pity
      ? 'Guaranteed shard on the next attempt.'
      : `Normal ${b.shardChanceBp / 100}% shard chance on the next attempt.`;
  }
  ns.cleared = true;
  if (!wasCleared) {
    logProgress(state, `First clear: ${node.displayName}${rewards.firstClear ? ' (first-clear rewards claimed)' : ''}`, now);
  }
  return { ok: true, rewards, node, evalResult: check.evalResult };
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
  const cs = state.characters[characterId];
  if (!cs || !cs.owned) return { ok: false, reasons: ['Character not owned.'] };
  const tier = activeTier(content.balance, cs, content.maxGearTier);
  if (!tier) return { ok: false, reasons: [`Current campaigns support Gear Tier ${content.maxGearTier}. Add higher-grade material nodes to continue.`] };
  if (cs.slots[slot]) return { ok: false, reasons: ['This slot is already equipped for the current tier. Complete the tier to continue.'] };
  const recipe = equipmentRecipe(content, characterId, slot, tier);
  const reasons = [];
  for (const input of recipe.inputs) {
    const have = compQty(state, input.componentId);
    if (have < input.qty) {
      reasons.push(`Need ${input.qty} ${content.componentById[input.componentId].displayName} (have ${have}).`);
    }
  }
  return { ok: reasons.length === 0, reasons, recipe, tier };
}

// Crafting an equipment piece equips it immediately (GDD 5.3).
export function craftEquipment(content, state, characterId, slot, now = Date.now()) {
  const check = checkCraftEquipment(content, state, characterId, slot);
  if (!check.ok) return { ok: false, reasons: check.reasons };
  const cs = state.characters[characterId];
  const before = characterPower(content, cs);
  for (const input of check.recipe.inputs) addComp(state, input.componentId, -input.qty);
  cs.slots[slot] = true;
  const after = characterPower(content, cs);
  const name = equipmentName(content, characterId, slot, check.tier);
  logProgress(state, `${content.characterById[characterId].displayName} equipped ${name} (+${after - before} Power)`, now);
  return { ok: true, tier: check.tier, name, powerBefore: before, powerAfter: after };
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
  cs.gearTier = check.tier;
  cs.slots = emptySlots(content);
  const after = characterPower(content, cs);
  const def = content.characterById[characterId];
  const complete = cs.gearTier >= content.maxGearTier;
  logProgress(state, `${def.displayName} completed Gear Tier ${check.tier}${complete ? ' — Gear Complete!' : ''} (+${after - before} Power)`, now);
  return { ok: true, tier: check.tier, powerBefore: before, powerAfter: after, gearComplete: complete };
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
  const after = characterPower(content, cs);
  logProgress(state, `${content.characterById[characterId].displayName} promoted to ${cs.stars} Stars (+${after - before} Power)`, now);
  return { ok: true, stars: cs.stars, powerBefore: before, powerAfter: after };
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
  cs.stars = check.tier.unlockStar;
  const def = content.characterById[characterId];
  logProgress(state, `Unlocked ${def.displayName} at ${cs.stars} Star${cs.stars > 1 ? 's' : ''}!`, now);
  return { ok: true, stars: cs.stars };
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

const pinKey = p => p.type === 'equipment' ? `equipment:${p.characterId}:${p.slot}` : `${p.type}:${p.characterId}`;
export function togglePin(state, pin) {
  const key = pinKey(pin);
  const idx = state.pins.findIndex(p => pinKey(p) === key);
  if (idx !== -1) { state.pins.splice(idx, 1); return { ok: true, pinned: false }; }
  if (state.pins.length >= 8) return { ok: false, reasons: ['Pin limit reached (8). Unpin something first.'] };
  state.pins.push(pin);
  return { ok: true, pinned: true };
}
export function isPinned(state, pin) {
  const key = pinKey(pin);
  return state.pins.some(p => pinKey(p) === key);
}

// ------------------------------------------------------------- archive status
export function archiveStatus(content, state, worldId) {
  const archive = content.archiveByWorld[worldId];
  const collections = archive.collections.map(col => {
    const relics = col.relics.map(relic => {
      const owned = relic.fragments.filter(f => state.archive.fragments[f.id]).length;
      return { relic, owned, total: relic.fragments.length, complete: owned === relic.fragments.length };
    });
    const complete = relics.every(r => r.complete);
    return { collection: col, relics, complete };
  });
  const relicsDone = collections.reduce((s, c) => s + c.relics.filter(r => r.complete).length, 0);
  const relicsTotal = collections.reduce((s, c) => s + c.relics.length, 0);
  const fragmentsOwned = collections.reduce((s, c) => s + c.relics.reduce((x, r) => x + r.owned, 0), 0);
  const complete = relicsDone === relicsTotal;
  return { archive, collections, relicsDone, relicsTotal, fragmentsOwned, fragmentsTotal: relicsTotal * 2, complete };
}

export function unlockedSkins(content, state, characterId) {
  const def = content.characterById[characterId];
  if (!def) return [];
  const archive = content.archiveByWorld[def.world];
  if (!archive) return [];
  const status = archiveStatus(content, state, def.world);
  const skins = [];
  status.collections.forEach(col => {
    const reward = col.collection.rewardSkin;
    if (col.complete && reward?.characterId === characterId) skins.push(content.skinById[reward.id]);
  });
  if (status.complete && archive.fullReward?.characterId === characterId) {
    skins.push(content.skinById[archive.fullReward.id]);
  }
  return skins.filter(Boolean);
}

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
          if (!cs.slots[slot] && checkCraftEquipment(content, state, def.id, slot).ok) {
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
