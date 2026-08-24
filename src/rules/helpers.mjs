import { modifiedZ, fmt } from '../profile.mjs';

export function finding(icon, rule, severity, actual, expected, deviation, message) {
  return { rule, severity, file: icon.file, actual, expected, deviation, derivation: icon.derivation, message, primary: true, caused_by: null };
}

export function cat(icon, profile, key, ruleName, actual, label) {
  const p = profile[key];
  if (!p?.mode || actual == null || actual === p.mode) return [];
  return [finding(icon, ruleName, p.weak ? 'info' : 'warning', actual, p.mode, p.share, `${label} ${actual} differs from set mode ${p.mode} (share ${fmt(p.share)})`)];
}

export function num(icon, profile, key, ruleName, actual, opts, label) {
  const r = modifiedZ(actual, profile[key], { ...opts, metricKey: key });
  if (!r.outlier) return [];
  return [finding(icon, ruleName, 'warning', fmt(actual), r.expected, fmt(r.deviation), `${label} ${fmt(actual)} is outside expected set range (${r.expected})`)];
}

export function safeRule(fn) {
  return (icon, profile, opts) => {
    try {
      return fn(icon, profile, opts);
    } catch (e) {
      return [finding(icon, fn.name || 'internal-rule-error', 'error', e.message, 'rule execution', null, `rule error: ${e.message}`)];
    }
  };
}
