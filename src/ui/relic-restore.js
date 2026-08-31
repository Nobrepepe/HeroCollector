// Binding the relic (design turn 16b).
//
// Four pieces held is not a whole relic. The player goes to the Mastery track
// and presses the button, and this is what happens next: the room quiets, the
// four quarters lift as if picked up, come together in reading order with
// their gaps closing, the seams take, and the thing has a name again.
//
// It follows the promotion sequence's two rules exactly, because they are what
// make a moment safe to play: the state change has already committed before a
// single frame runs — this re-dresses a settled screen and walks it forward,
// so nothing is queued behind it — and any click or key jumps straight to the
// settled state.
import { h } from './dom.js';
import { PROGRAM_NAMES } from '../core/programs.js';
import { relicStatus } from '../core/relics.js';

// Milliseconds from the click. Six beats, then it is just the Mastery screen.
const BEATS = {
  quiet: 0, quietDuration: 260,
  lift: 0, liftDuration: 420,
  gather: 420, gatherStagger: 90, gatherDuration: 330,
  seams: 1020, seamsDuration: 160,
  name: 1180, nameDuration: 520,
  consequence: 1900, consequenceDuration: 500,
  settle: 4600
};
const LIFT_SCALE = 1.03;
const LIFT_DRIFT = 22 / Math.SQRT2;   // 22px along the cell's own diagonal
const CROSSFADE = 180;
// The tear, authored once and reused for every world's relic: four polygons
// whose shared edges are exact complements — one tear down the gutter, one
// across the quire. A torn book, not a jigsaw.
const TEARS = [
  '0% 0%,54% 0%,52% 18%,56% 34%,51% 52%,53% 60%,34% 58%,18% 62%,0% 59%',
  '56% 0%,100% 0%,100% 54%,82% 51%,66% 56%,55% 61%,53% 60%,51% 52%,56% 34%,52% 18%,54% 0%',
  '0% 61%,18% 64%,34% 60%,53% 62%,51% 78%,55% 90%,52% 100%,0% 100%',
  '55% 63%,66% 58%,82% 53%,100% 56%,100% 100%,54% 100%,55% 90%,51% 78%,53% 62%'
];

let running = null;

// Ends any sequence still playing. Binding a second relic starts from the
// settled screen, and leaving the track never strands one half-played.
export function settleRelicRestore() {
  running?.settle();
}

