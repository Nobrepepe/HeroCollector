// The star promotion sequence (design turn 13).
//
// A promotion is the largest single jump a character ever makes, and it used
// to be a toast. This plays it in place on the character screen: everything
// that is not the character leaves, the progress bar's own light collapses
// into a bead, the bead flies into the empty star slot, and the payoff is
// three sentences naming what is newly possible.
//
// Two rules hold the whole thing together. The state change has already
// happened before a single frame of this plays — the sequence re-dresses the
// settled screen and walks it forward, so nothing is queued behind it and no
// input is swallowed. And it can always be cut short: any click or key jumps
// straight to the settled state.
import { h, fmt } from './dom.js';
import { rankShift } from '../core/consequences.js';

// Beat sheet 13b with its 600ms "quiet" beat dropped — that beat is the screen
// the player clicked on. Every number below is milliseconds from the click.
const BEATS = {
  leave: 0, leaveDuration: 400,
  collapse: 400, collapseDuration: 500,
  travel: 900, travelDuration: 200,
  strike: 1100, strikeDuration: 520,
  roll: 1100, rollDuration: 850,
  relight: 1200, relightDuration: 1400,
  sentence: 1800, sentenceDuration: 500,
  lines: 2400, lineStagger: 140, lineDuration: 420,
  settle: 6800
};
const EMBER_COUNT = 7;
const EMBERS = [
  ['#f6c67f', 'rgba(233,169,79,.5)'],
  ['#e9a94f', 'rgba(233,169,79,.45)'],
  ['#e2603f', 'rgba(226,96,63,.5)']
];
const CROSSFADE = 180;

let running = null;

// Ends any sequence still playing. A second promotion starts from the settled
// screen, and leaving the screen never strands it half-played.
export function settlePromotion() {
  running?.settle();
}

