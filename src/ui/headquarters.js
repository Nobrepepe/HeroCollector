import { h, fmt } from './dom.js';
import { resourceQty } from '../core/resources.js';
import {
  assignHqStaff, cancelConstruction, facilityLevel, hqBackground, hqRank,
  hqState, setProduction, staffingCapacity, startConstruction, unassignHqStaff
} from '../core/hq.js';
import { portrait, selectorWorldName } from './shared.js';
import { fieldSupplyLimits } from '../core/energy.js';

export function renderHeadquarters(store, root, arg) {
  const worlds = store.content.worlds.filter(w => w.hq?.enabled);
  if (!worlds.length) {
    root.appendChild(h('header.utility-head', h('div.eyebrow', 'World Headquarters'),
      h('h1.display-s', 'No Headquarters has been founded yet.'),
      h('p.muted', 'Enable and configure one from the Content Creator.')));
    return;
  }
  const [requested, facilityId] = (arg ?? '').split('/');
  const world = worlds.find(w => w.id === requested) ?? worlds[0];
  if (facilityId) return facilityView(store, root, world, facilityId);
  const rank = hqRank(store.content, store.state, world.id);
  const background = hqBackground(store.content, store.state, world.id) ?? store.content.images.world[world.id];
  const total = world.hq.facilities.reduce((n, f) => n + facilityLevel(store.state, world.id, f.id), 0);
  const next = world.hq.ranks.find(r => r.totalLevels > total);
  const page = h('div.hq-page');
  page.appendChild(h('div.hq-landscape' + (background ? '' : '.art-fallback'), {
    style: background ? { backgroundImage: `url("${background}")` } : {}
  }));
  const tabs = h('div.tab-bar.hq-world-tabs', worlds.map(w => h('button.tab-btn' + (w.id === world.id ? '.active' : ''), {
    onclick: () => store.go(`#/headquarters/${w.id}`)
  }, h('span', selectorWorldName(w)), h('small', `Rank ${hqRank(store.content, store.state, w.id)}`))));
  page.appendChild(h('header.hq-head', h('div.eyebrow', 'World Headquarters'),
    h('h1.hq-title',
      h('span.hq-title-world', world.displayName),
      h('span.hq-title-rank', `Rank ${rank}`)),
    h('p', next ? `${next.totalLevels - total} more facility levels open the next chapter.` : 'Every facility path is fully open.'),
    store.state.crises?.active?.worldId === world.id ? h('p.warn', 'Crisis today · the response remains optional and costs no Energy. ',
      h('button.link', { onclick: () => store.go('#/crisis') }, 'Review it →')) : null,
    tabs));
  const resources = h('section.hq-resources', h('div.eyebrow', 'Development reserves'),
    h('div', h('span.numeral', fmt(resourceQty(store.state, 'renown'))), ' Renown · ',
      h('span.numeral', fmt(resourceQty(store.state, world.worldAsset.id))), ` ${world.worldAsset.displayName}`));
  page.appendChild(resources);
  const path = h('section.hq-path', h('div.eyebrow', 'The grounds'));
  const line = h('div.hq-facilities');
  world.hq.facilities.forEach((facility, index) => {
    const level = facilityLevel(store.state, world.id, facility.id);
    line.appendChild(h('button.hq-facility', {
      style: { '--path-y': `${[0, -24, 18, -10][index]}px` },
      onclick: () => store.go(`#/headquarters/${world.id}/${facility.id}`)
    }, h('span.hq-dot' + (level ? '.built' : '')), h('span.title', facility.displayName),
    h('span.caption', `Level ${level} of ${facility.levels.length}`)));
  });
  path.appendChild(line); page.appendChild(path);
  const build = store.state.headquarters.construction;
  page.appendChild(h('section.hq-current', h('div.eyebrow', 'Current construction'),
    build ? h('p', `${build.facilityName} reaches Level ${build.targetLevel} on day ${build.dueDay}. `,
      h('button.link', { disabled: build.startDay !== store.state.dayNumber,
        onclick: () => store.tx(() => cancelConstruction(store.content, store.state)) }, 'Cancel and refund'))
      : h('p.muted', 'The account-wide construction slot is open.')));
  root.appendChild(page);
}

function facilityView(store, root, world, facilityId) {
  const facility = world.hq.facilities.find(f => f.id === facilityId);
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
  if (facility.category === 'training') {
    const limits = fieldSupplyLimits(store.content, store.state);
    const localPower = [0, 25, 50, 100][level] ?? 0;
    root.appendChild(h('section.facility-effects', h('div.eyebrow', 'What this changes'),
      h('p', level ? `Every character from ${world.displayName} carries ${localPower} additional Power from this Training path.`
        : `Characters from ${world.displayName} gain their first Training Power when this path opens.`),
      h('p', `Across the whole collection, the highest Training path now allows ${limits.storageCap} Field Supplies to be stored and ${limits.dailyUseCap} to be used each day. Training levels from different worlds do not add together.`)));
  }
  root.appendChild(h('section.facility-next', h('div.eyebrow', next ? 'The next level' : 'Development complete'),
    next ? h('div', h('p', `Construction takes ${next.buildDays ?? 1} day.`),
      h('p.caption', costText(store, world, next.cost)),
      h('button.btn.primary', { disabled: !!store.state.headquarters.construction,
        onclick: () => store.tx(() => startConstruction(store.content, store.state, world.id, facility.id)) }, `Build Level ${level + 1} →`))
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
