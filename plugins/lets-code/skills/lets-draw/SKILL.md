---
name: lets-draw
description: Draw a system as one multi page .drawio file at docs/diagrams/, generated, validated against a real structural validator and rendered until it is provably not corrupt and actually readable. Use when someone needs to see the architecture. It consumes docs/design/SOLUTION-DESIGN.md, or an ARCHITECTURE.md plus the infrastructure code, and draws what those decided. It does not decide anything itself.
---

# lets-draw

Input: `docs/design/SOLUTION-DESIGN.md`. Output: `docs/diagrams/<name>.drawio`, one multi
page file that is structurally valid and actually says something. That path, every time.

`lets-design` decides. This skill draws. `lets-code` builds. If the design is present but
ambiguous about what talks to what, **ask the user**.

**No `SOLUTION-DESIGN.md`?** An `ARCHITECTURE.md` plus the ADRs is an acceptable input, and so
is any document that states what the components are and what talks to what. Whatever the
source, **read the infrastructure code and check the prose against it**. Design documents go
stale, Terraform does not, and the diagram is read as a statement of fact about what is
deployed. Where the two disagree, the code wins and you say so. If there is no document at
all and no infrastructure to read, stop and invoke `lets-design`. Do not resolve an architectural gap by drawing a plausible answer: a
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

Generate, validate, render and look, repair, repeat, bounded. **The validator now fails on
readability, not only on structure**, so an unreadable diagram does not pass. Transparent
canvas, invisible label text, overlapping nodes and a label printed across an icon are all
errors, and they are repaired in the same loop as a dangling edge terminal.

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
- Each page carries `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageScale="1" pageWidth="850" pageHeight="1100" background="#ffffff">`. **`background="#ffffff"` is mandatory on every page.** Without it the canvas exports transparent, and a viewer in dark mode paints its own dark surface behind it, so every dark label vanishes. It is a `background` error. A labelled five column path is roughly 1900 wide, so **content will overflow the page box, and that is harmless.** `pageWidth` and `pageHeight` are print pagination only. The canvas is unbounded, the editor shows the overflow, and PNG export crops to content, not to the page. Do not shrink the diagram to fit 850. The column pitch below wins over the page box every time.
- **Every cell that carries a label carries an explicit dark `fontColor` in its style.** The catalog styles already do. draw.io's implicit default is black, and that is not good enough: the default is never written into the file, so a dark-mode viewer has nothing to read and inverts it to white, which on the mandated white background is white on white. An absent `fontColor` on a labelled cell is a `font-contrast` error. The default to use is `fontColor=#232F3E`, AWS Squid Ink, 13.57:1 on white. `#000000` is also fine. Anything under 3:1 against the surface the label actually sits on is an error.
- **Every cell that carries a label also carries `labelBackgroundColor=#FFFFFF`.** It paints an opaque white box behind the text, so an edge or a container border passing behind a label occludes cleanly instead of striking through it. One token, and it removes a whole class of defect that no check can see. It pairs with the mandated white background, which is why the value is fixed rather than chosen. Every labelled cell on every page of the machinel file carries it.
- Each `<root>` starts with `<mxCell id="0" />` and `<mxCell id="1" parent="0" />`, always, on every page.
- Cell ids are scoped per page. The same id may appear on two pages. Uniqueness is checked within a `<root>`.
- Every vertex needs `<mxGeometry x y width height as="geometry"/>`. Every edge needs `<mxGeometry relative="1" as="geometry"/>`. It may be empty, and it is where a label offset goes when the edge needs one. See Edge label collisions below.
- **Size boxes to their labels.** `200x80` with `whiteSpace=wrap;html=1` is the default that worked, and it holds roughly 24 characters per line over three lines. Past that, widen by 20px per extra character rather than letting the text clip: draw.io does not shrink or ellipsise, it draws the overflow outside the box. Service icons are the fixed `78x78` from `shapes.json` and carry their label underneath, so a long service label needs column pitch, not a bigger box.
- **Pin every edge's ports with `exitX/exitY/exitDx/exitDy` and `entryX/entryY/entryDx/entryDy`.** Unpinned, draw.io picks a side per edge at render time, and several edges leaving one node share a stub and lie on top of each other. Pinned ports are also the precondition for working out where a label actually lands, below. `exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;` is the plain left-to-right case; fan-out uses fractional `Y` values on the same side, as `apigw` does at `0.3`, `0.5` and `0.7`.
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

