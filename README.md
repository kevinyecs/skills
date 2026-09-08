# skills

A Claude Code plugin marketplace.

## Install

```sh
claude plugin marketplace add kevinyecs/skills
claude plugin install lets-code@kevinyecs-skills
```

## lets-code

A design-and-build toolkit. It used to be one implementation skill. It is now three skills
that pipe into each other, plus a validator and three hooks.

```
grilling (mattpocock)  ->  solution-design  ->  draw-system-diagram  ->  lets-code
   gather context          argue to a design     draw it, validated      build it
```

- **grilling** interviews you until the requirements a design needs actually exist.
- **solution-design** turns those requirements into an architecture, argued out by opposed
  sub-agents rather than accepted from a single pass.
- **draw-system-diagram** turns the design into a multi-page drawio file, validated on
  every write.
- **lets-code** turns the design and the diagram into code, split across scoped sub-agents.

### solution-design

Senior architect and solution engineer. Cloud agnostic in method, committed once a cloud is
chosen. Gates on context first: if the requirements are not on the table (workload shape,
traffic, data volume, availability target, RTO/RPO, compliance, budget, team size, cloud),
it invokes `grilling` before drafting anything. A proposer drafts a design, three advocates
argue reliability, security, and simplicity and cost against it in parallel, and a judge
resolves the conflicts. Writes `docs/design/SOLUTION-DESIGN.md`.

Reach for it when a system needs an architecture before anyone writes code, and you want
the trade-offs on paper, not just the component list.

### draw-system-diagram

Consumes the solution design and produces one multi-page `.drawio` file: an infrastructure
page, a functional flow page, and a page per critical request path. Generates, validates,
repairs, and repeats, bounded, driven by a real validator rather than the agent's own
judgement of whether the diagram looks right.

Reach for it once a design exists and needs to be seen, not just read.

### lets-code

An orchestration skill. The session that invokes it stops implementing and becomes a
planner: it splits the work, scopes each task, delegates to sub-agents on the cheapest
model tier that can do the job, reviews what comes back, and keeps a running record of
where the plan stands.

Four tiers, lowest sufficient one wins, escalation on evidence rather than nerves. Tier 4
requires explicit approval in chat before it spawns.

Independent tasks run in parallel, dependent ones serialise behind a confirmed result.
Every sub-agent inherits the same rules: DRY, KISS, YAGNI, small focused files, explicit
error handling, validation at boundaries, and the project's own conventions ahead of its
own instincts.

Reach for it once there is a plan, spec, ticket or PRD ready to build, whether or not it
came out of `solution-design`.

### Hooks

**`plan-gate.js`, on Stop.** Reads the status table in `docs/PLAN.md` or `PLAN.md` and
blocks the session from stopping while any row is `pending`, `running` or `landed`. The
block message names the outstanding rows. `reviewed`, `skipped`, `done` and `blocked`
count as settled. See the plan status contract in the skill for the full vocabulary.

**`inject-context.js`, on SubagentStart.** SessionStart context never reaches sub-agents,
so the conventions the orchestrator wrote down have to be pushed into each one. If
`docs/CONVENTIONS.md` or `CONVENTIONS.md` exists, its content is injected into every
sub-agent, capped at 4000 characters.

**`drawio-gate.js`, on PostToolUse for `Write` and `Edit`.** Runs the diagram validator
against any `.drawio` file that was just written or edited and blocks on failure.

Why a validator exists at all: almost every way of corrupting a `.drawio` file fails
silently, and a bad `parent` attribute deletes the rest of the page while draw.io still
exports a PNG successfully. See `research/drawio-reference.md` for how the format actually
resolves cells.

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
- The drawio validator checks structure, not whether the diagram matches the design. It
  will pass a well-formed diagram that draws the wrong system.
- Round-trip and PNG verification need the drawio binary, which the plugin does not assume
  is installed. The validator works on the XML alone.

### Other plugins worth having

`solution-design` chains to `mattpocock-skills:grilling` for its context gate.
`lets-code` references the `show-me` and `ponytail` plugins in its review pass. Install
these separately if you want the pipeline to work as written.

### Tests

```sh
node plugins/lets-code/hooks/test-plan-gate.js
node plugins/lets-code/draw-io-utils/test-validate-drawio.js
```

### Status

Experimental.
