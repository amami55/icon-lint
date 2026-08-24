import { num, finding, safeRule } from './helpers.mjs';

export default safeRule(function strokeWidth(icon, profile, opts) {
  if (!icon.strokeWidths.length) return [];
  const unique = [...new Set(icon.strokeWidths.map((v) => Number(v.toFixed(6))))];
  const out = [];
  if (unique.length > 1) out.push(finding(icon, 'mixed-stroke-width-within-icon', 'info', unique, 'single effective stroke-width', null, 'icon contains multiple effective stroke-width values'));
  out.push(...num(icon, profile, 'stroke_width', 'stroke-width-outlier', icon.strokeWidthRep, opts, 'stroke-width'));
  return out;
});
