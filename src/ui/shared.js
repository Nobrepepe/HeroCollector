// Shared UI building blocks used by several screens.
import { h, fmt, stars } from './dom.js';
import { unlockedSkins } from '../core/state.js';
import { characterPower } from '../core/power.js';

// The character's selected, unlocked alternate skin, or null.
export function activeSkin(store, characterId) {
  const selected = store.state.characters[characterId]?.selectedSkinId;
  if (!selected) return null;
  const skin = unlockedSkins(store.content, store.state, characterId).find(s => s.id === selected);
  if (!skin) return null;
  return { ...skin, ...(store.content.images.skin[skin.id] ?? {}), name: skin.skinName };
}

export function portraitSlot({
  src = null, color = 'var(--muted-2)', glyph = '✦', alt = '',
  size = 'md', state = 'met', pulse = false, decorative = false
} = {}) {
  const classes = ['portrait-slot', size, state];
  if (pulse) classes.push('pulses');
  const el = h(`div.${classes.join('.')}`, {
    style: { '--portrait-color': color },
    'aria-hidden': decorative ? 'true' : null
  });
  el.appendChild(h('span.portrait-slot__glow', { 'aria-hidden': 'true' }));
  if (src) {
    el.appendChild(h('img.portrait-slot__image', {
      src, alt: decorative ? '' : alt, draggable: 'false'
    }));
  } else {
    el.appendChild(h('span.portrait-slot__fallback', { 'aria-hidden': 'true' },
      h('span', glyph),
      h('small', 'eyes · alpha art')));
  }
  return el;
}

export function portrait(store, characterId, size = 'md', options = {}) {
  const def = store.content.characterById[characterId];
  let src = store.content.images.portrait[characterId] ?? null;
  const skin = activeSkin(store, characterId);
  if (skin?.portrait) src = skin.portrait;
  const el = portraitSlot({
    src,
    color: def.color,
    glyph: def.glyph,
    alt: def.displayName,
    size,
    state: options.state ?? 'met',
    pulse: options.pulse ?? false,
    decorative: options.decorative ?? false
  });
  el.title = options.title ?? def.displayName;
  return el;
}

export function starline(n) {
  return h('span.starline', { 'aria-label': `${n} of 7 stars` }, stars(n));
}

export function charSub(store, def, cs) {
  const arch = store.content.archetypes[def.archetype];
  return `${arch.icon} ${arch.name} · GT ${cs.gearTier} · ${fmt(characterPower(store.content, cs))} Power`;
}

export function tagChips(store, def) {
  const chips = [];
  const world = store.content.worldById[def.world];
  const arch = store.content.archetypes[def.archetype];
  chips.push(h('span.chip', world.icon, world.displayName));
  chips.push(h('span.chip', arch.icon, arch.name));
  if (def.faction) chips.push(h('span.chip', store.content.tagById[def.faction].displayName));
  for (const t of def.extraTags ?? []) chips.push(h('span.chip', store.content.tagById[t].displayName));
  chips.push(h('span.chip', { title: 'Acquisition tier measures commitment, not strength' },
    def.tier[0].toUpperCase() + def.tier.slice(1)));
  return h('div', chips);
}

export function rewardChips(store, rewards) {
  const chips = [];
  for (const [matId, qty] of Object.entries(rewards.materials ?? {})) {
    const m = store.content.materialById[matId];
    chips.push(h('span.chip', `${m.icon} ${m.displayName} ×${qty}`));
  }
  for (const [charId, qty] of Object.entries(rewards.shards ?? {})) {
    const c = store.content.characterById[charId];
    chips.push(h('span.chip', `🧩 ${c.displayName} shard ×${qty}`));
  }
  for (const fragId of rewards.fragments ?? []) {
    chips.push(h('span.chip', '🏛️ Archive fragment'));
  }
  for (const m of rewards.milestones ?? []) chips.push(h('span.chip', `🏁 ${m}`));
  return h('div.reward-list', chips.length ? chips : h('span.muted', 'Nothing'));
}

const NODE_TYPE_META = {
  ordinary: { icon: '🟢', label: 'Ordinary material node' },
  advanced: { icon: '🔵', label: 'Advanced material node' },
  shard: { icon: '🧩', label: 'Character shard node' },
  world: { icon: '🏛️', label: 'World node' }
};
export function nodeTypeMeta(type) { return NODE_TYPE_META[type]; }

export function nodeRepeatText(store, node) {
  const def = store.content.balance.nodeDefaults[node.type];
  const m = store.content.materialById[node.material];
  let text = `${def.repeat.count} × ${m.displayName}`;
  if (def.repeat.bonusChanceBp > 0) text += ` (+1 with ${def.repeat.bonusChanceBp / 100}% chance)`;
  if (node.shardCharacter) {
    const c = store.content.characterById[node.shardCharacter];
    text += `, shard roll for ${c.displayName}`;
  }
  return text;
}

export function campaignLabel(store, node) {
  if (node.campaign === 'main') return 'Main';
  if (node.campaign === 'shadow') return 'Shadow';
  return store.content.worldById[node.world].displayName;
}
