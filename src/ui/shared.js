// Shared UI building blocks used by several screens.
import { h, fmt, stars } from './dom.js';
import { openModal } from '../app.js';
import { nodeState, nodeUnlocked, shardAttemptsLeft, unlockedSkins } from '../core/state.js';
import { characterPower } from '../core/power.js';

// The character's selected, unlocked alternate skin, or null.
export function activeSkin(store, characterId) {
  const selected = store.state.characters[characterId]?.selectedSkinId;
  if (!selected) return null;
  const skin = unlockedSkins(store.content, store.state, characterId).find(s => s.id === selected);
  if (!skin) return null;
  return { ...skin, ...(store.content.images.skin[skin.id] ?? {}), name: skin.skinName };
}

export function portrait(store, characterId, size = 'md') {
  const def = store.content.characterById[characterId];
  const world = store.content.worldById[def.world];
  const cs = store.state.characters[characterId];
  let src = store.content.images.portrait[characterId] ?? null;
  const skin = activeSkin(store, characterId);
  if (skin?.portrait) src = skin.portrait;
  const el = h(`div.portrait.${size}`, {
    style: { '--pc': `linear-gradient(140deg, ${def.color}, ${world.palette.dark})` },
    title: def.displayName
  });
  if (src) el.appendChild(h('img.portrait-img', { src, alt: def.displayName }));
  else el.appendChild(h('span', def.glyph));
  el.appendChild(h('span.world-badge', world.icon));
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

// Find Sources (GDD 11.3): reachable from any missing material, component,
// equipment recipe, or shard requirement.
export function openFindSources(store, target) {
  openModal((modal, close) => {
    let title = '', rows = [];
    const nodeRow = (node) => {
      const unlock = nodeUnlocked(store.content, store.state, node);
      const ns = nodeState(store.state, node.id);
      const material = store.content.materialById[node.material];
      const attempts = node.shardCharacter ? ` · ${shardAttemptsLeft(store.content, store.state, node)} attempts left today` : '';
      return h('button.node-row' + (unlock.unlocked ? '' : '.locked'), {
        onclick: () => { if (unlock.unlocked || ns.cleared) { close(); store.go(`#/node/${node.id}`); } }
      },
        h('span', nodeTypeMeta(node.type).icon),
        h('span.nname', `${campaignLabel(store, node)} ${node.number} — ${node.displayName}`),
        h('span.node-drop', {
          title: `Drops ${material.displayName}`,
          'aria-label': `Drops ${material.displayName}`
        }, h('span.node-drop-icon', { 'aria-hidden': 'true' }, material.icon),
        h('span.node-drop-name', material.displayName)),
        h('span.small.muted', unlock.unlocked ? (ns.cleared ? 'Sweepable' : 'Available') : unlock.reason)
      );
    };

    if (target.type === 'material') {
      const m = store.content.materialById[target.id];
      title = `Sources: ${m.displayName}`;
      const direct = (store.content.nodesByMaterial[target.id] ?? []).map(nodeRow);
      rows.push(h('h3', 'Nodes that drop it'), direct.length ? direct : h('p.muted', 'No node drops this directly.'));
      const lower = store.content.materials.find(x => x.conversionTarget === target.id);
      if (lower) {
        rows.push(h('p.small.muted', `Also craftable by upcrafting ${lower.conversionCost} × ${lower.displayName} (Inventory → Upcraft). Higher nodes are usually more Energy-efficient than upcrafting.`));
      }
    } else if (target.type === 'component') {
      const k = store.content.componentById[target.id];
      title = `Sources: ${k.displayName}`;
      rows.push(h('p.small.muted', `Crafted from ${k.inputs.map(i => `${i.qty} × ${store.content.materialById[i.materialId].displayName}`).join(' + ')} (Inventory → Components).`));
      for (const input of k.inputs) {
        rows.push(h('h3', store.content.materialById[input.materialId].displayName),
          (store.content.nodesByMaterial[input.materialId] ?? []).map(nodeRow));
      }
    } else if (target.type === 'shards') {
      const c = store.content.characterById[target.id];
      title = `Shard sources: ${c.displayName}`;
      const nodes = store.content.shardNodesByCharacter[target.id] ?? [];
      rows.push(nodes.map(nodeRow));
      rows.push(h('p.small.muted', `Each attempt: ${store.content.balance.shardChanceBp / 100}% shard chance, guaranteed after a miss. ${store.content.balance.shardAttemptsPerDay} attempts per node per day.`));
    }
    modal.appendChild(h('h2', title));
    for (const r of rows) modal.appendChild(Array.isArray(r) ? h('div', r) : r);
    modal.appendChild(h('div', { style: { marginTop: '14px' } },
      h('button.btn', { onclick: close }, 'Close')));
  });
}

export function campaignLabel(store, node) {
  if (node.campaign === 'main') return 'Main';
  if (node.campaign === 'shadow') return 'Shadow';
  return store.content.worldById[node.world].displayName;
}

// Results modal (GDD 11.2 Results screen): one consolidated summary.
export function showResults(store, result, { onClose } = {}) {
  openModal((modal, close) => {
    const wrap = () => { close(); onClose?.(); };
    modal.appendChild(h('h2', `${result.node.displayName} — ${result.rewards.runs > 1 ? `${result.rewards.runs} sweeps` : 'Cleared'}`));
    modal.appendChild(h('p.small.muted', `⚡ ${result.rewards.energySpent} Energy spent`));
    if (result.rewards.firstClear) modal.appendChild(h('p.good', '✦ First-clear rewards claimed!'));
    if (result.rewards.objective) modal.appendChild(h('p.good', '✦ Optional objective completed!'));
    modal.appendChild(rewardChips(store, result.rewards));
    if (result.rewards.pity) modal.appendChild(h('p.small', '🧩 ', result.rewards.pity));
    const totals = h('div.small.muted');
    for (const matId of Object.keys(result.rewards.materials)) {
      totals.appendChild(h('div', `${store.content.materialById[matId].displayName}: now ${fmt(store.state.inventory.materials[matId] ?? 0)} in inventory`));
    }
    modal.appendChild(totals);
    modal.appendChild(h('div', { style: { marginTop: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap' } },
      h('button.btn.primary', { onclick: wrap }, 'Continue'),
      h('button.btn', { onclick: () => { close(); store.go('#/inventory'); } }, 'Go craft'),
      h('button.btn', { onclick: () => { close(); store.go('#/home'); } }, 'Home')
    ));
  });
}
