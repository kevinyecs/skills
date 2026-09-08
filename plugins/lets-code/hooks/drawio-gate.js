#!/usr/bin/env node
// lets-code — PostToolUse hook on Write|Edit.
//
// Almost every way of corrupting a .drawio file fails silently: an edge
// pointing at a missing id loses the edge and its label, a bad `parent`
// destroys cells 0 and 1 and deletes the rest of the page, and draw.io still
// exports a PNG and exits 0. An agent reviewing its own diagram cannot see any
// of that, so the check has to be deterministic and it has to run on write.
//
// This runs on every write in every session, so the extension check comes
// first and everything after it is wrapped: a broken gate must never wedge a
// session.

const fs = require('fs');
const path = require('path');

const DRAWIO_EXT = '.drawio';
const VALIDATOR = path.join(__dirname, '..', 'draw-io-utils', 'validate-drawio.js');
// Exit 2 is the PostToolUse blocking contract: stderr is fed back to the model.
const EXIT_BLOCK = 2;
const EXIT_OK = 0;
const MAX_FINDINGS = 20;
const STDIN_TIMEOUT_MS = 1000;

function writtenPath(input) {
  const parsed = JSON.parse(String(input).replace(/^\uFEFF/, ''));
  const candidates = [
    parsed && parsed.tool_input && parsed.tool_input.file_path,
    parsed && parsed.tool_response && parsed.tool_response.filePath,
  ];
  return candidates.find(c => typeof c === 'string' && c) || null;
}

function buildReason(file, errors, warnings) {
  const shown = errors.slice(0, MAX_FINDINGS).map(f => {
    const where = [f.page ? `page ${f.page}` : null, f.line ? `line ${f.line}` : null].filter(Boolean).join(', ');
    return `- ${f.check}${where ? ` (${where})` : ''}: ${f.message}`;
  });
  if (errors.length > shown.length) shown.push(`- ...and ${errors.length - shown.length} more`);

  const lines = [
    `${file} is not a valid draw.io diagram. draw.io would open it without complaining and silently misrender or delete parts of the model, so these must be fixed now:`,
    '',
    ...shown,
  ];
  if (warnings.length > 0) {
    lines.push('', `Also ${warnings.length} warning(s) worth checking: ${warnings.map(w => w.check).join(', ')}.`);
  }
  lines.push('', 'Fix the file and write it again. The gate reruns on every write.');
  return lines.join('\n');
}

function run(input) {
  const file = writtenPath(input);
  if (!file || !file.endsWith(DRAWIO_EXT) || !fs.existsSync(file)) return EXIT_OK;

  const { validateFile, loadCatalog, ERROR } = require(VALIDATOR);
  const findings = validateFile(file, loadCatalog());
  const errors = findings.filter(f => f.severity === ERROR);
  if (errors.length === 0) return EXIT_OK;

  process.stderr.write(buildReason(file, errors, findings.filter(f => f.severity !== ERROR)) + '\n');
  return EXIT_BLOCK;
}

function main() {
  let input = '';
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    let code = EXIT_OK;
    try {
      code = run(input);
    } catch (e) {
      // A gate that throws would break every write in the session.
    }
    process.exit(code);
  };

  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
  setTimeout(finish, STDIN_TIMEOUT_MS).unref();
}

if (require.main === module) main();

module.exports = { buildReason, run, writtenPath };
