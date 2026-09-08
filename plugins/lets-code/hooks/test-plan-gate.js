#!/usr/bin/env node
// Self-check for the plan gate. Run: node test-plan-gate.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  MAX_CONSECUTIVE_BLOCKS,
  SATISFIED_STATUSES,
  buildReason,
  findOutstanding,
  findPlanFile,
} = require('./plan-gate');

const TABLE = rows => ['| Task | Status |', '|---|---|', ...rows].join('\n');

function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

check('all rows reviewed passes', () => {
  const out = findOutstanding(TABLE(['| Wave 1 | reviewed |', '| Wave 2 | reviewed |']));
  assert.deepStrictEqual(out, []);
});

check('every satisfied status passes', () => {
  const rows = [...SATISFIED_STATUSES].map((s, i) => `| Wave ${i} | ${s} |`);
  assert.deepStrictEqual(findOutstanding(TABLE(rows)), []);
});

check('landed blocks', () => {
  const out = findOutstanding(TABLE(['| Wave 1 | reviewed |', '| Wave 2b | landed |']));
  assert.deepStrictEqual(out, [{ label: 'Wave 2b', status: 'landed' }]);
});

check('pending and running block', () => {
  const out = findOutstanding(TABLE(['| Wave 3 | pending |', '| Wave 4 | running |']));
  assert.deepStrictEqual(out.map(r => r.status), ['pending', 'running']);
});

check('status matching is case and emphasis insensitive', () => {
  const out = findOutstanding(['| Task | STATUS |', '|---|---|', '| Wave 1 | **Landed** |', '| Wave 2 | `REVIEWED` |'].join('\n'));
  assert.deepStrictEqual(out, [{ label: 'Wave 1', status: 'landed' }]);
});

check('table with no status column is ignored', () => {
  const md = ['| Tier | Model |', '|---|---|', '| 1 | Sonnet |', '| 2 | pending |'].join('\n');
  assert.deepStrictEqual(findOutstanding(md), []);
});

check('a status table after a non-status table is still read', () => {
  const md = [
    '| Tier | Model |', '|---|---|', '| 1 | Sonnet |', '',
    '| Task | Status |', '|---|---|', '| Wave 1 | pending |',
  ].join('\n');
  assert.deepStrictEqual(findOutstanding(md), [{ label: 'Wave 1', status: 'pending' }]);
});

check('malformed markdown does not throw', () => {
  for (const md of ['', '|||', '| Status |', '|---|', '| a', null, undefined, 42]) {
    assert.doesNotThrow(() => findOutstanding(md));
  }
});

check('reason names the row and stays short', () => {
  const reason = buildReason('docs/PLAN.md', [
    { label: 'Wave 3', status: 'pending' },
    { label: 'Wave 2b', status: 'landed' },
  ]);
  assert.ok(reason.includes('Wave 3 is pending'), reason);
  assert.ok(reason.includes('Wave 2b is landed but not reviewed'), reason);
  assert.ok(reason.length <= 600, `reason too long: ${reason.length}`);
});

check('reason is capped for a long plan', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ label: `Wave ${i}`, status: 'landed' }));
  assert.ok(buildReason('PLAN.md', rows).length <= 600);
});

check('missing plan file is detected as absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gate-'));
  assert.strictEqual(findPlanFile(dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

// End to end: the hook itself must stay silent and exit 0 with no plan file.
check('hook exits 0 silently with no plan file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gate-'));
  const out = execFileSync(process.execPath, [path.join(__dirname, 'plan-gate.js')], {
    cwd: dir, input: '{}', encoding: 'utf8',
  });
  assert.strictEqual(out, '');
  fs.rmSync(dir, { recursive: true, force: true });
});

check('hook blocks then gives up after the cap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gate-'));
  fs.writeFileSync(path.join(dir, 'PLAN.md'), TABLE(['| Wave 1 | landed |']));
  const input = JSON.stringify({ session_id: `test-${process.pid}` });

  for (let i = 0; i < MAX_CONSECUTIVE_BLOCKS; i++) {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'plan-gate.js')], {
      cwd: dir, input, encoding: 'utf8',
    });
    assert.strictEqual(JSON.parse(out).decision, 'block');
  }

  const after = execFileSync(process.execPath, [path.join(__dirname, 'plan-gate.js')], {
    cwd: dir, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  assert.strictEqual(after, '', 'gate should give up after the cap');
  fs.rmSync(dir, { recursive: true, force: true });
});

if (process.exitCode) {
  console.error('\nplan gate self-check FAILED');
} else {
  console.log('\nplan gate self-check passed');
}