// Called by the Mastery screen once the page is built and in the document,
// which is the last moment before the browser paints it. The board is first
// dressed as it was a moment ago — four separate quarters with gaps between
// them — and then walked forward through the beats.
export function playRelicRestore(store, page, worldId) {
  const pending = store.ui.relicRestore;
  if (!pending || pending.worldId !== worldId) return;
  store.ui.relicRestore = null;
  settleRelicRestore();

  const parts = findParts(page);
  if (!parts.board || parts.cells.length !== 4 || !parts.plate) return;
  const status = relicStatus(store.content, store.state, worldId);
  if (!status?.restored) return;

  const timers = [];
  const cleanups = [];
  const animations = [];
  const sequence = {
    settle() {
      if (running !== sequence) return;
      running = null;
      timers.forEach(clearTimeout);
      animations.forEach(animation => animation.cancel());
      cleanups.forEach(cleanup => cleanup());
      // Back to what the render produced: one bound plate.
      parts.board.classList.add('is-bound');
      page.classList.remove('relic-restoring');
    }
  };
  running = sequence;

  const dismiss = () => sequence.settle();
  for (const event of ['pointerdown', 'keydown']) {
    document.addEventListener(event, dismiss, { passive: true });
    cleanups.push(() => document.removeEventListener(event, dismiss));
  }
  window.addEventListener('hashchange', dismiss);
  cleanups.push(() => window.removeEventListener('hashchange', dismiss));
  const at = (delay, fn) => { timers.push(setTimeout(fn, delay)); };
  const animate = (target, keyframes, options) => {
    for (const element of [target].flat().filter(Boolean)) {
      animations.push(element.animate(keyframes, { fill: 'both', ...options }));
    }
  };
  const adopt = element => { cleanups.push(() => element.remove()); return element; };

  // ---- the board as it was a moment ago -----------------------------------
  // Four quarters with gaps. The class the render settled on is taken back off
  // before anything measures the page, so the cells are laid out where they
  // were rather than where they are going.
  parts.board.classList.remove('is-bound');
  page.classList.add('relic-restoring');
  // Faded out is not gone: the piece rows carry links that would still take a
  // click, so the quieting rows stop listening for the length of the sequence.
  for (const element of parts.quieting) {
    element.classList.add('relic-quieting');
    cleanups.push(() => element.classList.remove('relic-quieting'));
  }

  const payoff = buildPayoff(store, status, worldId);
  parts.side.appendChild(adopt(payoff.element));
  // It stands where the piece list was, which is the space the first beat
  // cleared for it — beside the plate rather than under the whole column.
  if (parts.anchor) {
    Object.assign(payoff.element.style, {
      top: `${parts.anchor.offsetTop}px`, width: `${parts.anchor.offsetWidth}px`
    });
  }

  if (prefersReducedMotion(store)) {
    // No lift, no travel, no sheen. The gaps close and the quarters drop in one
    // cross-fade; the name and the consequence arrive behind it.
    animate(parts.quieting, [{ opacity: 1 }, { opacity: .22 }], { duration: CROSSFADE });
    animate(parts.cells, [{ opacity: 1 }, { opacity: 0 }], { duration: CROSSFADE });
    animate(parts.plate, [{ opacity: 0 }, { opacity: 1 }], { duration: CROSSFADE });
    animate([payoff.headline, ...payoff.lines], [{ opacity: 0 }, { opacity: 1 }],
      { duration: CROSSFADE, delay: CROSSFADE });
    at(BEATS.settle, () => sequence.settle());
    return;
  }

  // ---- 0–260 · the room quiets --------------------------------------------
  // The piece list, the track and the milestone copy go to 22%. The board
  // stays lit: it is the only thing this is about.
  animate(parts.quieting, [{ opacity: 1 }, { opacity: .22 }],
    { duration: BEATS.quietDuration, easing: 'ease-out' });

  // ---- 0–1020 · the four lift, then come together --------------------------
  // Measured rather than authored: where a quarter is going is wherever the
  // grid put the board, so the closed position is read off the board's own box.
  const board = parts.board.getBoundingClientRect();
  parts.cells.forEach((cell, index) => {
    const rect = cell.getBoundingClientRect();
    const right = index % 2 === 1;
    const bottom = index >= 2;
    // Its own diagonal: out from the centre of the board, away from the seam.
    // Cells transform from their top-left corner, so scaling is re-centred by
    // hand — otherwise a quarter would grow into the seam rather than in place.
    const grow = (LIFT_SCALE - 1) / 2;
    const lift = `translate(${(right ? 1 : -1) * LIFT_DRIFT - grow * rect.width}px,`
      + `${(bottom ? 1 : -1) * LIFT_DRIFT - grow * rect.height}px) scale(${LIFT_SCALE})`;
    // Closed: the gaps go to zero, so each quarter grows into exactly half the
    // board and sits flush against its neighbours.
    const scale = board.width / 2 / rect.width;
    const closed = `translate(${board.left + (right ? board.width / 2 : 0) - rect.left}px,`
      + `${board.top + (bottom ? board.height / 2 : 0) - rect.top}px) scale(${scale})`;
    // 90ms apart in reading order, and each arrives before the seams take. The
    // last keyframe repeats at offset 1: keyframes that stop short of the end
    // leave the rest of the timeline unanimated, and the quarter would snap
    // back to where it started the instant it landed.
    const start = (BEATS.gather + index * BEATS.gatherStagger) / BEATS.seams;
    const arrived = Math.min(1, (BEATS.gather + index * BEATS.gatherStagger + BEATS.gatherDuration) / BEATS.seams);
    animate(cell, [
      { transform: 'translate(0,0) scale(1)', offset: 0, easing: 'cubic-bezier(.2,.8,.3,1)' },
      { transform: lift, offset: BEATS.liftDuration / BEATS.seams, easing: 'linear' },
      // Nothing rotates on the way in; a torn book does not spin.
      { transform: lift, offset: start, easing: 'cubic-bezier(.4,0,.2,1)' },
      { transform: closed, offset: arrived, easing: 'linear' },
      { transform: closed, offset: 1 }
    ], { duration: BEATS.seams });
    // Its edge glow comes to full as it is picked up, and dies as it lands.
    cell.classList.add('is-lifted');
    cleanups.push(() => cell.classList.remove('is-lifted'));
  });

  // ---- 1020–1180 · the seams take -----------------------------------------
  // The four tear masks cross-fade to one unmasked plate. One bloom leaves the
  // centre cross and dies; a single sheen crosses the whole face.
  // With no relic art there is nothing to tear: the four bordered cells simply
  // become one bordered plate. The moment is the binding, not the picture.
  const tears = parts.plate.classList.contains('is-unarted') ? [] : TEARS.map(polygon => {
    const layer = adopt(h('div.relic-tear', { 'aria-hidden': 'true' }));
    layer.style.clipPath = `polygon(${polygon})`;
    layer.style.backgroundImage = parts.plate.style.backgroundImage;
    parts.board.appendChild(layer);
    return layer;
  });
  animate(parts.cells, [{ opacity: 1 }, { opacity: 0 }],
    { duration: 80, delay: BEATS.seams });
  animate(tears, [{ opacity: 0 }, { opacity: 1 }], { duration: 80, delay: BEATS.seams });
  animate(tears, [{ opacity: 1 }, { opacity: 0 }],
    { duration: BEATS.seamsDuration, delay: BEATS.seams + 80, easing: 'ease-in' });
  animate(parts.plate, [{ opacity: 0 }, { opacity: 1 }],
    { duration: BEATS.seamsDuration, delay: BEATS.seams + 40, easing: 'ease-out' });

  const bloom = adopt(h('div.relic-bloom', { 'aria-hidden': 'true' }));
  parts.board.appendChild(bloom);
  animate(bloom, [
    { opacity: 0, transform: 'translate(-50%,-50%) scale(.2)' },
    { opacity: 1, transform: 'translate(-50%,-50%) scale(.85)', offset: .2 },
    { opacity: 0, transform: 'translate(-50%,-50%) scale(1.5)' }
  ], { duration: 400, delay: BEATS.seams, easing: 'cubic-bezier(.2,.8,.3,1)' });

  const sheen = adopt(h('div.relic-sheen', { 'aria-hidden': 'true' }));
  parts.board.appendChild(sheen);
  animate(sheen, [
    { opacity: 0, transform: 'translateX(-70%) skewX(-12deg)' },
    { opacity: .55, offset: .3 },
    { opacity: 0, transform: 'translateX(160%) skewX(-12deg)' }
  ], { duration: 760, delay: BEATS.seams + 60, easing: 'ease-in-out' });

  // ---- 1180–1700 · the name sets ------------------------------------------
  // The rank reading is untouched throughout: binding grants no points.
  animate(payoff.headline, [
    { opacity: 0, transform: 'translateY(14px)' },
    { opacity: 1, transform: 'translateY(0)' }
  ], { duration: BEATS.nameDuration, delay: BEATS.name, easing: 'cubic-bezier(.2,.9,.3,1)' });

  // ---- 1900–2400 · what it can do now --------------------------------------
  payoff.lines.forEach((line, index) => animate(line, [
    { opacity: 0, transform: 'translateY(10px)' },
    { opacity: 1, transform: 'translateY(0)' }
  ], {
    duration: BEATS.consequenceDuration, easing: 'cubic-bezier(.2,.9,.3,1)',
    delay: BEATS.consequence + index * 140
  }));

  // ---- the hold, and then it is just the Mastery screen --------------------
  at(BEATS.settle, () => sequence.settle());
}

