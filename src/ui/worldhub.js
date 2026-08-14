// World Hub Content screen: install, link, preview, activate, roll back.
// In Hub mode the Content Creator is retired and canonical content comes
// from the installed immutable publication.
import { h, clear } from './dom.js';
import { worldhub } from '../platform.js';

export function renderWorldHub(store) {
  const root = h('div.screen.worldhub-screen');
  const body = h('div.panel');
  root.appendChild(h('h1', 'World Hub Content'));
  root.appendChild(body);

  if (!worldhub.available()) {
    body.appendChild(h('p.muted',
      'World Hub packages install through the desktop app. The browser build stays on legacy content.'));
    return root;
  }

  const rerender = () => { clear(body); draw(); };

  const showPreview = (staged) => {
    if (!staged) return;
    if (staged.error) {
      body.appendChild(h('p.warn', `The package was refused: ${staged.error}`));
      return;
    }
    const lines = [];
    if (staged.alreadyActive) lines.push('This publication is already active.');
    if (staged.addedCharacters?.length) lines.push(`Characters added: ${staged.addedCharacters.join(', ')}`);
    if (staged.updatedCharacters?.length) lines.push(`Characters updated: ${staged.updatedCharacters.join(', ')}`);
    if (staged.retiredCharacters?.length) {
      lines.push(`Characters retiring (saves keep their data dormant): ${staged.retiredCharacters.join(', ')}`);
    }
    if (!lines.length) lines.push('No visible content changes.');
    const dialog = h('div.panel.wh-preview',
      h('h2', `Activate “${staged.productionName}”?`),
      h('p.muted', `Revision ${staged.productionRevision}, published ${String(staged.publishedAt).slice(0, 10)}.`),
      ...lines.map(line => h('p', line)),
      h('p.muted', 'Your save, resources, and progress are never touched. If activation fails, current content stays live.'),
      h('div.row',
        h('button.btn.primary', {
          onclick: async () => {
            const result = await worldhub.activate(staged.stagingId);
            if (result?.error) { body.appendChild(h('p.warn', result.error)); return; }
            location.reload(); // rebuild content from the newly active publication
          }
        }, 'Activate'),
        h('button.btn', {
          onclick: async () => { await worldhub.discard(staged.stagingId); rerender(); }
        }, 'Cancel'),
      ),
    );
    body.appendChild(dialog);
  };

  async function draw() {
    const status = await worldhub.status();
    if (status.hubMode) {
      const receipt = status.receipt ?? {};
      body.appendChild(h('p',
        `Hub mode — “${receipt.productionName ?? 'unknown production'}” revision ${receipt.productionRevision ?? '?'}, ` +
        `publication ${String(status.publicationId).slice(0, 8)}…, imported ${String(receipt.importedAt ?? '').slice(0, 10)}.`));
      body.appendChild(h('p.muted',
        'The Content Creator is retired while a publication is active; canonical content comes from World Hub. ' +
        'Legacy Creator data is untouched and returns if no publication is active.'));
    } else {
      body.appendChild(h('p',
        'Legacy mode — content comes from the Content Creator. Install a World Hub publication to make the Hub the content source.'));
    }
    if (status.linkedFolder) {
      body.appendChild(h('p.muted', `Linked production folder: ${status.linkedFolder}`));
    }

    body.appendChild(h('div.row.wh-actions',
      h('button.btn', {
        onclick: async () => { showPreview(await worldhub.stageZip()); }
      }, 'Install publication ZIP…'),
      h('button.btn', {
        onclick: async () => { showPreview(await worldhub.stageFolder(null)); }
      }, 'Link production folder…'),
      status.linkedFolder ? h('button.btn', {
        onclick: async () => { showPreview(await worldhub.stageFolder(status.linkedFolder)); }
      }, 'Check for update') : null,
      status.previousPublicationId ? h('button.btn', {
        onclick: async () => {
          const result = await worldhub.rollback();
          if (result?.error) { body.appendChild(h('p.warn', result.error)); return; }
          location.reload();
        }
      }, 'Roll back') : null,
    ));

    body.appendChild(h('p.muted',
      'Publications are copied into this app’s own data directory, so the game keeps working when the Hub library or drive is unavailable.'));
  }

  draw();
  return root;
}
