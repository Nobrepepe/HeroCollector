import { h, fmt } from './dom.js';
import { canAffordEntries, resourceQty } from '../core/resources.js';
import { trainingPowerBonus } from '../core/power.js';
import {
  assignHqStaff, assignedStaff, cancelConstruction, facilityLevel, hqBackground, hqRank,
  hqState, operationsWorldAssetBp, setProduction, staffingCapacity, startConstruction, unassignHqStaff
} from '../core/hq.js';
import { worldCampaignUnlocked } from '../core/state.js';
import { portrait, selectorWorldName } from './shared.js';
import { countWord } from './presentation.js';
import { fieldSupplyLimits } from '../core/energy.js';

export function renderHeadquarters(store, root, arg) {
  const { content, state } = store;
  const founded = content.worlds.filter(world => world.hq?.enabled);
  if (!founded.length) {
    root.appendChild(h('header.utility-head', h('div.eyebrow', 'World Headquarters'),
      h('h1.display-s', 'No grounds have been broken anywhere.'),
      h('p.muted', 'Nothing about the game is missing while that stays true. A Headquarters is enabled per world from the Content Creator.')));
    return;
  }
  const [requested, facilityId] = (arg ?? '').split('/');
  const world = founded.find(candidate => candidate.id === requested) ?? founded[0];
  if (facilityId) return facilityView(store, root, world, facilityId);

  const rank = hqRank(content, state, world.id);
  const background = hqBackground(content, state, world.id) ?? content.images.world[world.id];
  const total = world.hq.facilities.reduce((sum, facility) => sum + facilityLevel(state, world.id, facility.id), 0);
  const next = world.hq.ranks.find(milestone => milestone.totalLevels > total);

  const page = h('div.hq-page');
  page.appendChild(h('div.hq-landscape' + (background ? '' : '.art-fallback'), {
    style: background ? { backgroundImage: `url("${background}")` } : {}, 'aria-hidden': 'true'
  }));
  // The caption sits in the empty middle of the band so it never collides with
  // the title on the left or the reserves column on the right.
  if (!background) page.appendChild(h('div.hq-landscape-slot', { 'aria-hidden': 'true' }, 'HQ landscape — 1024 × 576'));
  // A Headquarters belongs to a world, so the way out leads back to it.
  page.appendChild(h('button.link.hq-back', {
    onclick: () => store.go(`#/worlds/${world.id}`)
  }, `← ${world.displayName}`));
  page.appendChild(worldSwitcher(store, world));

  const head = h('header.hq-head', h('div.eyebrow', 'World Headquarters'),
    h('h1.hq-title',
      h('span.hq-title-world', world.displayName),
      h('span.hq-title-rank', `Rank ${rank}`)),
    h('p.hq-next', next
      ? `${countWord(next.totalLevels - total, { capitalize: true })} more facility level${next.totalLevels - total === 1 ? '' : 's'} open Rank ${next.rank}.`
      : 'Every facility path here is fully open.'));
  // A Headquarters whose world campaign is still closed cannot earn its own
  // asset yet. That is a gate, and it is stated rather than left to be
  // inferred from costs that never become affordable.
  const entry = worldCampaignUnlocked(content, state, world.id);
  if (!entry.unlocked) {
    head.appendChild(h('p.hq-gate',
      `The ${world.displayName} campaign is still closed, so ${world.worldAsset.displayName} cannot be earned here yet — own ${entry.needed} of its characters to open it (${entry.owned}/${entry.needed}).`));
  }
  // A Crisis belongs to the world, not to its Headquarters: the world hub is
  // the single place it is announced and answered from.
  page.appendChild(head);

  page.appendChild(h('section.hq-resources', h('div.eyebrow', 'Development reserves'),
    h('div.hq-reserve-row',
      reserve(fmt(resourceQty(state, 'renown')), 'Renown'),
      reserve(fmt(resourceQty(state, world.worldAsset.id)), world.worldAsset.displayName))));

  page.appendChild(grounds(store, world));
  page.appendChild(h('div.fade-rule.hq-rule'));
  page.appendChild(h('div.hq-footer', construction(store, world), staffRow(store, world)));
  root.appendChild(page);
}

function reserve(value, label) {
  return h('div.hq-reserve', h('div.hq-reserve-number', value), h('div.hq-reserve-label', label));
}

// Every world is listed, founded or not — an absent Headquarters keeps its row
// and says what is absent rather than disappearing from the switcher.
function worldSwitcher(store, active) {
  const { content, state } = store;
  const bar = h('nav.hq-world-switcher', { 'aria-label': 'World Headquarters' });
  for (const world of content.worlds) {
    if (!world.hq?.enabled) {
      bar.appendChild(h('div.hq-world.is-unfounded',
        h('div.hq-world-name', selectorWorldName(world)),
        h('div.hq-world-rank', 'not founded')));
      continue;
    }
    const current = world.id === active.id;
    bar.appendChild(h('button.hq-world' + (current ? '.is-active' : ''), {
      onclick: () => store.go(`#/headquarters/${world.id}`),
      'aria-current': current ? 'page' : null
    },
    h('div.hq-world-name', selectorWorldName(world)),
    h('div.hq-world-rank', `Rank ${hqRank(content, state, world.id)}`)));
  }
  return bar;
}

