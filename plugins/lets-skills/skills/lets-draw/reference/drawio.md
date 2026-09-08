# draw.io mechanics

For the generator sub-agent. Everything needed to write a `.drawio` page that validates and
is readable. Read it start to finish before drawing. `lets-draw`'s SKILL.md owns the process
and does not repeat any of this.

The companion file is `draw-io-utils/shapes.json`: the verified icon catalog, the style
templates, the container styles and the derivation notes. This document is how to assemble
XML, that file is what to put in it.

Everything here was verified against draw.io desktop 31.3.2, either by reading the shipped
app bundle or by rendering the file and looking at it. Every XML example is real, taken from
`docs/diagrams/machinel.drawio`.

## 1. Why the validator exists

Exactly one way of corrupting a `.drawio` file fails loudly. Every other one exits 0, still
exports a PNG, and silently misrenders or mutates the model:

| Corruption | Exit | What actually happens |
|---|---|---|
| Unescaped `&` in a label | 1 | XML parse error, no output. The only good failure |
| Edge `target` names a missing id | 0 | The terminal is stripped, the edge is discarded, **its label is gone** |
| `parent` names a missing id, or is absent | 0 | **Cells 0 and 1 are destroyed and the rest of the page is deleted** |
| Duplicate cell id | 0 | Both render, one is silently renumbered, cross references bind to the wrong cell |
| Edge with no `<mxGeometry>` | 0 | Edge not drawn at all, label lands at the canvas origin |
| Vertex with no `<mxGeometry>` | 0 | Zero size, only the label text renders |
| `resIcon` naming a stencil that does not exist | 0 | A blank coloured square with a label, no icon |
| Malformed `style` token | 0 | Token ignored, default shape |

So "it opened" and "it rendered" prove nothing. Run
`node draw-io-utils/validate-drawio.js <file or directory>` on every page you write. `--json`
is the only flag. Exit 0 means no errors, 1 means errors, 2 means bad usage.

**Every error gets fixed.** No "cosmetic in this case". A `label-collision` or `node-overlap`
is not cosmetic, it is the diagram being unreadable. **Warnings are judged, not silenced.** An
unverified shape name means go and verify the name, not delete the icon. Deleting a cell to
quiet a check is the one response that is always wrong. Fix the cause: a missing terminal id
usually means the id scheme drifted and the other edges are wrong too.

## 2. The file

Write one page per part file, uncompressed. **What makes it uncompressed** is an
`<mxGraphModel>` **element** child inside `<diagram>` with no text content. There is no
attribute for this, and `compressed="false"` is not read on load.

```xml
<mxfile host="app.diagrams.net">
  <diagram id="infrastructure" name="Infrastructure">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageScale="1" pageWidth="850" pageHeight="1100" background="#ffffff">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
```

- Root `<mxfile host="app.diagrams.net">`. Every other `mxfile` attribute is stripped on save, omit them.
- One `<diagram id="..." name="...">`, using the slug and name the orchestrator assigned. Both are required by the validator, and they are what makes the merge safe. A single `<diagram>` with no `name` is not treated as a tabbed page.
- **`background="#ffffff"` is mandatory.** Without it the canvas exports transparent, a dark-mode viewer paints its own dark surface behind it, and every dark label vanishes. It is a `background` error.
- Every other `mxGraphModel` attribute is a view-state hint with a default. `pageWidth` and `pageHeight` are print pagination only. A labelled five column path is roughly 1900 wide, so **content will overflow the page box, and that is harmless.** The canvas is unbounded, the editor shows the overflow, and PNG export crops to content. Do not shrink the diagram to fit 850. The column pitch in section 7 wins over the page box every time.
- `<root>` starts with `<mxCell id="0" />` and `<mxCell id="1" parent="0" />`, always. Cell `0` is the model root, cell `1` is the default layer. Cell ids are scoped to the page, so a branch never coordinates ids with another branch and two pages may both have an `apigw`.

### Cells

| Attribute | Vertex | Edge |
|---|---|---|
| `id` | required | required |
| `parent` | required | required |
| `vertex="1"` / `edge="1"` | one or the other, never both | |
| `value` | the label | the label |
| `style` | falls back to the default style | |
| `source` / `target` | | resolved against ids on the same page |
| `<mxGeometry as="geometry">` | required | required |

