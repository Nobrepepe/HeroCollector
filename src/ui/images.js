// Image import pipeline for the Content Creator. Imported files are
// center-cropped to the target aspect ratio, downscaled, and stored as
// compressed data URLs inside the custom-content database — no asset folders.
import { h } from './dom.js';

// Canonical image kinds and their target aspect/size.
export const IMAGE_KINDS = {
  portrait:  { w: 512,  h: 512,  label: 'Portrait (square)' },
  fullBody:  { w: 576,  h: 1024, label: 'Full body (9:16, taller than wide)' },
  world:     { w: 1024, h: 576,  label: 'World banner (16:9, wider than tall)' },
  chapter:   { w: 1280, h: 720,  label: 'Chapter key art (16:9, wider than tall)' },
  equipment: { w: 256,  h: 256,  label: 'Equipment (square)' },
  relic:     { w: 1024, h: 576,  label: 'Relic (16:9, wider than tall)' }
};

export function pickAndProcessImage(kind) {
  const spec = IMAGE_KINDS[kind];
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      resolve(await processImageFile(kind, file));
    };
    input.click();
  });
}

async function processImageFile(kind, file) {
  const spec = IMAGE_KINDS[kind];
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = spec.w;
    canvas.height = spec.h;
    const ctx = canvas.getContext('2d');
    const scale = Math.max(spec.w / bitmap.width, spec.h / bitmap.height);
    const sw = spec.w / scale, sh = spec.h / scale;
    const sx = (bitmap.width - sw) / 2, sy = (bitmap.height - sh) / 2;
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, spec.w, spec.h);
    bitmap.close();
    let url = canvas.toDataURL('image/webp', 0.82);
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.85);
    return url;
  } catch {
    return null;
  }
}

// A labeled image slot: preview + Import + Remove. `get`/`set` read and write
// the data URL in the custom DB; `onChange` persists and re-renders.
export function imageWell(kind, label, get, set, onChange) {
  const spec = IMAGE_KINDS[kind];
  const current = get();
  const wrap = h('div.image-well');
  const preview = h('div.image-preview', {
    style: { aspectRatio: `${spec.w} / ${spec.h}`, width: spec.w >= spec.h ? '180px' : `${Math.round(180 * spec.w / spec.h)}px` },
    tabindex: '0', role: 'button', 'aria-label': `${current ? 'Replace' : 'Import'} ${label}. You can also drop an image here.`
  });
  const receive = async file => {
    if (!file?.type?.startsWith('image/')) return;
    const url = await processImageFile(kind, file);
    if (url) { set(url); onChange(); }
  };
  preview.addEventListener('dragover', event => { event.preventDefault(); preview.classList.add('dragging'); });
  preview.addEventListener('dragleave', () => preview.classList.remove('dragging'));
  preview.addEventListener('drop', event => {
    event.preventDefault(); preview.classList.remove('dragging'); receive(event.dataTransfer.files[0]);
  });
  preview.addEventListener('click', async () => {
    const url = await pickAndProcessImage(kind);
    if (url) { set(url); onChange(); }
  });
  preview.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); preview.click(); }
  });
  if (current) {
    preview.appendChild(h('img', { src: current, alt: label }));
  } else {
    preview.appendChild(h('div.image-empty', `${spec.w}×${spec.h}`));
  }
  wrap.appendChild(h('div.small', label));
  wrap.appendChild(preview);
  wrap.appendChild(h('div', { style: { display: 'flex', gap: '6px' } },
    h('button.btn.tiny', {
      onclick: async () => {
        const url = await pickAndProcessImage(kind);
        if (url) { set(url); onChange(); }
      }
    }, current ? 'Replace…' : 'Import…'),
    current ? h('button.btn.tiny.danger', { onclick: () => { set(null); onChange(); } }, 'Remove') : null
  ));
  return wrap;
}
