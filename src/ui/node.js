// Node Detail (GDD 11.2): energy/attempt cost, exact threshold comparison,
// party selection, reward table, pity state, objective, Clear, and Sweep.
import { h, fmt, pct } from './dom.js';
import {
  nodeState, nodeUnlocked, nodeEnergyCost, shardAttemptsLeft, checkClear,
  clearNode, maxSweepCount, preferredPartyIndex, selectPartyPreset
} from '../core/state.js';
import { evaluateParty, objectiveSatisfied } from '../core/synergy.js';
import { nodeTypeMeta, nodeRepeatText, rewardChips, campaignLabel } from './shared.js';
import { showResults } from './results.js';
import { render } from '../app.js';

export function renderNode(store, root, nodeId) {
  const { content, state } = store;
  const node = content.nodeById[nodeId];
  if (!node) { root.appendChild(h('p.bad', 'Unknown node.')); return; }
  const ns = nodeState(state, nodeId);
  const meta = nodeTypeMeta(node.type);
  const unlock = nodeUnlocked(content, state, node);
  const cost = nodeEnergyCost(content, node);

  const returnContext = store.ui.returnContext;
  const returnGear = returnContext?.gear;
  const returnName = returnGear
    ? content.characterById[returnGear.characterId]?.equipmentLines?.[returnGear.slot]
    : null;
  root.appendChild(h('button.link', {
    onclick: () => {
      if (returnContext) {
        store.ui.pendingReopen = returnContext;
        store.ui.returnContext = null;
        store.go(returnContext.route);
      } else store.go(`#/campaign/${node.campaign}`);
    }
  }, returnName ? `← Back to ${returnName}`
    : returnContext?.archive ? '← Back to World Archive'
      : '← Back to campaign map'));

  // ---------- header
  const head = h('div.panel');
  head.appendChild(h('h2', `${meta.icon} ${campaignLabel(store, node)} ${node.number} — ${node.displayName}`));
  head.appendChild(h('p.small.muted', `${meta.label} · Chapter ${node.chapter}${node.checkpoint ? ' · chapter checkpoint' : ''}`));
  const facts = h('div.row');
  facts.appendChild(fact('Energy per run', `⚡ ${cost}`));
  facts.appendChild(fact('Required Power', fmt(node.threshold)));
  if (node.shardCharacter) {
    facts.appendChild(fact('Attempts left today', `${shardAttemptsLeft(content, state, node)} / ${content.balance.shardAttemptsPerDay}`));
  } else {
    facts.appendChild(fact('Daily attempts', 'Unlimited'));
  }
  head.appendChild(facts);
  if (!unlock.unlocked) head.appendChild(h('p.warn', `🔒 ${unlock.reason}`));
  root.appendChild(head);

  // ---------- party & threshold
  const partyPanel = h('div.panel');
  partyPanel.appendChild(h('h2', 'Party'));
  const sel = h('select', { 'aria-label': 'Party preset' });
  let selectedPartyIndex = preferredPartyIndex(state, node.id);
  state.parties.forEach((p, i) => {
    sel.appendChild(h('option', { value: String(i), selected: i === selectedPartyIndex }, `${p.name} (${p.members.filter(Boolean).length}/5)`));
  });
  sel.addEventListener('change', async () => {
    selectedPartyIndex = Number(sel.value);
    await store.tx(() => selectPartyPreset(state, selectedPartyIndex, node.id), { rerender: false });
    rerenderBody();
  });
  partyPanel.appendChild(h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
    sel, h('button.btn.tiny', { onclick: () => store.go('#/party') }, 'Edit parties')));
  const body = h('div');
  partyPanel.appendChild(body);
  root.appendChild(partyPanel);

  // ---------- rewards table
  const rw = h('div.panel');
  rw.appendChild(h('h2', 'Rewards'));
  const table = h('table.data');
  table.appendChild(h('tr', h('th', 'When'), h('th', 'Reward')));
  table.appendChild(h('tr', h('td', 'Every run'), h('td', nodeRepeatText(store, node))));
  if (node.firstClear) {
    const fc = [];
    for (const m of node.firstClear.materials ?? []) fc.push(`${m.qty} × ${content.materialById[m.materialId].displayName}`);
    if (node.firstClear.shards) fc.push(`${node.firstClear.shards.qty} × ${content.characterById[node.firstClear.shards.characterId].displayName} shards (fixed)`);
    if (node.firstClear.archiveFragment) fc.push('1 Archive fragment');
    if (node.firstClear.milestone) fc.push(node.firstClear.milestone);
    table.appendChild(h('tr',
      h('td', 'First clear', ns.firstClearClaimed ? h('span.good', ' ✓') : h('span.warn', ' ✦')),
      h('td', fc.join(' + '))));
  }
  if (node.objective) {
    const or = (node.objective.reward.materials ?? []).map(m => `${m.qty} × ${content.materialById[m.materialId].displayName}`).join(' + ');
    table.appendChild(h('tr',
      h('td', 'Optional objective', ns.objectiveClaimed ? h('span.good', ' ✓') : ''),
      h('td', `${node.objective.text} → ${or}. One-time; can be completed on any later paid clear or sweep. Never blocks progression.`)));
  }
  rw.appendChild(table);
  if (node.shardCharacter) {
    const sc = state.characters[node.shardCharacter];
    const cdef = content.characterById[node.shardCharacter];
    rw.appendChild(sc.stars >= 7
      ? h('p.small.muted', `${cdef.displayName} is at 7★ — the shard roll is replaced by a guaranteed extra material.`)
      : h('p.small', sc.pity
        ? h('span.good', `🧩 ${cdef.displayName}: guaranteed shard on the next attempt.`)
        : `🧩 ${cdef.displayName}: ${content.balance.shardChanceBp / 100}% shard chance per attempt; a miss guarantees the next one.`));
  }
  root.appendChild(rw);

  function rerenderBody() {
    body.replaceChildren();
    const members = state.parties[selectedPartyIndex].members.filter(Boolean);
    const check = checkClear(content, state, node.id, members, 1);
    const ev = members.length === 5 ? evaluateParty(content, state, members) : null;

    if (ev) {
      const ok = ev.effectivePower >= node.threshold;
      body.appendChild(h('table.data',
        h('tr', h('td', 'Raw Power'), h('td', fmt(ev.rawPower))),
        h('tr', h('td', `Synergy (capped at ${pct(content.balance.synergyCapBp)})`), h('td', `+${pct(ev.cappedBp)}`)),
        h('tr', h('td', 'Effective Power'), h('td', h('b.big-num' + (ok ? '.good' : '.bad'), fmt(ev.effectivePower)))),
        h('tr', h('td', 'Required'), h('td', fmt(node.threshold))),
        h('tr', h('td', 'Verdict'), h('td' + (ok ? '.good' : '.bad'), ok ? 'Guaranteed clear — no random victory roll.' : `Short by ${fmt(node.threshold - ev.effectivePower)}. The attempt cannot start, so no Energy can be lost.`))
      ));
      if (node.objective && !ns.objectiveClaimed) {
        const sat = objectiveSatisfied(content, node.objective, members);
        body.appendChild(h('p.small' + (sat ? '.good' : '.warn'),
          sat ? '✦ This party satisfies the optional objective.' : `Objective not met with this party: ${node.objective.text}.`));
      }
    }

    // Clear
    const actions = h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' } });
    actions.appendChild(h('button.btn.primary', {
      disabled: !check.ok,
      onclick: async () => {
        const result = await store.tx(() => clearNode(content, state, node.id, members, 1, store.rng, store.now()), { rerender: false });
        rerenderAll();
        if (result.ok) showResults(store, result);
      }
    }, `Clear (⚡${cost})`));

    // Sweep
    const canSweepBase = ns.cleared && unlock.unlocked;
    const maxN = Math.max(1, maxSweepCount(content, state, node.id));
    const qty = h('input', { type: 'number', min: 1, max: maxN, value: Math.min(5, maxN), 'aria-label': 'Sweep count' });
    const sweepBtn = h('button.btn', {
      disabled: !canSweepBase || !check.ok,
      title: canSweepBase ? 'Resolve several runs instantly with one summary' : 'Sweep unlocks after the first clear',
      onclick: async () => {
        const n = Math.max(1, Math.min(maxN, Number(qty.value) || 1));
        const pre = checkClear(content, state, node.id, members, n);
        if (!pre.ok) { store.tx(() => pre, { rerender: false }); rerenderAll(); return; }
        const result = await store.tx(() => clearNode(content, state, node.id, members, n, store.rng, store.now()), { rerender: false });
        rerenderAll();
        if (result.ok) showResults(store, result);
      }
    }, 'Sweep ×');
    const sweepWrap = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, sweepBtn, qty,
      h('span.small.muted', `(max ${maxN} by Energy${node.shardCharacter ? ' & attempts' : ''}, ⚡${cost} each)`));
    actions.appendChild(sweepWrap);
    body.appendChild(actions);

    if (!check.ok) {
      body.appendChild(h('ul.reasons', check.reasons.map(r => h('li', r))));
    }
  }

  function rerenderAll() { render(); }
  rerenderBody();
}

function fact(label, value) {
  return h('div', { style: { minWidth: '140px' } },
    h('div.small.muted', label), h('div', { style: { fontWeight: 700 } }, value));
}