// Called by the character screen once the page is built and in the document,
// which is the last moment before the browser paints it. The page is first
// dressed in the state it was in before the click — the star is not shown,
// the power still reads the old total, the bar is still full of the shards
// that were just spent — and then walked forward through the beats.
export function playPromotion(store, page, characterId) {
  const promotion = store.ui.promotion;
  if (!promotion || promotion.characterId !== characterId) return;
  store.ui.promotion = null;
  settlePromotion();

  const parts = findParts(page);
  if (!parts.newStar || !parts.power || !parts.bar) return;

  const timers = [];
  const frames = [];
  const cleanups = [];
  const animations = [];
  // What the render produced, which is what the screen goes back to.
  const settled = { width: parts.fill.style.width };
  const sequence = {
    settle() {
      if (running !== sequence) return;
      running = null;
      timers.forEach(clearTimeout);
      frames.forEach(cancelAnimationFrame);
      animations.forEach(animation => animation.cancel());
      cleanups.forEach(cleanup => cleanup());
      page.classList.remove('promotion-playing', 'promotion-relit');
      parts.power.textContent = fmt(promotion.powerAfter);
      // The bar is put back, not animated back: the spend was already drawn.
      parts.fill.style.transition = 'none';
      parts.fill.style.width = settled.width;
      void parts.fill.offsetWidth;              // commit before the transition returns
      parts.fill.style.transition = '';
      if (parts.rank) parts.rank.textContent = parts.rankSettled;
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

  // Faded out is not gone: a control at zero opacity would still take the
  // click that settles the sequence, so the departing rows stop listening.
  for (const element of parts.leaving) {
    element.classList.add('promotion-leaving');
    cleanups.push(() => element.classList.remove('promotion-leaving'));
  }

  // ---- the screen as it was a moment ago ---------------------------------
  const reduced = prefersReducedMotion(store);
  page.classList.add('promotion-playing');
  // The power and the bar go back to what they read before the click. This
  // must happen before anything measures the page: once the bar's settled
  // width has been read back, changing it would animate rather than apply.
  if (!reduced) {
    parts.power.textContent = fmt(promotion.powerBefore);
    parts.fill.style.width = '100%';
  }
  // The moment lives at the top of the page. If the player was reading the
  // gear panel when they spent the shards, bring it into view.
  bringIntoView(parts.starline, reduced);
  const payoff = buildPayoff(store, promotion, parts);
  parts.body.appendChild(adopt(payoff.element));
  fitPayoff(payoff.element, parts);

  if (reduced) {
    // No travel, no sheen, no embers. The dim still happens; the star, the
    // number and the three lines cross-fade in. The moment survives as a
    // change of state.
    if (parts.rank) parts.rank.textContent = parts.rankPayoff;
    animate(parts.leaving, [{ opacity: 1 }, { opacity: 0 }], { duration: CROSSFADE });
    animate(parts.dimming, [{ opacity: 1 }, { opacity: .22 }], { duration: CROSSFADE });
    animate([parts.newStar, payoff.element], [{ opacity: 0 }, { opacity: 1 }], { duration: CROSSFADE });
    at(BEATS.settle, () => sequence.settle());
    return;
  }

  // ---- 0–400 · everything else leaves ------------------------------------
  // Gear row and disclosures fall 16px and go to zero; the eyebrow and the
  // back-link dim. Name, stars, power and art stay lit.
  animate(parts.leaving, [
    { opacity: 1, transform: 'translateY(0)' },
    { opacity: 0, transform: 'translateY(16px)' }
  ], { duration: BEATS.leaveDuration, easing: 'cubic-bezier(.2,.8,.3,1)' });
  animate(parts.dimming, [{ opacity: 1 }, { opacity: .22 }],
    { duration: BEATS.leaveDuration, easing: 'ease-out' });

  // ---- 400–900 · the shards collapse -------------------------------------
  // The fill scales toward its own right end until only a bead of light is
  // left. The spend, drawn once.
  animate(parts.fill, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }],
    { duration: BEATS.collapseDuration, delay: BEATS.collapse, easing: 'cubic-bezier(.7,0,.3,1)' });

  // ---- 900–1100 · the bead travels ---------------------------------------
  // Measured rather than authored: the bar's right end and the empty slot are
  // wherever this character's name and layout put them.
  // The slot keeps its empty ☆ until the bead arrives. It is a separate
  // element inside the starline so it inherits the line's size and colour
  // while the star it replaces is still hidden.
  const ghost = adopt(h('i.star.empty.promotion-ghost', { 'aria-hidden': 'true' }, '☆'));
  const inLine = rectIn(parts.starline, parts.newStar);
  Object.assign(ghost.style, {
    left: `${inLine.left}px`, top: `${inLine.top}px`,
    width: `${inLine.width}px`, height: `${inLine.height}px`
  });
  parts.starline.appendChild(ghost);

  const bead = adopt(h('div.promotion-bead'));
  page.appendChild(bead);
  const bar = rectIn(page, parts.bar);
  const slot = rectIn(page, parts.newStar);
  bead.style.left = `${bar.right - 4}px`;
  bead.style.top = `${bar.top + bar.height / 2 - 4}px`;
  animate(bead, [
    { opacity: 0, transform: 'translate(0,0) scale(1)', offset: 0 },
    { opacity: 1, offset: .08 },
    {
      opacity: 1, offset: 1,
      transform: `translate(${slot.left + slot.width / 2 - bar.right}px,`
        + `${slot.top + slot.height / 2 - bar.top - bar.height / 2}px) scale(.55)`
    }
  ], {
    duration: BEATS.travel + BEATS.travelDuration - BEATS.collapse,
    delay: BEATS.collapse, easing: 'cubic-bezier(.4,0,.3,1)'
  });
  // The empty ☆ fades out to meet it.
  animate(ghost, [{ opacity: 1 }, { opacity: 0 }],
    { duration: BEATS.travelDuration, delay: BEATS.travel, easing: 'ease-in' });

  // ---- 1100–1620 · strike -------------------------------------------------
  at(BEATS.strike, () => { bead.remove(); ghost.remove(); });
  const bloom = adopt(h('div.promotion-bloom'));
  bloom.style.left = `${slot.left + slot.width / 2}px`;
  bloom.style.top = `${slot.top + slot.height / 2}px`;
  page.appendChild(bloom);
  animate(bloom, [
    { opacity: 0, transform: 'translate(-50%,-50%) scale(.18)' },
    { opacity: 1, transform: 'translate(-50%,-50%) scale(.8)', offset: .18 },
    { opacity: 0, transform: 'translate(-50%,-50%) scale(1.4)' }
  ], { duration: 500, delay: BEATS.strike, easing: 'cubic-bezier(.2,.8,.3,1)' });
  animate(parts.newStar, [
    { opacity: 0, transform: 'scale(2.8) rotate(-26deg)' },
    { opacity: 1, transform: 'scale(1.18) rotate(0deg)', offset: .55 },
    { opacity: 1, transform: 'scale(1) rotate(0deg)' }
  ], { duration: BEATS.strikeDuration, delay: BEATS.strike, easing: 'cubic-bezier(.2,.9,.3,1)' });
  parts.newStar.classList.add('promotion-new');
  cleanups.push(() => parts.newStar.classList.remove('promotion-new'));
  // The stars already earned flare once, and only once.
  parts.earnedStars.forEach((star, index) => animate(star, [
    { filter: 'brightness(1)' },
    { filter: 'brightness(2.2)', offset: .28 },
    { filter: 'brightness(1)' }
  ], { duration: 620, delay: BEATS.strike + 40 + index * 30, easing: 'ease-out' }));

  // ---- 1100–1950 · the number answers -------------------------------------
  rollNumber(parts.power, promotion.powerBefore, promotion.powerAfter,
    { at, frames, delay: BEATS.roll, duration: BEATS.rollDuration });
  animate(parts.power, [
    { transform: 'scale(1)' },
    { transform: 'scale(1.06)', offset: .25 },
    { transform: 'scale(1)' }
  ], { duration: 700, delay: BEATS.roll, easing: 'ease-out' });
  if (parts.rank) at(BEATS.roll, () => { parts.rank.textContent = parts.rankPayoff; });

  // ---- 1200–2600 · the art relights ---------------------------------------
  // The ambient radial in their colour grows and stays; one sheen crosses the
  // full body; seven embers drift up and die. No confetti, no burst.
  page.classList.add('promotion-relit');
  const sheen = adopt(h('div.promotion-sheen'));
  parts.art.appendChild(sheen);
  animate(sheen, [
    { opacity: 0, transform: 'translateX(-70%) skewX(-12deg)' },
    { opacity: .5, offset: .25 },
    { opacity: 0, transform: 'translateX(160%) skewX(-12deg)' }
  ], { duration: 900, delay: BEATS.relight, easing: 'ease-in-out' });
  for (let i = 0; i < EMBER_COUNT; i++) {
    const ember = adopt(h('div.promotion-ember'));
    const size = 3 + (i % 3);
    const [colour, glow] = EMBERS[i % EMBERS.length];
    ember.style.setProperty('--ember', colour);
    ember.style.setProperty('--ember-glow', glow);
    Object.assign(ember.style, {
      width: `${size}px`, height: `${size}px`,
      left: `${12 + (i * 13) % 74}%`, bottom: `${6 + (i * 7) % 22}%`
    });
    parts.art.appendChild(ember);
    animate(ember, [
      { opacity: 0, transform: 'translateY(0) scale(1)' },
      { opacity: .85, offset: .12 },
      { opacity: 0, transform: 'translateY(-260px) scale(.35)' }
    ], { duration: BEATS.relightDuration, delay: BEATS.relight + i * 90, easing: 'ease-out' });
  }

  // ---- 1800–2300 · the sentence -------------------------------------------
  animate(payoff.headline, [
    { opacity: 0, transform: 'translateY(14px)' },
    { opacity: 1, transform: 'translateY(0)' }
  ], { duration: BEATS.sentenceDuration, delay: BEATS.sentence, easing: 'cubic-bezier(.2,.9,.3,1)' });

  // ---- 2400–3700 · the consequences ---------------------------------------
  // Three lines, each naming something newly possible. This is the reward.
  payoff.lines.forEach((line, index) => animate(line, [
    { opacity: 0, transform: 'translateY(10px)' },
    { opacity: 1, transform: 'translateY(0)' }
  ], {
    duration: BEATS.lineDuration, easing: 'cubic-bezier(.2,.9,.3,1)',
    delay: BEATS.lines + index * BEATS.lineStagger
  }));

  // ---- the hold, and then it is just the character screen ------------------
  at(BEATS.settle, () => sequence.settle());
}

