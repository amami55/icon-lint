const REGEX_SPECIAL = /[\\^$+?.()|[\]{}]/g;

export function matchGlob(glob, relPath) {
  const patternSegments = String(glob).split('/');
  const pathSegments = String(relPath).split('/');
  const memo = new Map();

  function matchFrom(pi, si) {
    const key = `${pi}:${si}`;
    if (memo.has(key)) return memo.get(key);

    let ok = false;
    if (pi === patternSegments.length) {
      ok = si === pathSegments.length;
    } else if (patternSegments[pi] === '**') {
      ok = matchFrom(pi + 1, si) || (si < pathSegments.length && matchFrom(pi, si + 1));
    } else {
      ok = si < pathSegments.length && matchSegment(patternSegments[pi], pathSegments[si]) && matchFrom(pi + 1, si + 1);
    }

    memo.set(key, ok);
    return ok;
  }

  return matchFrom(0, 0);
}

export function shouldIgnore(relPath, globs) {
  return globs.some((glob) => matchGlob(glob, relPath));
}

function matchSegment(pattern, value) {
  let source = '';
  for (const ch of pattern) {
    if (ch === '*') source += '[^/]*';
    else if (ch === '?') source += '[^/]';
    else source += ch.replace(REGEX_SPECIAL, '\\$&');
  }
  return new RegExp(`^${source}$`).test(value);
}
