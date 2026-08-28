// World Programs: each world's Headquarters runs three standing Programs that
// advance automatically through relevant play — no timers, no construction,
// no daily interaction. Meters fill from play and pay out at the daily reset:
//   Procurement — Energy spent on this world's nodes → material shipments of
//                 a player-chosen family at the world's opened grade.
//   Development — shards applied to this world's heroes → bonus shards for a
//                 chosen revealed hero of the world.
//   Operations  — completed Expedition routes from this world → visibly
//                 improved routes on the next cycle board.
// The world's reconstructed relic can be installed into exactly one Program
// slot; effects are read at payout time, so moving it only affects the future.
import { grantRewardEntries } from './resources.js';
import { relicStatus } from './relics.js';
import { isRevealed } from './focus.js';
import { worldMaterialGrade } from './mastery.js';

export const PROGRAM_IDS = ['procurement', 'development', 'operations'];
export const PROGRAM_NAMES = { procurement: 'Procurement', development: 'Development', operations: 'Operations' };

export function programState(state, worldId) {
  return state.programs[worldId] ??= {
    procurement: { meter: 0, delivered: 0, family: null },
    development: { meter: 0, delivered: 0, heroId: null },
    operations: { meter: 0, delivered: 0, boostCycles: 0 },
    relicSlot: null
  };
}

export function relicInstalledIn(content, state, worldId, programId) {
  const ps = state.programs[worldId];
  if (!ps || ps.relicSlot !== programId) return false;
  return !!relicStatus(content, state, worldId)?.complete;
}

export function addProcurementEnergy(content, state, worldId, energy) {
  if (!content.worldById[worldId] || !Number.isInteger(energy) || energy <= 0) return;
  programState(state, worldId).procurement.meter += energy;
}

export function addDevelopmentShards(content, state, worldId, shards) {
  if (!content.worldById[worldId] || !Number.isInteger(shards) || shards <= 0) return;
  programState(state, worldId).development.meter += shards;
}

export function addOperationsCompletion(content, state, worldId, routes = 1) {
  if (!content.worldById[worldId] || !Number.isInteger(routes) || routes <= 0) return;
  programState(state, worldId).operations.meter += routes;
}

export function setProcurementFamily(content, state, worldId, family) {
  if (!content.worldById[worldId]) return { ok: false, reasons: ['Unknown world.'] };
  if (family !== null && !content.materialMeta.familyOrder.includes(family)) {
    return { ok: false, reasons: ['Unknown material family.'] };
  }
  programState(state, worldId).procurement.family = family;
  return { ok: true, family };
}

export function setDevelopmentHero(content, state, worldId, characterId) {
  if (!content.worldById[worldId]) return { ok: false, reasons: ['Unknown world.'] };
  if (characterId !== null) {
    const def = content.characterById[characterId];
    if (!def || def.world !== worldId) return { ok: false, reasons: ['Choose a hero from this world.'] };
    if (!isRevealed(state, characterId)) return { ok: false, reasons: ['Only a revealed hero can be the Development target.'] };
  }
  programState(state, worldId).development.heroId = characterId;
  return { ok: true, characterId };
}

export function installRelic(content, state, worldId, programId) {
  if (!content.worldById[worldId]) return { ok: false, reasons: ['Unknown world.'] };
  if (programId !== null && !PROGRAM_IDS.includes(programId)) return { ok: false, reasons: ['Unknown Program.'] };
  if (programId !== null && !relicStatus(content, state, worldId)?.complete) {
    return { ok: false, reasons: ['Reconstruct all four relic pieces first.'] };
  }
  programState(state, worldId).relicSlot = programId;
  return { ok: true, programId };
}

// A full read of one world's Programs for the UI: meters, thresholds (with the
// relic's improvement applied where installed), and what the next payout is.
export function programOverview(content, state, worldId) {
  const config = content.balance.programs;
  const ps = programState(state, worldId);
  const relic = relicStatus(content, state, worldId);
  const grade = worldMaterialGrade(content, state, worldId);
  const procurementQty = config.procurement.shipmentQty
    + (relicInstalledIn(content, state, worldId, 'procurement') ? config.procurement.relicBonusQty : 0);
  const developmentThreshold = relicInstalledIn(content, state, worldId, 'development')
    ? config.development.relicThreshold : config.development.threshold;
  const operationsThreshold = relicInstalledIn(content, state, worldId, 'operations')
    ? config.operations.relicThreshold : config.operations.threshold;
  return {
    relic, relicSlot: ps.relicSlot,
    procurement: {
      ...ps.procurement, threshold: config.procurement.threshold,
      shipmentQty: procurementQty, grade
    },
    development: { ...ps.development, threshold: developmentThreshold, bonusShards: config.development.bonusShards },
    operations: { ...ps.operations, threshold: operationsThreshold }
  };
}

// Convert full meters into concrete payouts. Runs during the daily reset;
// a Program whose payout needs a player choice that is not set (no family, no
// hero) simply banks its meter — nothing is ever lost, and every banked
// threshold pays out once the choice is made.
export function deliverProgramPayouts(content, state, now = Date.now()) {
  const config = content.balance.programs;
  const events = [];
  for (const world of content.worlds) {
    const ps = state.programs[world.id];
    if (!ps) continue;

    const shipmentQty = config.procurement.shipmentQty
      + (relicInstalledIn(content, state, world.id, 'procurement') ? config.procurement.relicBonusQty : 0);
    while (ps.procurement.meter >= config.procurement.threshold && ps.procurement.family) {
      const grade = worldMaterialGrade(content, state, world.id);
      const materialId = `mat_${ps.procurement.family}_${grade}`;
      if (!content.materialById[materialId]) break;
      ps.procurement.meter -= config.procurement.threshold;
      ps.procurement.delivered += 1;
      const granted = grantRewardEntries(content, state, [{ kind: 'material', id: materialId, qty: shipmentQty }]);
      events.push({ worldId: world.id, program: 'procurement', granted });
    }

    const developmentThreshold = relicInstalledIn(content, state, world.id, 'development')
      ? config.development.relicThreshold : config.development.threshold;
    const hero = ps.development.heroId ? state.characters[ps.development.heroId] : null;
    const heroCanGrow = hero && !(hero.owned && hero.stars >= 7);
    while (ps.development.meter >= developmentThreshold && heroCanGrow) {
      ps.development.meter -= developmentThreshold;
      ps.development.delivered += 1;
      hero.shards += config.development.bonusShards;
      events.push({
        worldId: world.id, program: 'development',
        granted: [{ kind: 'shards', characterId: ps.development.heroId, qty: config.development.bonusShards }]
      });
    }

    const operationsThreshold = relicInstalledIn(content, state, world.id, 'operations')
      ? config.operations.relicThreshold : config.operations.threshold;
    while (ps.operations.meter >= operationsThreshold) {
      ps.operations.meter -= operationsThreshold;
      ps.operations.delivered += 1;
      ps.operations.boostCycles += 1;
      events.push({ worldId: world.id, program: 'operations', boostCycles: ps.operations.boostCycles });
    }
  }
  return events;
}