// Facilities sit along an irregular path rather than in a grid, so the grounds
// read as a place instead of a list of equal cards.
const PATH_OFFSETS = [26, 2, 44, 16, 58, 8];

function grounds(store, world) {
  const { content, state } = store;
  const section = h('section.hq-path', h('div.eyebrow', 'The grounds'));
  const line = h('div.hq-facilities');
  world.hq.facilities.forEach((facility, index) => {
    const level = facilityLevel(state, world.id, facility.id);
    const next = facility.levels[level];
    const built = level > 0;
    const affordable = next ? canAffordEntries(content, state, next.cost, world.id).ok : false;
    const button = h('button.hq-facility' + (built ? '.is-built' : '.is-unbuilt'), {
      style: { '--path-y': `${PATH_OFFSETS[index % PATH_OFFSETS.length]}px` },
      onclick: () => store.go(`#/headquarters/${world.id}/${facility.id}`)
    },
    h('span.hq-dot' + (built ? '.built' : ''), { 'aria-hidden': 'true' }),
    h('span.hq-facility-name', facility.displayName),
    h('span.hq-facility-level', `Level ${level} of ${facility.levels.length}`));
    if (built) {
      button.appendChild(h('span.hq-facility-effect', facilityEffect(store, world, facility, level)));
    } else if (next) {
      button.appendChild(h('span.hq-facility-cost' + (affordable ? '' : '.is-gated'),
        `${costText(store, world, next.cost)} · ${countWord(next.buildDays ?? 1)} day${(next.buildDays ?? 1) === 1 ? '' : 's'}`));
    } else {
      button.appendChild(h('span.hq-facility-cost.is-gated', 'no levels are authored yet'));
    }
    line.appendChild(button);
  });
  section.appendChild(line);
  return section;
}

// One sentence per built facility, saying what it does rather than what it is.
function facilityEffect(store, world, facility, level) {
  const { content, state } = store;
  if (facility.category === 'training') {
    return `+${trainingPowerBonus(level)} Power to every ${selectorWorldName(world)} character`;
  }
  if (facility.category === 'production') {
    const chosen = hqState(state, world.id).production[facility.id];
    const option = facility.productionOptions?.find(item => item.id === chosen) ?? facility.productionOptions?.[0];
    if (!option) return 'nothing is set to produce here';
    const qty = option.quantities[level - 1] ?? 0;
    const name = option.resourceId === '@associated_world_asset'
      ? world.worldAsset.displayName
      : option.displayName ?? content.materialById[option.resourceId]?.displayName ?? option.resourceId;
    return `makes ${qty} ${name} each day`;
  }
  if (facility.category === 'operations') {
    return `+${operationsWorldAssetBp(level) / 100}% ${world.worldAsset.displayName} from ${selectorWorldName(world)} routes`;
  }
  const slots = staffingCapacity(content, state, world.id);
  return `${countWord(slots)} staffing slot${slots === 1 ? '' : 's'} across this Headquarters`;
}

// The construction slot is account-wide. That is stated here rather than
// discovered by tabbing to another world and finding the action refused.
function construction(store, world) {
  const { content, state } = store;
  const build = state.headquarters.construction;
  const section = h('section.hq-current', h('div.eyebrow', 'Current construction'));
  if (!build) {
    section.appendChild(h('p.hq-current-line', 'Nothing is being built.'));
    section.appendChild(h('p.caption', 'The construction slot is account-wide and open — any Headquarters can start one build.'));
    return section;
  }
  const elsewhere = build.worldId !== world.id;
  section.appendChild(h('p.hq-current-line',
    `${build.facilityName} reaches Level ${build.targetLevel} on day ${build.dueDay}.`));
  section.appendChild(h('p.caption',
    elsewhere
      ? `It is being built at ${content.worldById[build.worldId]?.displayName ?? 'another Headquarters'}. The construction slot is account-wide — no other Headquarters can build until this finishes. `
      : 'The construction slot is account-wide — no other Headquarters can build until this finishes. ',
    build.startDay === state.dayNumber
      ? h('button.link', { onclick: () => store.tx(() => cancelConstruction(content, state)) }, 'Cancel and refund')
      : h('span.hq-past', 'Started before today · it can no longer be cancelled')));
  return section;
}

