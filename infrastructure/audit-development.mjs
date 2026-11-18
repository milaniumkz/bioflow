import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const advisory = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const expires = Date.parse('2026-12-02T00:00:00Z');
/** Only this unpatched, development-only advisory is temporarily tolerated; production audit stays strict. */
export function assessAudit(report, lock, now = Date.now()) {
  if (!report?.vulnerabilities || !report?.metadata?.vulnerabilities || report.error || !lock?.packages)
    throw Error('Invalid npm audit report or package lock');
  const vulnerabilities = report.vulnerabilities;
  function leaves(name, seen = new Set()) {
    if (seen.has(name)) return [];
    seen.add(name);
    const item = vulnerabilities[name];
    if (!item || !Array.isArray(item.via)) return [{ severity: 'high', url: 'unknown', dependency: name }];
    return item.via.flatMap(v => typeof v === 'string' ? leaves(v, seen) : [{ ...v, dependency: name }]);
  }
  const blocked = [], exceptions = new Set();
  for (const [name, item] of Object.entries(vulnerabilities)) {
    if (!['high', 'critical'].includes(item.severity)) continue;
    const serious = leaves(name).filter(v => ['high', 'critical'].includes(v.severity));
    if (!serious.length || serious.some(v => {
      const source = vulnerabilities[v.dependency];
      const allowed = now < expires && item.severity !== 'critical' && v.severity === 'high' &&
        v.url === advisory && v.dependency === 'picomatch' && source?.nodes?.length > 0 &&
        source.nodes.every(path => lock.packages[path]?.dev === true);
      if (allowed) exceptions.add(advisory);
      return !allowed;
    })) blocked.push(name);
  }
  return { blocked, exceptions: [...exceptions] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  try {
    if (result.error || ![0, 1].includes(result.status)) throw result.error ?? Error(result.stderr || 'npm audit failed');
    const report = JSON.parse(result.stdout);
    const assessment = assessAudit(report, JSON.parse(readFileSync('package-lock.json', 'utf8')));
    for (const url of assessment.exceptions) console.log(`Temporary development-only exception through 2026-12-01 UTC: ${url}; see docs/DEPENDENCY_AUDIT.md`);
    if (assessment.blocked.length) throw Error('Unaccepted high/critical dependency advisories: ' + assessment.blocked.join(', '));
    console.log('Development dependency audit passed; production audit is checked separately without exceptions.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
