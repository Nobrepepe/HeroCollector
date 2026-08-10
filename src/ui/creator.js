// Content Creator: the game's entire playable content — worlds, characters,
// the Main Campaign, archives, and all art — is authored here and stored in
// the creator database. Worlds stay drafts until they meet the publish
// requirements; the game itself stays in setup mode until the content meets
// the minimum prerequisites for a playable save.
import { h, fmt } from './dom.js';
import { openModal, toast, render } from '../app.js';
import { auditArt, deleteOrphanArt, imageWell } from './images.js';
import { portraitSlot } from './shared.js';
import { artStorageAvailable, exportJson, importJson, loadSamplePack } from '../platform.js';
import {
  emptyCustomDB, upgradeCustomDB, newCustomWorld, newCustomCharacter,
  newCustomFaction, addCampaignChapter, canPublishWorld, canPublishChapterPair, characterShardAssignments,
  scaffoldWorldHq, sampleExpeditionLibrary, newCrisisDefinition, newId
} from '../core/custom.js';
import { RANDOM_MATERIAL } from '../core/resources.js';

export function renderCreator(store, root, arg) {
  const parts = (arg ?? '').split('/').filter(Boolean);
  root.classList.add('creator-screen');
  if (parts[0] === 'world' && parts[1]) return worldEditor(store, root, parts[1]);
  if (parts[0] === 'char' && parts[1]) return charEditor(store, root, parts[1]);
  if (parts[0] === 'main-chapter' && parts[1] !== undefined) return chapterEditor(store, root, 'main', Number(parts[1]));
  if (parts[0] === 'shadow-chapter' && parts[1] !== undefined) return chapterEditor(store, root, 'shadow', Number(parts[1]));
  if (parts[0] === 'expeditions') return expeditionEditor(store, root);
  // Compatibility with old creator hashes.
  if (parts[0] === 'chapter' && parts[1] !== undefined) return chapterEditor(store, root, 'main', Number(parts[1]));
  return overview(store, root);
}

// Persist the DB and re-merge content. Structural changes re-render the screen;
// text edits do not (so typing keeps focus).
async function commit(store, structural = false) {
  await store.saveCustom();
  const res = await store.applyCustom();
  if (structural) render();
  return res;
}

// ------------------------------------------------------------- field helpers
function field(label, control) {
  return [h('label', label), control];
}
function textInput(obj, key, store, { placeholder = '', maxlength = 60 } = {}) {
  const input = h('input', { type: 'text', value: obj[key] ?? '', placeholder, maxlength });
  input.addEventListener('change', () => { obj[key] = input.value; commit(store); });
  return input;
}
function textArea(obj, key, store) {
  const input = h('textarea', obj[key] ?? '');
  const grow = () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; };
  input.addEventListener('input', grow);
  input.addEventListener('change', () => { obj[key] = input.value; commit(store); });
  queueMicrotask(grow);
  return input;
}
function arrayInput(obj, key, store) {
  const input = h('input', { type: 'text', value: (obj[key] ?? []).join(', '), placeholder: 'id_one, id_two' });
  input.addEventListener('change', () => {
    obj[key] = input.value.split(',').map(value => value.trim()).filter(Boolean);
    commit(store, true);
  });
  return input;
}
function numInput(obj, key, store, { min = 0, step = 50 } = {}) {
  const input = h('input', { type: 'number', value: obj[key], min, step });
  input.addEventListener('change', () => { obj[key] = Math.max(min, Number(input.value) || 0); commit(store); });
  return input;
}
function selectInput(obj, key, store, options, { structural = false } = {}) {
  const sel = h('select');
  for (const [value, label] of options) {
    sel.appendChild(h('option', { value, selected: String(obj[key]) === String(value) }, label));
  }
  sel.addEventListener('change', () => {
    obj[key] = sel.value === '' ? null : sel.value;
    commit(store, structural);
  });
  return sel;
}
function colorInput(obj, key, store) {
  const input = h('input', { type: 'color', value: obj[key] ?? '#777777' });
  input.addEventListener('change', () => { obj[key] = input.value; commit(store); });
  return input;
}
function backLink(store, hash, label) {
  return h('button.link', { onclick: () => store.go(hash) }, `← ${label}`);
}
function rewardEntryLabel(entry) {
  return entry.id === RANDOM_MATERIAL
    ? `any ${entry.grade ?? 'basic'} material (drawn per offer)` : entry.id;
}
function familyGradeSelects(nd, store, content) {
  return [
    selectInput(nd, 'family', store, content.materialMeta.familyOrder.map(f => [f, content.materialMeta.families[f].name])),
    selectInput(nd, 'grade', store, content.materialMeta.gradeOrder.map(g => [g, content.materialMeta.grades[g].name]))
  ];
}

