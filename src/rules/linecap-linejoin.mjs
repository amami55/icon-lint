import { cat, safeRule } from './helpers.mjs';

export default safeRule(function linecapLinejoin(icon, profile) {
  if (!icon.strokeWidths.length) return [];
  return [
    ...cat(icon, profile, 'linecap', 'linecap-mismatch', icon.linecapRep, 'stroke-linecap'),
    ...cat(icon, profile, 'linejoin', 'linejoin-mismatch', icon.linejoinRep, 'stroke-linejoin')
  ];
});