// ------------------------------------------------------------------ internals

function findParts(page) {
  const starline = page.querySelector('.starline');
  const stars = starline ? [...starline.querySelectorAll('.star')] : [];
  const earned = stars.filter(star => star.classList.contains('earned'));
  const bar = page.querySelector('.character-progress');
  return {
    page, starline, bar,
    body: page.querySelector('.character-body'),
    newStar: earned.at(-1) ?? null,
    earnedStars: earned.slice(0, -1),
    fill: bar?.firstElementChild ?? null,
    power: page.querySelector('.character-power .display-l'),
    rank: page.querySelector('.character-power .power-rank'),
    art: page.querySelector('.character-art'),
    leaving: [...page.querySelectorAll(
      '.character-gear, .character-disclosures, .character-actions, .character-shard-note, .character-assignments')],
    dimming: [...page.querySelectorAll('.character-body > .eyebrow'),
      ...document.querySelectorAll('.character-back')]
  };
}

// The payoff stands exactly where the gear row was, which is the space the
// second beat cleared for it.
function buildPayoff(store, promotion, parts) {
  const anchor = parts.leaving.find(element => element.classList.contains('character-gear'))
    ?? parts.leaving[0];
  const element = h('div.promotion-payoff');
  if (anchor) {
    Object.assign(element.style, {
      top: `${anchor.offsetTop}px`, left: `${anchor.offsetLeft}px`, width: `${anchor.offsetWidth}px`
    });
  }
  const headline = h('div.promotion-headline', promotion.headline);
  element.appendChild(headline);
  const lines = promotion.consequences.map(line => {
    const row = h(`div.promotion-line.${line.tone}`, h('span.promotion-dot'), h('p', line.text));
    element.appendChild(row);
    return row;
  });

  // The rank line the screen renders on its own is the settled reading; while
  // the moment plays it names who was passed instead.
  parts.rankSettled = parts.rank?.textContent ?? '';
  const shift = rankShift(store.content, store.state, promotion.characterId, promotion.before);
  parts.rankPayoff = shift?.passed.length
    ? `power · ${ordinal(shift.rank)} of ${shift.total} — past ${shift.passed[0]}`
    : parts.rankSettled;
  return { element, headline, lines };
}

