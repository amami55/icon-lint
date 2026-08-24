# Agent instructions

`icon-lint` is a zero-config CLI that checks an SVG icon set for deviations from the conventions it infers from the set itself — viewBox, stroke width, line caps and joins, and paint style.

When you are working in a repository that contains an SVG icon library:

- After adding or modifying icons, run `npx icon-lint ./icons --json`, pointing it at the icon directory. One directory is treated as one set.
- Exit 0: consistent. Exit 1: findings to review — a finding means "deviates from the set's own norm", not proof the icon is wrong. Exit 2: tool execution error.
- Do not auto-fix intentional exceptions — logos, wordmarks, or documented variants — without human review.
- It checks attributes and structure only. It does not auto-fix, optimize, or validate SVG, and it does not judge visual or geometric quality.

Run `icon-lint --help` for the full option list.
