import { SCHEMA_VERSION } from './state.js';
import { activeTier } from './power.js';

export const DEFAULT_UI_STATE = Object.freeze({
  roster: {
    world: 'all', archetype: 'all', faction: 'all', ownership: 'all',
    sort: 'name', direction: 'asc'
  },
  campaignId: 'main',
  archiveCollapsed: { worlds: {}, collections: {} },
  nodePartyById: {}
});

export function defaultUiState() {
  return JSON.parse(JSON.stringify(DEFAULT_UI_STATE));
}

function shardObjective(content, state, characterId) {
  const def = content.characterById[characterId];
  const cs = state.characters[characterId];
  if (!def || !cs) return null;
  if (!cs.owned) return { objective: 'unlock', targetStars: content.balance.acquisitionTiers[def.tier].unlockStar };
  if (cs.stars >= 7) return null;
  return { objective: 'promotion', targetStars: cs.stars + 1 };
}

function normalizePins(content, state, pins) {
  const out = [];
  const seen = new Set();
  for (const original of pins ?? []) {
    const pin = { ...original };
    if (!content.characterById[pin.characterId] || !state.characters[pin.characterId]) continue;
    if (pin.type === 'equipment') {
      const cs = state.characters[pin.characterId];
      if (!content.characterMeta.slots[pin.slot] || !cs.owned
        || !activeTier(content.balance, cs, content.maxGearTier) || cs.slots[pin.slot]) continue;
    } else if (pin.type === 'character') {
      const objective = pin.objective && Number.isInteger(pin.targetStars)
        ? { objective: pin.objective, targetStars: pin.targetStars }
        : shardObjective(content, state, pin.characterId);
      if (!objective) continue;
      Object.assign(pin, objective);
      const cs = state.characters[pin.characterId];
      if ((pin.objective === 'unlock' && cs.owned)
        || (pin.objective === 'promotion' && cs.stars >= pin.targetStars)) continue;
    } else continue;
    const key = pin.type === 'equipment'
      ? `equipment:${pin.characterId}:${pin.slot}`
      : `character:${pin.characterId}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(pin);
    }
  }
  return out;
}

function normalizeUi(content, state) {
  const defaults = defaultUiState();
  const input = state.ui ?? {};
  const roster = { ...defaults.roster, ...(input.roster ?? {}) };
  const values = {
    world: new Set(['all', ...content.worlds.map(w => w.id)]),
    archetype: new Set(['all', ...Object.keys(content.archetypes)]),
    faction: new Set(['all', ...content.tags.filter(t => t.category === 'faction').map(t => t.id)]),
    ownership: new Set(['all', 'owned', 'unowned', 'ready']),
    sort: new Set(['name', 'power', 'stars', 'gearTier', 'ready']),
    direction: new Set(['asc', 'desc'])
  };
  for (const [key, allowed] of Object.entries(values)) {
    if (!allowed.has(roster[key])) roster[key] = defaults.roster[key];
  }
  const campaigns = new Set(['main', 'shadow', ...content.worlds.map(w => w.campaignId)]);
  const campaignId = campaigns.has(input.campaignId) ? input.campaignId : 'main';
  const archiveIds = new Set(content.archives.map(a => a.id));
  const worldIds = new Set(content.worlds.map(w => w.id));
  const worlds = Object.fromEntries(Object.entries(input.archiveCollapsed?.worlds ?? {})
    .filter(([id, value]) => worldIds.has(id) && typeof value === 'boolean'));
  const collections = {};
  for (const archive of content.archives) {
    if (!archiveIds.has(archive.id)) continue;
    for (const collection of archive.collections) {
      const value = input.archiveCollapsed?.collections?.[collection.id];
      if (typeof value === 'boolean') collections[collection.id] = value;
    }
  }
  const nodePartyById = {};
  for (const [nodeId, index] of Object.entries(input.nodePartyById ?? {})) {
    if (content.nodeById[nodeId] && Number.isInteger(index) && index >= 0 && index < state.parties.length) {
      nodePartyById[nodeId] = index;
    }
  }
  return { roster, campaignId, archiveCollapsed: { worlds, collections }, nodePartyById };
}

function v1ToV2(content, state) {
  state.ui = normalizeUi(content, state);
  state.settings = {
    ...state.settings,
    farmingResults: ['automatic', 'full', 'compact'].includes(state.settings?.farmingResults)
      ? state.settings.farmingResults : 'automatic'
  };
  state.pins = normalizePins(content, state, state.pins);
  if (!Number.isInteger(state.activePartyIndex)
    || state.activePartyIndex < 0 || state.activePartyIndex >= state.parties.length) {
    state.activePartyIndex = 0;
  }
  state.schemaVersion = 2;
  return state;
}

export function migratePlayerState(content, inputState) {
  if (!inputState || typeof inputState !== 'object') throw new Error('Save data is not an object.');
  const state = structuredClone(inputState);
  let version = Number(state.schemaVersion ?? 1);
  if (version > SCHEMA_VERSION) throw new Error(`Save schema ${version} is newer than supported schema ${SCHEMA_VERSION}.`);
  while (version < SCHEMA_VERSION) {
    if (version === 1) {
      v1ToV2(content, state);
      version = 2;
    } else {
      throw new Error(`No migration path exists from schema ${version}.`);
    }
  }
  // Normalize v2 saves too, making migration idempotent and content-safe.
  state.ui = normalizeUi(content, state);
  state.pins = normalizePins(content, state, state.pins);
  state.settings.farmingResults = ['automatic', 'full', 'compact'].includes(state.settings.farmingResults)
    ? state.settings.farmingResults : 'automatic';
  state.schemaVersion = SCHEMA_VERSION;
  return state;
}
