// Image import pipeline for the Content Creator. Imported files are
// center-cropped to the target aspect ratio, downscaled, and written to the
// art/ folder; the database stores only the relative path. Sizes below are the
// storage ceiling, so they track how large each kind is ever drawn on screen.
import { h } from './dom.js';
import { artStorageAvailable, deleteArt, listArt, writeArt } from '../platform.js';

const ART_PREFIX = 'art/';

// Every art path the database still points at. A plain deep walk is both
// complete and safe: no other field holds an art/ reference.
export function referencedArtFiles(db) {
  const names = new Set();
  const walk = node => {
    if (typeof node === 'string') {
      if (node.startsWith(ART_PREFIX)) names.add(node.slice(ART_PREFIX.length));
      return;
    }
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(db);
  return names;
}

// Compares the database against the art folder. `missing` means a reference
// with no file (an interrupted pull, or a pack imported without its art);
// `orphans` means a file nothing points at any more.
export async function auditArt(db) {
  const referenced = referencedArtFiles(db);
  const files = new Set(await listArt());
  return {
    referenced,
    missing: [...referenced].filter(name => !files.has(name)).sort(),
    orphans: [...files].filter(name => !referenced.has(name)).sort()
  };
}

export async function deleteOrphanArt(db) {
  const { orphans } = await auditArt(db);
  if (!orphans.length) return 0;
  return deleteArt(orphans);
}

// Canonical image kinds and their target aspect/size.
export const IMAGE_KINDS = {
  // Never drawn wider than ~250 CSS px (the expedition slot); most slots are
  // 88-200 px. 640 leaves headroom for high-DPI displays.
  portrait:  { w: 640, h: 360, label: 'Eye tile (16:9 PNG with transparency)', contain: true, preserveAlpha: true },
  fullBody:  { w: 576,  h: 1024, label: 'Full body (9:16, taller than wide)' },
  world:     { w: 1024, h: 576,  label: 'World banner (16:9, wider than tall)' },
  chapter:   { w: 1280, h: 720,  label: 'Chapter key art (16:9, wider than tall)' },
  equipment: { w: 256,  h: 256,  label: 'Equipment (square)' },
  relic:     { w: 1024, h: 576,  label: 'Relic (16:9, wider than tall)' },
  hq:        { w: 1280, h: 720,  label: 'Headquarters background (16:9)' },
  facility:  { w: 1024, h: 576,  label: 'Headquarters building art (16:9)' },
  expedition: { w: 660, h: 860, label: 'Expedition offer art (33:43, taller than wide)' },
  crisis: { w: 1280, h: 720, label: 'Crisis key art (16:9, wider than tall)' }
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
    const scale = (spec.contain ? Math.min : Math.max)(spec.w / bitmap.width, spec.h / bitmap.height);
    const sw = spec.w / scale, sh = spec.h / scale;
    if (spec.contain) {
      const dw = bitmap.width * scale, dh = bitmap.height * scale;
      ctx.drawImage(bitmap, (spec.w - dw) / 2, (spec.h - dh) / 2, dw, dh);
    } else {
      const sx = (bitmap.width - sw) / 2, sy = (bitmap.height - sh) / 2;
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, spec.w, spec.h);
    }
    bitmap.close();
    let blob = await encode(canvas, 'image/webp', 0.82);
    if (blob?.type !== 'image/webp') {
      blob = spec.preserveAlpha
        ? await encode(canvas, 'image/png')
        : await encode(canvas, 'image/jpeg', 0.85);
    }
    if (!blob) return null;
    const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'webp';
    if (!artStorageAvailable) return await blobToDataUrl(blob);
    const stored = await writeArt(new Uint8Array(await blob.arrayBuffer()), extension);
    return stored ?? await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

function encode(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

// Browser fallback only: without a writable art folder the image stays inline.
function blobToDataUrl(blob) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
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
