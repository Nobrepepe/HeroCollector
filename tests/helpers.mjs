import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContent } from '../src/core/content.js';
import { compileManifest } from '../src/core/compile/index.js';
import { normalizeManifest } from '../src/core/manifest.js';
import { newPlayerState } from '../src/core/state.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(readFileSync(join(root, 'content', f), 'utf8'));

// System-only content (rules-level data; no worlds/characters/nodes).
export function loadSystemRaw() {
  return {
    balance: read('balance.json'),
    archetypes: read('archetypes.json'),
    materials: read('materials.json'),
    components: read('components.json'),
    characters: read('characters.json'),
    tags: read('tags.json'),
    recipes: read('recipes.json'),
    expeditions: read('expeditions.json'),
    crises: read('crises.json')
  };
}

export function loadSampleManifest() {
  return normalizeManifest(read('sample-pack.json'), loadSystemRaw().characters.slotOrder);
}

// The full playable game: system content compiled against the sample manifest.
export function loadContent() {
  const compiled = compileManifest(loadSystemRaw(), loadSampleManifest());
  if (compiled.health.some(x => x.level === 'error' || x.level === 'warn')) {
    throw new Error('Sample manifest did not compile cleanly: ' + compiled.health.map(x => x.text).join('; '));
  }
  const content = buildContent(compiled.raw);
  content.images = compiled.images;
  return content;
}

// A new save whose starting five are named rather than drawn. The draw itself
// is deliberately random per save, so a test that wants to talk about a
// particular hero says which five it began with; `drawStarters` has its own
// test. These are the sample pack's original five.
export const SAMPLE_STARTERS = [
  'char_suzume', 'char_hoshi', 'char_ayame', 'char_ashley', 'char_bridget'
];

export function newGame(content, now, starters = SAMPLE_STARTERS) {
  return newPlayerState(content, now, { starters });
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
