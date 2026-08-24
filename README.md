# icon-lint

**Find SVG icons that drift from the conventions of their own icon set.**
Use it after adding or editing icons in a shared icon library, in review or in CI.

```sh
npx icon-lint ./icons --json
```

It infers each set's own conventions — viewBox, stroke width, line caps and joins, paint style — from the files themselves, with zero config, and flags the icons that deviate. It checks consistency, not correctness: no rules to write, no golden values to maintain.

## Install / Usage

```sh
npx icon-lint ./icons
npm i -D icon-lint
icon-lint <dir> [--json] [--ignore <glob>] [--min-set N] [--z K] [--eps-ratio R] [-h]
```

## Example Output

Human output:

```text
icon-lint /repo/icons
files: 10, parsed: 9, ignored: 1
errors: 0, warnings: 1, infos: 0
WARNING warning.svg stroke-width-outlier: stroke width 2.25 differs from set profile
{"version":"0.4.2","target":"/repo/icons","files":9,"parsed":9,"set_profile":{},"findings":[],"summary":{"errors":0,"warnings":1,"infos":0,"ignored_files":1},"exit_code":1}
```

JSON output:

```json
{
  "version": "0.4.2",
  "target": "/repo/icons",
  "files": 9,
  "parsed": 9,
  "set_profile": {
    "viewbox": { "mode": "0 0 24 24", "share": 1, "n": 9, "weak": false },
    "stroke_width": { "median": 1.5, "mad": 0, "n": 9 },
    "linecap": { "mode": "round", "share": 1, "n": 9, "weak": false },
    "linejoin": { "mode": "round", "share": 1, "n": 9, "weak": false },
    "paint_style": { "mode": "stroke", "share": 1, "n": 9, "weak": false }
  },
  "findings": [
    {
      "rule": "stroke-width-outlier",
      "severity": "warning",
      "file": "warning.svg",
      "actual": 2.25,
      "expected": "1.5 (median, MAD 0, eps 2%)",
      "deviation": 25,
      "derivation": {
        "bbox": "parsed",
        "unsupported_elements": [],
        "style_sheet": "n/a",
        "render_relevance": { "cap_ambiguous": 0, "join_ambiguous": 0 }
      },
      "primary": true,
      "caused_by": null,
      "message": "stroke width 2.25 differs from set profile"
    }
  ],
  "summary": { "errors": 0, "warnings": 1, "infos": 0, "ignored_files": 1 },
  "exit_code": 1
}
```

## Exit Codes

- `0`: consistent; no warning or error findings
- `1`: findings; warnings or errors were produced
- `2`: execution error, such as bad arguments, missing directory, zero SVG files, or internal failure

Info findings never affect exit status.

## Supported Rules

| Rule | Meaning |
| --- | --- |
| `viewbox-mismatch` | Icon viewBox differs from the set mode. |
| `viewbox-missing` | SVG has no viewBox. |
| `aspect-ratio-outlier` | Icon aspect ratio drifts from the set profile. |
| `stroke-width-outlier` | Representative stroke width drifts from the set profile. |
| `mixed-stroke-width-within-icon` | Info finding for multiple stroke widths in one icon. |
| `linecap-mismatch` | Render-relevant line caps differ from the set mode. |
| `linejoin-mismatch` | Render-relevant line joins differ from the set mode. |
| `paint-style-mismatch` | Fill/stroke style differs from the set mode. |
| `fill-in-stroke-set` | Child finding for filled content inside a stroke-norm set. |
| Parse errors | Invalid SVG XML is reported and other files continue. |

Render-relevant resolution is intentionally conservative: caps are judged only on elements with open subpaths; joins are judged only on provable line-line corners.

Findings are flat, but `primary` and `caused_by` mark child findings. Summary counts and exit status count primary findings only.

## Not Supported

- Occupied-size, optical, and geometry checks are not part of the supported contract.
- `occupied-bounds-outlier`, `padding-outlier`, `center-offset-outlier`, and `bbox-overflow` are not run and never appear in output.
- Image or vision analysis.
- Auto-fix.
- General SVG validation.
- Optimization.
- Accessibility checks.
- CSS `<style>` application.
- `<use>` and `<text>` geometry; these are recorded in `derivation.unsupported_elements`.
- Rotate and skew transforms; these are ignored.
- Per-rule config.

## One Directory = One Icon Set

`icon-lint` assumes one directory is one icon set. Mixing sizes, weights, platforms, or documented variants in one directory will flag the minority. Split directories or use `--ignore` for files that do not belong to the set being profiled.

## Ignore Globs

`--ignore <glob>` is repeatable and excludes whole files only. Globs are evaluated against the SVG file path relative to the input directory, using posix `/` separators. Ignored files are not parsed, do not populate `set_profile`, produce no findings, and are counted only in `summary.ignored_files`.

Supported glob subset:

- `*`: zero or more characters within one path segment; it does not match `/`
- `**`: any depth across path segments
- `?`: one character within one path segment
- Everything else is literal, with regex specials escaped internally

## Examples of real-world findings

Run against published icon sets, `icon-lint` surfaces genuine set-relative drift (whether each is a defect or an intentional exception is for a human to decide):

- **Heroicons** — one outline icon uses a `butt` line cap where the rest of the set is `round`.
- **Octicons** — inside the 16px set, a few icons carry a viewBox that is not `0 0 16 16`.
- **Ionicons** — within the round `-outline` set, a handful of icons draw with `butt` caps or `miter` joins.

These are reported because they differ from the set's own norm, not because they are wrong. Third-party icons are not bundled with this package.

## Use from an AI agent (Codex / Claude Code)

`icon-lint` is a plain CLI; agents call it, they do not need a plugin. Drop one of these into your repo instructions so an agent runs it after touching icons.

`AGENTS.md`:

```md
After adding or modifying SVG icons, run:

    npx icon-lint ./src/icons --json

- Exit 0: no supported inconsistencies found
- Exit 1: review the findings (each `primary` finding is one issue to judge)
- Exit 2: tool execution error
- Warnings mean "deviates from the set's own norm" — do not auto-fix logos,
  wordmarks, or deliberate exceptions without human review.
```

`CLAUDE.md`:

```md
When SVG icons under src/icons change, run `npx icon-lint ./src/icons --json`
and report the primary findings. Exit 0 = consistent, 1 = review, 2 = error.
Treat warnings as candidates, not confirmed bugs; intentional exceptions exist.
```

## Related use cases

If you are looking for an SVG icon consistency checker, an icon set linter, or a CLI to validate SVG icon sets in a design system, this is that tool. `icon-lint` detects inconsistent icon attributes — viewBox, stroke width, line caps and joins, paint style — across an icon library, so drift is caught in review or CI instead of shipping.

It works on attributes and structure only. It does not measure visual similarity, pixel-level rendering, or subjective design quality, so it is not a "visual" or "pixel-perfect" checker.

## vs svglint / SVGO

`svglint` checks hand-written fixed rules per file. `icon-lint` infers the set's conventions with zero config and flags drift from those conventions.

SVGO is an optimizer. It is orthogonal to `icon-lint`; run both if you like.

## Findings Are Not Always Bugs

Intentional exceptions exist: logo or wordmark files, deliberate filled-dot details, documented variants, and other product-specific choices may legitimately deviate from the set norm. Warnings mean "deviates from the set's own norm"; a human still judges intent.
