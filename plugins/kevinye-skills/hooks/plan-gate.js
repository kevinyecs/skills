#!/usr/bin/env node
// lets-code — Stop hook.
//
// The orchestrator's failure mode is stopping mid-plan, or calling work done
// while tasks sit at "landed" with no review pass. This gate reads the plan's
// status table and blocks Stop while anything is outstanding.
//
// It is a no-op in any session without a plan file, so the file check runs
// first and everything else is wrapped: a broken gate must never wedge a
// session.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PLAN_FILES = ['docs/PLAN.md', 'PLAN.md'];
// "landed" means implemented but not yet reviewed, which is the case this gate exists for.
const OUTSTANDING_STATUSES = new Set(['pending', 'running', 'landed']);
// The other half of the vocabulary. Nothing here blocks; kept so the contract
// the skill documents lives in one place.
const SATISFIED_STATUSES = new Set(['reviewed', 'skipped', 'done', 'blocked']);
const MAX_CONSECUTIVE_BLOCKS = 3;
const MAX_REASON_CHARS = 600;
const STDIN_TIMEOUT_MS = 1000;

const TABLE_SEPARATOR = /^\|?[\s:|-]+\|[\s:|-]*$/;

function splitRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
}

// Strip emphasis, backticks and checkboxes so `**Landed**` reads as "landed".
function normalizeStatus(cell) {
  return cell.replace(/[^A-Za-z]/g, '').toLowerCase();
}

function cleanLabel(cell) {
  return cell.replace(/[*`_]/g, '').trim();
}

/**
 * Parse markdown tables and return the rows whose status is outstanding.
 * Tables without a status column are ignored rather than guessed at.
 * @returns {{label: string, status: string}[]}
 */
function findOutstanding(markdown) {
  if (typeof markdown !== 'string') return [];

  const lines = markdown.split(/\r?\n/);
  const outstanding = [];
  let statusIndex = -1;
  let header = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed.startsWith('|')) {
      statusIndex = -1;
      header = null;
      continue;
    }

    const cells = splitRow(trimmed);

    if (TABLE_SEPARATOR.test(trimmed)) {
      statusIndex = header ? header.findIndex(c => /status/i.test(c)) : -1;
      continue;
    }

    if (statusIndex < 0) {
      header = cells;
      continue;
    }

    // Anything satisfied, or outside the vocabulary entirely, is left alone.
    const status = normalizeStatus(cells[statusIndex] || '');
    if (!OUTSTANDING_STATUSES.has(status)) continue;

    outstanding.push({ label: cleanLabel(cells[0] || 'row') || 'row', status });
  }

  return outstanding;
}

function buildReason(planFile, rows) {
  const parts = rows.map(({ label, status }) =>
    status === 'landed'
      ? `${label} is landed but not reviewed, run ponytail-review on it and set the status to reviewed`
      : `${label} is ${status}`);

  let reason = `${planFile} is not finished: ${parts.join('. ')}. Finish the plan and update its statuses before stopping.`;
  if (reason.length > MAX_REASON_CHARS) {
    reason = `${reason.slice(0, MAX_REASON_CHARS - 3)}...`;
  }
  return reason;
}

function findPlanFile(cwd) {
  for (const candidate of PLAN_FILES) {
    const full = path.join(cwd, candidate);
    if (fs.existsSync(full)) return { relative: candidate, full };
  }
  return null;
}

function stateFile(sessionId) {
  return path.join(os.tmpdir(), `lets-code-plan-gate-${sessionId}.count`);
}

function readBlockCount(file) {
  try {
    return parseInt(fs.readFileSync(file, 'utf8'), 10) || 0;
  } catch (e) {
    return 0;
  }
}

function writeBlockCount(file, count) {
  try {
    fs.writeFileSync(file, String(count));
  } catch (e) {
    // A state write failure only costs the escape hatch, never the session.
  }
}

function clearBlockCount(file) {
  try {
    fs.unlinkSync(file);
  } catch (e) {
    // Already absent.
  }
}

function sessionIdFrom(input, cwd) {
  try {
    const parsed = JSON.parse(String(input).replace(/^\uFEFF/, ''));
    if (parsed && parsed.session_id) return String(parsed.session_id).replace(/[^\w-]/g, '');
  } catch (e) {
    // No usable payload, fall through to the cwd hash.
  }
  return crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 16);
}

function run(input, cwd) {
  const plan = findPlanFile(cwd);
  if (!plan) return;

  const outstanding = findOutstanding(fs.readFileSync(plan.full, 'utf8'));
  const file = stateFile(sessionIdFrom(input, cwd));

  if (outstanding.length === 0) {
    clearBlockCount(file);
    return;
  }

  const blocks = readBlockCount(file) + 1;
  if (blocks > MAX_CONSECUTIVE_BLOCKS) {
    clearBlockCount(file);
    process.stderr.write(`lets-code plan gate: ${MAX_CONSECUTIVE_BLOCKS} blocks with no progress, giving up so the session is not stuck.\n`);
    return;
  }

  writeBlockCount(file, blocks);
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: buildReason(plan.relative, outstanding),
  }));
}

function main() {
  // Cheapest check first: no plan file means this is not a lets-code project.
  if (!findPlanFile(process.cwd())) process.exit(0);

  let input = '';
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    try {
      run(input, process.cwd());
    } catch (e) {
      // A gate that throws could wedge every Stop in the session.
    }
    process.exit(0);
  };

  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
  setTimeout(finish, STDIN_TIMEOUT_MS).unref();
}

if (require.main === module) main();

module.exports = {
  MAX_CONSECUTIVE_BLOCKS,
  OUTSTANDING_STATUSES,
  SATISFIED_STATUSES,
  buildReason,
  findOutstanding,
  findPlanFile,
  run,
};
