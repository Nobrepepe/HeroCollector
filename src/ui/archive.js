// World Archive (GDD 11.2, §10): collection shelves, fragment progress, lore,
// cosmetic milestone rewards, completion percentage. Cosmetic only — never
// grants Power or anything the Main Campaign requires.
import { h, fmt } from './dom.js';
import { archiveStatus } from '../core/state.js';
import { openModal } from '../app.js';
import { campaignLabel } from './shared.js';

export function renderArchive(store, root) {
  const { content, state } = store;
  root.appendChild(h('p.muted.small', 'The Archive celebrates a world you have invested in. Rewards are cosmetic and lore only — nothing here is required by the Main Campaign.'));

  for (const world of content.worlds) {
    const st = archiveStatus(content, state, world.id);
    const panel = h('div.panel');
    const pctDone = Math.round(st.fragmentsOwned / st.fragmentsTotal * 100);
    panel.appendChild(h('h2', `${world.icon} ${st.archive.displayName} `,
      h('span.small.muted', `— ${st.relicsDone}/${st.relicsTotal} relics · ${pctDone}% complete`)));
    const bar = h('div.progressbar' + (st.complete ? '.full' : ''));
    bar.appendChild(h('div', { style: { width: `${pctDone}%` } }));
    panel.appendChild(bar);

    st.collections.forEach((col, ci) => {
      panel.appendChild(h('h3', `Collection ${ci + 1}: ${col.collection.displayName}`,
        col.complete ? h('span.good', ' ✓') : null));
      const shelf = h('div.archive-shelf');
      for (const { relic, owned, total, complete } of col.relics) {
        const card = h('div.relic-card' + (complete ? '.complete' : ''));
        const img = content.images.relic[relic.id];
        if (complete && img) card.appendChild(h('div.relic-art', h('img', { src: img, alt: relic.displayName })));
        else card.appendChild(h('div.r-ico', complete ? relicIcon(relic.id) : '▢'));
        card.appendChild(h('div.small', { style: { fontWeight: 600 } }, complete ? relic.displayName : '— Undiscovered —'));
        const pips = h('div.frag-pips');
        relic.fragments.forEach(f => pips.appendChild(h('span' + (state.archive.fragments[f.id] ? '.owned' : ''), { title: fragTitle(store, f) })));
        card.appendChild(pips);
        card.appendChild(h('div.small.muted', `${owned}/${total} fragments`));
        if (complete) {
          card.appendChild(h('button.btn.tiny', { style: { marginTop: '6px' }, onclick: () => inspectRelic(store, relic) }, 'Inspect'));
        } else {
          const missing = relic.fragments.filter(f => !state.archive.fragments[f.id]);
          card.appendChild(h('div.small.muted', missing.map(f => h('div', fragTitle(store, f)))));
        }
        shelf.appendChild(card);
      }
      panel.appendChild(shelf);
      const reward = col.collection.rewardSkin;
      if (reward) {
        panel.appendChild(h('p.small' + (col.complete ? '.good' : '.muted'),
          `${col.complete ? '🎭 Unlocked: ' : '🎭 Collection reward: '}${reward.skinName} for ${content.characterById[reward.characterId].displayName}`));
        const rewardImgs = content.images.skin[reward.id];
        if (col.complete && rewardImgs) {
          panel.appendChild(h('div', { style: { display: 'flex', gap: '10px' } },
            rewardImgs.portrait ? h('img.skin-preview-sq', { src: rewardImgs.portrait, alt: reward.skinName }) : null,
            rewardImgs.fullBody ? h('img.skin-preview-tall', { src: rewardImgs.fullBody, alt: reward.skinName }) : null));
        }
      } else if (col.collection.legacyMilestoneText) {
        panel.appendChild(h('p.small.muted', col.collection.legacyMilestoneText));
      }
    });

    panel.appendChild(h('h3', 'Full Archive reward'));
    panel.appendChild(h('p.small' + (st.complete ? '.good' : '.muted'),
      `${st.complete ? '🎭 Unlocked: ' : '🎭 '}${st.archive.fullReward.skinName}`,
      st.complete ? '' : ` — complete all ${st.relicsTotal} relics.`));
    const skinImgs = content.images.skin[st.archive.fullReward.id];
    if (st.complete && skinImgs) {
      panel.appendChild(h('div', { style: { display: 'flex', gap: '10px' } },
        skinImgs.portrait ? h('img.skin-preview-sq', { src: skinImgs.portrait, alt: 'Skin portrait' }) : null,
        skinImgs.fullBody ? h('img.skin-preview-tall', { src: skinImgs.fullBody, alt: 'Skin full body' }) : null));
      panel.appendChild(h('p.small.muted', `Wear it from ${content.characterById[st.archive.fullReward.characterId]?.displayName}’s character screen.`));
    }
    root.appendChild(panel);
  }
}

function relicIcon(id) {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const icons = ['🏺', '📜', '🕯️', '🗝️', '🔔', '🪞', '🧭', '🎖️', '💠', '🎐'];
  return icons[hash % icons.length];
}

function fragTitle(store, frag) {
  const node = store.content.nodeById[frag.sourceNode];
  return `First clear: ${campaignLabel(store, node)} ${node.number} — ${node.displayName}`;
}

function inspectRelic(store, relic) {
  openModal((modal, close) => {
    modal.appendChild(h('h2', `${relicIcon(relic.id)} ${relic.displayName}`));
    modal.appendChild(h('p', relic.lore));
    modal.appendChild(h('p.small.muted', 'Recovered from: ', relic.fragments.map(f => fragTitle(store, f)).join(' · ')));
    modal.appendChild(h('button.btn', { onclick: close }, 'Close'));
  });
}
