import svgpath from 'svgpath';
import { createRequire } from 'node:module';
import { SUPPORTED_SHAPES, UNSUPPORTED, shapeBBox, unionBBox, parseViewBox, metricsForBBox, hasPaint, num } from './geometry.mjs';
import { modeOf } from './profile.mjs';

const require = createRequire(import.meta.url);
const pathParse = require('svgpath/lib/path_parse');
const PRESENTATION = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-rule', 'clip-rule'];
const DEFAULTS = { fill: 'black', stroke: 'none', 'stroke-width': '1', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter' };
const RELEVANCE_EPS = 1e-6;

export function resolveIcon(parsed, file) {
  const derivation = { bbox: 'none', unsupported_elements: [], style_sheet: 'n/a', render_relevance: { cap_ambiguous: 0, join_ambiguous: 0 } };
  const rootAttrs = parsed.attributes ?? {};
  if ((parsed.children ?? []).some((c) => c.name === 'style')) derivation.style_sheet = 'unsupported';
  const vb = parseViewBox(rootAttrs);
  const icon = {
    file,
    attrs: rootAttrs,
    viewBox: vb?.values ?? null,
    viewBoxNorm: vb?.norm ?? null,
    aspectRatio: vb ? vb.values[2] / vb.values[3] : null,
    elements: [],
    derivation,
    skippedRules: new Set()
  };
  if (!vb) icon.skippedRules.add('viewbox-dependent');
  walk(parsed, { ...DEFAULTS, ...pick(rootAttrs), ...parseStyle(rootAttrs.style) }, identity(), icon);
  const boxes = icon.elements.map((e) => e.bbox).filter(Boolean);
  icon.bbox = unionBBox(boxes);
  if (icon.bbox) derivation.bbox = derivation.unsupported_elements.length ? 'partial' : 'parsed';
  else if (derivation.unsupported_elements.length) derivation.bbox = 'partial';
  Object.assign(icon, metricsForBBox(icon.bbox, icon.viewBox));
  const stroked = icon.elements.filter((e) => hasPaint(e.attrs.stroke, false));
  icon.strokeWidths = stroked.map((e) => num(e.attrs['stroke-width'], 1));
  icon.strokeWidthRep = icon.strokeWidths.length ? modeOf(icon.strokeWidths.map((v) => String(Number(v.toFixed(6))))) : null;
  if (icon.strokeWidthRep != null) icon.strokeWidthRep = Number(icon.strokeWidthRep);
  resolveStrokeRendering(icon, stroked);
  const paints = icon.elements.map((e) => ({ fill: hasPaint(e.attrs.fill, true), stroke: hasPaint(e.attrs.stroke, false) }));
  icon.hasFillElement = paints.some((p) => p.fill);
  icon.paintStyle = classifyPaint(paints);
  return icon;
}

function resolveStrokeRendering(icon, stroked) {
  const renderStroked = stroked.filter((e) => num(e.attrs['stroke-width'], 1) > 0);
  const capValues = [];
  const joinValues = [];
  let capAmbiguousElements = 0;
  let joinAmbiguousElements = 0;
  for (const el of renderStroked) {
    const cap = capRelevance(el);
    const join = joinRelevance(el);
    icon.derivation.render_relevance.cap_ambiguous += cap.ambiguous;
    icon.derivation.render_relevance.join_ambiguous += join.ambiguous;
    if (cap.ambiguous > 0) capAmbiguousElements++;
    if (join.ambiguous > 0) joinAmbiguousElements++;
    if (cap.relevant) capValues.push(el.attrs['stroke-linecap'] ?? 'butt');
    if (join.relevant) joinValues.push(el.attrs['stroke-linejoin'] ?? 'miter');
  }
  const capExcluded = renderStroked.length > 0 && capAmbiguousElements > renderStroked.length / 2;
  const joinExcluded = renderStroked.length > 0 && joinAmbiguousElements > renderStroked.length / 2;
  if (capExcluded) icon.derivation.render_relevance.linecap_excluded = 'ambiguous-majority';
  if (joinExcluded) icon.derivation.render_relevance.linejoin_excluded = 'ambiguous-majority';
  icon.linecapValues = capExcluded ? [] : capValues;
  icon.linejoinValues = joinExcluded ? [] : joinValues;
  icon.linecapRep = icon.linecapValues.length ? modeOf(icon.linecapValues) : null;
  icon.linejoinRep = icon.linejoinValues.length ? modeOf(icon.linejoinValues) : null;
}

function capRelevance(el) {
  if (el.name === 'line') return { relevant: true, ambiguous: 0 };
  if (el.name === 'polyline') {
    const pts = parsePoints(el.attrs.points);
    if (pts.length < 2) return { relevant: false, ambiguous: 0 };
    if (samePoint(pts[0], pts[pts.length - 1])) return { relevant: false, ambiguous: 1 };
    return { relevant: true, ambiguous: 0 };
  }
  if (el.name === 'path') {
    const subpaths = pathSubpaths(el.attrs.d);
    let relevant = false;
    let ambiguous = 0;
    for (const subpath of subpaths) {
      if (subpath.closed) continue;
      if (samePoint(subpath.start, subpath.end)) {
        ambiguous++;
      } else {
        relevant = true;
      }
    }
    return { relevant, ambiguous };
  }
  return { relevant: false, ambiguous: 0 };
}

function joinRelevance(el) {
  if (el.name === 'polygon') return { relevant: parsePoints(el.attrs.points).length >= 3, ambiguous: 0 };
  if (el.name === 'polyline') return { relevant: parsePoints(el.attrs.points).length >= 3, ambiguous: 0 };
  if (el.name === 'rect') {
    const rounded = (el.attrs.rx != null && num(el.attrs.rx, 0) > 0) || (el.attrs.ry != null && num(el.attrs.ry, 0) > 0);
    return { relevant: !rounded, ambiguous: 0 };
  }
  if (el.name !== 'path') return { relevant: false, ambiguous: 0 };
  let relevant = false;
  let ambiguous = 0;
  for (const subpath of pathSubpaths(el.attrs.d)) {
    for (let i = 1; i < subpath.segments.length; i++) {
      const prev = subpath.segments[i - 1].kind;
      const cur = subpath.segments[i].kind;
      if (prev === 'line' && cur === 'line') relevant = true;
      else if (prev === 'curve' || cur === 'curve') ambiguous++;
    }
    if (subpath.closed && subpath.firstKind && subpath.lastKind) {
      if (subpath.firstKind === 'line' && subpath.lastKind === 'line') relevant = true;
      else if (subpath.firstKind === 'curve' || subpath.lastKind === 'curve') ambiguous++;
    }
  }
  return { relevant, ambiguous };
}

function pathSubpaths(d = '') {
  const parsed = pathParse(String(d));
  if (parsed.err) return [];
  const subpaths = [];
  let cur = [0, 0];
  let start = null;
  let current = null;
  for (const seg of parsed.segments) {
    const cmd = seg[0];
    const lc = cmd.toLowerCase();
    if (lc === 'm') {
      cur = pointFor(cmd, seg, cur);
      start = cur;
      current = { start, end: cur, closed: false, segments: [], firstKind: null, lastKind: null };
      subpaths.push(current);
      continue;
    }
    if (!current) continue;
    if (lc === 'z') {
      current.closed = true;
      current.end = start;
      cur = start;
      continue;
    }
    const kind = lineCommand(lc) ? 'line' : curveCommand(lc) ? 'curve' : null;
    cur = endPointFor(cmd, seg, cur);
    current.end = cur;
    if (kind) {
      current.segments.push({ kind });
      current.firstKind ??= kind;
      current.lastKind = kind;
    }
  }
  return subpaths;
}

function lineCommand(cmd) {
  return cmd === 'l' || cmd === 'h' || cmd === 'v';
}

function curveCommand(cmd) {
  return cmd === 'c' || cmd === 's' || cmd === 'q' || cmd === 't' || cmd === 'a';
}

function pointFor(cmd, seg, cur) {
  return cmd === cmd.toLowerCase() ? [cur[0] + seg[1], cur[1] + seg[2]] : [seg[1], seg[2]];
}

function endPointFor(cmd, seg, cur) {
  const rel = cmd === cmd.toLowerCase();
  switch (cmd.toLowerCase()) {
    case 'l':
    case 'm':
      return rel ? [cur[0] + seg[1], cur[1] + seg[2]] : [seg[1], seg[2]];
    case 'h':
      return rel ? [cur[0] + seg[1], cur[1]] : [seg[1], cur[1]];
    case 'v':
      return rel ? [cur[0], cur[1] + seg[1]] : [cur[0], seg[1]];
    case 'c':
      return rel ? [cur[0] + seg[5], cur[1] + seg[6]] : [seg[5], seg[6]];
    case 's':
    case 'q':
      return rel ? [cur[0] + seg[3], cur[1] + seg[4]] : [seg[3], seg[4]];
    case 't':
      return rel ? [cur[0] + seg[1], cur[1] + seg[2]] : [seg[1], seg[2]];
    case 'a':
      return rel ? [cur[0] + seg[6], cur[1] + seg[7]] : [seg[6], seg[7]];
    default:
      return cur;
  }
}

function parsePoints(s = '') {
  const xs = String(s).trim().split(/[\s,]+/).filter(Boolean).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (Number.isFinite(xs[i]) && Number.isFinite(xs[i + 1])) pts.push([xs[i], xs[i + 1]]);
  return pts;
}

function samePoint(a, b) {
  if (!a || !b) return false;
  return Math.abs(a[0] - b[0]) <= RELEVANCE_EPS && Math.abs(a[1] - b[1]) <= RELEVANCE_EPS;
}

function walk(node, inherited, matrix, icon) {
  const name = node.name;
  if (name && UNSUPPORTED.has(name)) {
    if (!icon.derivation.unsupported_elements.includes(name)) icon.derivation.unsupported_elements.push(name);
    return;
  }
  const attrs = { ...inherited, ...pick(node.attributes ?? {}), ...parseStyle(node.attributes?.style) };
  const nextMatrix = multiply(matrix, parseTransform(node.attributes?.transform));
  if (SUPPORTED_SHAPES.has(name)) {
    const transformed = transformElement(name, { ...node.attributes, ...attrs }, nextMatrix);
    if (hasPaint(transformed.fill, true) || hasPaint(transformed.stroke, false)) {
      const bbox = shapeBBox({ name, attrs: transformed });
      icon.elements.push({ name, attrs: transformed, bbox });
    }
  }
  for (const child of node.children ?? []) {
    if (child.name === 'title' || child.name === 'desc' || child.name === 'style') continue;
    walk(child, attrs, nextMatrix, icon);
  }
}

function transformElement(name, attrs, m) {
  const out = { ...attrs };
  const swScale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  out['stroke-width'] = String(num(out['stroke-width'], 1) * swScale);
  if (name === 'path' && out.d) {
    out.d = svgpath(out.d).matrix(m).toString();
    return out;
  }
  const point = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  if (name === 'rect') {
    const x = num(out.x, 0), y = num(out.y, 0), w = num(out.width, 0), h = num(out.height, 0);
    const pts = [point(x, y), point(x + w, y), point(x, y + h), point(x + w, y + h)];
    setBox(out, pts);
  } else if (name === 'circle' || name === 'ellipse') {
    const cx = num(out.cx, 0), cy = num(out.cy, 0), rx = name === 'circle' ? num(out.r, 0) : num(out.rx, 0), ry = name === 'circle' ? num(out.r, 0) : num(out.ry, 0);
    const c = point(cx, cy);
    const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
    out.cx = c[0]; out.cy = c[1];
    if (name === 'circle' && Math.abs(sx - sy) < 1e-9) out.r = rx * sx;
    else { out.rx = rx * sx; out.ry = ry * sy; delete out.r; }
  } else if (name === 'line') {
    const p1 = point(num(out.x1, 0), num(out.y1, 0)), p2 = point(num(out.x2, 0), num(out.y2, 0));
    out.x1 = p1[0]; out.y1 = p1[1]; out.x2 = p2[0]; out.y2 = p2[1];
  } else if (name === 'polyline' || name === 'polygon') {
    const xs = String(out.points ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < xs.length; i += 2) pts.push(point(xs[i], xs[i + 1]));
    out.points = pts.map((p) => `${p[0]},${p[1]}`).join(' ');
  }
  return out;
}

function setBox(out, pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  out.x = Math.min(...xs); out.y = Math.min(...ys); out.width = Math.max(...xs) - out.x; out.height = Math.max(...ys) - out.y;
}

function parseStyle(style = '') {
  const out = {};
  for (const decl of String(style).split(';')) {
    const [k, ...rest] = decl.split(':');
    if (!k || !rest.length) continue;
    const key = k.trim();
    if (PRESENTATION.includes(key)) out[key] = rest.join(':').trim();
  }
  return out;
}

function pick(attrs) {
  const out = {};
  for (const k of PRESENTATION) if (attrs[k] != null) out[k] = attrs[k];
  return out;
}

function classifyPaint(paints) {
  if (!paints.length) return null;
  if (paints.every((p) => !p.fill && p.stroke)) return 'stroke';
  if (paints.every((p) => p.fill && !p.stroke)) return 'fill';
  return 'mixed';
}

function identity() { return [1, 0, 0, 1, 0, 0]; }
function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
function parseTransform(s = '') {
  let m = identity();
  const re = /(matrix|translate|scale)\(([^)]*)\)/g;
  for (const match of String(s).matchAll(re)) {
    const xs = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    let t = identity();
    if (match[1] === 'matrix' && xs.length >= 6) t = xs.slice(0, 6);
    if (match[1] === 'translate') t = [1, 0, 0, 1, xs[0] || 0, xs[1] || 0];
    if (match[1] === 'scale') t = [xs[0] ?? 1, 0, 0, xs[1] ?? xs[0] ?? 1, 0, 0];
    m = multiply(m, t);
  }
  return m;
}