// ------------------------------------------------------------- overview
function overview(store, root) {
  const { customDB: db } = store;
  root.classList.add('creator-overview');

  root.appendChild(h('header.creator-title',
    h('div.eyebrow', 'Content Creator'),
    h('h1.display-s', store.gameReady.ready ? 'Your game is playable.' : `${store.gameReady.checks.filter(check => !check.ok).length} things left before your game can start.`),
    h('p.muted', `${db.worlds.length} worlds authored, ${db.characters.length} characters, ${db.mainChapters.length} chapter pairs.`)));

  // ---- game readiness
  const rp = h('div.panel');
  rp.appendChild(h('h2', store.gameReady.ready ? '✅ Game ready to play' : '◻️ Game readiness'));
  for (const c of store.gameReady.checks) {
    rp.appendChild(h('div.health-item' + (c.ok ? '.good' : '.warn'), `${c.ok ? '✅' : '◻️'} ${c.text}`));
  }
  root.appendChild(rp);

  // ---- health
  const hp = h('div.panel');
  hp.appendChild(h('h2', 'Content health'));
  if (store.contentHealth.length === 0) hp.appendChild(h('p.good.small', '✅ Everything in the creator database is live in the game.'));
  for (const item of store.contentHealth) {
    hp.appendChild(h('div.health-item' + ({ error: '.bad', warn: '.warn', info: '.muted' }[item.level] ?? ''), item.text));
  }
  // Art lives in art/ rather than in the database, so a reference can outlive
  // its file. Checking needs the filesystem, so the row fills in afterwards.
  if (artStorageAvailable) {
    const artRow = h('div.health-item.muted', 'Checking imported art…');
    hp.appendChild(artRow);
    auditArt(db).then(({ referenced, missing, orphans }) => {
      if (missing.length) {
        artRow.className = 'health-item bad';
        artRow.textContent = `${missing.length} image${missing.length === 1 ? ' is' : 's are'} missing from art/ — the reference is in the database but the file is not on disk. Restore it from version control, or re-import the image. First: ${missing[0]}`;
      } else {
        artRow.className = 'health-item good';
        artRow.textContent = `✅ All ${referenced.size} imported images resolve in art/${orphans.length ? ` · ${orphans.length} unused file${orphans.length === 1 ? '' : 's'} can be cleaned up below.` : '.'}`;
      }
    }).catch(() => artRow.remove());
  }
  root.appendChild(hp);

  // ---- worlds
  const wp = h('div.panel.creator-worlds-panel');
  wp.appendChild(h('h2', 'Worlds'));
  if (db.worlds.length === 0) {
    wp.appendChild(h('p.muted.small', 'No worlds yet. Create one from scratch, or import the sample worlds below as an editable starting point.'));
  }
  const worldGrid = h('div.creator-world-grid');
  for (const w of db.worlds) {
    const gate = canPublishWorld(db, w.id);
    const row = h('div.creator-list-row.creator-world-card' + (w.image ? '' : '.art-fallback'), {
      style: w.image ? { backgroundImage: `url("${w.image}")` } : {}
    });
    row.appendChild(h('span', { style: { fontSize: '1.4rem' } }, w.icon));
    row.appendChild(h('div.grow',
      h('div', h('b', w.displayName), ' ', h('span.badge.' + w.status, w.status.toUpperCase())),
      h('div.small.muted', `${db.characters.filter(c => c.worldId === w.id).length} characters` + (w.status === 'draft' && !gate.ok ? ` — ${gate.reasons[0]}` : ''))));
    row.appendChild(h('button.btn.tiny.primary', { onclick: () => store.go(`#/creator/world/${w.id}`) }, 'Edit'));
    worldGrid.appendChild(row);
  }
  wp.appendChild(worldGrid);
  wp.appendChild(h('button.btn.primary', {
    style: { marginTop: '10px' },
    onclick: () => promptName('New world name', name => {
      const w = newCustomWorld(name);
      db.worlds.push(w);
      commit(store, false).then(() => store.go(`#/creator/world/${w.id}`));
    })
  }, '+ New World'));
  root.appendChild(wp);

  // ---- paired campaigns
  const cp = h('div.panel');
  cp.appendChild(h('h2', 'Main & Shadow Campaigns'));
  cp.appendChild(h('p.small.muted', 'Chapters are added in pairs of 10 corresponding nodes. Main is material-focused; every Shadow node needs a character and unlocks when its matching Main node is cleared.'));
  if (db.mainChapters.length === 0) {
    cp.appendChild(h('p.warn.small', 'No campaign chapters yet — the game needs at least one complete pair to start.'));
  }
  db.mainChapters.forEach((ch, i) => {
    const shadow = db.shadowChapters[i];
    const shardChars = (shadow?.nodes ?? []).map(nd => {
      const c = db.characters.find(x => x.id === nd.shardCharacterId);
      return c ? c.displayName : '—';
    });
    const row = h('div.creator-list-row');
    const pairStatus = ch.status ?? 'published';
    const gate = canPublishChapterPair(db, i);
    row.appendChild(h('div.grow',
      h('div', h('b', ch.title || `Main Chapter ${i + 1}`), ' ', h('span.badge.' + pairStatus, pairStatus.toUpperCase()), h('span.small.muted', ` — nodes ${i * 10 + 1}–${i * 10 + 10}`)),
      h('div.small.muted', `Shadow assignments: ${shardChars.filter(x => x !== '—').length}/10${!gate.ok ? ` · ${gate.reasons[0]}` : ''}`)));
    row.appendChild(h('div.chapter-dots',
      h('div', h('span.caption', 'Main'), ...ch.nodes.map(() => h('i.filled'))),
      h('div', h('span.caption', 'Shadow'), ...(shadow?.nodes ?? []).map(node => h('i' + (node.shardCharacterId ? '.assigned' : ''))))));
    row.appendChild(h('button.btn.tiny.primary', { onclick: () => store.go(`#/creator/main-chapter/${i}`) }, 'Edit Main'));
    row.appendChild(h('button.btn.tiny.primary', { onclick: () => store.go(`#/creator/shadow-chapter/${i}`) }, 'Edit Shadow'));
    if (pairStatus === 'draft') row.appendChild(h('button.btn.tiny.primary', {
      disabled: !gate.ok,
      onclick: async () => {
        ch.status = 'published';
        shadow.status = 'published';
        const result = await commit(store, true);
        toast(result.ok ? `Chapter Pair ${i + 1} published.` : 'Chapter could not be published; see Content health.', result.ok ? 'info' : 'error');
      }
    }, 'Publish Pair'));
    else row.appendChild(h('button.btn.tiny', { onclick: async () => {
      ch.status = 'draft'; shadow.status = 'draft'; await commit(store, true);
    } }, 'Move to Draft'));
    if (i === db.mainChapters.length - 1) {
      row.appendChild(h('button.btn.tiny.danger', {
        onclick: () => confirmModal(store, `Delete Main & Shadow Chapter ${i + 1}?`, 'Both paired chapters are removed. Characters whose only shard source is this Shadow chapter become unacquirable.', () => {
          db.mainChapters.pop();
          db.shadowChapters.pop();
          commit(store, true);
        })
      }, 'Delete'));
    }
    cp.appendChild(row);
  });
  cp.appendChild(h('button.btn.primary', {
    style: { marginTop: '10px' },
    onclick: () => {
      const idx = addCampaignChapter(db);
      commit(store, false).then(() => store.go(`#/creator/main-chapter/${idx}`));
    }
  }, '+ New Paired Chapter'));
  root.appendChild(cp);

  const ep = h('div.panel');
  ep.appendChild(h('h2', 'Expedition library'));
  ep.appendChild(h('p.small.muted', `${db.expeditions.templates.length} templates · ${db.expeditions.rewardPackages.length} reward packages · ${db.expeditions.requirements.length} requirements.`));
  ep.appendChild(h('button.btn.primary', { onclick: () => store.go('#/creator/expeditions') }, 'Edit Expeditions →'));
  if (!db.expeditions.templates.length && db.worlds.length) ep.appendChild(h('button.btn', {
    onclick: () => { db.expeditions = sampleExpeditionLibrary(db.worlds); commit(store, true); }
  }, 'Add starter Expedition library'));
  root.appendChild(ep);

  // ---- database tools
  const tp = h('div.panel');
  tp.appendChild(h('h2', 'Creator database'));
  tp.appendChild(h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
    h('button.btn', {
      onclick: async () => {
        const pack = upgradeCustomDB(await loadSamplePack());
        const doImport = async () => {
          store.customDB = pack;
          const res = await commit(store, true);
          toast(res.ok ? 'Sample worlds imported — everything in them is yours to edit.' : 'Imported, but see Content health.', res.ok ? 'info' : 'error');
        };
        if (db.worlds.length > 0 || db.mainChapters.length > 0) {
          confirmModal(store, 'Replace your content with the sample worlds?', 'Your current creator database is replaced. Export it first if you want a backup.', doImport);
        } else {
          doImport();
        }
      }
    }, 'Import sample worlds…'),
    h('button.btn', { onclick: () => exportJson(store.customDB, 'hero-collector-content-pack.json').then(ok => ok && toast('Content pack exported.')) }, 'Export content pack…'),
    h('button.btn', {
      onclick: async () => {
        const imported = await importJson();
        if (!imported) { toast('Import canceled or unreadable.', 'error'); return; }
        confirmModal(store, 'Replace creator database?', 'Your current creations are replaced by the imported content pack. Export first if you want a backup.', async () => {
          store.customDB = upgradeCustomDB(imported);
          const res = await commit(store, true);
          toast(res.ok ? 'Content pack imported.' : 'Imported, but it could not be fully applied — see Content health.', res.ok ? 'info' : 'error');
        });
      }
    }, 'Import content pack…'),
    artStorageAvailable ? h('button.btn', {
      onclick: async () => {
        const { orphans } = await auditArt(db);
        if (!orphans.length) { toast('No unused art — every file in art/ is still in use.'); return; }
        confirmModal(store,
          `Delete ${orphans.length} unused image${orphans.length === 1 ? '' : 's'}?`,
          `${orphans.length} file${orphans.length === 1 ? '' : 's'} in art/ ${orphans.length === 1 ? 'is' : 'are'} no longer referenced by any world, character, chapter or Crisis — usually art that was replaced or removed. Nothing currently in use is touched.`,
          async () => {
            const removed = await deleteOrphanArt(db);
            toast(`Removed ${removed} unused image${removed === 1 ? '' : 's'} from art/.`);
            render();
          });
      }
    }, 'Clean unused art…') : null,
    h('button.btn.danger', {
      onclick: () => confirmModal(store, 'Delete ALL creator content?', 'Every world, character, chapter, and imported image is removed and the game returns to setup mode. Imported art files stay in art/ until you run “Clean unused art…”. This cannot be undone.', async () => {
        store.customDB = emptyCustomDB();
        await commit(store, true);
        toast('Creator database reset.');
      })
    }, 'Reset creator data…')));
  root.insertBefore(tp, rp);
}