`as="geometry"` names the `mxCell.geometry` field and is mandatory on the element. Every
vertex needs `<mxGeometry x y width height as="geometry"/>`. Every edge needs
`<mxGeometry relative="1" as="geometry"/>`, which may be empty, and which is where waypoints
and a label offset go. It is the **presence of the element** that routes the edge, not
`relative="1"`, but emit `relative="1"` anyway because it is what changes the label
coordinate semantics.

An edge with neither terminals nor `sourcePoint`/`targetPoint` is deleted by the view.

### Escaping

| Character | Write |
|---|---|
| `&` | `&amp;` (the one that actually bites, service names and query strings are full of them) |
| `<` | `&lt;` |
| `>` | `&gt;` |
| `"` | `&quot;` inside a double quoted attribute |

Use an XML serializer, or escape every interpolated value and escape `&` first or you double
escape everything after it. With `html=1` a label renders as HTML, so `<br>` and `<b>` are
legitimate content and still have to arrive as `&lt;br&gt;`.

A style string is an XML attribute value too. It parses as `split(';')` then `split('=')`, so
no spaces around `=`, and a literal `;` inside a value breaks the parse.

## 3. Labels and contrast

- **Every cell that carries a label carries an explicit dark `fontColor`.** draw.io's implicit default is black and that is not good enough: the default is never written into the file, so a dark-mode viewer has nothing to read and inverts it to white, which on the mandated white background is white on white. An absent `fontColor` on a labelled cell is a `font-contrast` error. Use `fontColor=#232F3E`, AWS Squid Ink, 13.57:1 on white. `#000000` is also fine. Anything under 3:1 against the surface the label actually sits on is an error.
- **Every cell that carries a label also carries `labelBackgroundColor=#FFFFFF`.** It paints an opaque white box behind the text, so an edge or a container border passing behind a label occludes cleanly instead of striking through it. One token, and it removes a whole class of defect that no check can see. It pairs with the mandated white background, which is why the value is fixed rather than chosen. Every labelled cell on every page of the machinel file carries it.
- **Size boxes to their labels.** `200x80` with `whiteSpace=wrap;html=1` is the default that worked, and it holds roughly 24 characters per line over three lines. Past that, widen by 20px per extra character rather than letting the text clip: draw.io does not shrink or ellipsise, it draws the overflow outside the box. Service icons are the fixed `78x78` from `shapes.json` and carry their label underneath, so a long service label needs column pitch, not a bigger box.

**Node labels name the thing.** Enough that a reader knows what it is, not so much that the
canvas becomes prose.

| Good | Bad |
|---|---|
| `Order API` | `API` |
| `orders (DynamoDB, on-demand)` | `Database` |
| `order-processor` | `Lambda function that processes incoming orders and writes them to the orders table` |

The reasoning lives in `SOLUTION-DESIGN.md`. The diagram points at it.

## 4. Icons and shapes

**Only use a style string from `shapes.json`**, or one you verified by the methods in its
`derivation` field: grep the shipped stencil file, render it and look, or cross check the
sidebar source. An invented `resIcon` renders as a blank coloured square, exits 0, and the
validator can only warn. A guessed icon name produces a diagram that looks almost right,
which is worse than one that looks obviously broken, and catching it is the reviewer's first
job.

The naming rule: a stencil declared as `<shape name="Elastic Load Balancing">` is addressed as
`mxgraph.aws4.elastic_load_balancing`. Lowercased, spaces to underscores, prefixed by the
stencil file's root name. AWS uses the service name and not the marketing name, so `route_53`
and not `route53`, `elastic_file_system` and not `efs`.

**The three clouds use three different mechanisms**, and this is not what most guides say.

- **AWS** is a stencil drawn inside a generic container shape. `mxgraph.aws4.resourceIcon` paints a square in `fillColor` and then draws the stencil named by `resIcon` inside it, tinted with `strokeColor`. So `fillColor` is the tile background, `strokeColor` is the glyph colour and is always `#ffffff` for AWS's official look. If `resIcon` names nothing, the draw is simply skipped and you get the blank tile. 1038 stencils, and the category colours are in `shapes.json`.
- **Azure** is a plain image reference to a bundled SVG, `image=img/lib/azure2/<category>/<File.svg>`. `shape=mxgraph.azure2.*` does not exist. Recommended size 68x68.
- **GCP** is a stencil, but `mxgraph.gcp3` has only 45 names and lacks Pub/Sub, load balancing, Firestore and Bigtable. Fill the gaps from the legacy `mxgraph.gcp.<category>.<name>` set and expect those to render as monochrome outline hexagons next to the colour gcp3 icons. `gcp2` and `gcpicons` embed base64 data URIs instead of named shapes and are unusable for generation.

