export function summarize(findings) {
  const primary = findings.filter((f) => f.primary !== false);
  return {
    errors: primary.filter((f) => f.severity === 'error').length,
    warnings: primary.filter((f) => f.severity === 'warning').length,
    infos: primary.filter((f) => f.severity === 'info').length
  };
}

export function downgradeForSmallSet(findings, parsed, minSet) {
  if (parsed >= minSet) return findings;
  return findings.map((f) => f.severity === 'warning' ? { ...f, severity: 'info', message: `${f.message} (downgraded: parsed set size ${parsed} < ${minSet})` } : f);
}

export function applyPrimaryChildDedupe(findings) {
  const out = findings.map((f) => ({ ...f, primary: f.primary ?? true, caused_by: f.caused_by ?? null }));
  const byFile = new Map();
  for (const f of out) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const sameFile of byFile.values()) {
    markChild(sameFile, 'viewbox-mismatch', 'aspect-ratio-outlier');
    markChild(sameFile, 'paint-style-mismatch', 'fill-in-stroke-set');
  }
  return out;
}

function markChild(findings, primaryRule, childRule) {
  const primary = findings.find((f) => f.rule === primaryRule);
  if (!primary) return;
  for (const f of findings) {
    if (f.rule === childRule && severityRank(primary.severity) >= severityRank(f.severity)) {
      f.primary = false;
      f.caused_by = primaryRule;
    }
  }
}

function severityRank(severity) {
  return { info: 1, warning: 2, error: 3 }[severity] ?? 0;
}

export function buildReport({ target, fileCount, icons, profile, findings, exitCode, ignoredFiles = 0 }) {
  const summary = { ...summarize(findings), ignored_files: ignoredFiles };
  return { version: '0.4.1', target, files: fileCount, parsed: icons.length, set_profile: profile, findings, summary, exit_code: exitCode };
}

export function printReport(report, jsonOnly) {
  if (jsonOnly) {
    console.log(JSON.stringify(report));
    return;
  }
  console.log(`icon-lint ${report.target}`);
  console.log(`files: ${report.files}, parsed: ${report.parsed}, ignored: ${report.summary.ignored_files}`);
  console.log(`errors: ${report.summary.errors}, warnings: ${report.summary.warnings}, infos: ${report.summary.infos}`);
  for (const f of report.findings) console.log(`${f.severity.toUpperCase()} ${f.file} ${f.rule}: ${f.message}`);
  console.log(JSON.stringify(report));
}
