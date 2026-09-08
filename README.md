<p align="center">
  <img src="assets/banner.png" alt="lets-skills" width="100%">
</p>

Three skills that hand work to each other. Design a system, draw it, build it.

```
grilling  ->  lets-design  ->  lets-draw  ->  lets-code
gather        argue it out     draw it       build it
```

Each stage produces a file the next one reads. You can start at any stage that has its
input, and stop at any stage whose output is all you wanted.

## Install

```sh
claude plugin marketplace add kevinyecs/skills
claude plugin install lets-skills@kevinye-skills
```

## lets-design

Designs a distributed system for a real project on a chosen cloud, and writes down why.

It refuses to design without requirements, and chains to `grilling` to get them. Then a
proposer drafts an architecture and three advocates attack it in parallel: one for
reliability, one for security, and one for simplicity and cost. A judge resolves the
conflicts and names the trade-offs it accepted.

The third advocate is the one that matters. Without a seat arguing for deletion, review
only ever adds, and you end up with a design that satisfies every reviewer and no budget.

Output is `docs/design/SOLUTION-DESIGN.md`. Per component: what it does here, why it beat
the alternatives for this project, what you must know to operate it, and how it fails.

## lets-draw

Turns that design into a multi page `.drawio` file that is actually readable.

One branch per page, running in parallel. Each branch has a generator and its own reviewer,
and the reviewer is spawned fresh every round and never sees the generator's context. It
reads the design as well as the render, so it can catch a connection that does not exist,
not just an ugly one. A branch stops when its own reviewer passes. The run stops when all
of them have.

This shape exists because a generator cannot review its own layout. A real run produced a
diagram that passed every structural check and was unreadable in a dozen places.

Between the two sits `validate-drawio.js`, because almost every way of corrupting a
`.drawio` file fails silently. A bad `parent` attribute deletes the rest of the page and
still exports a PNG successfully. The validator checks structure, contrast, overlap, label
collisions and page shape, and a `PostToolUse` hook runs it on every write.

## lets-code

Implements a plan through sub-agents on four model tiers, cheapest one that can do the job.

The session that invokes it stops writing code and becomes the orchestrator. It splits the
work, scopes each task, delegates, reviews what comes back, and keeps the plan updated.
Independent tasks run in parallel, dependent ones wait.

Before delegating anything it establishes the project's conventions and hands them to every
sub-agent, because three sub-agents left to infer structure produce three different
structures.

## Hooks

| Event | Does |
|---|---|
| `Stop` | Reads the plan's status table and refuses to end the session while a task is pending, or landed but unreviewed |
| `SubagentStart` | Injects the project conventions into every sub-agent, since session context never reaches them |
| `PostToolUse` | Runs the drawio validator on any `.drawio` file just written |

## Limits, honestly

A hook cannot spawn an agent or run a skill. The gate cannot review anything itself. All it
does is refuse to let the orchestrator stop, so the orchestrator has to do the review pass
and update the plan.

The gate is only as good as the plan file. If the orchestrator does not maintain the status
column, the gate has nothing to check.

The gate gives up after 3 consecutive blocks in a session and prints a warning to stderr, so
a wrong status value cannot trap you in a loop.

Both hooks exit silently when the file they look for is absent, so they are a no-op in any
project that is not using them.

The drawio validator checks structure, not whether the diagram matches the design. It will
pass a well formed diagram that draws the wrong system.

Round trip and PNG verification need the drawio binary, which the plugin does not assume is
installed. The validator works on the XML alone.

## Other plugins worth having

`lets-design` chains to `mattpocock-skills:grilling` for its context gate. `lets-code`
references the `show-me` and `ponytail` plugins in its review pass. Install these separately
if you want the pipeline to work as written.

## Tests

```sh
node plugins/lets-skills/test-plugin.js
node plugins/lets-skills/hooks/test-plan-gate.js
node plugins/lets-skills/draw-io-utils/test-validate-drawio.js
```

## License

MIT. Use it, fork it, ship it, sell it. Pull requests welcome.
