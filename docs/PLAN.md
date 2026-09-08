# Plan: system design skills for the lets-code plugin

Extend the `lets-code` plugin from one skill to three. It stops being an implementation
skill and becomes the toolkit: design a system, draw it, build it.

```
grilling (mattpocock)  ->  lets-design  ->  lets-draw  ->  lets-code
   gather context          argue to a design     draw it, validated      build it
```

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Packaging | one plugin, three skills | They pipe into each other and share the validator |
| Interview | chain to `mattpocock-skills:grilling` | Reuse what works, do not write a second interviewer |
| Debate | 3 opposed advocates plus a judge | Breadth without a per-component agent explosion |
| Diagram format | uncompressed drawio XML, multi page | Diffable, and a script can check it |
| Diagram enforcement | PostToolUse hook on `*.drawio` | Deterministic gate, not a reminder the agent can skip |

## lets-design

Senior architect and solution engineer. Cloud agnostic in method, committed once a cloud is
chosen. Ponytail voice throughout: the simplest architecture that meets the stated
requirements, never the most impressive one.

1. **Context gate.** Not enough to design against? Invoke `grilling` first. Requirements
   that must exist before any design: workload shape, traffic profile and growth, data
   volume and gravity, availability target, RTO and RPO, consistency needs, security and
   compliance obligations, budget ceiling, team size and operational maturity, cloud.
2. **Draft.** A proposer agent produces a candidate design against those requirements.
3. **Argue.** Three advocates run in parallel, each with the requirements and the draft,
   none inheriting the others' context:
   - reliability: failure modes, blast radius, degradation, does it meet the stated RTO/RPO
   - security: identity, network boundaries, data protection, compliance obligations
   - simplicity and cost: does each component need to exist, what managed service removes
     it, what does it cost to run and to operate
4. **Judge.** A judge agent takes the draft and the three critiques, resolves the conflicts,
   and states which trade-offs were accepted and why they are right for this context.
5. **Write.** Orchestrator writes `docs/design/SOLUTION-DESIGN.md`.

Per component the document states: what it does here, why it was chosen for this project,
what you must know about the service to run it (limits, quotas, failure behaviour, pricing
model), what was rejected and why, the trade-off accepted and why it is optimal here, and
how it fails.

## lets-draw

Consumes the solution design. Produces one multi page `.drawio` file plus the utils that
keep it valid.

Pages: infrastructure (cloud service icons, region, VPC, subnet and AZ containers),
functional flow (plain boxes and labelled edges), and a page per critical request path.
Every edge carries a label saying what happens on it. Node labels name the thing without
bloating the canvas.

Generate, validate, repair, repeat, bounded. The loop is driven by a real validator, not by
the agent's judgement.

## draw-io-utils

Written into the target repo by the skill. Dependency free.

- `validate-drawio.js`: XML well formed, unique ids, every edge source and target resolves,
  no cell parented to a missing cell, no unlabelled edge, no orphan node, labels escaped,
  page names unique
- `shapes.json`: verified style strings per cloud, and how to derive one
- `test-validate-drawio.js`: self check with assert, must fail when the checks break

## Tasks

| # | Task | Tier | Status |
|---|---|---|---|
| 1 | Research drawio XML format, cloud shape catalogs, validation tooling | 3 | reviewed |
| 2 | `draw-io-utils`: validator, shapes catalog, self check | 2 | reviewed |
| 3 | `drawio-gate.js` hook, PostToolUse on `*.drawio`, wired into hooks.json | 2 | reviewed |
| 4 | `lets-design/SKILL.md` | 2 | reviewed |
| 5 | `lets-draw/SKILL.md` | 2 | reviewed |
| 6 | plugin.json, marketplace.json, README for three skills | 1 | reviewed |
| 7 | End to end dry run on the machinel project, then review | 2 | reviewed |
| 8 | Fix the nine defects the dry run found | 2 | reviewed |
| 9 | Validator: readability checks, white background, dark text, overlap detection | 2 | reviewed |
| 10 | Skill: mandate the palette and a layout loop that iterates until clean | 2 | reviewed |
| 11 | Regenerate the machinel diagram, render, confirm readable | 2 | reviewed |
| 12 | Fold the eight regeneration findings into lets-draw | 2 | reviewed |
| 13 | Rewrite the lets-draw loop as per-page branches with their own reviewers | 3 | running |
| 14 | `branch-state.js` deterministic driver, plus branch awareness in the Stop gate | 2 | pending |

