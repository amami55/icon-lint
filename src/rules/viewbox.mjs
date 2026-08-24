import { cat, num, finding, safeRule } from './helpers.mjs';

export default safeRule(function viewbox(icon, profile, opts) {
  if (!icon.viewBox) {
    return [finding(icon, 'viewbox-missing', 'warning', null, 'viewBox or width/height', null, 'viewBox is missing and width/height fallback is unavailable')];
  }
  return [
    ...cat(icon, profile, 'viewbox', 'viewbox-mismatch', icon.viewBoxNorm, 'viewBox'),
    ...num(icon, profile, 'aspect_ratio', 'aspect-ratio-outlier', icon.aspectRatio, opts, 'aspect ratio')
  ];
});
