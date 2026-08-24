import * as bboxModule from 'svg-path-bbox';

const pathBbox = bboxModule.default ?? bboxModule.svgPathBbox ?? bboxModule;

export const SUPPORTED_SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
export const UNSUPPORTED = new Set(['use', 'text', 'image', 'mask', 'clipPath', 'symbol', 'foreignObject', 'defs', 'marker', 'pattern']);

export function shapeBBox(el) {
  const a = el.attrs;
  let b = null;
  if (el.name === 'path') {
    if (!a.d) return null;
    try {
      const r = pathBbox(a.d);
      b = [r[0], r[1], r[2], r[3]];
    } catch {
      return null;
    }
  } else if (el.name === 'rect') {
    const x = num(a.x, 0), y = num(a.y, 0), w = num(a.width, NaN), h = num(a.height, NaN);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    b = [x, y, x + w, y + h];
  } else if (el.name === 'circle') {
    const cx = num(a.cx, 0), cy = num(a.cy, 0);
    const rx = a.rx != null ? num(a.rx, NaN) : num(a.r, NaN);
    const ry = a.ry != null ? num(a.ry, NaN) : num(a.r, NaN);
    if (!Number.isFinite(rx) || !Number.isFinite(ry)) return null;
    b = [cx - rx, cy - ry, cx + rx, cy + ry];
  } else if (el.name === 'ellipse') {
    const cx = num(a.cx, 0), cy = num(a.cy, 0), rx = num(a.rx, NaN), ry = num(a.ry, NaN);
    if (!Number.isFinite(rx) || !Number.isFinite(ry)) return null;
    b = [cx - rx, cy - ry, cx + rx, cy + ry];
  } else if (el.name === 'line') {
    b = [num(a.x1, 0), num(a.y1, 0), num(a.x2, 0), num(a.y2, 0)];
    b = [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
  } else if (el.name === 'polyline' || el.name === 'polygon') {
    const pts = parsePoints(a.points);
    if (!pts.length) return null;
    b = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  }
  const hasStroke = hasPaint(a.stroke, false);
  if (b && hasStroke) {
    const half = Math.max(0, num(a['stroke-width'], 1)) / 2;
    b = [b[0] - half, b[1] - half, b[2] + half, b[3] + half];
  }
  return b;
}

export function unionBBox(boxes) {
  const bs = boxes.filter(Boolean);
  if (!bs.length) return null;
  return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
}

export function parseViewBox(attrs) {
  const raw = attrs.viewBox ?? attrs.viewbox;
  if (raw) {
    const xs = String(raw).trim().split(/[\s,]+/).map(Number);
    if (xs.length === 4 && xs.every(Number.isFinite)) return { values: xs, norm: xs.map((n) => Number(n.toFixed(6))).join(' ') };
  }
  const w = num(attrs.width, NaN), h = num(attrs.height, NaN);
  if (Number.isFinite(w) && Number.isFinite(h)) return { values: [0, 0, w, h], norm: `0 0 ${fmt(w)} ${fmt(h)}` };
  return null;
}

export function metricsForBBox(b, vb) {
  if (!b || !vb) return {};
  const [vx, vy, vw, vh] = vb;
  const bw = Math.max(0, b[2] - b[0]), bh = Math.max(0, b[3] - b[1]);
  const l = (b[0] - vx) / vw, r = (vx + vw - b[2]) / vw, t = (b[1] - vy) / vh, bot = (vy + vh - b[3]) / vh;
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  const ox = (cx - (vx + vw / 2)) / vw, oy = (cy - (vy + vh / 2)) / vh;
  const overflowBy = {
    left: Math.max(0, (vx - b[0]) / vw),
    top: Math.max(0, (vy - b[1]) / vh),
    right: Math.max(0, (b[2] - (vx + vw)) / vw),
    bottom: Math.max(0, (b[3] - (vy + vh)) / vh)
  };
  const overflowRatio = Math.max(overflowBy.left, overflowBy.top, overflowBy.right, overflowBy.bottom);
  return {
    widthRatio: bw / vw,
    heightRatio: bh / vh,
    extent: Math.max(bw / vw, bh / vh),
    margins: { left: l, right: r, top: t, bottom: bot },
    minMargin: Math.min(l, r, t, bot),
    centerOffset: Math.hypot(ox, oy),
    center: { x: ox, y: oy },
    overflow: overflowRatio > 1e-9,
    overflowBy,
    overflowRatio
  };
}

export function hasPaint(value, fillDefault) {
  if (value == null || value === '') return !!fillDefault;
  const v = String(value).trim().toLowerCase();
  return v !== 'none' && v !== 'transparent';
}

export function num(v, d = 0) {
  if (v == null || v === '') return d;
  const m = String(v).match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i);
  return m ? Number(m[0]) : d;
}

function parsePoints(s = '') {
  const xs = String(s).trim().split(/[\s,]+/).filter(Boolean).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (Number.isFinite(xs[i]) && Number.isFinite(xs[i + 1])) pts.push([xs[i], xs[i + 1]]);
  return pts;
}

function fmt(n) {
  return Number(n.toFixed(6));
}
