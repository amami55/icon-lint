import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'svgson';
import { resolveIcon } from './resolve.mjs';
import { shouldIgnore } from './glob.mjs';

export async function loadDir(dir, opts = {}) {
  const allFiles = await scan(dir);
  const ignored = new Set();
  const files = [];
  for (const abs of allFiles) {
    const rel = path.relative(dir, abs).split(path.sep).join('/');
    if (shouldIgnore(rel, opts.ignore ?? [])) ignored.add(abs);
    else files.push(abs);
  }
  const icons = [];
  const findings = [];
  for (const abs of files) {
    const rel = path.relative(dir, abs).split(path.sep).join('/');
    try {
      const text = await readFile(abs, 'utf8');
      const parsed = await parse(text);
      icons.push(resolveIcon(parsed, rel));
    } catch (e) {
      findings.push({
        rule: 'parse-error',
        severity: 'error',
        file: rel,
        actual: e.message,
        expected: 'valid SVG XML',
        deviation: null,
        derivation: { bbox: 'none', unsupported_elements: [], style_sheet: 'n/a', render_relevance: { cap_ambiguous: 0, join_ambiguous: 0 } },
        primary: true,
        caused_by: null,
        message: `failed to parse SVG: ${e.message}`
      });
    }
  }
  return { files, icons, findings, ignoredFiles: ignored.size };
}

async function scan(dir) {
  const out = [];
  async function walk(d) {
    const ents = await readdir(d, { withFileTypes: true });
    for (const ent of ents) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) await walk(p);
      else if (ent.isFile() && ent.name.toLowerCase().endsWith('.svg')) out.push(p);
    }
  }
  await walk(dir);
  return out.sort();
}
