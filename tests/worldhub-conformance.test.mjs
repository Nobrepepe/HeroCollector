import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * World Hub conformance.
 *
 * The kit ships a checker; running it here makes the standard something the
 * build enforces rather than something a document asks anyone to remember. It
 * covers the contract's vocabulary, recipe names written into code,
 * compatibility gating, whether the conformance fixtures have gone stale, and
 * the two install-time traps that are invisible until they fire.
 *
 * A failure names the file, the line, and the fix. The reasoning is in
 * vendor/worldhub-kit/CONSUMER_GUIDE.md.
 */

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const verify = join(appRoot, 'vendor', 'worldhub-kit', 'js', 'verify.mjs');

test('the app conforms to the World Hub consumer kit', () => {
  assert.ok(existsSync(verify),
    'vendor/worldhub-kit is missing — run `node scripts/kit-sync.mjs herocollector` from World Hub');
  try {
    const output = execFileSync('node', [verify, '--app-root', appRoot], { encoding: 'utf8' });
    assert.match(output, /passes/);
  } catch (error) {
    assert.fail(`\n${error.stdout ?? ''}${error.stderr ?? ''}`);
  }
});
