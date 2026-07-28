// Party Builder (GDD 11.2): five slots, saved presets, active/inactive
// synergies with explanations, raw power, cap, effective power, node compare.
import { h, fmt, pct } from './dom.js';
import { evaluateParty } from '../core/synergy.js';
import { setPartyMember, renameParty, nodeState, nodeUnlocked } from '../core/state.js';
import { characterPower } from '../core/power.js';
import { portrait, starline, campaignLabel, nodeTypeMeta } from './shared.js';
import { openModal } from '../app.js';

export function renderParty(store, root, arg) {
  const { content, state } = store;
  const idx = state.activePartyIndex;
  const party = state.parties[idx];

  // ---------- preset tabs
  const tabs = h('div.tab-bar');
  state.parties.forEach((p, i) => {
    tabs.appendChild(h('button.tab-btn' + (i === idx ? '.active' : ''), {
      onclick: () => { state.activePartyIndex = i; store.save().then(() => renderPartyAgain(store, root)); }
    }, p.name));
  });
  root.appendChild(tabs);

  // ---------- rename
  const renameRow = h('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px' } });
  const nameInput = h('input', { type: 'text', value: party.name, 'aria-label': 'Preset name', maxlength: 30 });
  renameRow.appendChild(nameInput);
  renameRow.appendChild(h('button.btn.tiny', {
    onclick: () => store.tx(() => renameParty(state, idx, nameInput.value))
  }, 'Rename preset'));
  root.appendChild(renameRow);

  // ---------- slots
  const slotsPanel = h('div.panel');
  slotsPanel.appendChild(h('h2', 'Party — five unique owned characters'));
  const slotsRow = h('div.party-slots');
  party.members.forEach((memberId, slotIdx) => {
    const slot = h('button.party-slot' + (memberId ? '.filled' : ''), {
      onclick: () => pickMember(store, idx, slotIdx, () => renderPartyAgain(store, root)),
      title: memberId ? 'Change or remove' : 'Add a character'
    });
    if (memberId) {
      const def = content.characterById[memberId];
      const cs = state.characters[memberId];
      slot.appendChild(portrait(store, memberId, 'md'));
      slot.appendChild(h('div.small', def.displayName));
      slot.appendChild(starline(cs.stars));
      slot.appendChild(h('div.small.muted', `${fmt(characterPower(content, cs))}`));
    } else {
      slot.appendChild(h('div', { style: { fontSize: '2rem', color: 'var(--muted)' } }, '+'));
      slot.appendChild(h('div.small.muted', 'Empty slot'));
    }
    slotsRow.appendChild(slot);
  });
  slotsPanel.appendChild(slotsRow);
  root.appendChild(slotsPanel);

  // ---------- synergy breakdown
  const members = party.members.filter(Boolean);
  const ev = evaluateParty(content, state, members);
  const syn = h('div.panel');
  syn.appendChild(h('h2', 'Effective Party Power'));
  syn.appendChild(h('table.data',
    h('tr', h('td', 'Raw Power (sum of five characters)'), h('td', h('b', fmt(ev.rawPower)))),
    h('tr', h('td', 'Total active synergy'), h('td', h('b' + (ev.capped ? '.warn' : ''), `+${pct(ev.totalBp)}`))),
    ev.capped ? h('tr', h('td', `Applied synergy (global ${pct(content.balance.synergyCapBp)} cap)`), h('td', h('b.warn', `+${pct(ev.cappedBp)}`))) : null,
    h('tr', h('td', h('b', 'Effective Power')), h('td', h('b.big-num', fmt(ev.effectivePower))))
  ));
  if (members.length < 5) syn.appendChild(h('p.warn.small', `Add ${5 - members.length} more character${5 - members.length > 1 ? 's' : ''} to form a legal party.`));

  syn.appendChild(h('h3', 'Active bonuses'));
  if (ev.active.length === 0) syn.appendChild(h('p.muted.small', 'No synergy bonuses are active.'));
  for (const a of ev.active.sort((x, y) => y.bonusBp - x.bonusBp)) {
    syn.appendChild(h('div.synergy-item.on',
      h('span.bonus', `+${pct(a.bonusBp)}`),
      h('span', h('b', a.tag.displayName), ' — ', h('span.small.muted', a.tag.explanation))));
  }
  syn.appendChild(h('h3', 'Inactive — what would activate them'));
  for (const i of ev.inactive) {
    syn.appendChild(h('div.synergy-item.off',
      h('span.bonus', '—'),
      h('span', h('b', i.tag.displayName), h('div.small', i.missing))));
  }
  root.appendChild(syn);

  // ---------- node comparison
  const cmp = h('div.panel');
  cmp.appendChild(h('h2', 'Compare against a node'));
  const sel = h('select', { 'aria-label': 'Node to compare' });
  const candidates = content.nodes.filter(n => nodeUnlocked(content, state, n).unlocked);
  for (const n of candidates) {
    sel.appendChild(h('option', { value: n.id }, `${campaignLabel(store, n)} ${n.number} — ${n.displayName} (needs ${fmt(n.threshold)})`));
  }
  const verdict = h('div', { style: { marginTop: '8px' } });
  const update = () => {
    const n = content.nodeById[sel.value];
    verdict.replaceChildren();
    if (!n) return;
    const ok = ev.effectivePower >= n.threshold && members.length === 5;
    verdict.appendChild(h('p' + (ok ? '.good' : '.bad'),
      `${fmt(ev.effectivePower)} vs required ${fmt(n.threshold)} — ${ok ? 'this party can clear it.' : members.length < 5 ? 'party is incomplete.' : `short by ${fmt(n.threshold - ev.effectivePower)}.`}`));
    verdict.appendChild(h('button.btn.tiny', { onclick: () => store.go(`#/node/${n.id}`) }, 'Open node'));
  };
  sel.addEventListener('change', update);
  cmp.appendChild(sel);
  cmp.appendChild(verdict);
  update();
  root.appendChild(cmp);
}

function renderPartyAgain(store, root) {
  root.replaceChildren();
  renderParty(store, root, null);
}

function pickMember(store, partyIdx, slotIdx, done) {
  const { content, state } = store;
  openModal((modal, close) => {
    modal.appendChild(h('h2', 'Choose a character'));
    const current = state.parties[partyIdx].members[slotIdx];
    if (current) {
      modal.appendChild(h('button.btn.danger.tiny', {
        onclick: () => { store.tx(() => setPartyMember(content, state, partyIdx, slotIdx, null), { rerender: false }).then(() => { close(); done(); }); }
      }, 'Remove from slot'));
    }
    const grid = h('div.card-grid', { style: { marginTop: '10px' } });
    for (const def of content.characters) {
      const cs = state.characters[def.id];
      if (!cs.owned) continue;
      const inParty = state.parties[partyIdx].members.includes(def.id);
      const card = h('button.char-card', {
        onclick: () => { store.tx(() => setPartyMember(content, state, partyIdx, slotIdx, def.id), { rerender: false }).then(() => { close(); done(); }); }
      });
      card.appendChild(portrait(store, def.id, 'sm'));
      const body = h('div');
      body.appendChild(h('div.name', def.displayName, inParty ? h('span.small.muted', ' (in party)') : null));
      body.appendChild(h('div.sub', `${content.archetypes[def.archetype].name} · ${fmt(characterPower(content, cs))} Power`));
      card.appendChild(body);
      grid.appendChild(card);
    }
    modal.appendChild(grid);
    modal.appendChild(h('div', { style: { marginTop: '12px' } }, h('button.btn', { onclick: close }, 'Cancel')));
  });
}
