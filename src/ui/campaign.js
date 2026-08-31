import { enableMouseDragScroll, h, fmt } from './dom.js';
import { nodeState, nodeUnlocked, worldCampaignUnlocked } from '../core/state.js';
import { rankMaterialSources } from '../core/sources.js';
import { sourceRow } from './find-sources.js';
import { compactResult } from './results.js';
import { campaignLabel, selectorWorldName } from './shared.js';

import { sceneImage } from './presentation.js';

export function renderCampaign(store, root, arg) {
  const { content, state } = store;
  // Journey holds the Main Campaign, the one path that belongs to no single
  // world. A world's own chapters are reached through that world's hub, so
  // they render here with a way back to it instead of a tab beside Main.
  const [argCampaign, argChapter] = (arg ?? '').split('/');
  const worldCampaign = content.worlds.find(candidate => candidate.campaignId === argCampaign) ?? null;
  if (!worldCampaign) state.ui.campaignId = 'main';
  const current = worldCampaign ? worldCampaign.campaignId : 'main';
  const nodes = content.nodesByCampaign[current] ?? [];
  const chapters = [...new Set(nodes.map(node => node.chapter))].sort((a, b) => a - b);
  const remembered = store.ui.journeyChapterByCampaign ??= {};
  const requestedChapter = Number(argChapter);
  let chapter = chapters.includes(requestedChapter)
    ? requestedChapter
    : chapters.includes(remembered[current]) ? remembered[current] : standingChapter(state, nodes, chapters);
  remembered[current] = chapter;
  const chapterIndex = chapters.indexOf(chapter);
  const chapterNodes = nodes.filter(node => node.chapter === chapter);
  // Main and Shadow nodes still carry world metadata for rewards/artwork. Only
  // a campaign authored as a world campaign should show its entry lock.
  const world = content.worlds.find(candidate => candidate.campaignId === current) ?? null;
  const scene = sceneImage(store, chapterNodes[0]);
  const direction = store.ui.journeyDirection;
  store.ui.journeyDirection = null;

  const page = h(`div.journey-page${direction ? `.journey-slide-${direction}` : ''}`);
  page.appendChild(h('div.journey-landscape' + (scene ? '' : '.art-fallback'), {
    style: scene ? { backgroundImage: `url("${scene}")` } : {}
  }));
  const header = h('header.journey-head',
    h('div.eyebrow', `${campaignName(content, current)} · chapter ${chapter} of ${chapters.length || 1}`),
    h('h1.display-s', chapterTitle(chapterNodes, world, current, chapter)),
    h('p', chapterDescription(world, current, chapter)));
  // A Crisis is announced and answered from its world hub, never from a
  // chapter path that happens to share its world.
  if (worldCampaign) {
    header.appendChild(h('p.journey-worlds-link',
      h('button.link', { onclick: () => store.go(`#/worlds/${worldCampaign.id}`) },
        `← ${worldCampaign.displayName}`)));
  }
  page.appendChild(header);
  if (store.ui.lastSourceResult) page.appendChild(compactResult(store, store.ui.lastSourceResult));

  if (world) {
    const availability = worldCampaignUnlocked(content, state, world.id);
    if (!availability.unlocked) page.appendChild(h('p.journey-lock.warn',
      `Previewing a locked campaign · own ${availability.needed} ${world.displayName} characters to enter (${availability.owned}/${availability.needed}).`));
  }

  // The path can only be centred once it is on the page and has a width, so
  // the section hands back the one step that has to wait for that.
  let centrePath = null;
  if (chapterNodes.length) {
    const built = chapterPath(store, chapter, chapterNodes);
    centrePath = built.centre;
    page.appendChild(built.section);
  } else page.appendChild(h('p.muted.journey-empty', 'This campaign has no authored chapters yet.'));

  page.appendChild(h('nav.chapter-navigation', { 'aria-label': 'Campaign chapters' },
    h('button.chapter-nav.previous', {
      disabled: chapterIndex <= 0,
      onclick: () => changeChapter(store, current, chapters[chapterIndex - 1], 'backward')
    }, h('span', '←'), h('span', h('small', 'Previous chapter'),
      chapterIndex > 0 ? `Chapter ${chapters[chapterIndex - 1]}` : 'Beginning')),
    h('div.chapter-position', chapters.map(number => h('i' + (number === chapter ? '.active' : ''), {
      title: `Chapter ${number}`, 'aria-hidden': 'true'
    }))),
    h('button.chapter-nav.next', {
      disabled: chapterIndex < 0 || chapterIndex >= chapters.length - 1,
      onclick: () => changeChapter(store, current, chapters[chapterIndex + 1], 'forward')
    }, h('span', h('small', 'Next chapter'),
      chapterIndex >= 0 && chapterIndex < chapters.length - 1 ? `Chapter ${chapters[chapterIndex + 1]}` : 'End of campaign'), h('span', '→'))));
  root.appendChild(page);
  centrePath?.();
}