A clean run now means structure **and gross layout** are both fine. It used to mean "the file
is not corrupt, go and look at the picture yourself". It now means "nothing is corrupt and
nothing is provably on top of anything else, go and look at the picture for the judgement the
checks cannot make". Those are different claims, and only the second one is true today.

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

`-p` / `--page-index` is **1 based**. `-p 0` is a rejected argument: the CLI exits non-zero before it opens the file. That is not a broken page, and reading it as one sends the next hour into repairing a page that was fine. On Linux this needs a display: `xvfb-run -a drawio ... --no-sandbox
--disable-gpu`. Note `-k, --check` is not a validator, it means "do not overwrite existing
files".

The gross collisions are the validator's job now. This step catches what the estimates miss:
text spilling out of a box, an icon that is a plain coloured square, a label that clears its
neighbour by two pixels, a routed edge that takes an ugly path, a page that is simply too
busy. Then repair and render again.

**No binary?** Say so rather than claiming the diagram is readable, and apply the tactics that
fix a bad picture blind: shorten every edge label and move the detail into the node, widen the
column pitch, stagger the label offsets on parallel edges, and split a crowded page into two.
They are cheap and they are what the render iterations end up asking for anyway.

### 5. Repair

- **Every error gets fixed.** No exceptions, no "cosmetic in this case". A `label-collision` or `node-overlap` error is not cosmetic, it is the diagram being unreadable.
- **Repair the layout, not just the structure.** A collision is fixed by moving something: an `<mxPoint as="offset"/>` on the edge, a shorter label, a wider column pitch, a node moved to another row. It is never fixed by deleting the label, and an edge with no label is its own error anyway.
- **Warnings are judged, not silenced.** An unverified shape name means go and verify the name, not delete the icon. Deleting the cell to quiet the check is the one response that is always wrong.
- Fix the cause, not the symptom. A missing terminal id usually means the id scheme drifted between pages, and the other edges are wrong too.

### 6. Stop at the cap

**Five repair iterations.** If the file still has errors after the fifth, stop. Report which
checks are still failing, on which page and cell, and what you tried. Then:

- Do not ship a knowingly broken file.
- Do not delete the offending cells to make the check pass.
- Do not weaken, skip, or edit the validator. It is not yours to change.

Five failed attempts means the problem is understanding, not typing. Ask.

A layout that will not come clean in five passes is usually one page doing two jobs. Splitting
it is a legitimate repair. Shrinking the labels until the check stops firing is not.

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
| `background` | error | The `<mxGraphModel>` has no `background`, or it is not `#ffffff`. A transparent canvas is painted dark by a dark-mode viewer and every dark label disappears |
| `font-contrast` | error | A labelled cell has no `fontColor`, or one under 3:1 against the surface it sits on. The surface is the cell's `fillColor` only when the label is drawn inside it: `verticalLabelPosition=bottom` or `top`, or `labelPosition=left` or `right`, puts the label on the canvas, so it is judged against white. That is exactly the AWS icon case, where the tile colour does not help the label under it |
| `node-overlap` | error | Two sibling vertices whose rectangles intersect. Exact, no estimation, and only siblings are compared, so a child inside its container is never reported |
| `label-collision` | error | An edge label printed over a vertex, or over another edge label. Containers, ports and `connectable="0"` cells are excluded |
| `edge-crosses-node` | warning | The straight line between an edge's terminals passes through an unrelated vertex. A warning because the drawn edge is routed, not straight |
| `shape-name` | warning | A `shape`, `resIcon`, `grIcon` or `image=` value not in the verified catalog. **The catalog is a verified subset, not the whole registry.** aws4 alone ships 1038 stencils, so a miss is not proof the name is fake. Verify it, then keep it or fix it |

**What the geometric checks estimate, and therefore miss.** `node-overlap` is exact. The other
two are not, and the validator's author recorded why:

- A label box is estimated from character count times font size, because there are no font metrics available. Wide caps and narrow lowercase both come out average.
- The estimate is then deliberately shrunk to 0.6 of itself about its centre, so a near miss passes. A false positive blocking a good diagram was judged worse than a missed marginal collision.
- An edge label is placed at the midpoint of the **straight** line between the terminals, and waypoints are ignored entirely. draw.io routes orthogonally, so the drawn label is somewhere else. See The two label anchors below, which is the single defect this misses most.

So a clean run still leaves marginal collisions possible. **The render is what catches those**,
which is why step 4 exists and is not optional when the binary is there.

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

**On an icon page, never exit or enter a node's bottom.** A `resourceIcon` label hangs *below* the 78x78 tile, so the real footprint is roughly 78 wide by 120 tall and up to 200px wide across the text. An edge leaving or arriving at the bottom is drawn straight through the node's own label. `node-overlap` is blind to this because it compares the 78x78 rectangles and nothing else, so a page full of this defect validates clean. Use `exitY`/`entryY` of `0`, or a fractional value on the left or right side. Not one edge on the machinel infrastructure page uses `exitY=1` or `entryY=1`. Cap each icon label line at about 26 characters so the text stays inside the column pitch, and use `&lt;br&gt;` to break it rather than letting it run.

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
style="rounded=0;whiteSpace=wrap;html=1;fontColor=#232F3E;container=1;collapsible=0;verticalAlign=top;"
```

That is `genericShapes.groupBox` in `shapes.json`.

A container with children is not an orphan, so it needs no edge of its own. Children use
coordinates relative to the container origin. Leave about 40px of top padding for the label.

## The two label anchors, and why a clean run can still look wrong

**Every edge carries a label saying what happens on it.** The protocol, the payload, the
trigger. `POST /orders over HTTPS`, `writes order record`, `emits OrderPlaced`, `polls every
30s`. Not `calls`, not an arrow with nothing on it. Unlabelled is a validator error, not a
style preference.

Put the label in the edge cell's `value`. One cell instead of two, the label cannot be
orphaned from its edge, and the check is one assertion. Use a separate `edgeLabel` child cell
only when one edge genuinely needs two labels, such as a protocol at one end and a port at the
other.

**draw.io puts an edge label at the arc-length midpoint of the routed polyline. The validator
puts it at the midpoint of the straight line between the two terminal centres.** On a straight
edge those are the same point. On any L or Z shaped edge they are different, routinely by
hundreds of pixels. This is the whole reason a diagram passes every check and is still visibly
broken in a dozen places.

Worked from `e5` on the machinel infrastructure page, `apigw` to `logs`, both in column
x=540..618 two rows apart:

- Terminal centres are `(579,439)` and `(579,859)`, so the **straight** anchor is `(579,649)`.
- The edge exits left, runs down the reserved corridor at x=459 and enters `logs` from the left. Legs are 81 + 420 + 81 = 582 long, so the **routed** anchor is 291 along, at `(459,649)`.

120px apart, for one ordinary edge. An `<mxPoint as="offset"/>` cannot reconcile them: it
shifts both anchors by the same vector.

**The rule: both landing points have to be clear.** Compute the routed one by hand from the
pinned ports and the waypoints, check nothing is there, and check the straight midpoint too
because that is the one the validator will fire on. If they disagree and only one is clear,
the fix is the routing or the layout, not the offset.

### Moving the label

Two tools, and they are not interchangeable.

**`mxGeometry` `x`, with `relative="1"`, slides the label along the edge.** It runs -1 at the
source to 1 at the target, 0 is the centre, and `validate-drawio.js` honours it: `labelAnchor()`
reads `geo.attrs.x`, maps it to `t = (along + 1) / 2` and interpolates the straight line at `t`.
So it moves both anchors together, in the same direction, and stays on the edge. Reach for it
whenever the answer is "put this near the source end" rather than "nudge this up 50px".

**`<mxPoint as="offset"/>` translates the label in pixels**, `x` right and negative `y` up,
from wherever it would otherwise sit. It is the right tool for separating two labels that
already land near each other. On a long span it moves the label off its own edge, so use it
there only along a lane you know is empty. From `p1e7`, the return leg of the inference path,
which runs 1500px down a reserved lane at y=480 and needs its label clear of the boxes above:

```xml
<mxGeometry relative="1" as="geometry">
  <Array as="points">
    <mxPoint x="1690" y="480" />
    <mxPoint x="140" y="480" />
  </Array>
  <mxPoint x="200" y="0" as="offset" />