// Tabular figures are set in CSS, so nothing jitters as the number rolls.
function rollNumber(element, from, to, { at, frames, delay, duration }) {
  at(delay, () => {
    const start = performance.now();
    const step = now => {
      const t = Math.min(1, (now - start) / duration);
      element.textContent = fmt(Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frames.push(requestAnimationFrame(step));
    };
    frames.push(requestAnimationFrame(step));
  });
}

// The gear row's space is where the payoff belongs, but on a short window
// three lines can fall below the fold. Lift the block just enough to fit,
// never above the power reading it is answering.
function fitPayoff(element, parts) {
  const main = document.getElementById('main');
  if (!main) return;
  const top = element.offsetTop;
  const withinContent = element.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
  const overflow = withinContent + element.offsetHeight + 24 - main.clientHeight;
  if (overflow <= 0) return;
  const floor = (parts.bar?.offsetTop ?? 0) + 56;
  element.style.top = `${Math.max(floor, top - overflow)}px`;
}

function bringIntoView(element, reduced) {
  const main = document.getElementById('main');
  if (!main || !element || element.getBoundingClientRect().top >= 0) return;
  main.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
}

function rectIn(container, element) {
  const base = container.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left - base.left, top: rect.top - base.top,
    right: rect.right - base.left, width: rect.width, height: rect.height
  };
}

function prefersReducedMotion(store) {
  return store.state.settings.reducedMotion
    || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
}
