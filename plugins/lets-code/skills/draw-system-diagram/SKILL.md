---
name: draw-system-diagram
description: Draw a system as one multi page .drawio file at docs/diagrams/, generated, validated against a real structural validator and rendered until it is provably not corrupt and actually readable. Use when someone needs to see the architecture. It consumes docs/design/SOLUTION-DESIGN.md, or an ARCHITECTURE.md plus the infrastructure code, and draws what those decided. It does not decide anything itself.
---

# draw-system-diagram

Input: `docs/design/SOLUTION-DESIGN.md`. Output: `docs/diagrams/<name>.drawio`, one multi
page file that is structurally valid and actually says something. That path, every time.

`solution-design` decides. This skill draws. `lets-code` builds. If the design is present but
ambiguous about what talks to what, **ask the user**.

**No `SOLUTION-DESIGN.md`?** An `ARCHITECTURE.md` plus the ADRs is an acceptable input, and so
is any document that states what the components are and what talks to what. Whatever the
source, **read the infrastructure code and check the prose against it**. Design documents go
stale, Terraform does not, and the diagram is read as a statement of fact about what is
deployed. Where the two disagree, the code wins and you say so. If there is no document at
all and no infrastructure to read, stop and invoke `solution-design`. Do not resolve an architectural gap by drawing a plausible answer: a
diagram is read as a statement of fact, and an invented component becomes real the moment
someone implements it.

## The fact this whole skill is built around

**Almost every way of corrupting a `.drawio` file fails silently.** Tested against
drawio 31.3.2, one class of error is loud and every other one exits 0:

| Corruption | Exit | What actually happens |
|---|---|---|
| Unescaped `&` in a label | 1 | XML parse error, no output. The only good failure |
| Edge `target` names a missing id | 0 | The terminal is stripped, the edge is discarded, **its label is gone** |
| `parent` names a missing id, or is absent | 0 | **Cells 0 and 1 are destroyed and the rest of the page is deleted**, and it still exports a PNG |
| Duplicate cell id | 0 | Both render, one is silently renumbered, cross references bind to the wrong cell |
| Edge with no `<mxGeometry>` | 0 | Edge not drawn at all, label lands at the canvas origin |
| Vertex with no `<mxGeometry>` | 0 | Zero size, only the label text renders |
| `resIcon` naming a stencil that does not exist | 0 | A blank coloured square with a label, no icon |
| Malformed `style` token | 0 | Token ignored, default shape |

So **an agent cannot review its own diagram by looking at it**, and "it opened" or "it
rendered" proves nothing. The validator is the only thing that knows. Everything below is
arranged around that.

## The loop

Generate, validate, render and look, repair, repeat, bounded.

### 1. Install the utils

If the target repo has no `draw-io-utils/`, copy the plugin's copy into it. **Do not assume
`${CLAUDE_PLUGIN_ROOT}` is set.** It is empty in a sub-agent shell, and `cp -R
"${CLAUDE_PLUGIN_ROOT}/draw-io-utils" .` then expands to `cp -R /draw-io-utils .` and fails.
Resolve it, fall back to the plugin cache, and stop loudly if neither works:

```sh
src="${CLAUDE_PLUGIN_ROOT:-}/draw-io-utils"
[ -d "$src" ] || src=$(find "$HOME/.claude/plugins/cache" -maxdepth 6 -type d \
  -name draw-io-utils -path '*lets-code*' 2>/dev/null | head -1)
if [ ! -d "$src" ]; then
  echo "draw-io-utils not found. CLAUDE_PLUGIN_ROOT='${CLAUDE_PLUGIN_ROOT:-unset}', and \
nothing matched under ~/.claude/plugins/cache. Stop and ask the user where the lets-code \
plugin lives." >&2
  exit 1
fi
[ -d ./draw-io-utils ] || cp -R "$src" ./draw-io-utils
echo "draw-io-utils installed from $src"
```

Dependency free, Node only. Copy it rather than referencing the plugin path so the repo can
run the check on its own later, in CI or by hand.

### 2. Generate

Write the whole file in one pass, all pages, uncompressed XML.

**What makes it uncompressed** is the presence of an `<mxGraphModel>` **element** child inside
`<diagram>` with no text content. There is no attribute for this. Do not set
`compressed="false"`, it is not read on load.

Per file:

- Root `<mxfile host="app.diagrams.net">`. Every other `mxfile` attribute is stripped on save, omit them.
- One `<diagram id="..." name="...">` per page. Both attributes are required by the validator: an unnamed single diagram is not treated as a tabbed page, and page links resolve by id.
- Each page carries `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageScale="1" pageWidth="850" pageHeight="1100">`. A labelled five column path is roughly 1900 wide, so **content will overflow the page box, and that is harmless.** `pageWidth` and `pageHeight` are print pagination only. The canvas is unbounded, the editor shows the overflow, and PNG export crops to content, not to the page. Do not shrink the diagram to fit 850, and do not read "leave a gutter" below as a promise that everything fits inside one page rectangle.
- Each `<root>` starts with `<mxCell id="0" />` and `<mxCell id="1" parent="0" />`, always, on every page.
- Cell ids are scoped per page. The same id may appear on two pages. Uniqueness is checked within a `<root>`.
- Every vertex needs `<mxGeometry x y width height as="geometry"/>`. Every edge needs `<mxGeometry relative="1" as="geometry"/>`. It may be empty, and it is where a label offset goes when the edge needs one. See Edge label collisions below.
- **Size boxes to their labels.** `200x80` with `whiteSpace=wrap;html=1` is the default that worked, and it holds roughly 24 characters per line over three lines. Past that, widen by 20px per extra character rather than letting the text clip: draw.io does not shrink or ellipsise, it draws the overflow outside the box. Service icons are the fixed `78x78` from `shapes.json` and carry their label underneath, so a long service label needs column pitch, not a bigger box.
- Container children use coordinates **relative to the container origin**, not the page.
- Edges that cross container boundaries get `parent="1"`.

Use an XML serializer or escape every interpolated value. See Escaping below.

### 3. Validate

```sh
node draw-io-utils/validate-drawio.js docs/diagrams/system.drawio
node draw-io-utils/validate-drawio.js --json docs/diagrams/system.drawio  # machine readable
node draw-io-utils/validate-drawio.js docs/diagrams/                      # walks a directory
```

`--json` is the only flag. Exit 0 means no errors, 1 means errors, 2 means bad usage.

**Run this yourself after every generation pass. It is a step of the loop, not a reminder.**

There is also a `PostToolUse` hook on `Write|Edit` that runs the same validator and blocks on
errors. It is a backstop, and it is tool shaped: it fires on a tool-based write and on nothing
else, so a file written with a bash heredoc or by a script fires it not at all. It also blocks
on errors only and merely counts the warnings. Neither reason is a reason to skip the explicit
run.

### 4. Render and look

**A structurally valid diagram is routinely unreadable, and this is the step that catches it.**
The validator checks the file, not the picture. If the draw.io binary is installed, render
every page and actually look at the image:

```sh
command -v drawio && drawio -x -f png -o /tmp/page1.png --page-index 1 --scale 2 \
  docs/diagrams/system.drawio
```

`--page-index` is 1 based. On Linux this needs a display: `xvfb-run -a drawio ... --no-sandbox
--disable-gpu`. Note `-k, --check` is not a validator, it means "do not overwrite existing
files".

Look for overlapping edge labels, text spilling out of boxes, edges crossing under nodes, and
an icon that is a plain coloured square. Then repair and render again.

**No binary?** Say so rather than claiming the diagram is readable, and apply the tactics that
fix a bad picture blind: shorten every edge label and move the detail into the node, widen the
column pitch, stagger the label offsets on parallel edges, and split a crowded page into two.
They are cheap and they are what the render iterations end up asking for anyway.

### 5. Repair

- **Every error gets fixed.** No exceptions, no "cosmetic in this case".
- **Warnings are judged, not silenced.** An unverified shape name means go and verify the name, not delete the icon. Deleting the cell to quiet the check is the one response that is always wrong.
- Fix the cause, not the symptom. A missing terminal id usually means the id scheme drifted between pages, and the other edges are wrong too.

### 6. Stop at the cap

**Five repair iterations.** If the file still has errors after the fifth, stop. Report which
checks are still failing, on which page and cell, and what you tried. Then:

- Do not ship a knowingly broken file.
- Do not delete the offending cells to make the check pass.
- Do not weaken, skip, or edit the validator. It is not yours to change.

Five failed attempts means the problem is understanding, not typing. Ask.

## What each check means

Errors block. Warnings do not, and each one is a question to answer.