No shape library needs enabling anywhere. Rendering goes through `mxStencilRegistry`, which
lazy-loads the stencil file on first reference, and the headless CLI has no palettes enabled
at all.

A real AWS icon cell, `apigw` from the machinel infrastructure page:

```xml
<mxCell id="apigw" value="machinel-dev-api&lt;br&gt;HTTP API, $default stage&lt;br&gt;5 routes, no authorizer" style="sketch=0;outlineConnect=0;fontColor=#232F3E;labelBackgroundColor=#FFFFFF;fillColor=#E7157B;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.api_gateway;" vertex="1" parent="region">
  <mxGeometry x="300" y="280" width="78" height="78" as="geometry" />
</mxCell>
```

## 5. Containers

Containers are ordinary vertices with `container=1`, children parented to them by id with
**coordinates relative to the container origin**. Nest account, region, VPC, subnet,
availability zone. Take the style prefixes and per boundary suffixes from `shapes.json` under
`clouds.<cloud>.groupStylePrefix` and `clouds.<cloud>.containers`. Leave about 40px of top
padding for the container's own label.

`region` from the machinel infrastructure page, parented into `account`:

```xml
<mxCell id="region" value="Region us-east-1 (no VPC: every service here is a public AWS endpoint, IAM-scoped)" style="points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;fontStyle=0;container=1;pointerEvents=0;collapsible=0;recursiveResize=0;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_region;strokeColor=#00A4A6;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#147EBA;dashed=1;" vertex="1" parent="account">
```

Availability Zone and Security group are plain styled rectangles with no icon. draw.io's own
palette omits `container=1` on those two, so add it yourself if you parent anything into them.

Only AWS has an official boundary palette. The Azure and GCP boundary styles in `shapes.json`
are constructions from generic style keys. They render correctly and carry no brand authority.

**Edges that cross container boundaries get `parent="1"`.** An edge parented to a container it
does not belong in still resolves its terminals, but its waypoints are interpreted in the
wrong coordinate space.

**Grouping is containment, not a floating heading.** A labelled box with no edges and no
children is an `orphan-vertex` error, so you cannot label a group by putting a box above it.
Parent the members into a container instead, and the container's `value` is the group label,
as `decl` does on the machinel functional page:

```xml
<mxCell id="decl" value="Declarative: OpenTofu owns the lifecycle (create, diff, update, destroy)" style="rounded=0;whiteSpace=wrap;html=1;fontSize=12;fontColor=#232F3E;container=1;collapsible=0;verticalAlign=top;fillColor=none;strokeColor=#232F3E;" vertex="1" parent="1">
  <mxGeometry x="40" y="40" width="640" height="880" as="geometry" />
</mxCell>
```

That is `genericShapes.groupBox` in `shapes.json`. A container with children is not an orphan,
so it needs no edge of its own.

## 6. Edges

**Every edge carries a label saying what happens on it.** The protocol, the payload, the
trigger. `POST /orders over HTTPS`, `writes order record`, `emits OrderPlaced`,
`polls every 30s`. Not `calls`, not an arrow with nothing on it. Unlabelled is an `edge-label`
error, not a style preference.

Put the label in the edge cell's `value`. One cell instead of two, the label cannot be
orphaned from its edge, and the check is one assertion. It is also what draw.io itself writes
for the ordinary case. Use a separate `edgeLabel` child cell only when one edge genuinely
needs two labels, a protocol at one end and a port at the other.

**Pin every edge's ports with `exitX/exitY/exitDx/exitDy` and `entryX/entryY/entryDx/entryDy`.**
Unpinned, draw.io picks a side per edge at render time, and several edges leaving one node
share a stub and lie on top of each other. Pinned ports are also the precondition for working
out where a label actually lands.
`exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;` is the plain
left-to-right case, and fan-out uses fractional `Y` values on the same side, as `apigw` does at
`0.3`, `0.5` and `0.7`.

### The two label anchors, and why a clean run can still look wrong

**draw.io puts an edge label at the arc-length midpoint of the routed polyline. The validator
puts it at the midpoint of the straight line between the two terminal centres.** On a straight
edge those are the same point. On any L or Z shaped edge they are different, routinely by
hundreds of pixels. This is the whole reason a page passes every check and is still visibly
broken in a dozen places.

Worked from `e5` on the machinel infrastructure page, `apigw` to `logs`, both in column
x=540..618 two rows apart:

```xml
<mxCell id="e5" value="writes JSON access logs" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=12;fontColor=#232F3E;labelBackgroundColor=#FFFFFF;exitX=0;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;" edge="1" parent="1" source="apigw" target="logs">
  <mxGeometry relative="1" as="geometry">
    <Array as="points">
      <mxPoint x="459" y="439" />
      <mxPoint x="459" y="859" />
    </Array>
  </mxGeometry>
</mxCell>
```

- Terminal centres are `(579,439)` and `(579,859)`, so the **straight** anchor is `(579,649)`.
- The edge exits left, runs down the reserved corridor at x=459 and enters `logs` from the left. Legs are 81 + 420 + 81 = 582 long, so the **routed** anchor is 291 along, at `(459,649)`.

120px apart, for one ordinary edge. An `<mxPoint as="offset"/>` cannot reconcile them: it
shifts both anchors by the same vector.

**The rule: both landing points have to be clear.** Compute the routed one by hand from the
pinned ports and the waypoints, check nothing is there, and check the straight midpoint too
because that is the one the validator will fire on. If they disagree and only one is clear,
the fix is the routing or the layout, not the offset.

### Moving the label

Two tools, not interchangeable.

**`mxGeometry` `x`, with `relative="1"`, slides the label along the edge.** It runs -1 at the
source to 1 at the target, 0 is the centre, and `validate-drawio.js` honours it: `labelAnchor()`
reads `geo.attrs.x`, maps it to `t = (along + 1) / 2` and interpolates the straight line at `t`.
It moves both anchors together, in the same direction, and stays on the edge. Reach for it when
the answer is "put this near the source end" rather than "nudge this up 50px".

**`<mxPoint as="offset"/>` translates the label in pixels**, `x` right and negative `y` up, from
wherever it would otherwise sit. It is the tool for separating two labels that already land near
each other. On a long span it moves the label off its own edge, so use it there only along a lane
you know is empty. From `p1e7`, the return leg of the inference path, which runs 1500px down a
reserved lane at y=480 and needs its label clear of the boxes above:

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
only works for one-line labels at `fontSize=12`, whose line box is 14px but whose collision box
is judged before the shrink. 50 is the number that stops the check firing. `-25` is enough for a
lane of single-line labels already staggered by row, which is what the inference path uses.

### Shorten the label and move the detail into the node

Move it, never drop it. From the real findings:

| Before, and what it did | After |
|---|---|
| `serves the model named by the endpoint config` on `sm_ep -> sm_model`, printed over both icons | `serves this model` on the edge, and the endpoint config named in the `sm_ep` node label |
| `job submits source/sourcedir.tar.gz, writes training/ output` on `l_trn -> s3_art`, printed over `s3_data` | `writes training/ output` on the edge, and `source/` listed in the bucket's node label |

## 7. Layout: a grid pitch, because overlap is an exact error

`node-overlap` compares real rectangles, so eyeballing the coordinates does not survive it. Lay
every page out on a pitch and the check cannot fire. The pitch that worked:

| Element | Real footprint | Column pitch | Row pitch |
|---|---|---|---|
| Service icon | `78x78` tile, label below it: about `78x120`, up to 200 wide | `240` | `210` |
| Plain box | `200x80` | `400` | `200` |

**Size the gap from the longest edge label, not from the element.** By the 0.5 char-width ratio
a 24 character label at `fontSize=12` is 144px wide, so a 220 icon pitch leaves 142px and that
label touches both neighbours, passing only because the estimate is shrunk to 0.6 first. The
numbers above are the ones that came out readable: 240 minus 78 leaves 162px between icon
columns, 400 minus 200 leaves 200px between plain boxes, which is what a 32 character label like
`sagemaker-runtime:InvokeEndpoint` needs. The plain-box pitch went from 320 to 400 for exactly
that reason. The row pitch is the icon's real 120px footprint plus a lane, not 78 plus a lane.

**Reserve corridors and lanes, and route through them.** This is what makes a dense page come
out clean, not an afterthought. Name the vertical corridors in the gaps between node columns and
the horizontal lanes between node rows, then give every non-trivial edge explicit
`<Array as="points">` waypoints through them. On the machinel infrastructure page the icon
columns sit at page x 300, 540, 780, 1020 and 1260, and every waypoint falls in a gap between two
of them: 420, 440 and 459 in the first gap, 660 through 760 in the second, 939 in the third, 1150
and 1210 in the fourth. Corridors are 20px apart so two edges sharing a gap never share a line.
The lanes work the same way in y, using the band the icon labels do not occupy.

