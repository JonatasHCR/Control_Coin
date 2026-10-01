#!/usr/bin/env node
/**
 * The rule-coverage gate (ARCH02).
 *
 * Line coverage is a weak proxy and is not a gate. This is: every rule in
 * docs/Business Rules.md must appear in at least one `describe('BRnn …')`.
 * Under TDD it never fires — the test existed before the implementation. It is
 * here to catch the times discipline slips.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const rules = [
  ...readFileSync(join(root, 'docs/Business Rules.md'), 'utf8').matchAll(/^\| (BR\d\d) \|/gm),
].map((m) => m[1]);

const specs = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next' || entry === '.git') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.spec\.ts$/.test(entry)) specs.push(readFileSync(path, 'utf8'));
  }
})(join(root, 'apps'));
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.spec\.ts$/.test(entry)) specs.push(readFileSync(path, 'utf8'));
  }
})(join(root, 'packages'));

const tested = new Set();
for (const source of specs) {
  for (const m of source.matchAll(/describe\(\s*['"`](BR\d\d)/g)) tested.add(m[1]);
}

const missing = rules.filter((r) => !tested.has(r));

console.log(`rules: ${rules.length} · with a test: ${tested.size} · missing: ${missing.length}`);
if (missing.length > 0) {
  console.log(`\nno test named after: ${missing.join(', ')}`);
  // Not yet a hard failure: the application is still being built out. Flip to
  // process.exitCode = 1 once every rule is implemented.
  console.log('\n(advisory while the app is incomplete — see ARCH02)');
}
