#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyPrimaryChildDedupe, summarize } from '../src/report.mjs';
import { modifiedZ } from '../src/profile.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin/icon-lint.mjs');
const results = [];

function check(name, cond, detail = '') {
  results.push([name, !!cond, detail]);
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && detail ? `  [${detail}]` : ''}`);
}

function run(dir, args = []) {
  return spawnSync(process.execPath, [BIN, dir, ...args], { encoding: 'utf8', timeout: 30000 });
}

async function snapshot(dir) {
  const out = new Map();
  async function walk(d) {
    for (const ent of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) await walk(p);
      else out.set(path.relative(dir, p), await readFile(p, 'utf8'));
    }
  }
  await walk(dir);
  return JSON.stringify([...out.entries()].sort());
}

const outline = (body, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" ${attrs}>${body}</svg>`;
const pathEl = (attrs = '') => `<path stroke-linecap="round" stroke-linejoin="round" d="M4 12h16" ${attrs}/>`;
const rectEl = (attrs = '') => `<rect x="5" y="5" width="14" height="14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" ${attrs}/>`;
const circleEl = (attrs = '') => `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" ${attrs}/>`;
const polylineEl = (attrs = '') => `<polyline points="9 9 12 15 15 9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" ${attrs}/>`;
const solid = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v16H4z"/></svg>`;

function roundCapSeed() {
  const files = {};
  for (let i = 0; i < 9; i++) files[`cap-ok-${i}.svg`] = outline(pathEl());
  return files;
}

