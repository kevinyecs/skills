# skills

Agent skills for Claude Code.

## impl

An orchestration skill. The session that invokes it stops implementing and becomes a
planner: it splits the work, scopes each task, delegates to sub-agents on the cheapest
model tier that can do the job, reviews what comes back, and keeps a running record of
where the plan stands.

Four tiers, lowest sufficient one wins, escalation on evidence rather than nerves. Tier 4
requires explicit approval in chat before it spawns.

Independent tasks run in parallel; dependent ones serialise behind a confirmed result.
Every sub-agent inherits the same rules: DRY, KISS, YAGNI, small focused files, explicit
error handling, validation at boundaries, and the project's own conventions ahead of its
own instincts.

### Install

```sh
git clone https://github.com/kevinyecs/skills.git
cp -r skills/impl ~/.claude/skills/impl
```

Then invoke it with `/impl` in Claude Code, or let it trigger when a plan or spec is ready
to build.

### Status

Experimental.