Waypoints buy three things at once. The routing becomes deterministic, so the routed label anchor
can be computed at all. Edges stop overlapping each other. And `edge-crosses-node` stops being
guesswork, because the drawn path is the path you chose.

- All coordinates on the 10px grid, and both pitches are multiples of it. `edgeStyle=orthogonalEdgeStyle` everywhere.
- One direction per page. Left to right for a request path, top to bottom for a layered stack. Pick one and hold it for the whole page.
- Order nodes along the flow so edges run forward. Most crossings are a node in the wrong column, not a routing problem.
- The pitch applies inside a container too, in container-relative coordinates.
- An `edge-crosses-node` warning is a node in the wrong place far more often than it is a routing problem. Move the node to the next row before you reach for waypoints.

Do not attempt a layout algorithm. If a page genuinely needs one, `drawio --layout` exists when
the binary is installed.

**On an icon page, never exit or enter a node's bottom.** A `resourceIcon` label hangs *below*
the 78x78 tile, so the real footprint is roughly 78 wide by 120 tall and up to 200px wide across
the text. An edge leaving or arriving at the bottom is drawn straight through the node's own
label. `node-overlap` is blind to this because it compares the 78x78 rectangles and nothing else,
so a page full of this defect validates clean. Use `exitY`/`entryY` of `0`, or a fractional value
on the left or right side. Not one edge on the machinel infrastructure page uses `exitY=1` or
`entryY=1`. Cap each icon label line at about 26 characters so the text stays inside the column
pitch, and use `&lt;br&gt;` to break it rather than letting it run.

**Icons on the infrastructure page, boxes on the functional page. Do not mix.** A half iconed
page reads as an unfinished page. The functional page uses `genericShapes.box`,
`genericShapes.edge` and `genericShapes.groupBox` and no vendor icons at all, because it answers
"what does the system do" and a cloud logo is noise there.

## 8. What each check means

Errors block. Warnings do not, and each one is a question to answer.

| Check | Severity | What it means for the rendered diagram |
|---|---|---|
| `xml-not-well-formed` | error | The file will not open at all. Almost always an unescaped `&` or a raw `<` in a label or style |
| `unescaped-character` | warning | A raw `>` in text. Legal in practice, wrong in principle, write `&gt;` |
| `file-structure` | error | Unreadable file, root is not `<mxfile>`, or no `<diagram>` pages |
| `page-id` | error | A `<diagram>` has no id, or two share one. Page links resolve to the first match. This is the one the merge can produce |
| `page-name` | error | A `<diagram>` has no name, or two share one. Unnamed pages become `Page-n` and stop being tabbed pages |
| `page-model` | error | No `<mxGraphModel>` or no `<root>`. The page is empty |
| `page-model` | warning | The page content is compressed, so nothing inside it can be checked. Rewrite it uncompressed |
| `root-cells` | error | `<root>` is empty, or `id="0"` and `id="1"` are missing. Without both, there is no layer for anything to live in |
| `cell-id` | error | A cell has no id. Nothing can reference it |
| `duplicate-cell-id` | error | Two cells share an id **within one page**. draw.io renumbers one on save and your edges bind to whichever won |
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
- An edge label is placed at the midpoint of the **straight** line between the terminals, and waypoints are ignored entirely. See section 6, which is the single defect this misses most.

So a clean run still leaves marginal collisions possible, which is exactly the class of defect
the reviewer exists to catch.

## 9. The drawio CLI

`-p` / `--page-index` is **1 based**. `-p 0` is a rejected argument: the CLI exits non-zero before it opens the file.
That is not a broken page, and reading it as one sends the next hour into repairing a page that was fine. On Linux the
export needs a display: `xvfb-run -a drawio ... --no-sandbox --disable-gpu`. `-k, --check` is not a validator, it
means "do not overwrite".

```sh
drawio -x -f png -o /tmp/<slug>.png --page-index 1 --scale 2 docs/diagrams/parts/<slug>.drawio
```

### Round trip, when the binary is there

One run on the merged file before the diagram is called done. Export it back out and diff the
sorted files: any cell draw.io renumbered, reparented or stripped a terminal from shows up,
under noise from attribute ordering and view defaults. It is the strongest deterministic signal
available, because it asks draw.io itself what it thinks the model is.

```sh
drawio -x -f xml -o /tmp/rt.xml -u docs/diagrams/machinel.drawio
```