| Check | Severity | What it means for the rendered diagram |
|---|---|---|
| `xml-not-well-formed` | error | The file will not open at all. Almost always an unescaped `&` or a raw `<` in a label or style |
| `unescaped-character` | warning | A raw `>` in text. Legal in practice, wrong in principle, write `&gt;` |
| `file-structure` | error | Unreadable file, root is not `<mxfile>`, or no `<diagram>` pages |
| `page-id` | error | A `<diagram>` has no id, or two share one. Page links resolve to the first match |
| `page-name` | error | A `<diagram>` has no name, or two share one. Unnamed pages become `Page-n` and stop being tabbed pages |
| `page-model` | error | No `<mxGraphModel>` or no `<root>`. The page is empty |
| `page-model` | warning | The page content is compressed, so nothing inside it can be checked. Rewrite it uncompressed |
| `root-cells` | error | `<root>` is empty, or `id="0"` and `id="1"` are missing. Without both, there is no layer for anything to live in |
| `cell-id` | error | A cell has no id. Nothing can reference it |
| `duplicate-cell-id` | error | Two cells share an id. draw.io renumbers one on save and your edges bind to whichever won |
| `parent-reference` | error | Missing, dangling, or self referencing `parent`. The worst one: cells 0 and 1 are destroyed and the rest of the page goes with them, while the export still succeeds |
| `vertex-and-edge` | error | A cell claims to be both. Undefined |
| `geometry` | error | Missing geometry, missing `as="geometry"`, or a vertex missing x/y/width/height. Invisible vertex or undrawn edge |
| `edge-terminal` | error | A `source`/`target` id does not exist, or the edge has neither terminals nor terminal points. The edge and its label vanish without a trace |
| `edge-label` | error | An edge says nothing about what happens on it. A project rule, not a format rule, and still an error |
| `orphan-vertex` | error | A vertex connected to nothing and containing nothing. Either it belongs in the diagram and needs an edge, or it does not belong |
| `style-token` | warning | A style token with no `=`, silently ignored. Usually a typo that dropped a real property |
| `shape-name` | warning | A `shape`, `resIcon`, `grIcon` or `image=` value not in the verified catalog. **The catalog is a verified subset, not the whole registry.** aws4 alone ships 1038 stencils, so a miss is not proof the name is fake. Verify it, then keep it or fix it |

## Pages

One `.drawio` file, several `<diagram>` pages. At minimum:

| Page | Contains | Reads as |
|---|---|---|
| Infrastructure | Real cloud service icons, inside account, region, VPC, subnet and availability zone containers | A deployment |
| Functional flow | Plain boxes and labelled edges, no icons at all | Logic |
| One per critical request path | The paths the design names, each showing what happens in order | A trace |

A page exists because it earns its place. Splitting exists so no detail is lost on an
overloaded canvas, not to inflate the page count. Two request paths that differ in one hop
are one page, not two. A page nobody would open is a page that should not exist.

### Infrastructure page

Containers are ordinary vertices with `container=1`, and children are parented to them by id.
Nest account, then region, then VPC, then subnet, then availability zone. Take the container
style prefixes and per boundary suffixes from `draw-io-utils/shapes.json` under
`clouds.<cloud>.groupStylePrefix` and `clouds.<cloud>.containers`.

Availability Zone and Security group are plain styled rectangles with no icon. draw.io's own
palette omits `container=1` on those two, so add it yourself if you parent anything into them.

Only AWS has an official boundary palette. The Azure and GCP boundary styles in `shapes.json`
are constructions from generic style keys. They render correctly and carry no brand authority.
Say so if a user asks why they look plain.

### Functional flow page

`genericShapes.box`, `genericShapes.edge`, and a plain container box for grouping. No vendor
icons. This page answers "what does the system do", so a cloud logo on it is noise. If a reader
can tell which cloud it is from this page, it has drifted into being a second infrastructure
page.

**Grouping is containment, not a floating heading.** A labelled box with no edges and no
children is an `orphan-vertex` error, so you cannot label a group by putting a box above it.
Parent the members into a container instead, and the container's `value` is the group label:

```
style="rounded=0;whiteSpace=wrap;html=1;container=1;collapsible=0;verticalAlign=top;"
```

A container with children is not an orphan, so it needs no edge of its own. Children use
coordinates relative to the container origin. Leave about 40px of top padding for the label.

## Drawing rules

**Every edge carries a label saying what happens on it.** The protocol, the payload, the
trigger. `POST /orders over HTTPS`, `writes order record`, `emits OrderPlaced`, `polls every
30s`. Not `calls`, not an arrow with nothing on it. Unlabelled is a validator error, not a
style preference.

Put the label in the edge cell's `value`. One cell instead of two, the label cannot be
orphaned from its edge, and the check is one assertion. Use a separate `edgeLabel` child cell
only when one edge genuinely needs two labels, such as a protocol at one end and a port at the
other.

