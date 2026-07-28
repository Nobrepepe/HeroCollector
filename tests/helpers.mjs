import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContent } from '../src/core/content.js';
import { mergeContent, upgradeCustomDB } from '../src/core/custom.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(readFileSync(join(root, 'content', f), 'utf8'));

// System-only content (rules-level data; no worlds/characters/nodes).
export function loadSystemRaw() {
  return {
    balance: read('balance.json'),
    worlds: read('worlds.json'),
    archetypes: read('archetypes.json'),
    materials: read('materials.json'),
    components: read('components.json'),
    characters: read('characters.json'),
    tags: read('tags.json'),
    recipes: read('recipes.json'),
    nodes: read('nodes.json'),
    archives: read('archives.json')
  };
}

export function loadSamplePack() {
  return upgradeCustomDB(read('sample-pack.json'));
}

// The full playable game: system content + the sample worlds pack.
export function loadContent() {
  const merged = mergeContent(loadSystemRaw(), loadSamplePack());
  if (merged.health.some(x => x.level === 'error' || x.level === 'warn')) {
    throw new Error('Sample pack did not merge cleanly: ' + merged.health.map(x => x.text).join('; '));
  }
  const content = buildContent(merged.raw);
  content.images = merged.images;
  return content;
}

// Grant enough power to a set of characters to pass any threshold (test-only
// shortcut that manipulates state exactly like the dev panel does).
export function maxOut(content, state, ids) {
  for (const id of ids) {
    const cs = state.characters[id];
    cs.owned = true;
    cs.stars = 7;
    cs.gearTier = content.balance.gearTierPower.length;
  }
}

export function give(state, materialId, qty) {
  state.inventory.materials[materialId] = (state.inventory.materials[materialId] ?? 0) + qty;
}
