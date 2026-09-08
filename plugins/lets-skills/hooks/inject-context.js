#!/usr/bin/env node
// lets-code — SubagentStart hook.
//
// SessionStart context is parent-thread only and never reaches subagents, so
// the conventions the orchestrator wrote down have to be pushed into each one
// individually. Without this every sub-agent invents its own layout.

const fs = require('fs');
const path = require('path');

const CONVENTIONS_FILES = ['docs/CONVENTIONS.md', 'CONVENTIONS.md'];
const MAX_CONTEXT_CHARS = 4000;
const TRUNCATION_MARKER = '\n\n[truncated, read the conventions file in full for the rest]';

function findConventions(cwd) {
  for (const candidate of CONVENTIONS_FILES) {
    const full = path.join(cwd, candidate);
    if (fs.existsSync(full)) return { relative: candidate, full };
  }
  return null;
}

function buildContext(relative, body) {
  const capped = body.length > MAX_CONTEXT_CHARS
    ? body.slice(0, MAX_CONTEXT_CHARS) + TRUNCATION_MARKER
    : body;
  return `Project conventions from ${relative}. Follow these ahead of your own instincts.\n\n${capped}`;
}

function main() {
  const conventions = findConventions(process.cwd());
  if (!conventions) process.exit(0);

  const body = fs.readFileSync(conventions.full, 'utf8').trim();
  if (!body) process.exit(0);

  // SubagentStart drops raw stdout, it only reads the hookSpecificOutput form.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: buildContext(conventions.relative, body),
    },
  }));
}

try {
  main();
} catch (e) {
  // Never fail a subagent spawn over missing context.
  process.exit(0);
}
