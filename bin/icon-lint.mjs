#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { loadDir } from '../src/load.mjs';
import { setProfile } from '../src/profile.mjs';
import { applyPrimaryChildDedupe, downgradeForSmallSet, buildReport, printReport, summarize } from '../src/report.mjs';
import viewbox from '../src/rules/viewbox.mjs';
import strokeWidth from '../src/rules/stroke-width.mjs';
import linecapLinejoin from '../src/rules/linecap-linejoin.mjs';
import paintStyle from '../src/rules/paint-style.mjs';

const rules = [viewbox, strokeWidth, linecapLinejoin, paintStyle];

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { json: false, ignore: [], minSet: 8, z: 3.5, epsRatio: 0.02 };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--ignore') {
      const glob = argv[++i];
      if (!glob || glob.startsWith('--')) throw new Error('missing value for --ignore');
      opts.ignore.push(glob);
    }
    else if (a === '--min-set') opts.minSet = Number(argv[++i]);
    else if (a === '--z') opts.z = Number(argv[++i]);
    else if (a === '--eps-ratio') opts.epsRatio = Number(argv[++i]);
    else if (a.startsWith('--')) throw new Error(`unknown option: ${a}`);
    else pos.push(a);
  }
  if (pos.length !== 1 || !Number.isFinite(opts.minSet) || !Number.isFinite(opts.z) || !Number.isFinite(opts.epsRatio)) throw new Error('usage: icon-lint <dir> [--json] [--ignore <glob>] [--min-set N] [--z K] [--eps-ratio R]');
  return { dir: pos[0], opts };
}

try {
  const { dir, opts } = parseArgs(process.argv.slice(2));
  const target = path.resolve(dir);
  const st = await stat(target).catch(() => null);
  if (!st?.isDirectory()) throw new UsageError(`dir not found: ${target}`);
  const loaded = await loadDir(target, { ignore: opts.ignore });
  if (!loaded.files.length) throw new UsageError(`no .svg files in ${target}`);
  const profile = setProfile(loaded.icons);
  let findings = [...loaded.findings];
  for (const icon of loaded.icons) {
    if (icon.derivation.unsupported_elements.length) {
      findings.push({
        rule: 'unsupported-elements',
        severity: 'info',
        file: icon.file,
        actual: icon.derivation.unsupported_elements,
        expected: 'supported geometry elements only',
        deviation: null,
        derivation: icon.derivation,
        primary: true,
        caused_by: null,
        message: `unsupported elements excluded from bbox: ${icon.derivation.unsupported_elements.join(', ')}`
      });
    }
    for (const rule of rules) findings.push(...rule(icon, profile, opts));
  }
  findings = downgradeForSmallSet(findings, loaded.icons.length, opts.minSet);
  findings = applyPrimaryChildDedupe(findings);
  let summary = summarize(findings);
  const exitCode = summary.errors || summary.warnings ? 1 : 0;
  const report = buildReport({ target, fileCount: loaded.files.length, icons: loaded.icons, profile, findings, exitCode, ignoredFiles: loaded.ignoredFiles });
  printReport(report, opts.json);
  process.exit(exitCode);
} catch (e) {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ version: '0.4.1', target: null, files: 0, parsed: 0, set_profile: {}, findings: [], summary: { errors: 1, warnings: 0, infos: 0, ignored_files: 0 }, exit_code: 2, error: e.message }));
  } else {
    console.error(e.message);
  }
  process.exit(2);
}
