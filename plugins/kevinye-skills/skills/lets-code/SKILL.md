---
name: lets-code
description: Implement work through scoped sub-agents on four model tiers. Use when a plan, spec, ticket or PRD is ready to be built. The main session stays the orchestrator and does not write the code itself.
---

# lets-code

Experimental. The session that invokes this skill is the **orchestrator**. It plans,
scopes, delegates, reviews and keeps state. It does not implement. Every implementation
task goes to a sub-agent, on the cheapest tier that can do the job well.

## Tiers

Pick the lowest tier that is genuinely sufficient. Escalate on evidence, not on nerves.

| Tier | Model and effort | Use for |
|---|---|---|
| 1 | Sonnet 5, low or medium thinking | Doc updates, small and targeted code changes known to be small before starting, CLI commands, low-complexity implementations, simplifying existing docs |
| 2 | Opus 5, medium | Complex implementations scoped as medium difficulty. The default when the session already carries the necessary context, spec and plan, which is most of the time. Also initial documentation writing, which Tier 1 can edit later |
| 3 | Opus 5, high or xhigh | Advanced problems that can fail in several places, where the extra thinking pays. System-design level work, deeply dependent problems, anything Tier 2 struggles with. Also when the orchestrator session has not fully scoped the functionality, or the failure cases are widely distributed |
| 4 | Fable, medium to xhigh | Genuinely hard problems only. System design, or new work that depends on a large amount of existing code, where production-ready output on a mature codebase is the bar. Reach for it after grilling and planning have run and something is still unclear |

**Tier 4 requires user approval.** The orchestrator must ask in the session first:

> This task looks reasonable for Fable, because `<one short reason>`. Spawn it?

Only spawn after the user says yes in chat.

## Orchestration

1. Read the plan and split it into implementation tasks.
2. Assign a tier per task.
3. **Parallelise what is independent.** Spawn those sub-agents together.
4. **Serialise what is dependent.** If task B needs A's output, implement A first, show the
   result, and go forward only once the user confirms A is correct.
5. **Keep memory.** Maintain a running record of where we are in the plan, what each
   sub-agent changed, and what remains. Update it after every task.
6. **Finish the plan.** Every wave, to the end, including the review and show-me pass. Do
   not stop at the last interesting task and offer the rest as an option. If something is
   genuinely blocked, complete everything else and say plainly what was left and why.

## Plan status contract

The plan lives in `docs/PLAN.md`, or `PLAN.md` if there is no docs folder. It carries a
markdown table with a **Status** column, one row per task, and the orchestrator keeps it
current. The status values are exactly these:

| Status | Means |
|---|---|
| `pending` | Not started |
| `running` | A sub-agent is working on it |
| `landed` | The sub-agent returned, not yet reviewed |
| `reviewed` | `ponytail-review` has run and its findings are applied or declined with a reason |
| `skipped` | Deliberately not doing it, reason written in the plan |
| `blocked` | Cannot proceed, blocker written in the plan |
| `done` | Finished and reviewed, for tasks with no review to run |

A task moves to `landed` the moment its sub-agent returns. It moves to `reviewed` only
after `ponytail-review` has run on that task. `landed` is not done.

The Stop hook enforces this. Any row left at `pending`, `running` or `landed` blocks the
session from stopping and names the row. Update the plan as you go rather than at the end.

## Establish the conventions before delegating

The orchestrator owns this step. Do it once, up front, and again whenever the work moves
into a stack it has not covered yet. A sub-agent inherits the result; it does not go and
work this out for itself, because three sub-agents working it out independently is three
different answers.

1. **Read the project first.** An existing layout, `CLAUDE.md`, `AGENTS.md`, a README, a
   lint or formatter config, an ADR: these win over anything general. Match them even where
   you would have chosen differently.
2. **Green field or silent project: go and find the idiomatic layout** for the language,
   framework or tool in question. Use the documentation tools available, the official style
   guide, the ecosystem's own scaffolding output. Do not reason it out from memory, and do
   not assume the shape of the last stack you worked in transfers.
3. **Write it down** as a short conventions note in the repo, before the first sub-agent is
   spawned. File layout, naming, where each kind of declaration lives, which tools gate the
   work.
4. **Put it in every sub-agent prompt**, concretely. Not "follow best practice" but the
   actual file names, the actual rule.
5. **First implementation sets the pattern.** Show it, confirm it is right, then hold every
   later sub-agent to it. Reviewing the fifth module is too late to discover the layout was
   wrong.

The failure this prevents: every sub-agent writes correct code in a different shape, the
result validates and passes tests, and it still does not look like a codebase a team
maintains. Structure is not something to review at the end. It is context to hand over at
the start.

