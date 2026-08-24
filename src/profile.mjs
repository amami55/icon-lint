export const EPS_ABS = 0.02;
const ZERO_EPS = 1e-9;

export function median(values) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

export function numericProfile(values) {
  const xs = values.filter((v) => Number.isFinite(v));
  const med = median(xs);
  if (med == null) return { median: null, mad: null, n: 0 };
  const rawMad = median(xs.map((v) => Math.abs(v - med))) ?? 0;
  const scaledMad = rawMad * 1.4826;
  return { median: Math.abs(med) < ZERO_EPS ? 0 : med, mad: scaledMad < ZERO_EPS ? 0 : scaledMad, n: xs.length };
}

export function categoricalProfile(values) {
  const counts = new Map();
  for (const v of values.filter((x) => x != null)) counts.set(v, (counts.get(v) ?? 0) + 1);
  let mode = null;
  let count = 0;
  for (const [k, v] of counts) {
    if (v > count || (v === count && String(k) < String(mode))) {
      mode = k;
      count = v;
    }
  }
  const n = [...counts.values()].reduce((a, b) => a + b, 0);
  const share = n ? count / n : 0;
  return { mode, share, n, weak: n > 0 && share < 0.6 };
}

export function modifiedZ(value, p, opts = {}) {
  const epsRatio = opts.epsRatio ?? 0.02;
  const epsAbs = opts.epsAbs ?? EPS_ABS;
  if (!Number.isFinite(value) || p?.median == null) return { outlier: false, deviation: null, expected: 'n/a' };
  const med = p.median;
  const mad = p.mad ?? 0;
  if (mad > 0) {
    const z = (value - med) / mad;
    return { outlier: Math.abs(z) > (opts.z ?? 3.5), deviation: z, expected: `${fmt(med)} ± ${(opts.z ?? 3.5)}*MAD ${fmt(mad)}` };
  }
  const eps = med === 0 ? epsAbs : Math.abs(med) * epsRatio;
  return { outlier: Math.abs(value - med) > eps, deviation: eps ? (value - med) / eps : 0, expected: `${fmt(med)} (median, MAD 0, eps ${med === 0 ? fmt(epsAbs) : `${fmt(epsRatio * 100)}%`})` };
}

export function modeOf(values) {
  return categoricalProfile(values).mode;
}

export function setProfile(icons) {
  return {
    viewbox: categoricalProfile(icons.map((i) => i.viewBoxNorm).filter(Boolean)),
    aspect_ratio: numericProfile(icons.map((i) => i.aspectRatio)),
    stroke_width: numericProfile(icons.map((i) => i.strokeWidthRep).filter((v) => v != null)),
    linecap: categoricalProfile(icons.flatMap((i) => i.linecapValues ?? []).filter(Boolean)),
    linejoin: categoricalProfile(icons.flatMap((i) => i.linejoinValues ?? []).filter(Boolean)),
    paint_style: categoricalProfile(icons.map((i) => i.paintStyle).filter(Boolean))
  };
}

export function fmt(n) {
  return typeof n === 'number' && Number.isFinite(n) ? Number(n.toFixed(6)) : n;
}
