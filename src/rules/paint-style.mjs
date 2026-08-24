import { cat, finding, safeRule } from './helpers.mjs';

export default safeRule(function paintStyle(icon, profile) {
  const out = [...cat(icon, profile, 'paint_style', 'paint-style-mismatch', icon.paintStyle, 'paint style')];
  if (profile.paint_style?.mode === 'stroke' && icon.hasFillElement) {
    out.push(finding(icon, 'fill-in-stroke-set', profile.paint_style.weak ? 'info' : 'warning', icon.paintStyle, 'stroke-only elements', profile.paint_style.share, 'fill-painted element appears in a stroke-style set'));
  }
  return out;
});