2 and 3 depend on 1. 4 is independent of the diagram work. 5 depends on 2 and 3.

## What the dry run found

Zero validator repair iterations, five layout iterations, every one driven by a PNG render
the skill treats as optional. The file was structurally valid and unreadable. Defects:

1. Step 1 is broken. `${CLAUDE_PLUGIN_ROOT}` is empty in a sub-agent shell, so the copy
   command expands to `cp -R /draw-io-utils` and fails. A cold agent stops at step 1.
2. The hook safety net is tool shaped, not file shaped. A heredoc write fires no
   `PostToolUse`, so "happens whether or not you remember" is false as written.
3. No edge label collision guidance. Every rule pushes toward long labels, long labels on a
   shared row overlap, and the fix (`mxPoint as="offset"`) is never mentioned.
4. `pageWidth 850` is fixed on every page while the mandated content is roughly 1900 wide.
5. No node box sizing guidance, so labels clip.
6. The functional page rule forbids containers, but `orphan-vertex` is an error, so grouping
   the declarative and imperative halves is impossible as written.
7. The catalog lacks SageMaker, IAM, EventBridge Scheduler and CloudWatch Logs, so 10 of 17
   icons on an ML stack had to be hand verified.
8. Output path never stated.
9. No fallback when a repo has no `SOLUTION-DESIGN.md`.

## Out of scope

No rendering to PNG or SVG. No cost calculator, the design cites pricing models rather than
computing a bill. No Terraform generation, `lets-code` already covers building.


## Readability defects, from looking at the render

The first diagram was structurally perfect and visually unusable. Both facts matter.

- No `background` attribute anywhere, so the canvas is transparent and reads as dark
- Edge labels default to the edge midpoint, which on a long horizontal span lands on top of
  whatever node is in the middle of the canvas
- Seven observed collisions, including a label printed across the SageMaker endpoint icon
  and two labels printed on top of each other

Node geometry is fully known in the XML, so overlap is computable rather than a matter of
taste. It belongs in the validator with the structural checks. A prose rule saying "do not
overlap" is what produced this file.


## The lets-draw loop, rewritten

One agent drawing five pages sequentially is wrong. Each page is independent work with its
own failure modes, and the run just proved that a generator cannot see its own layout
defects. So: one branch per page, each with a generator and its own reviewer, each
terminating on its own.

- **Branches are pages.** Fan out one per page from the solution design.
- **Every branch owns its own file** under `docs/diagrams/parts/`. Pages share one mxfile,
  so parallel branches writing the finished file would clobber each other. Merge at the end.
- **The reviewer is fresh every round and never inherits the generator's context.** It looks
  at the rendered PNG and judges what the checks cannot: wrong icon for the service, wrong
  direction, a connection that does not match the design, text over text, bad positioning.
- **Findings accumulate in a per-branch ledger** so a fix cannot silently regress an earlier
  finding, and the generator sees the whole history on each pass.
- **A branch stops when its own reviewer returns clean.** The run stops when every branch
  has. A capped branch reports what is still wrong rather than shipping.
- **Ponytail here is about reading, not about architecture.** The design phase already did
  the technical simplification. In this skill it means fewer crossings, straighter routes,
  and splitting a page that is doing two jobs. It never means deleting a fact to reduce
  clutter.


## Determinism without extra model cost

A driver that spawns `claude -p` per round would make the whole loop deterministic and would
cost a session per call. Not worth it. Split the loop instead:

- **Deterministic, no model**: validate each part, render each part, merge, decide which
  branch runs next, refuse to stop while a branch is open. A script does all of it.
- **Model, in session**: generate a page, review a render. These are the work itself and
  cost the same whoever schedules them.

`branch-state.js` answers one question, the same way every time: what is the next action.
The orchestrator obeys it and spawns the sub-agents. The Stop gate reads the same ledgers.

Guaranteed: no branch skipped, none merged unreviewed, every round validated and rendered
because the script does it rather than the model, findings survive a restart, and the
session cannot end while a branch is open.

Not guaranteed: the order branches run in, and whether they run in parallel. Making that
deterministic is the part that needed a spawning driver.
