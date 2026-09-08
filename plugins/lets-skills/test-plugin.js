#!/usr/bin/env node
// @ts-check
// Manifest and skill frontmatter self-check. A skill with malformed frontmatter is not
// loaded at all, and nothing else in this repo would notice.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = __dirname;
// A skill description is what the model matches on to decide whether to load the skill.
// Long is fine, unbounded is a sign something ran away.
const MAX_DESCRIPTION = 1024;

/** @param {string} file @returns {Record<string,string>} */
function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.startsWith('---\n'), `${file}: no frontmatter block`);
  const end = text.indexOf('\n---\n', 4);
  assert.ok(end > 0, `${file}: frontmatter is not closed`);
  const body = text.slice(4, end);
  /** @type {Record<string,string>} */
  const out = {};
  let key = null;
  for (const line of body.split('\n')) {
    const m = /^([a-z_]+):\s?(.*)$/.exec(line);
    if (m) {
      key = m[1];
      // The bug this exists to catch: `name: x description: y` on one line.
      assert.ok(!/^\S+\s+[a-z_]+:\s/.test(m[2]), `${file}: two keys on one line: ${line.slice(0, 60)}`);
      out[key] = m[2];
    } else if (key) {
      out[key] += ' ' + line.trim();
    }
  }
  return out;
}

const skills = fs.readdirSync(path.join(ROOT, 'skills'));
assert.ok(skills.length > 0, 'no skills found');
for (const slug of skills) {
  const file = path.join(ROOT, 'skills', slug, 'SKILL.md');
  const fm = frontmatter(file);
  assert.strictEqual(fm.name, slug, `${slug}: frontmatter name is '${fm.name}'`);
  assert.ok(fm.description, `${slug}: no description`);
  assert.ok(fm.description.length <= MAX_DESCRIPTION, `${slug}: description is ${fm.description.length} chars`);
  console.log(`ok   ${slug}: name matches directory, description ${fm.description.length} chars`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
assert.strictEqual(manifest.name, path.basename(ROOT), 'plugin.json name does not match its directory');
console.log(`ok   plugin.json: ${manifest.name} v${manifest.version}`);

const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8'));
for (const [event, blocks] of Object.entries(hooks.hooks)) {
  for (const b of /** @type {any[]} */ (blocks)) {
    for (const h of b.hooks) {
      const m = /\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+?)"/.exec(h.command);
      assert.ok(m, `${event}: hook command does not use \${CLAUDE_PLUGIN_ROOT}`);
      assert.ok(fs.existsSync(path.join(ROOT, m[1])), `${event}: hook script missing: ${m[1]}`);
      console.log(`ok   ${event}: ${m[1]} exists`);
    }
  }
}

console.log('\nplugin self-check passed');
