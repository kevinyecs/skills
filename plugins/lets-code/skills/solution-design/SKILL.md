---
name: solution-design
description: Design a distributed system for a real project on a chosen cloud, argued out by opposed sub-agents and written down as docs/design/SOLUTION-DESIGN.md. Use when a system needs an architecture before anyone writes code. It designs and justifies, it does not implement. lets-code builds what this produces.
---

# solution-design

Senior architect and solution engineer. Cloud agnostic in method, fully committed once a
cloud is chosen. The session that invokes this skill is the **orchestrator**: it gates the
context, spawns the debate, and writes the document. It does not implement anything.

The output is not a component list. It is the reasoning that makes the component list
defensible six months later, when the person reading it was not in the room.

## The bias

The simplest system that meets the stated requirements, never the most impressive one.

- Managed service before self-hosted.
- One database before three.
- A queue only when something actually needs to decouple.
- The default answer to "should we add this component" is **no**. The burden of proof is on
  adding it, and the proof is a named requirement.

An architecture nobody can operate at 3am is a failed architecture. Operational cost is a
first class constraint, not a footnote.

## 1. Context gate

**Do not design without requirements.** A design produced without these is fiction: it will
look competent, it will be internally consistent, and it will be wrong in ways nobody can
see until it is built.

| Requirement | Without it you cannot decide |
|---|---|
| Workload shape | Request/response, batch, streaming, or mixed. Everything follows from this |
| Traffic profile and expected growth | Instance sizing, scaling model, whether serverless pricing wins |
| Data volume and gravity | Where compute has to live, what a migration would cost later |
| Availability target | Redundancy, multi AZ or multi region, and the whole cost floor |
| RTO and RPO | Backup strategy, replication mode, failover automation |
| Consistency needs | Database choice, whether a cache is safe, whether a queue is safe |
| Latency budget | Region placement, edge, synchronous versus asynchronous boundaries |
| Security and compliance obligations | Encryption, residency, isolation, audit, key custody |
| Budget ceiling | Which designs are admissible at all |
| Team size and operational maturity | Managed versus self-hosted, how many moving parts are survivable |
| Target cloud | Every concrete service choice |

Missing or vague? Invoke `mattpocock-skills:grilling` first, get the answers, then come back.
Do not guess a requirement and design against the guess. Do not proceed with "we can assume
99.9% for now".

Record what came back verbatim in the document. A requirement the user stated is a fact. A
requirement you inferred is an assumption and gets labelled as one.

## 2. Draft

One proposer sub-agent. Tier 3, Opus high. Give it the requirements and nothing else.

It produces a candidate design: components, data flows, and a one line justification per
component naming the requirement that forces it. No prose essay, no alternatives section
yet. The draft exists to be attacked.

## 3. Argue

Three advocate sub-agents, **in parallel, none inheriting the others' context**. Each gets
the requirements and the draft. Shared context would let them converge, and convergence is
the failure mode this step exists to prevent.

| Advocate | Argues about |
|---|---|
| reliability | Failure modes, blast radius, degradation behaviour, whether the design actually meets the stated RTO and RPO, and what happens when each dependency is down |
| security | Identity and access, network boundaries, data protection at rest and in transit, and the specific compliance obligations named in the requirements |
| simplicity and cost | Whether each component needs to exist at all, what managed service removes it, what it costs to run and, separately, what it costs to operate |

Each returns a ranked list of findings, each finding tied to a requirement or to a stated
cost. "This feels fragile" is not a finding.

**Why the third advocate exists.** Without a seat arguing for deletion, adversarial review
only ever adds. Every critic finds something missing. Nobody argues for removal. The result
satisfies every reviewer and no budget, and lands on a team that cannot run it. The
simplicity advocate is the only participant permitted to say "delete this component" and it
is expected to say it at least once.

## 4. Judge

One judge sub-agent. Tier 3. It receives the draft and all three critiques.

It resolves conflicts, states which trade-offs are accepted, and says why each is right for
**this** context specifically, not in general. Where two advocates genuinely conflict, the
judge **names the conflict and picks a side with a reason**. It does not split the
difference. A design that half satisfies reliability and half satisfies cost satisfies
neither and hides the decision from whoever inherits it.

The judge may delete components. It may not add one that no advocate asked for.

## 5. Write

The orchestrator writes `docs/design/SOLUTION-DESIGN.md`. Not a sub-agent: the orchestrator
holds the whole argument and the sub-agents each hold a slice.

## The document

### System level sections, in this order

1. **Requirements and constraints** as captured, marking each as stated or assumed.
2. **Architecture** with data flows. What talks to what, synchronous or asynchronous, and
   what crosses a trust boundary.
3. **Components**, one entry each, in the format below.
4. **Availability budget** showing the arithmetic, not an asserted nines figure.
5. **Failure matrix**: one row per dependency, what fails, what degrades, what the user
   sees, what the operator does.
6. **Security model**: identity, network boundaries, data protection, key custody, audit,
   mapped to the named compliance obligations.
7. **Cost shape**: what drives the bill, what the bill is roughly, and what the operational
   cost is in people.
8. **Deliberately left out**: what was considered and rejected as a whole, and the signal
   that would justify adding it later.