// Opening the Journey cold lands where the campaign actually stands. Chapter
// one is only the right answer on the first day; after that it is ground the
// player has to page past to reach the one node they came here for.
function standingChapter(state, nodes, chapters) {
  const next = nodes.find(node => !nodeState(state, node.id).cleared);
  return next?.chapter ?? chapters.at(-1) ?? 1;
}

function changeChapter(store, campaign, chapter, direction) {
  if (!chapter) return;
  store.ui.journeyDirection = direction;
  store.go(`#/campaign/${campaign}/${chapter}`);
}

function chapterPath(store, chapter, nodes) {
  const { content, state } = store;
  const frontier = nodes.find(node => !nodeState(state, node.id).cleared);
  const firstUnlocked = nodes.find(node => nodeUnlocked(content, state, node).unlocked && !nodeState(state, node.id).cleared);
  const section = h('section.journey-chapter',
    h('div.journey-chapter-title',
      h('div', h('div.eyebrow', `Chapter ${chapter} path`),
        h('div.caption', `${nodes.filter(node => nodeState(state, node.id).cleared).length} of ${nodes.length} cleared`)),
      frontier && !nodeUnlocked(content, state, frontier).unlocked ? h('div.caption', 'Future ground · preview only') : null));
  // The path is wider than most screens and its far end is where the player is
  // heading, so it scrolls on its own — dragged with the mouse the way the
  // Collection shelf does — and opens on the node they are standing at.
  const path = h('div.journey-path');
  const track = h('div.journey-track');
  enableMouseDragScroll(path);
  let standing = null;
  nodes.forEach((node, index) => {
    const ns = nodeState(state, node.id);
    const unlock = nodeUnlocked(content, state, node);
    const status = ns.cleared ? 'cleared' : node.id === firstUnlocked?.id ? 'frontier' : unlock.unlocked ? 'next' : 'locked';
    // The path shows the name alone — long names used to collide with the gate
    // line beneath them. The gate reading lives on the node screen instead.
    const button = h('button.journey-node.' + status, {
      style: { '--path-y': `${[0, -22, 14, -8, 25, -16, 8, -25, 18, 0][index % 10]}px` },
      onclick: () => store.go(`#/node/${node.id}`),
      'aria-label': `${campaignLabel(store, node)} ${node.number}, ${node.displayName}, ${status}`
    }, h('span.journey-dot'), h('span.journey-node-name', node.displayName));
    if (status === 'frontier' || (!standing && !ns.cleared)) standing = button;
    track.appendChild(button);
  });
  path.appendChild(track);
  section.appendChild(path);

  const focus = firstUnlocked ?? frontier ?? nodes.at(-1);
  if (focus) {
    const unlock = nodeUnlocked(content, state, focus);
    const projection = rankMaterialSources(content, state, focus.material).find(row => row.node.id === focus.id);
    section.appendChild(h('div.journey-orientation',
      h('div', h('div.eyebrow', unlock.unlocked ? 'Where you stand' : 'Looking ahead'),
        h('p', unlock.unlocked
          ? `${focus.displayName} is the next threshold. ${projection?.check.evalResult
            ? `Your selected party reads ${fmt(projection.check.evalResult.effectivePower)} against ${fmt(focus.threshold)}.`
            : 'Choose a complete party to read the gate.'}`
          : `${focus.displayName} needs ${fmt(focus.threshold)} Power. ${unlock.reason}`)),
      h('button.btn.primary', { onclick: () => store.go(`#/node/${focus.id}`) },
        unlock.unlocked ? `Enter ${focus.displayName} →` : `Preview ${focus.displayName} →`)));
    if (projection?.sweepable) {
      const pop = h('details.journey-sweep', h('summary', 'Farm this frontier'));
      pop.appendChild(sourceRow(store, projection, {
        onUpdate: () => {
          const root = document.getElementById('screen');
          root.replaceChildren();
          renderCampaign(store, root, `${focus.campaign}/${chapter}`);
        }
      }));
      section.appendChild(pop);
    }
  }
  // Opening a chapter puts the node you are standing at in the middle of the
  // path rather than making you drag to find it.
  const centre = () => {
    if (!standing || !path.clientWidth) return;
    path.scrollLeft = Math.max(0, standing.offsetLeft - (path.clientWidth - standing.offsetWidth) / 2);
  };
  return { section, centre };
}

function campaignName(content, id) {
  if (id === 'main') return 'Main';
  return content.worlds.find(world => world.campaignId === id)?.displayName ?? 'Journey';
}

function chapterTitle(nodes, world, campaign, chapter) {
  if (nodes[0]?.chapterTitle) return nodes[0].chapterTitle;
  if (world) return `${world.displayName} · Chapter ${chapter}`;
  return `Main Chapter ${chapter}`;
}

function chapterDescription(world, campaign, chapter) {
  if (world) return world.tagline;
  return `Ten thresholds shape Chapter ${chapter}. Every clear moves the frontier one step farther.`;
}