## Sub-agent context

Curate the input. Most of it is about the task, with enough shared context that the agent
understands the larger goal it is serving.

- **Task context, the bulk**: the exact scope, files, interfaces, acceptance criteria, and
  what is explicitly out of scope.
- **Shared context, brief**: the goal, the architecture it fits into, the conventions in
  force.
- **Sources to draw from**: the session chat, written specs, plan files, tickets, PRDs.

## Rules every sub-agent inherits

**DRY, KISS, YAGNI by default.** Breaking one of these is occasionally the wiser long-term
call, but it is rare. When it happens, say so explicitly and say why.

**Clean, maintainable code:**

- Single responsibility per module, function and file
- Small focused functions, cohesive files, organised by feature or domain rather than by type
- Explicit names over clever ones
- Early returns instead of deep nesting
- Explicit error handling, never a silently swallowed failure
- Validate at system boundaries, do not trust external data
- Immutable by default
- Named constants, no magic numbers
- Separate responsibilities in the project structure too: infrastructure apart from business
  logic, modular and scalable rather than one growing file

**Follow the project before following your instincts.** If a pattern is already established
in the codebase, or defined in CLAUDE.md, AGENTS.md or a README, use it. Fall back on
general senior practice only where the project is green field or silent.

**Language best practices.** Use the idioms, typing and tooling of the language in question.
If you do not know the current best practice, look it up rather than guess.

**Comments.** Short, high signal, only where they earn their place. Do not narrate code.

**Working first, then simple.** Get the functionality right, then review your own output and
simplify what can be simplified, judged against the whole project rather than the diff.

## Skills to review with

Run these after an implementation lands, before it is called done.

| Skill | Use it to |
|---|---|
| `ponytail:ponytail-review` | Review the diff for over-engineering. Names what to delete: reinvented standard library, unneeded dependencies, speculative abstractions, dead flexibility |
| `ponytail:ponytail` | Force the simplest thing that works while implementing. Standard library and native platform features before a dependency |
| `ponytail:ponytail-audit` | Same as review, over the whole repo rather than a diff. Use at the end of a large piece of work |
| `ponytail:ponytail-debt` | Collect the `ponytail:` shortcuts left behind into a ledger, so deferrals are tracked rather than forgotten |
| `show-me` | Show the user what was built. Diagrams and code-shape sketches of the structure, so the shape can be reviewed and not just the diff |

The orchestrator runs the review skills on what comes back from a sub-agent. A sub-agent
may run them on its own output before returning.

**These are not optional and not a nice-to-have at the end.** Work is not done until the
review skills have run on it and their findings are either applied or explicitly declined
with a reason. Run `ponytail-review` per landed task, `ponytail-audit` and `show-me` once
the whole plan is complete.

## Structure and architecture

Decide the shape before writing files, and decide it from the problem rather than from
habit.

1. **The project decides first.** An established structure, or one defined in CLAUDE.md,
   AGENTS.md or a README, wins over anything below. Match it even where you would have
   chosen differently.
2. **Organise by feature or domain, not by file type.** Group what changes together.
3. **Separate the layers and point the dependencies inward.** Delivery and adapters at the
   edge, business logic in the middle with no knowledge of the edge, infrastructure behind
   an interface. Ports and adapters where the domain is rich enough to earn it.
4. **Name things in the language of the domain**, consistently, in files and folders as
   well as in code.
5. **Keep the public surface small.** Export what callers need and nothing else.
6. **Config and secrets at the edges.** No globals reaching into the middle.
7. **Modular monolith by default.** Split into services only under real pressure, never on
   anticipation.
8. **Tests live beside what they test**, in the structure the language expects.
9. **YAGNI applies to architecture too.** Do not scaffold a layer that has one
   implementation and no second one in sight. The simplest structure that supports the
   change you can actually foresee.
10. **Write the choice down** in a short note or ADR when it is not obvious, so the next
    agent follows it instead of inventing a second architecture.

## Tests

Keep a test folder and work test-first while developing. Enforce clean code and best
practices with the deterministic tools the project has: formatter, linter, type checker,
test runner. A tool finding beats an opinion.

## Judgment expected of every agent

Act as a senior developer and architect, on the implementation, the language and the tools.

- **Use the right tool for the job.** Prefer a well-chosen library over hand-rolled complex
  logic. Write it yourself only when the need is a small, easily replicated subset of what
  the library offers. The orchestrator makes that call, because it sees the whole project
  scope and direction.
- **Keep asking whether it can be simpler.** If another implementation, service or approach
  does the same job more simply, with lower latency, or more cheaply, and gives up no
  functionality, take that route.
