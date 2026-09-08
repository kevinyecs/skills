# skills

A Claude Code plugin marketplace.

## Install

```sh
claude plugin marketplace add kevinyecs/skills
claude plugin install lets-code@kevinyecs-skills
```

## lets-code

An orchestration skill plus two hooks. The session that invokes it stops implementing and
becomes a planner: it splits the work, scopes each task, delegates to sub-agents on the
cheapest model tier that can do the job, reviews what comes back, and keeps a running
record of where the plan stands.

Four tiers, lowest sufficient one wins, escalation on evidence rather than nerves. Tier 4
requires explicit approval in chat before it spawns.

Independent tasks run in parallel, dependent ones serialise behind a confirmed result.
Every sub-agent inherits the same rules: DRY, KISS, YAGNI, small focused files, explicit
error handling, validation at boundaries, and the project's own conventions ahead of its
own instincts.

The review pass references the `show-me` and `ponytail` plugins. Install those separately
if you want it to work as written.

### Hooks

**`plan-gate.js`, on Stop.** Reads the status table in `docs/PLAN.md` or `PLAN.md` and
blocks the session from stopping while any row is `pending`, `running` or `landed`. The
block message names the outstanding rows. `reviewed`, `skipped`, `done` and `blocked`
count as settled. See the plan status contract in the skill for the full vocabulary.

**`inject-context.js`, on SubagentStart.** SessionStart context never reaches sub-agents,
so the conventions the orchestrator wrote down have to be pushed into each one. If
`docs/CONVENTIONS.md` or `CONVENTIONS.md` exists, its content is injected into every
sub-agent, capped at 4000 characters.

### Limits, honestly

- A hook cannot spawn an agent or run a skill. The gate cannot review anything itself. All
  it does is refuse to let the orchestrator stop, so the orchestrator has to do the review
  pass and update the plan.
- The gate is only as good as the plan file. If the orchestrator does not maintain the
  status column, the gate has nothing to check.
- The gate gives up after 3 consecutive blocks in a session and prints a warning to stderr,
  so a wrong status value cannot trap you in a loop.
- Both hooks exit silently when the file they look for is absent, so they are a no-op in
  any project that is not using them.

### Tests

```sh
node plugins/lets-code/hooks/test-plan-gate.js
```

### Status

Experimental.
