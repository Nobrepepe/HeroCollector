// The modal grammar established by design turn 10b, shared by every dialog in
// the game so a Find-sources sheet reads like the day-open summary: an eyebrow,
// a serif headline, rows separated by fading rules, and actions that are accent
// text links rather than buttons.
import { h } from './dom.js';

// Applies the 10b shell to a modal element. `size` selects the width:
// 'day' (720px, the opening beat), 'sheet' (760px, the default dialog),
// 'wide' (980px, anything holding a grid of characters or sources).
const SIZES = ['day', 'sheet', 'wide', 'full'];

export function dressModal(modal, { size = 'sheet', tone = null } = {}) {
  modal.classList.add('hc-modal');
  for (const name of SIZES) modal.classList.toggle(`hc-modal--${name}`, name === size);
  if (tone) modal.classList.add(`hc-modal--${tone}`);
  return modal;
}

export function modalHead(eyebrow, headline, { lead = null, size = 'm' } = {}) {
  return h('header.hc-modal-head',
    eyebrow ? h('div.eyebrow', eyebrow) : null,
    headline ? h(`h2.hc-modal-title.hc-modal-title--${size}`, headline) : null,
    lead ? h('p.hc-modal-lead', lead) : null);
}

export function modalRule() {
  return h('div.hc-modal-rule');
}

// The single action grammar: a serif accent link with a right-fading rule under
// it, an optional sentence beneath saying why it cannot be taken, and plain
// dismissals beside it. Unavailable actions stay on screen in #4a423c.
export function modalAction(label, {
  onclick, disabled = false, reason = null, size = 'm'
} = {}) {
  const block = h('div.hc-modal-action' + (disabled ? '.is-unavailable' : ''));
  block.appendChild(h(`button.hc-modal-action-link.hc-modal-action-link--${size}`, {
    disabled, onclick, type: 'button'
  }, label));
  block.appendChild(h('div.hc-modal-action-rule', { 'aria-hidden': 'true' }));
  if (reason) block.appendChild(h('div.hc-modal-action-reason', reason));
  return block;
}

export function modalDismiss(label, onclick) {
  return h('button.hc-modal-dismiss', { onclick, type: 'button' }, label);
}

export function modalActions(...children) {
  return h('div.hc-modal-actions', children);
}

// A pulsing attention dot followed by a sentence — the only place hc-pulse is
// used inside a dialog.
export function noticeLine(text, { tone = 'crisis', pulse = true } = {}) {
  return h('p.hc-modal-notice' + (pulse ? '.pulses' : ''),
    h('span.hc-modal-notice-dot' + `.is-${tone}`, { 'aria-hidden': 'true' }),
    h('span', text));
}

// A dashed placeholder that names the art slot it is standing in for, so an
// unimported asset always reads as a missing file rather than a design choice.
export function artPlaceholder(label, { className = '' } = {}) {
  return h(`div.hc-art-placeholder${className ? `.${className}` : ''}`,
    h('span', label));
}
