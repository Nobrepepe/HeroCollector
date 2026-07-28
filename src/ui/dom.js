// Tiny DOM helpers: h('div.cls', {attrs}, ...children) element builder.

export function h(spec, attrs, ...children) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs) && typeof attrs !== 'string') {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'onclick' || k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      }
      else if (k in el && k !== 'list' && k !== 'form' && k !== 'type') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
      else el.setAttribute(k, v === true ? '' : v);
    }
  } else if (attrs !== undefined && attrs !== null) {
    children.unshift(attrs);
  }
  append(el, children);
  return el;
}

function append(el, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) { for (const c of child) append(el, c); return; }
  if (child instanceof Node) { el.appendChild(child); return; }
  el.appendChild(document.createTextNode(String(child)));
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

export function fmt(n) { return Number(n).toLocaleString('en-US'); }

export function pct(bp) {
  const v = bp / 100;
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(2)}%`;
}

export function stars(n, max = 7) {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n));
}
