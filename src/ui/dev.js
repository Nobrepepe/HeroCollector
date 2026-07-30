// Hidden developer panel (GDD 12.5): grants, node unlock/relock, reset-day
// advancement, RNG seeding and shard simulation, calculation traces, content
// validation, and clean-save reset. Not part of the player-facing design.
import { h, fmt, pct } from './dom.js';
import { validateContent, validateSave } from '../core/validate.js';
import { evaluateParty } from '../core/synergy.js';
import { characterPowerBreakdown } from '../core/power.js';
import { makeRng } from '../core/rng.js';
import { applyDailyReset, newPlayerState, nodeState } from '../core/state.js';
import { openModal, toast, render } from '../app.js';
import { addResource } from '../core/resources.js';
import { generateExpeditionBoard } from '../core/expeditions.js';

export function renderDev(store, root) {
  const { content, state } = store;

  root.appendChild(h('p.warn.small', '🧪 Developer tools — these bypass normal play. Not part of the player experience. ',
    h('button.link', { onclick: () => store.go('#/creator') }, 'Open the Content Creator'), ' to build worlds, characters, and campaigns.'));

  // ---------- grants
  const gr = h('div.panel');
  gr.appendChild(h('h2', 'Grants'));
  const amount = h('input', { type: 'number', value: 100, 'aria-label': 'Amount' });
  gr.appendChild(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
    h('span', 'Amount:'), amount,
    h('button.btn.tiny', { onclick: () => act(() => { state.energy = Math.max(0, state.energy + num(amount)); }) }, '± Energy'),
    h('button.btn.tiny', { onclick: () => act(() => addResource(state, 'renown', num(amount))) }, '± Renown'),
    h('button.btn.tiny', { onclick: () => act(() => addResource(state, 'intelligence', num(amount))) }, '± Intelligence'),
    ...content.worlds.map(world => h('button.btn.tiny', {
      onclick: () => act(() => addResource(state, world.worldAsset.id, num(amount)))
    }, `± ${world.worldAsset.displayName}`)),
    h('button.btn.tiny', {
      onclick: () => act(() => {
        for (const m of content.materials) {
          state.inventory.materials[m.id] = Math.max(0, (state.inventory.materials[m.id] ?? 0) + num(amount));
          if (!state.inventory.materials[m.id]) delete state.inventory.materials[m.id];
        }
      })
    }, '± All materials'),
    h('button.btn.tiny', {
      onclick: () => act(() => {
        for (const c of content.components) {
          state.inventory.components[c.id] = Math.max(0, (state.inventory.components[c.id] ?? 0) + num(amount));
          if (!state.inventory.components[c.id]) delete state.inventory.components[c.id];
        }
      })
    }, '± All components')));

  const charSel = h('select', { 'aria-label': 'Character' });
  for (const d of content.characters) charSel.appendChild(h('option', { value: d.id }, d.displayName));
  gr.appendChild(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' } },
    charSel,
    h('button.btn.tiny', { onclick: () => act(() => { const cs = state.characters[charSel.value]; cs.shards = Math.max(0, cs.shards + num(amount)); }) }, '± Shards'),
    h('button.btn.tiny', { onclick: () => act(() => { const cs = state.characters[charSel.value]; cs.owned = true; cs.stars = Math.min(7, Math.max(1, cs.stars + 1)); }) }, '+1 Star'),
    h('button.btn.tiny', {
      onclick: () => act(() => {
        const cs = state.characters[charSel.value];
        cs.owned = true;
        if (cs.gearTier < content.balance.gearTierPower.length) { cs.gearTier += 1; for (const s of content.characterMeta.slotOrder) cs.slots[s] = false; }
      })
    }, '+1 Gear Tier'),
    h('button.btn.tiny', { onclick: () => act(() => { const cs = state.characters[charSel.value]; cs.owned = true; cs.stars = Math.max(1, cs.stars); }) }, 'Own'),
  ));
  root.appendChild(gr);

  // ---------- nodes
  const nd = h('div.panel');
  nd.appendChild(h('h2', 'Nodes'));
  const campSel = h('select', {}, ...['main', ...content.worlds.map(w => w.campaignId)].map(c => h('option', { value: c }, c)));
  const chapterN = h('input', { type: 'number', min: 1, max: 30, value: 1, 'aria-label': 'Chapter' });
  nd.appendChild(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
    campSel, h('span', 'chapter'), chapterN,
    h('button.btn.tiny', {
      onclick: () => act(() => {
        for (const n of content.nodesByCampaign[campSel.value] ?? []) {
          if (n.chapter <= num(chapterN)) {
            const ns = state.nodes[n.id] ?? (state.nodes[n.id] = { cleared: false, firstClearClaimed: false, objectiveClaimed: false, attemptsToday: 0 });
            ns.cleared = true;
          }
        }
      })
    }, 'Mark cleared through chapter'),
    h('button.btn.tiny.danger', {
      onclick: () => act(() => {
        for (const n of content.nodesByCampaign[campSel.value] ?? []) {
          if (n.chapter >= num(chapterN)) delete state.nodes[n.id];
        }
      })
    }, 'Relock from chapter')));
  root.appendChild(nd);

  // ---------- time
  const tm = h('div.panel');
  tm.appendChild(h('h2', 'Time'));
  tm.appendChild(h('p.small.muted', `Dev time offset: ${Math.round((state.devTimeOffsetMs ?? 0) / 86400000)} day(s). Reset-day key: ${state.lastResetKey}`));
  tm.appendChild(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
    h('button.btn.tiny', {
      onclick: () => act(() => {
        state.devTimeOffsetMs = (state.devTimeOffsetMs ?? 0) + 86400000;
        const s = applyDailyReset(content, state, store.now());
        if (s) toast(`Reset applied: +${s.energyGained} Energy.`);
      })
    }, 'Advance one day & apply reset'),
    h('button.btn.tiny', { onclick: () => act(() => { for (const ns of Object.values(state.nodes)) ns.attemptsToday = 0; }) }, 'Refresh attempts'),
    h('button.btn.tiny', { onclick: () => act(() => { state.devTimeOffsetMs = 0; }) }, 'Clear time offset')));
  root.appendChild(tm);

  const ex = h('div.panel', h('h2', 'Expeditions'));
  const boardSeed = h('input', { type: 'number', value: 12345, 'aria-label': 'Expedition board seed' });
  ex.append(boardSeed,
    h('button.btn.tiny', { onclick: () => act(() =>
      generateExpeditionBoard(content, state, makeRng(num(boardSeed) >>> 0), { seed: num(boardSeed) >>> 0 })) }, 'Generate board'),
    h('button.btn.tiny', { onclick: () => act(() => {
      for (const expedition of state.expeditions.active) expedition.returnDay = state.dayNumber;
    }) }, 'Make active Expeditions due'),
    h('pre.small', JSON.stringify(state.expeditions.board, null, 2)));
  root.appendChild(ex);

  // ---------- rng
  const rg = h('div.panel');
  rg.appendChild(h('h2', 'RNG'));
  rg.appendChild(h('p.small.muted', state.rng ? `Seeded: ${state.rng.seed} (deterministic, persisted)` : 'Unseeded (entropy per session)'));
  const seedIn = h('input', { type: 'number', value: state.rng?.seed ?? 12345, 'aria-label': 'Seed' });
  rg.appendChild(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
    seedIn,
    h('button.btn.tiny', {
      onclick: () => act(() => {
        const seed = num(seedIn) >>> 0;
        state.rng = { seed, state: seed };
        store.rng = makeRng(seed);
      })
    }, 'Set seed'),
    h('button.btn.tiny', { onclick: () => act(() => { state.rng = null; }) }, 'Clear seed'),
    h('button.btn.tiny', {
      onclick: () => {
        const rng = makeRng(num(seedIn) >>> 0);
        let hits = 0, pity = false, pityHits = 0;
        const N = 1000;
        for (let i = 0; i < N; i++) {
          if (pity || rng.chanceBp(content.balance.shardChanceBp)) { hits++; if (pity) pityHits++; pity = false; }
          else pity = true;
        }
        openModal((modal, close) => {
          modal.appendChild(h('h2', 'Shard simulation'));
          modal.appendChild(h('p', `${N} attempts with seed ${num(seedIn)}: ${hits} shards (${(hits / N * 100).toFixed(1)}%), ${pityHits} from pity.`));
          modal.appendChild(h('button.btn', { onclick: close }, 'Close'));
        });
      }
    }, 'Simulate 1,000 shard attempts')));
  root.appendChild(rg);

  // ---------- trace
  const tr = h('div.panel');
  tr.appendChild(h('h2', 'Calculation trace (active party)'));
  const members = state.parties[state.activePartyIndex].members.filter(Boolean);
  if (members.length === 0) tr.appendChild(h('p.muted.small', 'Active party is empty.'));
  else {
    const ev = evaluateParty(content, state, members);
    const table = h('table.data');
    table.appendChild(h('tr', h('th', 'Character'), h('th', 'Base'), h('th', 'Stars'), h('th', 'Gear perm.'), h('th', 'Equipped'), h('th', 'Total')));
    for (const id of members) {
      const bd = characterPowerBreakdown(content, state.characters[id]);
      table.appendChild(h('tr', h('td', content.characterById[id].displayName),
        h('td', fmt(bd.base)), h('td', fmt(bd.stars)), h('td', fmt(bd.gearPermanent)), h('td', fmt(bd.gearEquipped)), h('td', fmt(bd.total))));
    }
    tr.appendChild(table);
    tr.appendChild(h('p.small', `Raw ${fmt(ev.rawPower)} × (1 + min(${pct(ev.totalBp)}, ${pct(content.balance.synergyCapBp)})) = floor → ${fmt(ev.effectivePower)}`));
    for (const a of ev.active) tr.appendChild(h('div.small.good', `+${pct(a.bonusBp)} ${a.tag.displayName} (count ${a.count}, group ${a.tag.stackingGroup})`));
  }
  root.appendChild(tr);

  // ---------- validation
  const va = h('div.panel');
  va.appendChild(h('h2', 'Validation'));
  va.appendChild(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
    h('button.btn.tiny', {
      onclick: () => {
        const c = validateContent(content);
        const s = validateSave(content, state);
        openModal((modal, close) => {
          modal.appendChild(h('h2', 'Validation report'));
          modal.appendChild(h('p', `Content: ${c.ok ? '✅ valid' : `❌ ${c.errors.length} error(s)`}`));
          if (!c.ok) modal.appendChild(h('ul.reasons', c.errors.map(e => h('li', e))));
          modal.appendChild(h('p', `Save: ${s.ok ? '✅ valid' : `❌ ${s.errors.length} error(s)`}`));
          if (!s.ok) modal.appendChild(h('ul.reasons', s.errors.map(e => h('li', e))));
          modal.appendChild(h('button.btn', { onclick: close }, 'Close'));
        });
      }
    }, 'Validate content & save'),
    h('button.btn.tiny.danger', {
      onclick: () => openModal((modal, close) => {
        modal.appendChild(h('h2', 'Reset to clean save?'));
        modal.appendChild(h('div', { style: { display: 'flex', gap: '8px' } },
          h('button.btn.danger', { onclick: async () => { store.state = newPlayerState(content, Date.now()); await store.save(); close(); render(); } }, 'Reset'),
          h('button.btn.primary', { onclick: close }, 'Cancel')));
      })
    }, 'Reset save')));
  root.appendChild(va);

  function num(input) { return Number(input.value) || 0; }
  function act(fn) { fn(); store.save().then(render); }
}
