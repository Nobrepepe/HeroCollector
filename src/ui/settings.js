// Settings (GDD 11.2): local reset time, text scale, motion reduction,
// confirmation preferences, save tools, credits.
import { h } from './dom.js';
import { exportSave, importSave } from '../platform.js';
import { newPlayerState, syncSaveWithContent, SCHEMA_VERSION } from '../core/state.js';
import { validateSave } from '../core/validate.js';
import { openModal, toast, render } from '../app.js';

export function renderSettings(store, root) {
  const { content, state } = store;

  // ---------- gameplay
  const gp = h('div.panel');
  gp.appendChild(h('h2', 'Gameplay'));
  const resetSel = h('select', { 'aria-label': 'Daily reset hour' });
  for (let hr = 0; hr < 24; hr++) {
    resetSel.appendChild(h('option', { value: String(hr), selected: hr === state.settings.resetHour },
      `${String(hr).padStart(2, '0')}:00`));
  }
  resetSel.addEventListener('change', () => {
    state.settings.resetHour = Number(resetSel.value);
    store.save().then(render);
    toast('Reset hour updated. The next daily grant uses the new time; past days are never re-granted.');
  });
  gp.appendChild(labeled('Daily reset time (local time zone)', resetSel));
  gp.appendChild(toggle(store, 'Confirm bulk actions with a preview', 'confirmBulk'));
  root.appendChild(gp);

  // ---------- accessibility
  const ax = h('div.panel');
  ax.appendChild(h('h2', 'Accessibility'));
  const scale = h('input', { type: 'number', min: '0.8', max: '1.6', step: '0.1', value: state.settings.textScale, 'aria-label': 'Text scale' });
  scale.addEventListener('change', () => {
    state.settings.textScale = Math.min(1.6, Math.max(0.8, Number(scale.value) || 1));
    store.save().then(render);
  });
  ax.appendChild(labeled('Text scale (0.8–1.6)', scale));
  ax.appendChild(toggle(store, 'Reduce motion (disables nonessential animation)', 'reducedMotion'));
  ax.appendChild(h('p.small.muted', 'Rarity, completion, and warnings are always shown with text or symbols, never color alone.'));
  root.appendChild(ax);

  // ---------- save tools
  const sv = h('div.panel');
  sv.appendChild(h('h2', 'Save data'));
  sv.appendChild(h('p.small.muted', `Autosaves after every action, with one rolling local backup. Schema v${state.schemaVersion}, content v${state.contentVersion}.`));
  sv.appendChild(h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
    h('button.btn', { onclick: () => exportSave(state).then(ok => ok && toast('Save exported.')) }, 'Export save…'),
    h('button.btn', {
      onclick: async () => {
        const imported = await importSave();
        if (!imported) { toast('Import canceled or unreadable.', 'error'); return; }
        if (imported.schemaVersion !== SCHEMA_VERSION) { toast(`Unsupported schema version ${imported.schemaVersion}.`, 'error'); return; }
        const finishImport = async () => {
          store.state = imported;
          syncSaveWithContent(content, store.state);
          await store.save();
          toast('Save imported.');
          render();
        };
        const check = validateSave(content, imported);
        if (!check.ok) {
          openModal((modal, close) => {
            modal.appendChild(h('h2', 'Import warnings'));
            modal.appendChild(h('p.muted.small', 'The save references content that is not currently in the game (for example, unpublished creations). That progress stays dormant and returns when the content does.'));
            modal.appendChild(h('ul.reasons', check.errors.slice(0, 10).map(e => h('li', e))));
            modal.appendChild(h('div', { style: { display: 'flex', gap: '8px' } },
              h('button.btn.primary', { onclick: () => { close(); finishImport(); } }, 'Import anyway'),
              h('button.btn', { onclick: close }, 'Cancel')));
          });
          return;
        }
        await finishImport();
      }
    }, 'Import save…'),
    h('button.btn.danger', {
      onclick: () => openModal((modal, close) => {
        modal.appendChild(h('h2', 'Reset to a clean save?'));
        modal.appendChild(h('p.warn', 'All progress will be replaced by a fresh starting state. The previous save remains in the rolling backup until the next autosave.'));
        modal.appendChild(h('div', { style: { display: 'flex', gap: '8px' } },
          h('button.btn.danger', {
            onclick: async () => { store.state = newPlayerState(content, Date.now()); await store.save(); close(); toast('New game started.'); render(); }
          }, 'Reset everything'),
          h('button.btn.primary', { onclick: close }, 'Keep my save')));
      })
    }, 'Reset save…')));
  root.appendChild(sv);

  // ---------- developer
  const dv = h('div.panel');
  dv.appendChild(h('h2', 'Developer'));
  dv.appendChild(toggle(store, 'Enable developer panel (also Ctrl+Shift+D)', 'devPanel'));
  root.appendChild(dv);

  // ---------- credits
  const cr = h('div.panel');
  cr.appendChild(h('h2', 'Credits'));
  cr.appendChild(h('p.small.muted', 'Hero Collector MVP — a single-player, menu-first collection game. No purchases, no ads, no accounts: the Energy cap forgives a missed day, and every character stays valid forever.'));
  root.appendChild(cr);
}

function labeled(text, control) {
  return h('div.kv', h('span', text), control);
}

function toggle(store, label, key) {
  const cb = h('input', { type: 'checkbox', checked: store.state.settings[key], 'aria-label': label });
  cb.addEventListener('change', () => {
    store.state.settings[key] = cb.checked;
    store.save().then(render);
  });
  return h('label.kv', h('span', label), cb);
}