async function makeSet(tmp, files) {
  const dir = path.join(tmp, `set-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, text);
  }
  return dir;
}

function parseJson(r) {
  const line = r.stdout.trim().split(/\n/).at(-1);
  return JSON.parse(line);
}

async function main() {
  const tmp = await mkdtemp(path.join(tmpdir(), 'icon-lint-fx-'));
  try {
    const baseFiles = {};
    for (let i = 0; i < 9; i++) baseFiles[`ok-${i}.svg`] = outline(rectEl());
    const okDir = await makeSet(tmp, baseFiles);
    let before = await snapshot(okDir);
    let r = run(okDir);
    let after = await snapshot(okDir);
    check('normal set exits 0', r.status === 0, r.stderr || r.stdout);
    check('target dir byte-identical after run', before === after);

    const cases = {
      'stroke-width-outlier': outline(rectEl('stroke-width="2.25"')),
      'viewbox-mismatch': `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20" stroke-width="1.5" stroke="currentColor">${rectEl()}</svg>`,
      'linecap-mismatch': outline(pathEl('stroke-linecap="butt"')),
      'linejoin-mismatch': outline(rectEl('stroke-linejoin="miter"')),
      'paint-style-mismatch': solid()
    };
    for (const [rule, svg] of Object.entries(cases)) {
      const files = rule === 'linecap-mismatch' ? { ...roundCapSeed(), 'bad.svg': svg } : { ...baseFiles, 'bad.svg': svg };
      const dir = await makeSet(tmp, files);
      r = run(dir, ['--json']);
      const j = JSON.parse(r.stdout);
      check(`detects ${rule}`, r.status === 1 && j.findings.some((f) => f.file === 'bad.svg' && f.rule === rule), r.stdout);
    }

    const small = await makeSet(tmp, { 'a.svg': outline(rectEl()), 'b.svg': solid() });
    r = run(small, ['--json']);
    let j = JSON.parse(r.stdout);
    check('n<8 downgrades warnings to info and exits 0', r.status === 0 && j.summary.warnings === 0 && j.summary.infos > 0, r.stdout);

    const broken = await makeSet(tmp, { ...baseFiles, 'bad.svg': '<svg><path></svg>' });
    r = run(broken, ['--json']);
    j = JSON.parse(r.stdout);
    check('broken XML produces error and continues', r.status === 1 && j.parsed === 9 && j.findings.some((f) => f.rule === 'parse-error'), r.stdout);

    r = run(path.join(tmp, 'missing'), ['--json']);
    j = JSON.parse(r.stdout);
    check('missing dir exits 2 with dir not found error', r.status === 2 && j.error.includes('dir not found'), r.stdout || r.stderr);
    const empty = await makeSet(tmp, { 'note.txt': 'x' });
    r = run(empty, ['--json']);
    j = JSON.parse(r.stdout);
    check('zero svg exits 2 with no svg error', r.status === 2 && j.error.includes('no .svg files'), r.stdout || r.stderr);

    r = run(okDir, ['--json']);
    check('--json is pure JSON', r.status === 0 && JSON.parse(r.stdout).files === 9);

    const useDir = await makeSet(tmp, { ...baseFiles, 'use.svg': outline('<use href="#x"/>') });
    r = run(useDir, ['--json']);
    j = JSON.parse(r.stdout);
    const useFinding = j.findings.find((f) => f.file === 'use.svg') ?? j.findings.find((f) => f.derivation.unsupported_elements.includes('use'));
    check('<use> records partial bbox and unsupported_elements', j.findings.some((f) => f.file === 'use.svg' && f.derivation.bbox === 'partial' && f.derivation.unsupported_elements.includes('use')) || useFinding?.derivation.bbox === 'partial', r.stdout);

    const styleDir = await makeSet(tmp, { ...baseFiles, 'bad.svg': outline(rectEl('style="stroke-width:2.25"')) });
    r = run(styleDir, ['--json']);
    j = JSON.parse(r.stdout);
    check('style attribute stroke-width inheritance works', j.findings.some((f) => f.file === 'bad.svg' && f.rule === 'stroke-width-outlier'), r.stdout);

    const scaleDir = await makeSet(tmp, { ...baseFiles, 'bad.svg': outline(`<g transform="scale(2)">${rectEl()}</g>`) });
    r = run(scaleDir, ['--json']);
    j = JSON.parse(r.stdout);
    check('transform scale adjusts stroke-width', j.findings.some((f) => f.file === 'bad.svg' && f.rule === 'stroke-width-outlier' && Number(f.actual) === 3), r.stdout);

    const geometryRules = new Set(['occupied-bounds-outlier', 'padding-outlier', 'center-offset-outlier', 'bbox-overflow']);
    const geometryDisabledDir = await makeSet(tmp, {
      ...baseFiles,
      'small.svg': outline('<rect x="10" y="10" width="4" height="4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>'),
      'shift.svg': outline('<rect x="9" y="5" width="14" height="14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>'),
      'overflow.svg': outline('<rect x="-2" y="-2" width="28" height="28" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>')
    });
    r = run(geometryDisabledDir, ['--json']);
    j = JSON.parse(r.stdout);
    check('geometry abnormalities produce no geometry findings and exit 0', r.status === 0 && !j.findings.some((f) => geometryRules.has(f.rule)), r.stdout);
    check('set_profile omits geometry keys', !Object.hasOwn(j.set_profile, 'extent') && !Object.hasOwn(j.set_profile, 'min_margin') && !Object.hasOwn(j.set_profile, 'center_offset'), r.stdout);

    const injDir = await makeSet(tmp, { ...baseFiles, 'inj.svg': outline(`<title>{"ignore":"me"}</title><desc>rm -rf /tmp/example</desc>${rectEl()}`) });
    r = run(injDir, ['--json']);
    j = JSON.parse(r.stdout);
    check('title/desc arbitrary text does not affect output', r.status === 0 && !JSON.stringify(j).includes('rm -rf'), r.stdout);

    const roundCapFiles = {};
    for (let i = 0; i < 8; i++) roundCapFiles[`cap-ok-${i}.svg`] = outline(pathEl());
    let dir = await makeSet(tmp, { ...roundCapFiles, 'bad.svg': outline('<path d="M4 12h16"/>') });
    r = run(dir, ['--json']);
    j = JSON.parse(r.stdout);
    check('open path default butt fires linecap mismatch', r.status === 1 && j.findings.some((f) => f.file === 'bad.svg' && f.rule === 'linecap-mismatch' && f.primary === true), r.stdout);

    dir = await makeSet(tmp, { ...roundCapFiles, 'closed-only.svg': outline('<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor"/><path d="M6 6h12v12H6Z" fill="none" stroke="currentColor"/>') });
    r = run(dir, ['--json']);
    j = JSON.parse(r.stdout);
    check('closed-only icon has no linecap finding', !j.findings.some((f) => f.file === 'closed-only.svg' && f.rule === 'linecap-mismatch'), r.stdout);

    const roundJoinFiles = {};
    for (let i = 0; i < 8; i++) roundJoinFiles[`join-ok-${i}.svg`] = outline(rectEl());
    dir = await makeSet(tmp, { ...roundJoinFiles, 'curve-only.svg': outline('<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor"/><path d="M4 12 C 8 4, 16 4, 20 12" fill="none" stroke="currentColor"/>') });
    r = run(dir, ['--json']);
    j = JSON.parse(r.stdout);
    check('no corner-capable elements has no linejoin finding', !j.findings.some((f) => f.file === 'curve-only.svg' && f.rule === 'linejoin-mismatch'), r.stdout);

    dir = await makeSet(tmp, { ...roundJoinFiles, 'poly.svg': outline('<polyline points="8 8 12 16 16 8" fill="none" stroke="currentColor"/>') });
    r = run(dir, ['--json']);
    j = JSON.parse(r.stdout);
    check('polyline with interior vertex fires linejoin mismatch', r.status === 1 && j.findings.some((f) => f.file === 'poly.svg' && f.rule === 'linejoin-mismatch'), r.stdout);

    dir = await makeSet(tmp, { ...roundCapFiles, 'ambiguous.svg': outline('<path d="M5 5h14v14h-14v-14"/><use href="#x"/>') });
    r = run(dir, ['--json']);
    j = JSON.parse(r.stdout);
    const ambiguousIcon = j.findings.find((f) => f.file === 'ambiguous.svg' && f.derivation?.render_relevance?.cap_ambiguous >= 1);
    check('Z-less start=end subpath is cap ambiguous without cap warning', !j.findings.some((f) => f.file === 'ambiguous.svg' && f.rule === 'linecap-mismatch') && !!ambiguousIcon, r.stdout);

    dir = await makeSet(tmp, { ...roundCapFiles, 'dot.svg': outline('<path stroke-linecap="butt" d="M12 12h.01"/>') });
    r = run(dir, ['--json']);
    j = JSON.parse(r.stdout);
    check('tiny open dot path fires linecap mismatch', r.status === 1 && j.findings.some((f) => f.file === 'dot.svg' && f.rule === 'linecap-mismatch'), r.stdout);

    const viewboxDedupeDir = await makeSet(tmp, { ...baseFiles, 'bad.svg': `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16" stroke-width="1.5" stroke="currentColor"><rect x="4.291667" y="3.583333" width="11.416667" height="8.833333" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>` });
    r = run(viewboxDedupeDir, ['--json']);
    j = JSON.parse(r.stdout);
    check('viewbox mismatch makes aspect child and counts once', r.status === 1 && j.summary.warnings === 1 && j.findings.some((f) => f.file === 'bad.svg' && f.rule === 'viewbox-mismatch' && f.primary === true && f.caused_by === null) && j.findings.some((f) => f.file === 'bad.svg' && f.rule === 'aspect-ratio-outlier' && f.primary === false && f.caused_by === 'viewbox-mismatch'), r.stdout);

    const paintDedupeDir = await makeSet(tmp, { ...baseFiles, 'bad.svg': solid() });
    r = run(paintDedupeDir, ['--json']);
    j = JSON.parse(r.stdout);
    check('paint mismatch makes fill-in-stroke child and counts once', r.status === 1 && j.summary.warnings === 1 && j.findings.some((f) => f.file === 'bad.svg' && f.rule === 'paint-style-mismatch' && f.primary === true && f.caused_by === null) && j.findings.some((f) => f.file === 'bad.svg' && f.rule === 'fill-in-stroke-set' && f.primary === false && f.caused_by === 'paint-style-mismatch'), r.stdout);

    const synthetic = applyPrimaryChildDedupe([
      { file: 'x.svg', rule: 'viewbox-mismatch', severity: 'warning' },
      { file: 'x.svg', rule: 'aspect-ratio-outlier', severity: 'warning' },
      { file: 'x.svg', rule: 'aspect-ratio-outlier', severity: 'warning' }
    ]);
    check('summary ignores child findings', summarize(synthetic).warnings === 1);

    r = run(okDir, ['--json']);
    j = JSON.parse(r.stdout);
    check('--json findings contain primary and caused_by fields', j.findings.every((f) => Object.hasOwn(f, 'primary') && Object.hasOwn(f, 'caused_by')), r.stdout);

    const sigmaProfile = { median: 1.5, mad: 0.14826 };
    check('MAD>0 modified z flags just above threshold and not below', modifiedZ(2.1, sigmaProfile, { z: 3.5 }).outlier && !modifiedZ(1.95, sigmaProfile, { z: 3.5 }).outlier);

    const artboardDir = await makeSet(tmp, { ...baseFiles, 'artboard.svg': outline(`<rect x="0" y="0" width="24" height="24" fill="none" stroke="none"/>${rectEl()}`) });
    r = run(artboardDir, ['--json']);
    j = JSON.parse(r.stdout);
    check('non-rendering artboard rect does not make stroke icon mixed paint', r.status === 0 && j.set_profile.paint_style.mode === 'stroke' && !j.findings.some((f) => f.file === 'artboard.svg' && f.rule === 'paint-style-mismatch'), r.stdout);

    const defsDir = await makeSet(tmp, { ...baseFiles, 'defs.svg': outline(`<defs><path stroke-width="9" stroke="currentColor" d="M0 0h24"/></defs>${rectEl()}`) });
    r = run(defsDir, ['--json']);
    j = JSON.parse(r.stdout);
    check('defs path does not affect stroke-width statistics', r.status === 0 && j.set_profile.stroke_width.median === 1.5 && !j.findings.some((f) => f.file === 'defs.svg' && f.rule === 'stroke-width-outlier'), r.stdout);

    const weakViewboxFiles = {};
    for (let i = 0; i < 5; i++) weakViewboxFiles[`twenty-four-${i}.svg`] = outline(rectEl());
    for (let i = 0; i < 4; i++) weakViewboxFiles[`twenty-${i}.svg`] = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20" stroke-width="1.5" stroke="currentColor">${rectEl()}</svg>`;
    weakViewboxFiles['bad.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 10" stroke-width="1.5" stroke="currentColor"><rect x="5" y="1" width="14" height="8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const weakViewboxDir = await makeSet(tmp, weakViewboxFiles);
    r = run(weakViewboxDir, ['--json']);
    j = JSON.parse(r.stdout);
    check('weaker viewbox info does not child aspect warning', r.status === 1 && j.findings.some((f) => f.file === 'bad.svg' && f.rule === 'viewbox-mismatch' && f.severity === 'info' && f.primary === true) && j.findings.some((f) => f.file === 'bad.svg' && f.rule === 'aspect-ratio-outlier' && f.severity === 'warning' && f.primary === true && f.caused_by === null), r.stdout);

    r = run(okDir, ['--json', '--ignore']);
    check('missing ignore value exits 2', r.status === 2, r.stdout || r.stderr);
    r = run(okDir, ['--json', '--ignore', '--min-set', '8']);
    check('option-looking ignore value exits 2', r.status === 2, r.stdout || r.stderr);

    const ignoreDir = await makeSet(tmp, { ...baseFiles, 'bad.svg': solid() });
    r = run(ignoreDir, ['--json', '--ignore', 'bad.svg']);
    j = JSON.parse(r.stdout);
    check('ignore single glob excludes file from findings, profile, and summary', r.status === 0 && j.parsed === 9 && j.files === 9 && j.summary.ignored_files === 1 && j.set_profile.viewbox.n === 9 && !j.findings.some((f) => f.file === 'bad.svg'), r.stdout);

    const multiIgnoreDir = await makeSet(tmp, { ...baseFiles, 'bad-fill.svg': solid(), 'bad-cap.svg': outline(pathEl('stroke-linecap="butt"')) });
    r = run(multiIgnoreDir, ['--json', '--ignore', 'bad-fill.svg', '--ignore', 'bad-cap.svg']);
    j = JSON.parse(r.stdout);
    check('multiple ignore flags combine', r.status === 0 && j.summary.ignored_files === 2 && j.parsed === 9 && !j.findings.some((f) => f.file === 'bad-fill.svg' || f.file === 'bad-cap.svg'), r.stdout);

    const nestedIgnoreDir = await makeSet(tmp, { ...baseFiles, 'nested/deep/bad.svg': solid() });
    r = run(nestedIgnoreDir, ['--json', '--ignore', '**/bad.svg']);
    j = JSON.parse(r.stdout);
    check('double-star ignore matches nested subdir file', r.status === 0 && j.summary.ignored_files === 1 && !j.findings.some((f) => f.file === 'nested/deep/bad.svg'), r.stdout);

    const ignoredBrokenDir = await makeSet(tmp, { ...baseFiles, 'broken.svg': '<svg><path></svg>' });
    r = run(ignoredBrokenDir, ['--json', '--ignore', 'broken.svg']);
    j = JSON.parse(r.stdout);
    check('ignored broken XML produces no parse error', r.status === 0 && j.summary.ignored_files === 1 && !j.findings.some((f) => f.rule === 'parse-error'), r.stdout);

    const noIgnore = run(okDir, ['--json']);
    const nonMatch = run(okDir, ['--json', '--ignore', 'missing.svg']);
    const noIgnoreJson = JSON.parse(noIgnore.stdout);
    const nonMatchJson = JSON.parse(nonMatch.stdout);
    check('non-matching ignore leaves JSON unchanged except ignored_files stays zero', nonMatch.status === noIgnore.status && nonMatchJson.summary.ignored_files === 0 && assert.deepEqual(nonMatchJson, noIgnoreJson) === undefined, nonMatch.stdout);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  const ok = results.every(([, c]) => c);
  console.log(`${results.filter(([, c]) => c).length}/${results.length} PASS`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