**Edge labels collide, and the fix is an offset.** Every rule here pushes toward long, specific
edge labels, and three long labels on one horizontal band render as overlapping mush. Move a
label off the edge's midpoint with an `offset` point inside the edge's `mxGeometry`, which is
the one thing that otherwise-empty geometry is for:

```xml
<mxCell id="e3" value="POST /v1/training-jobs" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="apigw" target="l_trn">
  <mxGeometry relative="1" as="geometry">
    <mxPoint x="0" y="-50" as="offset"/>
  </mxGeometry>
</mxCell>
```

`x` and `y` are pixels from where the label would otherwise sit, negative `y` is up. Tactics,
in the order to reach for them:

- **Stagger parallel edges.** Edges fanning out of one node get `y` offsets 25px apart, such as `-75`, `-50`, `-25`, `25`. Two labels 10px apart still overlap.
- **Shorten the label, move the detail into the node.** `POST /v1/predict` on the edge, the payload shape in the target box, beats a forty character edge label every time.
- **Increase the column pitch.** A label wider than the gap it sits in cannot be offset out of trouble. Widen the gap.

**Node labels name the thing.** Enough that a reader knows what it is, not so much that the
canvas becomes prose.

| Good | Bad |
|---|---|
| `Order API` | `API` |
| `orders (DynamoDB, on-demand)` | `Database` |
| `order-processor` | `Lambda function that processes incoming orders and writes them to the orders table` |

The reasoning lives in `SOLUTION-DESIGN.md`. The diagram points at it.

**Icons on the infrastructure page, boxes on the functional page. Do not mix.** A half iconed
page reads as an unfinished page.

**Only use a style string from `shapes.json`**, or one you verified by the methods in its
`derivation` field: grep the shipped stencil file, render it and look, or cross check the
sidebar source. An invented `resIcon` renders as a blank coloured square, exits 0, and the
validator can only warn. A guessed icon name produces a diagram that looks almost right, which
is worse than one that looks obviously broken.

The naming rule, for reference: a stencil declared as `<shape name="Elastic Load Balancing">`
is addressed as `mxgraph.aws4.elastic_load_balancing`. Lowercased, spaces to underscores,
prefixed by the stencil file's root name. AWS uses the service name and not the marketing
name, so `route_53` and not `route53`, `elastic_file_system` and not `efs`.

**Escape every label and every style string.**

| Character | Write |
|---|---|
| `&` | `&amp;` (the one that actually bites, service names and query strings are full of them) |
| `<` | `&lt;` |
| `>` | `&gt;` |
| `"` | `&quot;` inside a double quoted attribute |

Escape `&` first or you double escape everything after it. With `html=1` in the style a label
is rendered as HTML, so `<br>` and `<b>` are legitimate content, and they still have to arrive
in the XML as `&lt;br&gt;`.

**Layout: keep it simple and enforceable.**

- One direction per page. Left to right for a request path, top to bottom for a layered stack. Pick one and hold it for the whole page.
- Snap coordinates to the 10px grid.
- Leave a clear gutter between nodes, roughly one node width, so edges have room to route.
- Order nodes along the flow so edges run forward. Most crossings are a node in the wrong column, not a routing problem.
- `edgeStyle=orthogonalEdgeStyle` everywhere.

Do not attempt a layout algorithm. If a page genuinely needs one, `drawio --layout` exists when
the binary is installed.

## What the validator cannot tell you

**It checks structure, not truth.** It has no idea what the system is. It cannot tell you:

- The diagram disagrees with the design.
- A component the design named is missing.
- An icon is a real stencil for the wrong service.
- An edge label describes something that does not happen.
- The layout is unreadable.

A green validator run means the file is not corrupt. Nothing more. A human, or a review
sub-agent given `SOLUTION-DESIGN.md` and the XML, has to check that the diagram is right.
Ask for that pass before calling the diagram done.

## Round trip, when the binary is there

Rendering is step 4 of the loop. The binary gives one more signal on top of it, worth a run
before calling a diagram done.

```sh
# Round trip: ask draw.io what it thinks your model is, then diff.
drawio -x -f xml -o /tmp/rt.xml -u docs/diagrams/system.drawio
diff <(sort /tmp/rt.xml) <(sort docs/diagrams/system.drawio)
```

Any cell draw.io renumbered, reparented, or stripped a terminal from shows up in that diff.
Expect noise from attribute ordering and added view state defaults, and read past it.

## Handoff

- `solution-design` decided it.
- This skill drew it.
- `lets-code` builds it.

If the diagram is accepted and the next question is "how do we build it", stop and invoke
`lets-code`.