function promptName(title, onDone) {
  openModal((modal, close) => {
    modal.appendChild(h('h2', title));
    const input = h('input', { type: 'text', maxlength: 40, style: { width: '100%' } });
    modal.appendChild(input);
    const go = () => { const v = input.value.trim(); if (v) { close(); onDone(v); } };
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); });
    modal.appendChild(h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
      h('button.btn.primary', { onclick: go }, 'Create'),
      h('button.btn', { onclick: close }, 'Cancel')));
    setTimeout(() => input.focus(), 50);
  });
}

function confirmModal(store, title, warning, onConfirm) {
  openModal((modal, close) => {
    modal.appendChild(h('h2', title));
    modal.appendChild(h('p.warn', warning));
    modal.appendChild(h('div', { style: { display: 'flex', gap: '8px' } },
      h('button.btn.danger', { onclick: () => { close(); onConfirm(); } }, 'Yes, do it'),
      h('button.btn.primary', { onclick: close }, 'Cancel')));
  });
}

function expeditionEditor(store, root) {
  const lib = store.customDB.expeditions;
  lib.images ??= { global: null, worlds: {} };
  lib.images.worlds ??= {};
  root.appendChild(backLink(store, '#/creator', 'Content Creator'));
  root.appendChild(h('header.creator-title', h('div.eyebrow', 'Procedural content'),
    h('h1.display-s', 'Expeditions are assembled here.'),
    h('p.muted', 'Templates choose requirements, rewards, duration and prose; the board generator persists the assembled result.')));
  const artwork = h('div.panel', h('h2', 'Offer artwork'),
    h('p.small.muted', 'These portrait images use the exact aspect ratio of the player-facing offer containers. Across worlds is used for global offers; world artwork is used for offers associated with that world.'));
  artwork.appendChild(h('div.wells.expedition-art-wells',
    imageWell('expedition', 'Across worlds offer image (33:43)',
      () => lib.images.global,
      value => { lib.images.global = value; },
      () => commit(store, true)),
    ...store.customDB.worlds.map(world => imageWell('expedition', `${world.displayName} offer image (33:43)`,
      () => lib.images.worlds[world.id],
      value => { lib.images.worlds[world.id] = value; },
      () => commit(store, true)))));
  root.appendChild(artwork);
  const settings = h('div.panel', h('h2', 'Generation settings'));
  const sg = h('div.form-grid');
  for (const [key, label] of [['offerCount', 'Offers per board'], ['slotCount', 'Active slots'], ['freeRerolls', 'Free rerolls'], ['minimumFeasible', 'Minimum feasible'], ['maxLongOffers', 'Long-offer limit'], ['generationAttempts', 'Attempt limit']]) {
    sg.append(...field(label, numInput(lib.settings, key, store, { min: 0, step: 1 })));
  }
  const supplySelect = h('select', { 'aria-label': 'Guaranteed Field Supply template' },
    h('option', { value: '', selected: !lib.settings.guaranteedSupplyTemplateId }, '— none configured —'),
    lib.templates.map(template => h('option', { value: template.id, selected: template.id === lib.settings.guaranteedSupplyTemplateId }, template.titles?.[0] ?? template.id)));
  supplySelect.addEventListener('change', () => {
    lib.settings.guaranteedSupplyTemplateId = supplySelect.value || null;
    const template = lib.templates.find(item => item.id === supplySelect.value);
    if (template) {
      template.durations = [1];
      template.fixedRewards = [{ kind: 'resource', id: 'field_supply', qty: 1 }];
    }
    commit(store, true);
  });
  sg.append(...field('Guaranteed Field Supply template', supplySelect));
  settings.appendChild(sg); root.appendChild(settings);

  const guaranteed = lib.templates.find(template => template.id === lib.settings.guaranteedSupplyTemplateId);
  if (guaranteed) {
    const supplyEditor = h('div.panel', h('h2', 'Guaranteed Supply route'),
      h('p.small.muted', 'This route is fixed to one game day and exactly one unscaled Field Supply. Its secondary package still follows the result tier.'));
    const grid = h('div.form-grid');
    const title = h('input', { type: 'text', value: guaranteed.titles?.[0] ?? '', maxlength: 80 });
    title.addEventListener('change', () => { guaranteed.titles = [title.value]; commit(store); });
    const description = h('textarea', guaranteed.descriptions?.[0] ?? '');
    description.addEventListener('change', () => { guaranteed.descriptions = [description.value]; commit(store); });
    grid.append(...field('Offer title', title));
    grid.append(...field('Description', description));
    grid.append(...field('Associated world', selectInput(guaranteed, 'world', store,
      [['', 'Across worlds'], ['@any', 'Any published world'], ...store.customDB.worlds.map(world => [world.id, world.displayName])], { structural: true })));
    grid.append(...field('Party size', numInput(guaranteed, 'partySize', store, { min: 1, step: 1 })));
    grid.append(...field('Mandatory requirement IDs', arrayInput(guaranteed, 'requirementIds', store)));
    grid.append(...field('Optional objective IDs', arrayInput(guaranteed, 'optionalIds', store)));
    grid.append(...field('Secondary reward package', selectInput(guaranteed, 'rewardPackageId', store,
      lib.rewardPackages.map(pack => [pack.id, pack.displayName || pack.id]))));
    supplyEditor.appendChild(grid); root.appendChild(supplyEditor);
  }

  const req = h('div.panel', h('h2', 'Requirement definitions'));
  for (const item of [...lib.requirements, ...lib.optionalObjectives]) {
    req.appendChild(h('div.creator-list-row',
      h('span.caption', item.id), h('span', item.type),
      h('div.grow', textInput(item, 'text', store, { maxlength: 140 })),
      'count' in item ? numInput(item, 'count', store, { min: 1, step: 1 }) : null));
  }
  root.appendChild(req);

  const rewards = h('div.panel', h('h2', 'Reward packages'));
  for (const pack of lib.rewardPackages) {
    rewards.appendChild(h('h3', pack.displayName || pack.id));
    for (const entry of pack.entries) rewards.appendChild(h('div.creator-list-row',
      h('span.caption', `${entry.kind} · ${rewardEntryLabel(entry)}`),
      h('span', 'minimum'), numInput(entry, 'min', store, { min: 0, step: 1 }),
      h('span', 'maximum'), numInput(entry, 'max', store, { min: 0, step: 1 })));
  }
  root.appendChild(rewards);

  const templates = h('div.panel', h('h2', 'Expedition templates'));
  for (const template of lib.templates) {
    const row = h('div.creator-list-row');
    row.append(h('span.caption', template.id), h('div.grow',
      h('div', template.titles?.[0] ?? 'Untitled'),
      h('div.caption', `${template.world ?? 'global'} · ${template.partySize} characters · ${template.durations.join('/')} day`),
      template.fixedRewards?.length ? h('div.good.small', 'Fixed reward · one Field Supply, never multiplied') : null),
    numInput(template, 'weight', store, { min: 1, step: 1 }),
    selectInput(template, 'rewardPackageId', store, lib.rewardPackages.map(p => [p.id, p.displayName || p.id])));
    templates.appendChild(row);
  }
  root.appendChild(templates);

  const reports = h('div.panel', h('h2', 'Return prose'));
  for (const tier of ['completed', 'successful', 'exceptional']) {
    reports.appendChild(h('h3', tier));
    lib.reports[tier].forEach((text, index) => {
      const area = h('textarea', text);
      area.addEventListener('change', () => { lib.reports[tier][index] = area.value; commit(store); });
      reports.appendChild(area);
    });
  }
  root.appendChild(reports);
}

