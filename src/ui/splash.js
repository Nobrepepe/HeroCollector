import { h } from './dom.js';
import { worldCampaignUnlocked } from '../core/state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function renderSplash(store, root, mode = null) {
  const resting = mode === 'rest';
  const page = h('section.eden-splash' + (resting ? '.is-resting' : ''), {
    'aria-labelledby': 'eden-title'
  });
  page.appendChild(h('div.eden-splash-art', { 'aria-hidden': 'true' }));

  const lockup = h('div.eden-lockup');
  lockup.appendChild(edenMark());
  lockup.appendChild(h('h1.eden-wordmark', { id: 'eden-title' }, 'EDEN'));
  page.appendChild(lockup);

  page.appendChild(h('div.eden-tagline-block',
    h('div.eden-rule', { 'aria-hidden': 'true' }),
    h('p.eden-tagline', 'The door is never quite closed')));

  const fresh = !!store.ui.isFreshSave;
  const openWorlds = store.content.worlds.filter(world =>
    worldCampaignUnlocked(store.content, store.state, world.id).unlocked).length;
  const worldLabel = `${openWorlds} world${openWorlds === 1 ? '' : 's'} open`;
  const saveLine = fresh
    ? 'No footsteps yet · the first door is waiting'
    : `Day ${store.state.dayNumber} · ${worldLabel}`;
  const action = h('div.eden-action',
    h('button.eden-continue', { type: 'button', onclick: () => store.beginDay() },
      `${fresh ? 'Begin' : 'Continue'} →`),
    h('p.eden-save-state', saveLine));
  page.appendChild(action);
  root.appendChild(page);
}

function edenMark() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'eden-mark');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Eden');
  svg.innerHTML = `
    <defs>
      <linearGradient id="edenRing" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f4ece1" stop-opacity=".14"/>
        <stop offset=".44" stop-color="#f4ece1" stop-opacity=".86"/>
        <stop offset="1" stop-color="#f4ece1" stop-opacity=".12"/>
      </linearGradient>
      <linearGradient id="edenSeam" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#e9a94f" stop-opacity="0"/>
        <stop offset=".28" stop-color="#ffd79a"/>
        <stop offset=".74" stop-color="#e9a94f" stop-opacity=".92"/>
        <stop offset="1" stop-color="#e9a94f" stop-opacity="0"/>
      </linearGradient>
      <mask id="edenGap">
        <rect width="100" height="100" fill="#fff"/>
        <rect x="49.6" y="9" width="9" height="14" fill="#000"/>
        <rect x="49.6" y="77" width="9" height="14" fill="#000"/>
      </mask>
      <filter id="edenBlur" x="-60%" y="-40%" width="220%" height="180%">
        <feGaussianBlur stdDeviation="4"/>
      </filter>
    </defs>
    <circle class="eden-ring" cx="50" cy="50" r="34" fill="none" stroke="url(#edenRing)" stroke-width="1.5" mask="url(#edenGap)"/>
    <rect class="eden-glow" x="48.5" y="4" width="13" height="92" fill="url(#edenSeam)" filter="url(#edenBlur)"/>
    <rect class="eden-seam" x="53.2" y="6" width="1.7" height="88" fill="url(#edenSeam)"/>
  `;
  return svg;
}
