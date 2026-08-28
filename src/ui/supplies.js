// Field Supplies: one dialog for the three targeted modes. A Supply is never
// generic Energy — each mode skips straight to a goal: a material requisition,
// hero tutoring, or a one-attempt Surge past a near-miss gate.
import { h, fmt } from './dom.js';
import { openModal, render, toast } from '../app.js';
import { dressModal, modalHead, modalRule, modalAction, modalActions, modalDismiss } from './modal.js';
import { portrait, starline } from './shared.js';
import {
  fieldSupplyLimits,
  previewSupplyRequisition, useSupplyRequisition,
  previewSupplyTutoring, useSupplyTutoring,
  previewSupplySurge, useSupplySurge
} from '../core/energy.js';
import { isRevealed } from '../core/focus.js';

export function openSupplyDialog(store) {
  const limits = fieldSupplyLimits(store.content, store.state);
  const surge = store.state.surge;
  openModal((modal, close) => {
    dressModal(modal, { size: 'sheet' });
    modal.appendChild(modalHead('Field Supplies',
      limits.held > 0
        ? `${limits.held} targeted push${limits.held === 1 ? '' : 'es'} in reserve.`
        : 'The reserve is empty.',
      {
        lead: limits.held > 0
          ? 'Each Supply skips straight to a goal. There is no daily requirement — saving them for the right moment is the point.'
          : 'Expedition cycles and Mastery milestones are the sources. Saving them for the right moment is the point.'
      }));
    modal.appendChild(h('p.hc-modal-fine',
      `${limits.held} held of ${limits.storageCap} storage`
      + (limits.reserved ? ` · ${limits.reserved} promised by routes already out` : '')
      + (surge ? ' · a Surge is armed' : '')));
    modal.appendChild(modalRule());

    const requisition = previewableRequisitions(store);
    modal.appendChild(modalAction('Requisition materials →', {
      disabled: limits.held < 1 || !requisition.length,
      reason: limits.held < 1 ? 'No Supply is held.' : requisition.length ? null : 'No cleared node drops anything yet.',
      onclick: () => openRequisitionSheet(store, requisition)
    }));
    modal.appendChild(h('p.hc-modal-fine', 'The guaranteed yield of thirty Energy of sweeps of a chosen material’s best cleared source, delivered at once.'));

    const tutorable = tutoringTargets(store);
    modal.appendChild(modalAction('Tutor a hero →', {
      disabled: limits.held < 1 || !tutorable.length,
      reason: limits.held < 1 ? 'No Supply is held.' : tutorable.length ? null : 'No revealed hero can grow right now.',
      onclick: () => openTutoringSheet(store, tutorable)
    }));
    modal.appendChild(h('p.hc-modal-fine',
      `+${store.content.balance.fieldSupply.shardGrant} shards for any revealed hero — recruited or not.`));

    const surgePreview = previewSupplySurge(store.content, store.state);
    modal.appendChild(modalAction(`Arm a Surge (+${store.content.balance.fieldSupply.surgeBp / 100}% for one attempt) →`, {
      disabled: !surgePreview.ok,
      reason: surgePreview.ok ? null : surgePreview.reasons[0],
      onclick: async () => {
        const result = await store.tx(() => useSupplySurge(store.content, store.state), { rerender: false });
        if (result.ok) {
          toast('Surge armed. It is spent only when it carries a node attempt.');
          close();
          render();
        }
      }
    }));
    modal.appendChild(h('p.hc-modal-fine',
      'The next node attempt fights above its Power. The Surge is spent only when it actually carries the party past a gate.'));

    modal.appendChild(modalActions(modalDismiss('Leave the reserve', close)));
  });
}

function previewableRequisitions(store) {
  return store.content.materials
    .map(material => ({ material, preview: previewSupplyRequisition(store.content, store.state, material.id) }))
    .filter(entry => entry.preview.source);
}

function tutoringTargets(store) {
  return store.content.characters
    .filter(def => isRevealed(store.state, def.id))
    .filter(def => {
      const cs = store.state.characters[def.id];
      return !(cs.owned && cs.stars >= 7);
    })
    .sort((a, b) => Number(store.state.characters[b.id].owned) - Number(store.state.characters[a.id].owned));
}

function openRequisitionSheet(store, rows) {
  openModal((modal, close) => {
    dressModal(modal, { size: 'wide' });
    modal.appendChild(modalHead('Requisition', 'Which material does the goal need?',
      { lead: 'One Supply buys the guaranteed yield of thirty Energy of the best cleared source.' }));
    const list = h('div.supply-target-list');
    for (const { material, preview } of rows) {
      list.appendChild(modalAction(`${material.icon} ${fmt(preview.qty)} × ${material.displayName}`, {
        onclick: async () => {
          const result = await store.tx(() => useSupplyRequisition(store.content, store.state, material.id), { rerender: false });
          if (result.ok) {
            toast(`Requisitioned ${result.qty} × ${material.displayName}.`);
            close();
            render();
          }
        }
      }));
    }
    modal.appendChild(list);
    modal.appendChild(modalActions(modalDismiss('Back', close)));
  });
}

function openTutoringSheet(store, targets) {
  const qty = store.content.balance.fieldSupply.shardGrant;
  openModal((modal, close) => {
    dressModal(modal, { size: 'wide' });
    modal.appendChild(modalHead('Tutoring', 'Who is the push for?',
      { lead: `One Supply grants ${qty} shards to any revealed hero, before or after recruitment.` }));
    const list = h('div.supply-target-list');
    for (const def of targets) {
      const cs = store.state.characters[def.id];
      list.appendChild(h('button.supply-target-row', {
        onclick: async () => {
          const result = await store.tx(() => useSupplyTutoring(store.content, store.state, def.id), { rerender: false });
          if (result.ok) {
            toast(`${def.displayName} received ${result.qty} shards.`);
            close();
            render();
          }
        }
      },
      portrait(store, def.id, 'sm', { decorative: true }),
      h('div.grow',
        h('div', def.displayName, cs.owned ? null : h('span.small.muted', ' · not yet recruited')),
        cs.owned ? starline(cs.stars) : h('div.small.muted', `${fmt(cs.shards)} shards banked`)),
      h('div.small.good', `+${qty}`)));
    }
    modal.appendChild(list);
    modal.appendChild(modalActions(modalDismiss('Back', close)));
  });
}