function staffRow(store, world) {
  const { content, state } = store;
  const capacity = staffingCapacity(content, state, world.id);
  const placed = assignedStaff(state, world.id);
  const section = h('section.hq-staff',
    h('div.eyebrow', `Staff · ${placed.length} of ${capacity} placed`));
  if (!capacity) {
    section.appendChild(h('p.caption', 'No staffing slots have opened here yet. The community facility is what opens them.'));
    return section;
  }
  const row = h('div.hq-staff-row');
  placed.forEach(id => row.appendChild(portrait(store, id, 'staff', { decorative: true })));
  for (let index = placed.length; index < capacity; index++) {
    row.appendChild(h('div.hq-staff-empty', { 'aria-hidden': 'true' }));
  }
  section.appendChild(row);
  section.appendChild(h('p.caption', 'Staff keep working while they fight — placing someone here costs you nothing elsewhere.'));
  return section;
}

function facilityView(store, root, world, facilityId) {
  const facility = world.hq.facilities.find(item => item.id === facilityId);
  if (!facility) { root.appendChild(h('p.bad', 'Unknown facility.')); return; }
  const level = facilityLevel(store.state, world.id, facility.id);
  const next = facility.levels[level];
  const hs = hqState(store.state, world.id);
  root.appendChild(h('button.link.facility-back', {
    onclick: () => store.go(`#/headquarters/${world.id}`)
  }, `← ${world.displayName}`));
  const image = store.content.images.facility[facility.id];
  root.appendChild(h('div.facility-hero' + (image ? '' : '.art-fallback'), {
    style: image ? { backgroundImage: `url("${image}")` } : {},
    role: 'img', 'aria-label': image ? `${facility.displayName} building artwork` : `${facility.displayName} artwork has not been imported`
  }));
  root.appendChild(h('header.utility-head.facility-head', h('div.eyebrow', `${facility.category} · level ${level}`),
    h('h1.display-m', facility.displayName), h('p.muted', facility.description)));
  root.appendChild(h('section.facility-effects', h('div.eyebrow', 'What this changes'),
    h('p', level
      ? facilityEffect(store, world, facility, level)
      : `Nothing yet — ${facility.displayName} has not been built.`)));
  if (facility.category === 'training') {
    const limits = fieldSupplyLimits(store.content, store.state);
    root.appendChild(h('section.facility-effects',
      h('p.caption', `Across the whole collection, the highest Training path allows ${limits.storageCap} Field Supplies to be stored and ${limits.dailyUseCap} to be used each day. Training levels from different worlds do not add together.`)));
  }
  const blocked = !!store.state.headquarters.construction;
  root.appendChild(h('section.facility-next', h('div.eyebrow', next ? 'The next level' : 'Development complete'),
    next ? h('div',
      h('p.caption', `${costText(store, world, next.cost)} · ${countWord(next.buildDays ?? 1)} day${(next.buildDays ?? 1) === 1 ? '' : 's'} of construction`),
      h('button.btn.primary', {
        disabled: blocked,
        onclick: () => store.tx(() => startConstruction(store.content, store.state, world.id, facility.id))
      }, `Build Level ${level + 1} →`),
      blocked ? h('p.caption', 'The account-wide construction slot is occupied until the current build finishes.') : null)
      : h('p.good', 'This facility has reached its authored maximum.')));
  if (facility.productionOptions?.length && level > 0) {
    const select = h('select', { 'aria-label': 'Daily production' },
      facility.productionOptions.map(option => h('option', {
        value: option.id, selected: (hs.production[facility.id] ?? facility.productionOptions[0].id) === option.id
      }, `${option.displayName} · ${option.quantities[level - 1]} each day`)));
    select.addEventListener('change', () => store.tx(() => setProduction(store.content, store.state, world.id, facility.id, select.value)));
    root.appendChild(h('section.facility-production', h('div.eyebrow', 'Automatic production'), select));
  }
  const staff = h('section.facility-staff', h('div.eyebrow', `Staff · ${staffingCapacity(store.content, store.state, world.id)} slots across this HQ`));
  for (const id of hs.staff[facility.id] ?? []) staff.appendChild(h('div.staff-row', portrait(store, id, 'sm'),
    h('span', store.content.characterById[id]?.displayName ?? id),
    h('button.link', { onclick: () => store.tx(() => unassignHqStaff(store.state, world.id, id)) }, 'Reassign')));
  const select = h('select', { 'aria-label': 'Assign HQ staff' }, h('option', { value: '' }, 'Choose someone…'));
  for (const def of store.content.characters.filter(d => d.world === world.id && store.state.characters[d.id].owned)) {
    select.appendChild(h('option', { value: def.id }, def.displayName));
  }
  select.addEventListener('change', () => select.value && store.tx(() => assignHqStaff(store.content, store.state, world.id, facility.id, select.value)));
  staff.appendChild(select); root.appendChild(staff);
}

function costText(store, world, cost) {
  return cost.map(entry => `${entry.qty} ${entry.id === '@associated_world_asset'
    ? world.worldAsset.displayName : store.content.resourceById[entry.id]?.displayName ?? store.content.materialById[entry.id]?.displayName ?? entry.id}`).join(' · ');
}