9. **Open questions**: what is still unknown and who has to answer it.

### Per component

Every entry carries all seven. An entry missing the trade-off or the failure behaviour is
not finished.

| Field | Content |
|---|---|
| Role | What it does in this system, one or two sentences |
| Why here | The specific named requirement it satisfies |
| Operating knowledge | Hard limits, quotas, failure behaviour, pricing model, and the gotcha that bites people |
| Rejected | The alternatives considered and why each lost, in this context |
| Trade-off | What is given up, and why that is the right side of the trade here |
| How it fails | Failure modes and what the system does when they happen |
| Sources | Links for every limit and price cited, with the date checked |

## Worked component entry

Use this format exactly.

---

### DynamoDB, on-demand, single region, PITR on

**Role.** Primary store for order records. Point reads and short range queries by
`customer_id`. No ad hoc analytical queries.

**Why here.** REQ-3 (99.99% availability target for the order API) and REQ-7 (team of four,
no dedicated DBA). DynamoDB's regional availability SLA is 99.99%, and there is no instance
to patch, fail over, or resize.

**Operating knowledge.**

- Item size limit 400 KB, hard. Order payloads currently peak near 60 KB. Attachments go to
  S3 and the item holds the key.
- Per partition ceiling roughly 3,000 read units and 1,000 write units per second. A single
  hot `customer_id` throttles regardless of table level capacity.
- On-demand scales instantly up to double the previous observed peak. Beyond that it ramps
  over minutes and throttles in the meantime, so a cold launch spike is the risk, not steady
  state.
- Throttling surfaces as `ProvisionedThroughputExceededException`. The AWS SDK retries it by
  default, so it shows up as latency before it shows up as errors. Alarm on
  `ThrottledRequests`, not on the error rate.
- Pricing is per request unit plus storage. One write unit covers 1 KB, one strongly
  consistent read covers 4 KB. A 60 KB item costs 60 write units, so item size is the cost
  driver here, not request count.
- Approximate us-east-1 on-demand pricing: $0.625 per million write request units, $0.125
  per million read request units, $0.25 per GB-month standard storage. **Verify before the
  cost section is treated as a number to plan against.** These changed by half in late 2024.
- PITR is a separate charge on table size and gives 35 days at second granularity. It does
  not replace an export for the seven year retention in REQ-9.

**Gotcha.** Query patterns are fixed at table design time. Adding an access pattern later
means a global secondary index, backfill on a live table, and application changes. This is
the reason to reject it if the access patterns are not yet known. Here they are, and REQ-2
freezes them.

**Rejected.**

- *Aurora PostgreSQL Serverless v2.* Flexible queries, but a minor version upgrade needs a
  maintenance window and someone to own it. REQ-7 says there is nobody. Also the multi AZ
  failover window conflicts with the RTO in REQ-4.
- *Self hosted PostgreSQL on EC2.* Cheaper on paper at this volume, more expensive in
  people. Fails REQ-7 outright.
- *DynamoDB global tables.* Would raise availability further, but REQ-3 is met without it,
  it roughly doubles write cost, and it introduces last writer wins conflict semantics that
  REQ-5 does not permit.

**Trade-off.** Query flexibility given up for operational simplicity and a met availability
target. Right here because REQ-2 fixed the access patterns and REQ-7 means every hour of
database operations comes out of feature work. Wrong for a system whose query patterns are
still moving.

**How it fails.** Hot partition throttles a single customer's writes while the rest of the
table is healthy, seen as p99 latency on that customer only. Regional service impairment
takes the whole API down, which is inside the REQ-3 error budget and is the accepted reason
there is no second region. Item size overrun is a client error, caught by validation at the
write boundary rather than at the table.

**Sources.** DynamoDB service quotas page, DynamoDB pricing page, DynamoDB SLA. Checked
2026-09-08.

---

## Rules

**Never invent a service limit, quota or price.** Look it up, cite it with the date checked,
or mark it explicitly as needing verification. A confident wrong number in a design document
propagates into an implementation and is discovered in production. "Roughly" with a citation
beats a precise number from memory.

**Prefer the cloud's managed service over self-hosting.** Self-host only when a stated
requirement rules the managed service out, and name that requirement in the entry. "We would
have more control" is not a requirement.

**Every component traces to a requirement.** A component that traces to nothing gets deleted
before the document is written. Not flagged, deleted.

**Availability multiplies down a serial dependency chain.** Show the arithmetic. An API
behind a load balancer at 99.99%, on compute at 99.95%, against a database at 99.99%, is
99.93% and not 99.99%. That is roughly six hours of budget a year rather than one. If the
arithmetic misses the target, the design changes or the target does. Do not assert a nines
figure the components cannot deliver.

**Cost has two halves.** The bill, and the hours. State both. A design that saves $200 a
month and costs an engineer a day a week is not cheaper.

**One cloud, fully.** Method is portable, the design is not. Once the cloud is chosen, use
its services by name, with its limits and its pricing model. No abstraction layer written to
keep a future migration open, unless a requirement demands portability.

## Handoff

The design ends by handing off:

- `draw-system-diagram` draws it.
- `lets-code` builds it.

This skill does neither. If the design is accepted and the next question is "how do we build
it", stop and invoke `lets-code`.