</mxGeometry>
```

**Stagger parallel edges by 50px.** Edges fanning out of one node, or running in the same
horizontal band, get `y` offsets 50px apart: `-100`, `-50`, `50`, `100`. 25px is the floor and
only works for one-line labels at `fontSize=12`, whose line box is 14px but whose collision
box is judged before the shrink. 50 is the number that stops the check firing. `-25` is enough
for a lane of single-line labels that are already staggered by row, which is what the five
edges of the inference path use.

## Drawing rules

**Shorten the label and move the detail into the node.** From the real findings:

| Before, and what it did | After |
|---|---|
| `serves the model named by the endpoint config` on `sm_ep -> sm_model`, printed over both icons | `serves this model` on the edge, and the endpoint config named in the `sm_ep` node label |
| `job submits source/sourcedir.tar.gz, writes training/ output` on `l_trn -> s3_art`, printed over `s3_data` | `writes training/ output` on the edge, and `source/` listed in the bucket's node label |

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

**Layout: a grid pitch, because overlap is now an exact error.**

`node-overlap` compares real rectangles, so eyeballing the coordinates does not survive it. Lay
every page out on a pitch and the check cannot fire. The pitch that worked:

| Element | Real footprint | Column pitch | Row pitch |
|---|---|---|---|
| Service icon | `78x78` tile, label below it: about `78x120`, up to 200 wide | `240` | `210` |
| Plain box | `200x80` | `400` | `200` |

**Size the gap from the longest edge label, not from the element.** The pitch is set by what
has to fit between two columns, and by the skill's own 0.5 char-width ratio a 24 character
label at `fontSize=12` is 144px wide. So a 220 icon pitch leaves 142px and that label touches
both neighbours, and the validator lets it through only because it shrinks the estimate to 0.6
before intersecting anything. The numbers above are the ones that actually came out readable:
240 minus 78 leaves 162px between icon columns, and 400 minus 200 leaves 200px between plain
boxes, which is what a 32 character label like `sagemaker-runtime:InvokeEndpoint` needs. The
plain-box pitch had to go from 320 to 400 for exactly that reason. The row pitch is the icon's
real 120px footprint plus a lane, not 78 plus a lane.

**Reserve corridors and lanes, and route through them.** This is the technique that makes a
dense page come out clean, not an afterthought. Name the vertical corridors that live in the
gaps between node columns and the horizontal lanes that live between node rows, then give
every non-trivial edge explicit `<Array as="points">` waypoints through them. On the machinel
infrastructure page the icon columns sit at page x 300, 540, 780, 1020 and 1260, and every
waypoint on the page falls in a gap between two of them: 420, 440 and 459 in the first gap,
660 through 760 in the second, 939 in the third, 1150 and 1210 in the fourth. Corridors are
20px apart so two edges sharing a gap never share a line. The lanes work the same way in y,
using the band the icon labels do not occupy.

Waypoints buy three things at once: the routing is deterministic, so the routed label anchor
can be computed at all; edges stop overlapping each other; and `edge-crosses-node` stops being
guesswork, because the drawn path is now the path you chose.

- All coordinates on the 10px grid, and both pitches are multiples of it.
- One direction per page. Left to right for a request path, top to bottom for a layered stack. Pick one and hold it for the whole page.
- Order nodes along the flow so edges run forward. Most crossings are a node in the wrong column, not a routing problem.
- Container children are positioned relative to the container origin, so the pitch applies inside the container, and the container needs about 40px of top padding for its own label.
- `edgeStyle=orthogonalEdgeStyle` everywhere.
- An `edge-crosses-node` warning is a node in the wrong place far more often than it is a routing problem. Move the node to the next row before you reach for waypoints.

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

- `lets-design` decided it.
- This skill drew it.
- `lets-code` builds it.

If the diagram is accepted and the next question is "how do we build it", stop and invoke
`lets-code`.