// ------------------------------------------------------------------ internals

function findParts(page) {
  const board = page.querySelector('.relic-board');
  return {
    board,
    side: page.querySelector('.mastery-ledger-side'),
    cells: board ? [...board.querySelectorAll('.relic-cell')] : [],
    plate: board?.querySelector('.relic-plate') ?? null,
    anchor: page.querySelector('.relic-piece-list'),
    quieting: [...page.querySelectorAll(
      '.relic-piece-list, .relic-binding, .mastery-standing, .mastery-milestones, .relic-board-note')]
  };
}

// The name and the one consequence stand where the piece list was, which is
// the space the first beat cleared for them.
function buildPayoff(store, status, worldId) {
  const element = h('div.relic-restore-payoff');
  const headline = h('div.relic-restore-name', `${status.relic.displayName} — whole.`);
  element.appendChild(headline);
  const lines = [];
  const consequence = h('p.relic-restore-line', relicConsequence(store, worldId));
  element.appendChild(consequence);
  lines.push(consequence);
  const slot = store.state.programs[worldId]?.relicSlot ?? null;
  const action = h('button.link.relic-restore-action', {
    onclick: () => { settleRelicRestore(); store.go(`#/programs/${worldId}`); }
  }, slot ? `Move it out of ${PROGRAM_NAMES[slot]} →` : 'Install it into a Program →');
  element.appendChild(action);
  lines.push(action);
  return { element, headline, lines };
}

// One line, naming what the relic does — read off balance rather than written
// down twice, so it cannot drift from what the Program actually pays.
function relicConsequence(store, worldId) {
  const config = store.content.balance.programs;
  const slot = store.state.programs[worldId]?.relicSlot ?? null;
  if (slot === 'procurement') {
    return `Procurement ships ${config.procurement.shipmentQty + config.procurement.relicBonusQty} materials instead of ${config.procurement.shipmentQty}.`;
  }
  if (slot === 'development') {
    return `Development pays every ${config.development.relicThreshold} shards instead of ${config.development.threshold}.`;
  }
  if (slot === 'operations') {
    return `Operations banks a boost every ${countRoutes(config.operations.relicThreshold)} instead of ${countRoutes(config.operations.threshold)}.`;
  }
  return `Placed in a Program it visibly improves it — Development would pay every ${config.development.relicThreshold} shards instead of ${config.development.threshold}.`;
}

function countRoutes(n) {
  return n === 1 ? 'completed route' : `${n} completed routes`;
}

function prefersReducedMotion(store) {
  return store.state.settings.reducedMotion
    || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
