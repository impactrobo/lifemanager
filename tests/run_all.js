// Runs every tests/test_*.js as its own Node process and reports a summary.
// `npm test`. Nonzero exit if any script fails. No test runner, no dependencies.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter((f) => /^test_.*\.js$/.test(f))
  .sort();

if (!files.length) { console.error('no test_*.js files found in tests/'); process.exit(1); }

let failed = 0;
const started = Date.now();
for (const f of files) {
  process.stdout.write(`\n▶ ${f}\n`);
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; process.stdout.write(`✗ ${f} FAILED (exit ${r.status})\n`); }
  else process.stdout.write(`✓ ${f}\n`);
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
process.stdout.write(`\n${'='.repeat(48)}\n`);
process.stdout.write(`${files.length - failed}/${files.length} test files passed  (${secs}s)\n`);
process.exit(failed ? 1 : 0);