// ------------------------------------------------------------- world editor
function worldEditor(store, root, worldId) {
  const { customDB: db } = store;
  const w = db.worlds.find(x => x.id === worldId);
  if (!w) { root.appendChild(h('p.bad', 'Unknown world.')); return; }
  root.classList.add('creator-world');
  // The banner is the top of the screen; the back link rides on top of it.
  root.appendChild(h('header.creator-world-hero' + (w.image ? '' : '.art-fallback'), {
    style: w.image ? { backgroundImage: `url("${w.image}")` } : {}
  }, backLink(store, '#/creator', 'Content Creator'),
  h('div.creator-world-hero-copy',
    h('div.eyebrow', w.status), h('h1.display-m', w.displayName), h('p', w.tagline))));

  // ---- identity & status
  const idp = h('div.panel');
  idp.appendChild(h('h2', w.displayName, ' ', h('span.badge.' + w.status, w.status.toUpperCase())));
  const grid = h('div.form-grid');
  grid.append(...field('Name', textInput(w, 'displayName', store)));
  grid.append(...field('Tagline', textInput(w, 'tagline', store, { maxlength: 120 })));
  grid.append(...field('Icon (emoji)', textInput(w, 'icon', store, { maxlength: 4 })));
  grid.append(...field('Primary color', colorInput(w.palette, 'primary', store)));
  grid.append(...field('Accent color', colorInput(w.palette, 'accent', store)));
  grid.append(...field('Dark color', colorInput(w.palette, 'dark', store)));
  idp.appendChild(grid);
  const worldArtwork = h('div.wells.world-artwork-wells', { style: { marginTop: '12px' } },
    imageWell('world', 'World banner (16:9)', () => w.image, v => { w.image = v; }, () => commit(store, true)),
    imageWell('hq', 'Headquarters image (16:9)', () => w.hqImage, v => { w.hqImage = v; }, () => commit(store, true)));
  for (const facility of w.hq?.facilities ?? []) {
    worldArtwork.appendChild(imageWell('facility', `${facility.displayName} building image (16:9)`,
      () => facility.image,
      value => { facility.image = value; },
      () => commit(store, true)));
  }
  idp.appendChild(worldArtwork);

  const gate = canPublishWorld(db, w.id);
  idp.appendChild(h('div.publish-path',
    h('div.publish-station.done', h('i'), h('span', 'A world with a name'), h('small', w.displayName ? 'done' : 'still missing')),
    h('div.publish-station' + (db.characters.filter(c => c.worldId === w.id).length >= 5 ? '.done' : '.blocking'),
      h('i'), h('span', 'Five characters written'), h('small', `${db.characters.filter(c => c.worldId === w.id).length} of 5`)),
    h('div.publish-station' + (gate.ok ? '.done' : '.blocking'), h('i'), h('span', 'Every one findable'),
      h('small', gate.ok ? 'done' : gate.reasons.at(-1) ?? 'still missing'))));
  const statusRow = h('div', { style: { marginTop: '14px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } });
  if (w.status === 'draft') {
    statusRow.appendChild(h('button.btn.primary', {
      disabled: !gate.ok,
      onclick: async () => {
        w.status = 'published';
        const res = await commit(store, true);
        toast(res.ok ? `${w.displayName} is now in the game!` : 'Published, but held back — see Content health.', res.ok ? 'info' : 'error');
      }
    }, 'Publish into the game'));
    if (!gate.ok) statusRow.appendChild(h('div.small.warn', gate.reasons.map(r => h('div', r))));
  } else {
    statusRow.appendChild(h('button.btn', {
      onclick: () => confirmModal(store, `Unpublish “${w.displayName}”?`,
        'The world leaves the game while you edit it. Owned characters and progress go dormant and return when you republish.',
        async () => { w.status = 'draft'; await commit(store, true); })
    }, 'Unpublish (back to draft)'));
  }
  statusRow.appendChild(h('button.btn.danger', {
    onclick: () => confirmModal(store, `Delete “${w.displayName}” permanently?`,
      'The world, its characters, campaign, archive, and imported images are removed from the creator database. This cannot be undone.',
      async () => {
        db.worlds = db.worlds.filter(x => x.id !== w.id);
        const removedChars = new Set(db.characters.filter(c => c.worldId === w.id).map(c => c.id));
        db.characters = db.characters.filter(c => c.worldId !== w.id);
        for (const ch of db.shadowChapters) for (const nd of ch.nodes) if (removedChars.has(nd.shardCharacterId)) nd.shardCharacterId = null;
        for (const wx of db.worlds) for (const nd of wx.campaignNodes) if (removedChars.has(nd.shardCharacterId)) nd.shardCharacterId = null;
        await commit(store, false);
        store.go('#/creator');
      })
  }, 'Delete world'));
  idp.appendChild(statusRow);
  root.appendChild(idp);

  const hqp = h('div.panel');
  hqp.appendChild(h('h2', 'World Headquarters'));
  const ag = h('div.form-grid');
  ag.append(...field('World Asset name', textInput(w.worldAsset, 'displayName', store)));
  ag.append(...field('World Asset description', textInput(w.worldAsset, 'description', store, { maxlength: 140 })));
  ag.append(...field('World Asset icon', textInput(w.worldAsset, 'icon', store, { maxlength: 4 })));
  hqp.appendChild(ag);
  if (!w.hq) {
    hqp.appendChild(h('p.muted', 'This world has no Headquarters configuration. Existing worlds stay opt-in.'));
    hqp.appendChild(h('button.btn.primary', { onclick: () => { scaffoldWorldHq(w); commit(store, true); } }, 'Set up Headquarters →'));
  } else {
    hqp.appendChild(h('div.wells',
      ...[0, 1, 2].map(index => imageWell('hq', `HQ Rank ${index + 1} background`,
        () => w.hq.backgrounds[index], value => { w.hq.backgrounds[index] = value; }, () => commit(store, true)))));
    w.hq.facilities.forEach(facility => {
      hqp.appendChild(h('div.creator-list-row',
        h('div.grow', textInput(facility, 'displayName', store), textInput(facility, 'description', store, { maxlength: 140 })),
        h('span.caption', `${facility.category} · ${facility.levels.length} levels`)));
    });
  }
  root.appendChild(hqp);

  root.appendChild(crisisAuthoringPanel(store, w));

  // ---- characters
  root.appendChild(characterListPanel(store, w.id));

  // ---- world campaign nodes
  const np = h('div.panel');
  np.appendChild(h('h2', 'World Campaign — 3 chapters × 10 nodes'));
  np.appendChild(h('p.small.muted', 'All nodes require a full party from this world. Optionally assign one of this world’s characters as a shard drop; that node then allows five runs per day. First clears still award Archive fragments.'));
  const worldShardOptions = [
    ['', '— material only —'],
    ...db.characters.filter(c => c.worldId === w.id).map(c => [c.id, `${c.displayName} shards`])
  ];
  for (let ch = 0; ch < 3; ch++) {
    np.appendChild(h('h3', `Chapter ${ch + 1}`));
    const chapterTitle = h('input', {
      type: 'text',
      value: w.campaignChapterTitles?.[ch] ?? '',
      placeholder: `${w.displayName} · Chapter ${ch + 1}`,
      maxlength: 60,
      'aria-label': `Chapter ${ch + 1} name`
    });
    chapterTitle.addEventListener('change', () => {
      w.campaignChapterTitles ??= ['', '', ''];
      w.campaignChapterTitles[ch] = chapterTitle.value;
      commit(store);
    });
    np.appendChild(h('div.chapter-name-field', h('label', 'Chapter name'), chapterTitle));
    np.appendChild(imageWell('chapter', `Chapter ${ch + 1} key art (16:9)`,
      () => w.campaignChapterImages[ch],
      value => { w.campaignChapterImages[ch] = value; },
      () => commit(store, true)));
    for (let i = 0; i < 10; i++) {
      const nd = w.campaignNodes[ch * 10 + i];
      const row = h('div.node-edit-row.world');
      row.appendChild(h('span.muted.small', String(ch * 10 + i + 1)));
      row.appendChild(textInput(nd, 'name', store));
      row.appendChild(numInput(nd, 'threshold', store, { min: 0 }));
      row.append(...familyGradeSelects(nd, store, store.content));
      row.appendChild(selectInput(nd, 'shardCharacterId', store, worldShardOptions, { structural: true }));
      row.appendChild(h('span.small.muted', `relic ${Math.floor((ch * 10 + i) / 2) + 1}`));
      np.appendChild(row);
    }
  }
  root.appendChild(np);

  // ---- archive
  const ap = h('div.panel');
  ap.appendChild(h('h2', 'World Archive — 3 collections × 5 relics'));
  const chars = db.characters.filter(c => c.worldId === w.id);
  const skinCharOptions = [['', '— choose character —'], ...chars.filter(c => c.skins?.length).map(c => [c.id, c.displayName])];
  const rewardFields = (reward, label) => {
    reward ??= { characterId: null, skinId: null };
    const character = chars.find(c => c.id === reward.characterId);
    if (reward.skinId && !character?.skins?.some(skin => skin.id === reward.skinId)) reward.skinId = null;
    const fields = h('div.form-grid');
    const characterSelect = h('select');
    for (const [value, text] of skinCharOptions) characterSelect.appendChild(h('option', {
      value, selected: String(reward.characterId ?? '') === String(value)
    }, text));
    characterSelect.addEventListener('change', () => {
      reward.characterId = characterSelect.value || null;
      reward.skinId = null;
      commit(store, true);
    });
    fields.append(...field(`${label} character`, characterSelect));
    fields.append(...field(`${label} skin`, selectInput(reward, 'skinId', store,
      [['', character ? '— choose skin —' : '— choose a character first —'], ...(character?.skins ?? []).map(skin => [skin.id, skin.name])],
      { structural: true })));
    return fields;
  };
  w.archive.collections.forEach((col, c) => {
    ap.appendChild(h('h3', `Collection ${c + 1}`));
    const cg = h('div.form-grid');
    cg.append(...field('Collection name', textInput(col, 'name', store)));
    col.rewardSkin ??= { characterId: null, skinId: null };
    ap.appendChild(cg);
    ap.appendChild(rewardFields(col.rewardSkin, 'Reward'));
    const shelf = h('div.wells', { style: { marginTop: '8px' } });
    col.relics.forEach((relic, r) => {
      const cell = h('div', { style: { width: '200px' } });
      cell.appendChild(textInput(relic, 'name', store));
      cell.appendChild(imageWell('relic', `Relic ${c * 5 + r + 1} art (16:9)`, () => relic.image, v => { relic.image = v; }, () => commit(store, true)));
      const loreArea = textArea(relic, 'lore', store);
      loreArea.placeholder = 'Lore entry…';
      cell.appendChild(loreArea);
      shelf.appendChild(cell);
    });
    ap.appendChild(shelf);
  });
  ap.appendChild(h('h3', 'Full-Archive skin'));
  w.archive.fullSkin ??= { characterId: null, skinId: null };
  ap.appendChild(rewardFields(w.archive.fullSkin, 'Reward'));
  root.appendChild(ap);
}

function crisisAuthoringPanel(store, world) {
  const library = store.customDB.crises;
  const panel = h('div.panel.creator-crises', h('h2', 'Crises'),
    h('p.small.muted', 'Crises are optional, deterministic roster puzzles for this world. Each live definition needs at least three authored Fronts.'));
  const definitions = library.definitions.filter(definition => definition.worldId === world.id);
  for (const definition of definitions) {
    const details = h('details.crisis-authoring');
    details.appendChild(h('summary', `${definition.name} · ${definition.enabled === false ? 'disabled' : `${definition.fronts.length} Fronts`}`));
    const grid = h('div.form-grid');
    grid.append(...field('Name', textInput(definition, 'name', store)));
    grid.append(...field('Opening description', textArea(definition, 'openingDescription', store)));
    grid.append(...field('Weight', numInput(definition, 'weight', store, { min: 1, step: 1 })));
    grid.append(...field('Minimum cleared world nodes', numInput(definition, 'minimumClearedNodes', store, { min: 0, step: 1 })));
    grid.append(...field('Consolation Renown', numInput(definition.consolationReward[0], 'qty', store, { min: 1, step: 1 })));
    grid.append(...field('Mastery boon', selectInput(definition.boon, 'type', store, [
      ['free_world_node_runs', 'Free world node runs'], ['bonus_world_material_runs', 'Bonus world materials'],
      ['world_expedition_renown_bp', 'World Expedition Renown'], ['next_hq_production_bp', 'Next HQ production'],
      ['instant_intelligence', 'Instant Intelligence']
    ], { structural: true })));
    grid.append(...field('Boon prose', textInput(definition.boon, 'prose', store, { maxlength: 140 })));
    grid.append(...field('Boon runs', numInput(definition.boon, 'runs', store, { min: 0, step: 1 })));
    grid.append(...field('Boon quantity', numInput(definition.boon, 'qty', store, { min: 0, step: 1 })));
    grid.append(...field('Boon basis points', numInput(definition.boon, 'bonusBp', store, { min: 0, step: 100 })));
    details.appendChild(grid);
    details.appendChild(imageWell('crisis', 'Optional Crisis key art (16:9)', () => definition.artwork,
      value => { definition.artwork = value; }, () => commit(store, true)));
    definition.fronts.forEach((front, index) => {
      const row = h('div.crisis-front-editor', h('h3', `Front ${index + 1}`));
      const fg = h('div.form-grid');
      fg.append(...field('Name', textInput(front, 'name', store)));
      fg.append(...field('Description', textInput(front, 'description', store, { maxlength: 140 })));
      fg.append(...field('Favored IDs (one or two)', arrayInput(front, 'favoredTagIds', store)));
      for (const grade of library.settings.grades) fg.append(...field(`${grade.displayName} Power`, numInput(front.recommendedPowerByGrade, grade.id, store, { min: 1, step: 50 })));
      fg.append(...field('Struggle prose', textInput(front, 'struggleText', store, { maxlength: 140 })));
      fg.append(...field('Success prose', textInput(front, 'successText', store, { maxlength: 140 })));
      fg.append(...field('Excel prose', textInput(front, 'excelText', store, { maxlength: 140 })));
      row.appendChild(fg);
      if (definition.fronts.length > 3) row.appendChild(h('button.btn.tiny.danger', {
        onclick: () => { definition.fronts.splice(index, 1); commit(store, true); }
      }, 'Delete Front'));
      details.appendChild(row);
    });
    details.appendChild(h('h3', 'Emergency Cache choices'));
    definition.cacheChoices.forEach(choice => details.appendChild(h('div.creator-list-row',
      h('div.grow', textInput(choice, 'name', store), textInput(choice, 'description', store, { maxlength: 140 })),
      h('span.caption', choice.rewards[0]?.id ?? 'reward'), choice.rewards[0]
        ? numInput(choice.rewards[0], 'qty', store, { min: 1, step: 1 }) : null)));
    details.appendChild(h('div.creator-row-actions',
      h('button.btn.tiny', { onclick: () => {
        const source = definition.fronts.at(-1);
        definition.fronts.push({ ...structuredClone(source), id: `${definition.id}_front_${Date.now().toString(36)}`, name: 'New Front' });
        commit(store, true);
      } }, 'Add Front'),
      h('button.btn.tiny', { onclick: () => { definition.enabled = definition.enabled === false; commit(store, true); } }, definition.enabled === false ? 'Enable' : 'Disable'),
      h('button.btn.tiny', { onclick: () => {
        const copy = structuredClone(definition);
        copy.id = `${definition.id}_copy_${Date.now().toString(36)}`;
        copy.name = `${definition.name} Copy`;
        copy.fronts.forEach((front, index) => { front.id = `${copy.id}_front_${index + 1}`; });
        copy.cacheChoices.forEach((choice, index) => { choice.id = `${copy.id}_cache_${index + 1}`; });
        library.definitions.push(copy); commit(store, true);
      } }, 'Duplicate'),
      h('button.btn.tiny.danger', { onclick: () => confirmModal(store, `Delete “${definition.name}”?`,
        'The authored Crisis is removed. An active occurrence expires without penalty when content synchronizes.', () => {
          library.definitions = library.definitions.filter(item => item.id !== definition.id); commit(store, true);
        }) }, 'Delete')));
    panel.appendChild(details);
  }
  panel.appendChild(h('button.btn.primary', { onclick: () => {
    library.definitions.push(newCrisisDefinition(world)); commit(store, true);
  } }, 'Create Crisis →'));
  return panel;
}

function characterListPanel(store, worldId) {
  const { customDB: db } = store;
  const chars = db.characters.filter(c => c.worldId === worldId);
  const panel = h('div.panel');
  panel.appendChild(h('h2', `Characters (${chars.length})`));
  panel.appendChild(h('p.small.muted', 'A world needs at least 5 characters to be published, and each character needs a live shard source in a complete Shadow chapter or this World Campaign. Mark 5 Minor characters as “starting” somewhere in your game so a new save can begin.'));
  for (const c of chars) {
    const sources = characterShardAssignments(db, c.id);
    const row = h('div.creator-list-row');
    row.appendChild(portraitSlot({
      src: c.portrait, color: c.color, glyph: c.glyph,
      alt: c.displayName, size: 'creator'
    }));
    row.appendChild(h('div.grow',
      h('div', h('b', c.displayName),
        h('span.small.muted', ` · ${store.content.archetypes[c.archetype]?.name ?? c.archetype} · ${c.tier}`),
        c.starting ? h('span.chip', '⭐ starting') : null),
      sources.length > 0
        ? h('div.small.good', `Shard sources: ${sources.map(s => `Ch.${s.chapter} node ${s.position}`).join(', ')}`)
        : h('div.small.warn', 'No shard source yet — assign one in Shadow or this World Campaign')));
    row.appendChild(h('button.btn.tiny.primary', { onclick: () => store.go(`#/creator/char/${c.id}`) }, 'Edit'));
    row.appendChild(h('button.btn.tiny.danger', {
      onclick: () => confirmModal(store, `Delete ${c.displayName}?`,
        'The character and their imported images are removed from the creator database. Their shard nodes revert to unassigned.',
        async () => {
          db.characters = db.characters.filter(x => x.id !== c.id);
          for (const world of db.worlds) {
            for (const collection of world.archive.collections) if (collection.rewardSkin?.characterId === c.id) collection.rewardSkin = { characterId: null, skinId: null };
            if (world.archive.fullSkin?.characterId === c.id) world.archive.fullSkin = { characterId: null, skinId: null };
          }
          for (const ch of db.shadowChapters) for (const nd of ch.nodes) if (nd.shardCharacterId === c.id) nd.shardCharacterId = null;
          for (const wx of db.worlds) for (const nd of wx.campaignNodes) if (nd.shardCharacterId === c.id) nd.shardCharacterId = null;
          const world = db.worlds.find(x => x.id === worldId);
          if (world && world.status === 'published' && db.characters.filter(x => x.worldId === worldId).length < 5) {
            world.status = 'draft';
            toast(`${world.displayName} dropped below 5 characters and went back to draft.`, 'error');
          }
          await commit(store, true);
        })
    }, 'Delete'));
    panel.appendChild(row);
  }
  panel.appendChild(h('button.btn.primary', {
    style: { marginTop: '10px' },
    onclick: () => promptName('New character name', name => {
      const c = newCustomCharacter(worldId, name, store.content.characterMeta.slotOrder, store.content.characterMeta.slots);
      db.characters.push(c);
      commit(store, false).then(() => store.go(`#/creator/char/${c.id}`));
    })
  }, '+ New Character'));
  return panel;
}

// ------------------------------------------------------------- character editor
function charEditor(store, root, charId) {
  const { customDB: db, content } = store;
  const c = db.characters.find(x => x.id === charId);
  if (!c) { root.appendChild(h('p.bad', 'Unknown character.')); return; }
  root.classList.add('creator-character');
  root.appendChild(backLink(store, `#/creator/world/${c.worldId}`, 'world'));

  const idp = h('div.panel');
  idp.appendChild(h('h2', c.displayName, c.starting ? h('span.chip', '⭐ starting') : null));
  const grid = h('div.form-grid');
  grid.append(...field('Name', textInput(c, 'displayName', store)));
  grid.append(...field('Glyph (fallback letter)', textInput(c, 'glyph', store, { maxlength: 2 })));
  grid.append(...field('Color', colorInput(c, 'color', store)));
  grid.append(...field('Archetype', selectInput(c, 'archetype', store,
    Object.entries(content.archetypes).map(([id, a]) => [id, `${a.icon} ${a.name}`]))));
  const tierSel = h('select');
  for (const [value, label] of [['minor', 'Minor — unlock at 1★ (10 shards)'], ['medium', 'Medium — unlock at 4★ (110 shards)'], ['major', 'Major — unlock at 7★ (450 shards)']]) {
    tierSel.appendChild(h('option', { value, selected: c.tier === value }, label));
  }
  tierSel.addEventListener('change', () => {
    c.tier = tierSel.value;
    if (c.tier !== 'minor' && c.starting) {
      c.starting = false;
      toast('Only Minor characters can be starting characters — flag cleared.');
    }
    commit(store, true);
  });
  grid.append(...field('Acquisition tier', tierSel));

  const startCb = h('input', { type: 'checkbox', checked: !!c.starting, disabled: c.tier !== 'minor' });
  startCb.addEventListener('change', () => { c.starting = startCb.checked; commit(store, true); });
  grid.append(...field('Starting character', h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
    startCb, h('span.small.muted', c.tier === 'minor' ? 'Granted at 1★ when a new game starts (needs 5 total).' : 'Only Minor characters can start owned.'))));

  const factionOptions = [
    ['', '— no faction —'],
    ...db.factions.map(f => [f.id, f.displayName])
  ];
  const factionSel = selectInput(c, 'faction', store, factionOptions);
  const factionRow = h('div', { style: { display: 'flex', gap: '6px' } }, factionSel,
    h('button.btn.tiny', {
      onclick: () => promptName('New faction name', name => {
        const f = newCustomFaction(name);
        db.factions.push(f);
        c.faction = f.id;
        commit(store, true);
      })
    }, '+ New'));
  grid.append(...field('Faction (party bonus)', factionRow));
  grid.append(...field('Description', textArea(c, 'description', store)));
  grid.append(...field('Lore', textArea(c, 'lore', store)));
  idp.appendChild(grid);

  // extra profession tags (universal system tags)
  idp.appendChild(h('h3', 'Extra tags'));
  const tagRow = h('div');
  for (const t of store.baseRaw.tags.filter(x => x.category === 'profession')) {
    const cb = h('input', { type: 'checkbox', checked: (c.extraTags ?? []).includes(t.id) });
    cb.addEventListener('change', () => {
      c.extraTags = cb.checked
        ? [...(c.extraTags ?? []), t.id]
        : (c.extraTags ?? []).filter(x => x !== t.id);
      commit(store);
    });
    tagRow.appendChild(h('label.chip', cb, ` ${t.displayName}`));
  }
  idp.appendChild(tagRow);
  root.appendChild(idp);

  // ---- images
  const imp = h('div.panel');
  imp.appendChild(h('h2', 'Character art'));
  imp.appendChild(h('div.wells',
    imageWell('portrait', 'Eye tile (16:9, transparent PNG)', () => c.portrait, v => { c.portrait = v; }, () => commit(store, true)),
    imageWell('fullBody', 'Full body (9:16, taller than wide)', () => c.fullBody, v => { c.fullBody = v; }, () => commit(store, true))));
  root.appendChild(imp);

  // ---- alternate appearances
  const skins = h('div.panel');
  skins.appendChild(h('h2', 'Skins'));
  skins.appendChild(h('p.small.muted', 'Author alternate appearances here. Archive rewards select from these skins.'));
  c.skins ??= [];
  for (const skin of c.skins) {
    const row = h('div.creator-skin-row');
    row.appendChild(textInput(skin, 'name', store, { maxlength: 80 }));
    row.appendChild(h('div.wells',
      imageWell('portrait', 'Skin eye tile (16:9, transparent)', () => skin.portrait, value => { skin.portrait = value; }, () => commit(store, true)),
      imageWell('fullBody', 'Skin full body (9:16)', () => skin.fullBody, value => { skin.fullBody = value; }, () => commit(store, true))));
    row.appendChild(h('button.btn.tiny.danger', { onclick: () => {
      c.skins = c.skins.filter(item => item.id !== skin.id);
      for (const world of db.worlds) {
        for (const collection of world.archive.collections) if (collection.rewardSkin?.skinId === skin.id) collection.rewardSkin = { characterId: null, skinId: null };
        if (world.archive.fullSkin?.skinId === skin.id) world.archive.fullSkin = { characterId: null, skinId: null };
      }
      commit(store, true);
    } }, 'Delete skin'));
    skins.appendChild(row);
  }
  skins.appendChild(h('button.btn.primary', { onclick: () => {
    c.skins.push({ id: newId('skin'), name: 'New Skin', portrait: null, fullBody: null });
    commit(store, true);
  } }, '+ New Skin'));
  root.appendChild(skins);

  // ---- equipment lines
  const eqp = h('div.panel');
  eqp.appendChild(h('h2', 'Six equipment lines'));
  eqp.appendChild(h('p.small.muted', 'Each line keeps its core art through all ten Gear Tiers; only the name prefix evolves.'));
  const wells = h('div.wells');
  for (const slot of content.characterMeta.slotOrder) {
    const eq = c.equipment[slot];
    const cell = h('div', { style: { width: '170px' } });
    cell.appendChild(h('div.small.muted', content.characterMeta.slots[slot].name));
    cell.appendChild(textInput(eq, 'name', store, { maxlength: 60 }));
    cell.appendChild(imageWell('equipment', '', () => eq.image, v => { eq.image = v; }, () => commit(store, true)));
    wells.appendChild(cell);
  }
  eqp.appendChild(wells);
  root.appendChild(eqp);

  // ---- shard sources
  const sp = h('div.panel');
  sp.appendChild(h('h2', 'Shard sources'));
  const sources = characterShardAssignments(db, c.id);
  if (sources.length === 0) {
    sp.appendChild(h('p.warn.small', 'No shard source yet — this character cannot be acquired and is held out of the game. Assign them in a complete Shadow chapter or their World Campaign.'));
  } else {
    sp.appendChild(h('p.good.small', `Authored at: ${sources.map(s =>
      s.campaign === 'shadow'
        ? `Shadow ${s.chapter}-${s.position}`
        : `${s.worldName} ${s.chapter}-${s.position}`).join(' · ')}`));
  }
  if (db.mainChapters.length === 0) {
    sp.appendChild(h('button.btn.tiny.primary', {
      onclick: () => { addCampaignChapter(db); commit(store, false).then(() => store.go('#/creator/shadow-chapter/0')); }
    }, 'Create Campaign Chapter 1'));
  } else {
    sp.appendChild(h('div', db.shadowChapters.map((_, i) =>
      h('button.btn.tiny', { style: { marginRight: '6px' }, onclick: () => store.go(`#/creator/shadow-chapter/${i}`) }, `Edit Shadow ${i + 1}`))));
  }
  root.appendChild(sp);
}

// ------------------------------------------------------------- chapter editor
function chapterEditor(store, root, campaign, idx) {
  const { customDB: db, content } = store;
  const isShadow = campaign === 'shadow';
  const ch = (isShadow ? db.shadowChapters : db.mainChapters)[idx];
  if (!ch) { root.appendChild(h('p.bad', 'Unknown chapter.')); return; }
  root.classList.add('creator-chapter');
  const chapterNum = idx + 1;
  root.appendChild(backLink(store, '#/creator', 'Content Creator'));

  const panel = h('div.panel');
  panel.appendChild(h('h2', `${isShadow ? 'Shadow' : 'Main'} Campaign — Chapter ${chapterNum} (nodes ${idx * 10 + 1}–${idx * 10 + 10})`));
  const pairPublished = db.mainChapters[idx]?.status === 'published';
  if (pairPublished) panel.appendChild(h('p.good.small', 'This pair is published. Move it to Draft from the campaign overview before editing; the live game remains stable while draft work is incomplete.'));
  panel.appendChild(h('p.small.muted', isShadow
    ? 'Every node requires a shard character and allows five runs per day. Each unlocks when the corresponding Main node is cleared; Shadow nodes do not gate one another.'
    : 'All nodes are freely repeatable material sources. Thresholds never decrease along the campaign; positions 5 and 10 are checkpoints with larger first-clear rewards.'));
  panel.appendChild(h('div.chapter-name-field',
    h('label', 'Chapter name'),
    textInput(ch, 'title', store, {
      placeholder: `${isShadow ? 'Shadow' : 'Main'} Chapter ${chapterNum}`,
      maxlength: 60
    })));
  panel.appendChild(h('div.chapter-art-editor',
    imageWell('chapter', `${isShadow ? 'Shadow' : 'Main'} Chapter ${chapterNum} key art (16:9)`,
      () => ch.image,
      value => { ch.image = value; },
      () => commit(store, true))));

  const charOptions = [
    ['', '— choose character —'],
    ...db.characters.map(x => {
      const w = db.worlds.find(y => y.id === x.worldId);
      return [x.id, `${x.displayName} (${w?.displayName ?? '?'})`];
    })
  ];
  const worldOptions = [['', 'Global'], ...db.worlds.map(world => [world.id, world.displayName])];

  ch.nodes.forEach((nd, i) => {
    const pos = i + 1;
    const row = h('div.node-edit-row');
    row.appendChild(h('span.muted.small', String(idx * 10 + pos)));
    row.appendChild(textInput(nd, 'name', store));
    const chapterMax = Math.max(1, ...ch.nodes.map(node => node.threshold));
    row.appendChild(h('div.threshold-edit',
      numInput(nd, 'threshold', store, { min: 0 }),
      h('i', { style: { width: `${Math.max(2, nd.threshold / chapterMax * 100)}%` } })));
    row.append(...familyGradeSelects(nd, store, content));
    row.appendChild(selectInput(nd, 'worldId', store, worldOptions, { structural: true }));
    if (isShadow) {
      row.appendChild(selectInput(nd, 'shardCharacterId', store, charOptions, { structural: true }));
    } else {
      row.appendChild(h('span.small.muted', pos % 5 === 0 ? '🏁 checkpoint' : (pos >= 7 ? 'advanced node' : 'ordinary node')));
    }
    panel.appendChild(row);
    const rewards = h('div.node-extra-rewards', h('span.caption', 'Additional rewards'));
    rewards.appendChild(rewardQuantityInput(nd, 'firstClearRewards', 'renown', 'First-clear Renown', store));
    rewards.appendChild(rewardQuantityInput(nd, 'firstClearRewards', '@associated_world_asset', 'First-clear World Asset', store));
    rewards.appendChild(rewardQuantityInput(nd, 'repeatRewards', '@associated_world_asset', 'Repeat World Asset', store));
    panel.appendChild(rewards);
  });

  const actions = h('div', { style: { marginTop: '12px', display: 'flex', gap: '10px' } });
  actions.appendChild(h('button.btn', {
    onclick: () => store.go(`#/creator/${isShadow ? 'main' : 'shadow'}-chapter/${idx}`)
  }, `Edit matching ${isShadow ? 'Main' : 'Shadow'} chapter`));
  if (isShadow) {
    actions.appendChild(h('button.btn', {
      onclick: () => {
        const assigned = new Set();
        for (const chx of db.shadowChapters) for (const nd of chx.nodes) if (nd.shardCharacterId) assigned.add(nd.shardCharacterId);
        for (const w of db.worlds) for (const nd of w.campaignNodes) if (nd.shardCharacterId) assigned.add(nd.shardCharacterId);
        const needy = db.characters.filter(x => !assigned.has(x.id));
        const fallback = db.characters;
        let n = 0;
        for (const nd of ch.nodes) {
          if (nd.shardCharacterId) continue;
          const pick = needy.shift() ?? fallback[n % Math.max(1, fallback.length)];
          if (pick) { nd.shardCharacterId = pick.id; n++; }
        }
        commit(store, true).then(() => toast(n > 0 ? `Assigned ${n} Shadow node(s).` : 'No empty Shadow nodes, or no characters are available.'));
      }
    }, 'Auto-fill empty shard nodes'));
  }
  if (pairPublished) {
    for (const control of panel.querySelectorAll('input, select, textarea')) control.disabled = true;
    for (const well of panel.querySelectorAll('.image-well')) {
      well.style.pointerEvents = 'none';
      well.setAttribute('aria-disabled', 'true');
    }
  }
  panel.appendChild(actions);
  root.appendChild(panel);
}

function rewardQuantityInput(node, listKey, resourceId, label, store) {
  node[listKey] ??= [];
  const existing = node[listKey].find(entry => entry.kind === 'resource' && entry.id === resourceId);
  const input = h('input', { type: 'number', min: 0, step: 1, value: existing?.qty ?? 0, 'aria-label': label });
  input.addEventListener('change', () => {
    node[listKey] = node[listKey].filter(entry => !(entry.kind === 'resource' && entry.id === resourceId));
    const qty = Math.max(0, Number(input.value) || 0);
    if (qty) node[listKey].push({ kind: 'resource', id: resourceId, qty });
    commit(store);
  });
  return h('label', label, input);
}
