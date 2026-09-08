# draw.io (.drawio) programmatic generation reference

Audience: skill-authoring agents that emit `.drawio` XML and validate it deterministically.

## Provenance of claims

Three verification tiers are used throughout:

- **[TESTED]** — I built the file and ran it through the draw.io desktop CLI (`drawio 31.3.2`, macOS, `/opt/homebrew/bin/drawio`) and inspected the rendered PNG. Strongest tier.
- **[SOURCE]** — read directly out of the shipped app bundle (`/Applications/draw.io.app/Contents/Resources/app.asar`, draw.io 31.3.2) or the jgraph GitHub source. Shape names and style strings come from `js/diagramly/sidebar/Sidebar-*.js` and `stencils/*.xml` inside that bundle — this is the same code that builds draw.io's own shape picker, so it is definitionally correct.
- **`UNVERIFIED:`** — could not be confirmed against a primary source.

Everything in the icon tables below is both [SOURCE] and [TESTED]: all 63 style strings were rendered in one sheet and visually confirmed to produce the correct icon.

---

## 1. File format

### 1.1 Minimal complete working file

Save as `x.drawio` and open. [TESTED]

```xml
<mxfile host="app.diagrams.net">
  <diagram id="page1" name="Page-1">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="a" value="Hello" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="40" y="40" width="120" height="60" as="geometry" />
        </mxCell>
        <mxCell id="b" value="World" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="320" y="40" width="120" height="60" as="geometry" />
        </mxCell>
        <mxCell id="e1" value="calls over HTTPS" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;"
                edge="1" parent="1" source="a" target="b">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

### 1.2 Attributes: what is actually required

**`mxfile`** — every attribute is optional metadata; none is consulted when opening. [SOURCE: `Editor.extractGraphModel` only checks `nodeName == 'mxfile'` and iterates `diagram` children.] `EditorUi.getFileData` strips `userAgent`, `modified`, `version`, `editor`, `pages`, `type`, `etag` on save and rewrites `host`. Emitting `<mxfile host="app.diagrams.net">` and nothing else is correct and sufficient. `<mxfile>` bare also works. [TESTED]

**`mxGraphModel`** — all attributes optional with defaults. [SOURCE: `mxModelCodec` decodes only the `root` child; the rest are view-state hints defaulted by `Graph.saveViewState`.] Defaults: `grid=1`, `gridSize=10`, `guides/tooltips/connect/arrows/fold/page=1`, `pageScale=1`, `pageWidth=850`, `pageHeight=1100`, `math=0`, `shadow=0`. `dx`/`dy` are scroll position only — safe to omit or set arbitrarily.

Emit this and stop worrying:

```xml
<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageScale="1" pageWidth="850" pageHeight="1100">
```

### 1.3 Multiple pages

Multiple `<diagram>` elements inside one `<mxfile>`. [TESTED — a two-page uncompressed file opened and both pages exported.]

```xml
<mxfile host="app.diagrams.net">
  <diagram id="overview" name="Overview">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageWidth="850" pageHeight="1100">
      <root><mxCell id="0"/><mxCell id="1" parent="0"/></root>
    </mxGraphModel>
  </diagram>
  <diagram id="data-plane" name="Data plane">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageWidth="850" pageHeight="1100">
      <root><mxCell id="0"/><mxCell id="1" parent="0"/></root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

- `id` — not strictly required. `DiagramPage` assigns `Editor.guid()` when missing and persists it on next save. [SOURCE: Pages.js] **Always emit one anyway** — cross-page links resolve by id, and a stable id keeps diffs clean.
- `name` — optional; missing becomes `Page-<n>`. **Caveat:** a *single* `<diagram>` with no `name` is not treated as a tabbed page. [SOURCE: `EditorUi.setFileData`, condition `nodes.length > 1 || (nodes.length == 1 && nodes[0].hasAttribute('name'))`.] Always emit `name`.
- Colliding page ids: nothing de-duplicates on load; `getPageById` returns the **first** match. `UNVERIFIED:` behaviour beyond that (inferred from absence of any check, not tested).

**Cell ids are scoped per page.** Two pages may both use `id="1"`. Validate uniqueness *within* a `<root>`, not across the file.

### 1.4 Uncompressed content — confirmed, and this is the right choice

draw.io decides compressed vs. plain **purely from the content of the `<diagram>` node**. There is no attribute to set. [SOURCE: `Editor.parseDiagramNode`, Editor.js]

```js
var text = mxUtils.trim(mxUtils.getTextContent(diagramNode));
if (text.length > 0) {                 // non-empty TEXT -> deflate+base64 payload
    var tmp = Graph.decompress(text, null, checked);
    ...
} else {                               // no text -> first CHILD ELEMENT is the model
    var temp = mxUtils.getChildNodes(diagramNode);
    ...
}
```

**The rule for generators:** put an `<mxGraphModel>` **element** child inside `<diagram>` and leave no text content. That is what makes it uncompressed. Do not set `compressed="false"` — it is not read on load.

The `compressed` attribute on `mxfile` is a *save* preference only, read by `DrawioFile.isCompressed`. Current draw.io defaults to saving uncompressed anyway (`Editor.defaultCompressed = false`). [SOURCE] Confirmed empirically: `drawio -x -f xml` emitted plain XML with **and** without `-u/--uncompressed` on 31.3.2. [TESTED]

The compressed form, for recognition when reading files you did not write — raw-deflate, then base64, over URL-encoded XML:

```xml
<mxfile host="app.diagrams.net"><diagram id="C5RBs43oDa" name="Page-1">7VjLcpswFP0aL9sBFAxeNo7bTGeaycSLNksZZKMWkCuLGPfrKx4XkATBTup4kmYT654r6XLuQ0KZ4CKt...</diagram></mxfile>
```

Python round-trip for reading those:

```python
import base64, zlib, urllib.parse
def inflate(text: str) -> str:
    return urllib.parse.unquote(zlib.decompress(base64.b64decode(text), -15).decode("utf-8"))
```

### 1.5 mxCell: vertex vs edge

| attribute | vertex | edge | notes |
|---|---|---|---|
| `id` | required | required | unique within the page's `<root>`; `parent`/`source`/`target` resolve against it |
| `parent` | required | required | omitted only on cell `0`. [SOURCE: `mxModelCodec.decodeRoot` identifies the model root as the one cell with no parent] |
| `vertex="1"` | required | — | mutually exclusive with `edge` |
| `edge="1"` | — | required | |
| `value` | optional | optional | the label |
| `style` | optional | optional | falls back to the default vertex/edge style |
| `source` / `target` | — | optional | see below |
| `<mxGeometry as="geometry">` | required in practice | **required** | see 1.6 |

An edge with **neither** `source`/`target` **nor** `sourcePoint`/`targetPoint` in its geometry is deleted by the view: `mxGraphView.updateEdgeState` calls `this.clear(state.cell, true)` with the comment *"This will remove edges with no terminals and no terminal points as such edges are invalid and produce NPEs in the edge styles."* [SOURCE: mxgraph]

**The two mandatory root cells:**

```xml
<root>
  <mxCell id="0" />             <!-- model root: no parent, no role, never rendered -->
  <mxCell id="1" parent="0" />  <!-- default layer; its `value` is the layer name in the UI -->
  <!-- everything else uses parent="1", or the id of a group/container, or another layer -->
</root>
```

Cell `0` is the model root. Cell `1` is the default layer — children of the root are layers, and every drawn cell lives inside one. Additional layers are extra cells with `parent="0"`.

### 1.6 mxGeometry

`as="geometry"` is mandatory on the element — it names the `mxCell.geometry` field for `mxObjectCodec`. `relative` defaults to `false`.

Vertex — needs `x`, `y`, `width`, `height`:

```xml
<mxCell id="v1" value="Box" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1">
  <mxGeometry x="200" y="160" width="120" height="60" as="geometry" />
</mxCell>
```

A vertex child of a container has coordinates **relative to the container's origin**, not the page. [TESTED — nested AWS group containers.]

Edge — with optional waypoints and fallback terminal points:

```xml
<mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;"
        edge="1" parent="1" source="v1" target="v2">
  <mxGeometry relative="1" as="geometry">
    <mxPoint x="200" y="400" as="sourcePoint" />
    <mxPoint x="360" y="400" as="targetPoint" />
    <Array as="points">
      <mxPoint x="280" y="360" />
    </Array>
  </mxGeometry>
</mxCell>
```

**When `relative="1"` is actually needed** — this is narrower than most guides claim:

- **On the edge itself: NOT required for the edge to route.** [TESTED] An edge with `<mxGeometry as="geometry"/>` (no `relative`) renders identically to one with `relative="1"`. What *is* required is that the `<mxGeometry>` element **exists at all** — see 4.7. Emit `relative="1"` anyway for fidelity with draw.io's own output (`mxGraph.createEdge` sets it unconditionally) and because it changes label coordinate semantics on the edge.
- **On an edge-label child cell: REQUIRED.** It is what makes `x` mean "fraction along the edge" (−1…1, 0 = centre) and `y` mean orthogonal pixel offset.
- **On a relative-positioned vertex child / port: REQUIRED.** `x`/`y` become fractions of the parent's bounds. [SOURCE: `mxGraphView.updateCellState`, `state.origin.x += geo.x * pState.unscaledWidth + offset.x`]

---

## 2. Edge labels

Every edge should say what happens on it. Two forms exist; both round-trip and both render. [TESTED]

**Form A — `value` on the edge cell.** This is what draw.io writes when you select an edge and type. [SOURCE: `Graph.cellLabelChanged` sets the value on the edge cell; no child is created.]

```xml
<mxCell id="e1" value="writes object &amp; emits event"
        style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;"
        edge="1" parent="1" source="lambda" target="s3">
  <mxGeometry relative="1" as="geometry" />
</mxCell>
```

**Form B — separate child label cell.** [SOURCE: `Graph.prototype.addText` sets `vertex=true`, `connectable=false`, `style='edgeLabel;'+…`, `geometry.relative=true`, `geometry.offset`.] Produced by "add a label" / adding a *second* label to an edge.

```xml
<mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;html=1;"
        edge="1" parent="1" source="v1" target="v2">
  <mxGeometry relative="1" as="geometry" />
</mxCell>
<mxCell id="e1-label" value="writes object &amp; emits event"
        style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];"
        vertex="1" connectable="0" parent="e1">
  <mxGeometry x="-0.2" y="2" relative="1" as="geometry">
    <mxPoint as="offset" />
  </mxGeometry>
</mxCell>
```

### Recommendation: use Form A

One label per edge, on the edge cell's `value`.

1. **One cell instead of two.** Half the ids to allocate, half the parent references to keep consistent, and the label cannot become orphaned from its edge.
2. **It survives a dangling-terminal bug more visibly.** With Form B the label is a separate vertex; if the edge is dropped for a bad terminal the child label goes with it — but you also cannot tell which failed. With Form A there is exactly one thing to check.
3. **Validation is one line.** "Every `edge="1"` cell has a non-empty `value`" is a trivial assertion. Under Form B you must join edges to their label children first, and an edge legitimately has zero-or-more of them.
4. **It is what draw.io itself writes** for the ordinary case, so files diff cleanly against hand-edited ones.

Use Form B only when you genuinely need two labels on one edge (e.g. a protocol at the source end and a port at the target end), or need a label pinned to a specific position along the edge.

---

## 3. Cloud service icons

**The three clouds use three different mechanisms.** This is the single most important fact in this section, and it is not what most guides say.

| cloud | library | mechanism | name-addressable? |
|---|---|---|---|
| AWS | `mxgraph.aws4` | stencil, via a generic `resourceIcon` container shape | **yes** — 1038 stencils |
| Azure | `azure2` | **plain image reference to a bundled SVG file** | **yes** — 736 SVG paths |
| GCP | `mxgraph.gcp3` | stencil | yes, but **only 45 names** |
| GCP | `mxgraph.gcp.*` | stencil (legacy 2018 icons) | yes, larger, but visually dated |
| GCP | `gcp2` / `gcpicons` | **inline base64 data-URI SVG** | **no** — unusable programmatically |

### 3.1 Do any shape libraries need enabling in the UI?

**No, and this does not affect generated files.** The "Enable/Disable shape libraries" dialog only controls which palettes appear in the left-hand picker. Shape *rendering* goes through `mxStencilRegistry`, which lazy-loads the stencil file on first reference to an unknown `mxgraph.<lib>.<name>`. A file referencing `mxgraph.aws4.lambda` renders correctly in a fresh draw.io with the AWS palette switched off. [TESTED — the headless CLI has no palettes enabled at all and rendered every icon in this document.]

### 3.2 AWS — `resourceIcon` + `resIcon`

The hypothesis in the brief is **correct**, with one important refinement.

`mxgraph.aws4.resourceIcon` is not a stencil — it is a JS shape that draws a plain filled square in `fillColor` and then draws the stencil named by the `resIcon` style key inside it, tinted with `strokeColor`. [SOURCE: `shapes/mxAWS4.js`]

```js
mxShapeAws4ResourceIcon.prototype.paintVertexShape = function(c, x, y, w, h) {
    c.translate(x, y);
    c.begin(); c.moveTo(0,0); c.lineTo(w,0); c.lineTo(w,h); c.lineTo(0,h); c.close(); c.fill();
    c.setShadow(false);
    var prIcon = mxUtils.getValue(this.state.style, 'resIcon', '');
    var stencil = mxStencilRegistry.getStencil(prIcon);
    if (stencil != null) {
        var strokeColor = mxUtils.getValue(this.state.style, 'strokeColor', '#000000');
        c.setFillColor(strokeColor); c.setStrokeColor('none');
        stencil.drawShape(c, this, w*0.1, h*0.1, w*0.8, h*0.8);
    }
};
```

Consequences you must design around:

- `fillColor` is the tile background, `strokeColor` is the **glyph colour** (always `#ffffff` for AWS's official look).
- **If `resIcon` names a stencil that does not exist, `stencil` is `null` and the `if` is simply skipped.** You get a blank coloured square, no icon, no warning, exit code 0. [TESTED — this is failure mode 4.5.]
- The tile colour is a *convention*, not enforced. AWS's category colours are per-palette constants in the sidebar source.

**Canonical AWS style string:**

```
sketch=0;outlineConnect=0;fontColor=#232F3E;fillColor=<CATEGORY_COLOR>;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.<SERVICE>;
```

Recommended size 78x78 (draw.io's own default for these). [SOURCE]

**AWS category colours** — extracted from the per-palette `n2` constants in `Sidebar-AWS4.js`. [SOURCE]

| category | colour |
|---|---|
| Compute, Containers, Media, Blockchain, Quantum | `#ED7100` |
| Storage, Cloud Financial Mgmt, IoT | `#7AA116` |
| Database, Developer Tools, Customer Enablement, Satellite | `#C925D1` |
| Networking & Content Delivery, Analytics, Games, Serverless | `#8C4FFF` |
| App Integration, Management & Governance | `#E7157B` |
| Security Identity & Compliance, Front-End Web & Mobile, Business Apps, Contact Center, Robotics | `#DD344C` |
| AI/ML, End User Computing, Migration & Modernization | `#01A88D` |
| General Resources | `#5A6C86` |

**Verified AWS `resIcon` names** — all [SOURCE] from `stencils/aws4.xml` and [TESTED] rendered:

| service | fillColor | resIcon |
|---|---|---|
| EC2 | `#ED7100` | `mxgraph.aws4.ec2` |
| Lambda | `#ED7100` | `mxgraph.aws4.lambda` |
| EKS | `#ED7100` | `mxgraph.aws4.eks` |
| ECS | `#ED7100` | `mxgraph.aws4.ecs` |
| Fargate | `#ED7100` | `mxgraph.aws4.fargate` |
| ECR | `#ED7100` | `mxgraph.aws4.ecr` |
| S3 | `#7AA116` | `mxgraph.aws4.s3` |
| EFS | `#7AA116` | `mxgraph.aws4.elastic_file_system` |
| RDS | `#C925D1` | `mxgraph.aws4.rds` |
| Aurora | `#C925D1` | `mxgraph.aws4.aurora` |
| DynamoDB | `#C925D1` | `mxgraph.aws4.dynamodb` |
| ElastiCache | `#C925D1` | `mxgraph.aws4.elasticache` |
| Redshift | `#C925D1` | `mxgraph.aws4.redshift` |
| SQS | `#E7157B` | `mxgraph.aws4.sqs` |
| SNS | `#E7157B` | `mxgraph.aws4.sns` |
| EventBridge | `#E7157B` | `mxgraph.aws4.eventbridge` |
| Step Functions | `#E7157B` | `mxgraph.aws4.step_functions` |
| API Gateway | `#E7157B` | `mxgraph.aws4.api_gateway` |
| ELB | `#8C4FFF` | `mxgraph.aws4.elastic_load_balancing` |
| CloudFront | `#8C4FFF` | `mxgraph.aws4.cloudfront` |
| Route 53 | `#8C4FFF` | `mxgraph.aws4.route_53` |
| VPC (icon) | `#8C4FFF` | `mxgraph.aws4.vpc` |
| Athena | `#8C4FFF` | `mxgraph.aws4.athena` |
| Cognito | `#DD344C` | `mxgraph.aws4.cognito` |

Fully worked example:

```xml
<mxCell id="lam" value="Order processor" style="sketch=0;outlineConnect=0;fontColor=#232F3E;fillColor=#ED7100;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;" vertex="1" parent="1">
  <mxGeometry x="40" y="40" width="78" height="78" as="geometry" />
</mxCell>
```

### 3.3 Azure — image references, not stencils

**`shape=mxgraph.azure2.*` does not exist.** The current Azure library is 100% image-based. [SOURCE: `Sidebar-Azure2.js` — 70 occurrences of `image=img/lib/azure2`, **zero** occurrences of `shape=mxgraph.azure2`.]

```
image;aspect=fixed;html=1;points=[];align=center;fontSize=12;image=img/lib/azure2/<category>/<File_Name>.svg;
```

The path is resolved relative to the draw.io webapp root and works in draw.io web, desktop, and headless export without any local asset. [TESTED] Recommended size 68x68.

The 30 category folders: `ai_machine_learning analytics app_services azure_ecosystem azure_stack azure_vmware_solution blockchain compute containers cxp databases devops general hybrid_multicloud identity integration internet_of_things intune iot management_governance menu migrate mixed_reality monitor networking other power_platform preview security storage web`

**Verified Azure image paths** — all [SOURCE] from the bundle file listing and [TESTED] rendered:

| service | image path |
|---|---|
| Virtual Machine | `img/lib/azure2/compute/Virtual_Machine.svg` |
| Function Apps | `img/lib/azure2/compute/Function_Apps.svg` |
| App Services | `img/lib/azure2/app_services/App_Services.svg` |
| AKS (Kubernetes) | `img/lib/azure2/containers/Kubernetes_Services.svg` |
| Container Registry | `img/lib/azure2/containers/Container_Registries.svg` |
| Storage Accounts | `img/lib/azure2/storage/Storage_Accounts.svg` |
| Blob (block) | `img/lib/azure2/general/Blob_Block.svg` |
| SQL Database | `img/lib/azure2/databases/SQL_Database.svg` |
| Cosmos DB | `img/lib/azure2/databases/Azure_Cosmos_DB.svg` |
| Service Bus | `img/lib/azure2/integration/Service_Bus.svg` |
| Storage Queue | `img/lib/azure2/general/Storage_Queue.svg` |
| Event Hubs | `img/lib/azure2/analytics/Event_Hubs.svg` |
| Event Grid Topics | `img/lib/azure2/integration/Event_Grid_Topics.svg` |
| Load Balancers | `img/lib/azure2/networking/Load_Balancers.svg` |
| Front Door | `img/lib/azure2/networking/Front_Doors.svg` |
| API Management | `img/lib/azure2/integration/API_Management_Services.svg` |
| Virtual Networks | `img/lib/azure2/networking/Virtual_Networks.svg` |
| Subnet | `img/lib/azure2/networking/Subnet.svg` |
| Resource Groups | `img/lib/azure2/general/Resource_Groups.svg` |

Note the same file name appears under several categories (`App_Services.svg` exists in `compute/`, `app_services/`, and `containers/`). Any of them renders; pick the semantically right one.

```xml
<mxCell id="aks" value="Ingest cluster" style="image;aspect=fixed;html=1;points=[];align=center;fontSize=12;image=img/lib/azure2/containers/Kubernetes_Services.svg;" vertex="1" parent="1">
  <mxGeometry x="40" y="40" width="68" height="68" as="geometry" />
</mxCell>
```

### 3.4 GCP — no single good library

Be honest with users about this one. GCP's situation is the worst of the three.

**`mxgraph.gcp3`** (2026, current, clean colour icons) — the best-looking option, but only **45 names total**, and it has no Pub/Sub, no load balancer, no Firestore, no Bigtable. [SOURCE: `stencils/gcp3.xml`]

```
sketch=0;html=1;verticalAlign=top;labelPosition=center;verticalLabelPosition=bottom;align=center;fontSize=11;fontStyle=0;fontColor=#000000;aspect=fixed;pointerEvents=1;shape=mxgraph.gcp3.<name>;fillColor=#4285f4;
```

Complete gcp3 name list [SOURCE]: `agents aihypercomputer aimachinelearning alloydb anthos apigee bigquery businessintelligence cloud_storage cloudrun cloudspanner cloudsql collaboration compute computeengine containers dataanalytics databases developer_tools devops distributedcloud gke hybridmulticloud hyperdisk integrationservices looker managementtools mandiant mapsgeospatial marketplace mediaservices migration mixedreality networking observability operations secops securitycommandcenter securityidentity serverlesscomputing storage threatintelligence vertexai web3 webmobile`

**`mxgraph.gcp.<category>.<name>`** (legacy 2018 icons) — broader coverage, fills the gaps above, but renders as a **monochrome outline hexagon with a very faint glyph**. [TESTED — visually confirmed; this is by design, matching draw.io's own legacy palette.] Use only for services gcp3 lacks, and expect them to look different from gcp3 icons on the same page.

```
dashed=0;html=1;shape=mxgraph.gcp.<category>.<name>;
```

**`gcp2` and `gcpicons` are unusable for generation.** Both embed each icon as an inline base64 data-URI SVG rather than a named shape (`image=data:image/svg+xml,PHN2Zy...`). [SOURCE] There is no short style string for them. Do not attempt to use them.

**Verified GCP style strings** — all [SOURCE] and [TESTED]:

| service | library | shape |
|---|---|---|
| Compute Engine | gcp3 | `mxgraph.gcp3.computeengine` |
| Cloud Run | gcp3 | `mxgraph.gcp3.cloudrun` |
| GKE | gcp3 | `mxgraph.gcp3.gke` |
| Cloud Storage | gcp3 | `mxgraph.gcp3.cloud_storage` |
| Cloud SQL | gcp3 | `mxgraph.gcp3.cloudsql` |
| Cloud Spanner | gcp3 | `mxgraph.gcp3.cloudspanner` |
| AlloyDB | gcp3 | `mxgraph.gcp3.alloydb` |
| BigQuery | gcp3 | `mxgraph.gcp3.bigquery` |
| Apigee (API gateway) | gcp3 | `mxgraph.gcp3.apigee` |
| Vertex AI | gcp3 | `mxgraph.gcp3.vertexai` |
| Anthos | gcp3 | `mxgraph.gcp3.anthos` |
| **Pub/Sub** | legacy | `mxgraph.gcp.big_data.cloud_pubsub` |
| **Cloud Load Balancing** | legacy | `mxgraph.gcp.networking.cloud_load_balancing` |
| **Datastore** | legacy | `mxgraph.gcp.storage_databases.cloud_datastore` |
| **Bigtable** | legacy | `mxgraph.gcp.storage_databases.cloud_bigtable` |
| Cloud Functions | legacy | `mxgraph.gcp.compute.cloud_functions` |
| Cloud DNS | legacy | `mxgraph.gcp.networking.cloud_dns` |
| Cloud VPN | legacy | `mxgraph.gcp.networking.cloud_vpn` |
| Cloud CDN | legacy | `mxgraph.gcp.networking.cloud_cdn` |

Legacy GCP stencil categories: `big_data compute developer_tools extras identity_and_security machine_learning management_tools networking product_cards storage_databases`

### 3.5 Deriving a shape name you do not have, and verifying it

**The naming rule.** Stencil XML files declare shapes with human names containing spaces and mixed case:

```xml
<shape name="Elastic Load Balancing" h="..." w="...">
```

`mxStencilRegistry` addresses them **lowercased with spaces replaced by underscores**, prefixed by the stencil file's root name:

```
"Elastic Load Balancing"  ->  mxgraph.aws4.elastic_load_balancing
"A1 Instance"             ->  mxgraph.aws4.a1_instance
"Cloud PubSub"            ->  mxgraph.gcp.big_data.cloud_pubsub
"Cloud Storage"           ->  mxgraph.gcp3.cloud_storage
```

[SOURCE: cross-checked stencil `name` attributes against the sidebar's emitted style strings for every service in the tables above.] Note the AWS names are the *service* name, not the marketing name — `route_53` not `route53`, `elastic_file_system` not `efs`, `elastic_load_balancing` not `elb`.

**How to verify a name is real — three methods, best first.**

1. **Grep the shipped stencil file.** Definitive, offline, no network. On macOS with draw.io desktop installed:

   ```sh
   npx --yes @electron/asar extract-file \
     /Applications/draw.io.app/Contents/Resources/app.asar \
     drawio/src/main/webapp/stencils/aws4.xml
   grep -o '<shape[^>]*name="[^"]*"' aws4.xml \
     | sed 's/.*name="//;s/"//' | tr ' ' '_' | tr 'A-Z' 'a-z' | sort -u > aws4_names.txt
   grep -x 'elastic_load_balancing' aws4_names.txt
   ```

   Same pattern for `stencils/gcp3.xml` and `stencils/gcp/*.xml`. For Azure, list the asset paths instead:

   ```sh
   npx --yes @electron/asar list /Applications/draw.io.app/Contents/Resources/app.asar \
     | grep '^/drawio/src/main/webapp/img/lib/azure2/'
   ```

2. **Render it and look.** The only way to catch a name that exists but is the wrong icon:

   ```sh
   drawio -x -f png -o probe.png --page-index 1 --scale 2 probe.drawio
   ```

   A bad `resIcon` produces a plain coloured square. A bad Azure `image=` path produces an empty box with a broken-image placeholder. A bad `shape=` produces a plain rectangle.

3. **Cross-check against the sidebar source**, which is the authority on the *intended* colour and size as well as the name:

   ```sh
   npx --yes @electron/asar extract-file \
     /Applications/draw.io.app/Contents/Resources/app.asar \
     drawio/src/main/webapp/js/diagramly/sidebar/Sidebar-AWS4.js
   grep -n "resIcon=' + gn + '\.lambda;" Sidebar-AWS4.js
   ```

Do **not** trust blog posts or icon-name guessing. AWS renamed many stencils between the aws3/aws4/aws4b generations, and `Sidebar-AWS4b.js` (legacy) uses the same `mxgraph.aws4` prefix with different colours.

### 3.6 Grouping and container shapes (VPC, subnet, region, AZ, account)

Containers are ordinary vertices with `container=1`, and children are parented to them by id with **coordinates relative to the container**. [TESTED — five levels of nesting rendered correctly.]

Shared prefix for the icon-bearing AWS groups [SOURCE: `addAWS4GroupsPalette`]:

```
points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;fontStyle=0;container=1;pointerEvents=0;collapsible=0;recursiveResize=0;shape=mxgraph.aws4.group;
```

Append the per-group suffix:

| boundary | suffix |
|---|---|
| AWS Cloud | `grIcon=mxgraph.aws4.group_aws_cloud_alt;strokeColor=#232F3E;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#232F3E;dashed=0;` |
| Region | `grIcon=mxgraph.aws4.group_region;strokeColor=#00A4A6;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#147EBA;dashed=1;` |
| VPC | `grIcon=mxgraph.aws4.group_vpc2;strokeColor=#8C4FFF;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#AAB7B8;dashed=0;` |
| Private subnet | `grIcon=mxgraph.aws4.group_security_group;grStroke=0;strokeColor=#00A4A6;fillColor=#E6F6F7;verticalAlign=top;align=left;spacingLeft=30;fontColor=#147EBA;dashed=0;` |
| Public subnet | `grIcon=mxgraph.aws4.group_security_group;grStroke=0;strokeColor=#7AA116;fillColor=#F2F6E8;verticalAlign=top;align=left;spacingLeft=30;fontColor=#248814;dashed=0;` |
| AWS Account | `grIcon=mxgraph.aws4.group_account;strokeColor=#CD2264;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#CD2264;dashed=0;` |
| Auto Scaling group | uses `shape=mxgraph.aws4.groupCenter;grIcon=mxgraph.aws4.group_auto_scaling_group;grStroke=1;strokeColor=#D86613;fillColor=none;verticalAlign=top;align=center;fontColor=#D86613;dashed=1;spacingTop=25;` |
| Corporate data center | `grIcon=mxgraph.aws4.group_corporate_data_center;strokeColor=#7D8998;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#5A6C86;dashed=0;` |
| EC2 instance contents | `grIcon=mxgraph.aws4.group_ec2_instance_contents;strokeColor=#D86613;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#D86613;dashed=0;` |

**Availability Zone and Security group have no icon** — they are plain styled rectangles [SOURCE: same palette]:

```
# Availability Zone
fillColor=none;strokeColor=#147EBA;dashed=1;verticalAlign=top;fontStyle=0;fontColor=#147EBA;whiteSpace=wrap;html=1;container=1;collapsible=0;

# Security group
fillColor=none;strokeColor=#DD3522;verticalAlign=top;fontStyle=0;fontColor=#DD3522;whiteSpace=wrap;html=1;container=1;collapsible=0;
```

Note: draw.io's own palette entries for these two omit `container=1`; add it yourself if you want to parent children into them, as in the example below.

Full AWS group name list [SOURCE: `stencils/aws4.xml`]: `group_account group_auto_scaling_group group_availability_zone group_aws_cloud group_aws_cloud_alt group_aws_step_functions_workflow group_corporate_data_center group_ec2_instance_contents group_elastic_beanstalk group_elastic_load_balancing group_iot_greengrass group_iot_greengrass_deployment group_on_premise group_region group_security_group group_spot_fleet group_subnet group_vpc group_vpc2`

**Working nested example** — AWS Cloud > Region > VPC > Private subnet > AZ > {EC2, RDS}. Note each child's `parent` and its container-relative geometry. [TESTED]

```xml
<mxCell id="cloud" value="AWS Cloud" style="points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;fontStyle=0;container=1;pointerEvents=0;collapsible=0;recursiveResize=0;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_aws_cloud_alt;strokeColor=#232F3E;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#232F3E;dashed=0;" vertex="1" parent="1">
  <mxGeometry x="20" y="20" width="520" height="380" as="geometry" />
</mxCell>
<mxCell id="region" value="us-east-1" style="...shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_region;strokeColor=#00A4A6;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#147EBA;dashed=1;" vertex="1" parent="cloud">
  <mxGeometry x="20" y="40" width="480" height="320" as="geometry" />
</mxCell>
<mxCell id="vpc" value="VPC" style="...shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_vpc2;strokeColor=#8C4FFF;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#AAB7B8;dashed=0;" vertex="1" parent="region">
  <mxGeometry x="20" y="40" width="440" height="260" as="geometry" />
</mxCell>
<mxCell id="sub" value="Private subnet" style="...shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_security_group;grStroke=0;strokeColor=#00A4A6;fillColor=#E6F6F7;verticalAlign=top;align=left;spacingLeft=30;fontColor=#147EBA;dashed=0;" vertex="1" parent="vpc">
  <mxGeometry x="20" y="40" width="400" height="180" as="geometry" />
</mxCell>
<mxCell id="az" value="Availability Zone" style="fillColor=none;strokeColor=#147EBA;dashed=1;verticalAlign=top;fontStyle=0;fontColor=#147EBA;whiteSpace=wrap;html=1;container=1;collapsible=0;" vertex="1" parent="sub">
  <mxGeometry x="20" y="30" width="360" height="130" as="geometry" />
</mxCell>
<mxCell id="ec2" value="EC2" style="sketch=0;outlineConnect=0;fontColor=#232F3E;fillColor=#ED7100;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ec2;" vertex="1" parent="az">
  <mxGeometry x="30" y="30" width="60" height="60" as="geometry" />
</mxCell>
<mxCell id="rds" value="RDS" style="sketch=0;outlineConnect=0;fontColor=#232F3E;fillColor=#C925D1;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.rds;" vertex="1" parent="az">
  <mxGeometry x="250" y="30" width="60" height="60" as="geometry" />
</mxCell>
<mxCell id="e" value="SQL over 5432" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="az" source="ec2" target="rds">
  <mxGeometry relative="1" as="geometry" />
</mxCell>
```

**Edges between cells in different containers:** parent the edge to the nearest common ancestor (or just `1`). An edge parented to a container it does not belong in still resolves its terminals, but its waypoints are interpreted in the wrong coordinate space. When in doubt, use `parent="1"`.

**Azure and GCP boundaries.** Neither has a `group`-style container shape equivalent. Use plain styled rectangles with `container=1`:

```
# Azure VNet / resource group boundary
rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#0078D4;dashed=1;verticalAlign=top;align=left;spacingLeft=8;fontColor=#0078D4;container=1;collapsible=0;

# GCP project / VPC boundary
rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#4285F4;dashed=1;verticalAlign=top;align=left;spacingLeft=8;fontColor=#4285F4;container=1;collapsible=0;
```

`UNVERIFIED:` those two are my own construction from generic draw.io style keys, not extracted from an official Azure/GCP palette — no such palette ships. They render correctly [TESTED] but carry no official-brand authority.

---

## 4. What makes a file invalid or badly formed

**The headline finding, tested against `drawio 31.3.2`:**

> Exactly **one** class of error causes a hard failure. Every other corruption exits 0 and silently misrenders or silently mutates your model.

Test matrix — each row is a file I built, exported with `drawio -x -f png`, and inspected:

| corruption | exit | what actually happens |
|---|---|---|
| unescaped `&` in a label | **1** | XML parse error, **no output file** |
| edge → nonexistent `target` id | 0 | `target` silently **stripped**; edge invisible; **label lost** |
| duplicate cell `id` | 0 | both cells render; the duplicate is silently **renumbered** on save |
| `parent` → nonexistent id | 0 | **model root destroyed** — cells `0` and `1` vanish |
| `parent` attribute missing | 0 | same as above |
| vertex with no `<mxGeometry>` | 0 | zero-size; only the label text renders |
| edge with no `<mxGeometry>` | 0 | **edge not drawn at all**; label renders at origin |
| malformed `style` string | 0 | garbage tokens silently ignored; default shape |
| `resIcon` naming a nonexistent stencil | 0 | plain coloured square, no icon |

Detail on each:

### 4.1 Unescaped characters in labels — the only hard error

`&`, `<`, `>` in `value` or `style` must be XML-escaped. `&` is the one that bites, because service names and edge labels naturally contain it ("Extract & Transform", "R&D", a query string `?a=1&b=2`).

```
&  ->  &amp;      (MUST)
<  ->  &lt;       (MUST)
>  ->  &gt;       (should)
"  ->  &quot;     (MUST inside a double-quoted attribute)
'  ->  &apos;     (only if you delimit attributes with single quotes)
```

```xml
<!-- WRONG: exit 1, no output -->
<mxCell id="a" value="Extract & Load" ... />
<!-- RIGHT -->
<mxCell id="a" value="Extract &amp; Load" ... />
```

**Manifestation:** `Error: Export failed: file.drawio`, exit 1, no file written. In the GUI: draw.io reports the file is not a valid diagram and refuses to open it. This is the *good* failure — loud and immediate.

Use your language's XML serializer (`xml.etree.ElementTree`, `xmlbuilder2`) rather than f-string templating. If you must template, escape every interpolated value with `html.escape(s, quote=True)` (Python) — note `html.escape` handles `&`, `<`, `>`, `"`, `'` and gets the ordering right (`&` first). Rolling your own `.replace("&","&amp;")` chain in the wrong order double-escapes.

Rich-text labels are the exception: with `html=1` in the style, draw.io renders the label as HTML, so `<br>`, `<b>` etc. are legitimate — but they still have to arrive as `&lt;br&gt;` in the XML attribute. Plain `\n` in an attribute also works for line breaks.

### 4.2 Edge referencing a non-existent source/target id

**Manifestation: invisible element, exit 0.** The reference is dropped during decode — `mxCodec.insertIntoGraph` resolves terminals with `getObject(id)`, which returns `null` and silently continues [SOURCE: mxgraph `io/mxCodec.js`]. The edge survives as a half-edge with one terminal and no geometry points, so the view discards it.

Round-trip proof — input had `target="NOPE"`, output has no `target` at all:

```xml
<!-- what came back out of drawio -->
<mxCell id="e" edge="1" parent="1" source="a" value="lbl">
  <mxGeometry relative="1" as="geometry" />
</mxCell>
```

**This is the single most damaging failure mode for generated infra diagrams**, because the whole point of the diagram is the edges, and a typo'd id makes an edge and its label vanish without a trace. Validate it.

### 4.3 Duplicate cell ids

**Manifestation: silent identity reassignment, exit 0.** Both cells render. On save, draw.io renumbers the colliding one:

```xml
<!-- input: two cells both with id="a" -->
<!-- output: -->
<mxCell id="a"  parent="1" ... value="A" vertex="1"> ... </mxCell>
<mxCell id="2"  parent="1" ... value="A2" vertex="1"> ... </mxCell>
```

So any edge you wrote pointing at `"a"` binds to whichever one won, and the other silently loses its identity. Cross-references become wrong rather than broken — worse than an error. Duplicate ids are not checked anywhere in the codec.

### 4.4 Missing parent, or parent pointing at a non-existent cell

**Manifestation: catastrophic silent model corruption, exit 0.** This is the worst one and the least obvious.

`mxModelCodec.decodeRoot` identifies the model root as *the decoded cell whose parent is null*. An unresolvable `parent` makes your cell parentless, so **it becomes the model root** and the real root and default layer are discarded.

```xml
<!-- input -->
<root>
  <mxCell id="0"/>
  <mxCell id="1" parent="0"/>
  <mxCell id="a" value="Orphan" style="html=1;" vertex="1" parent="ghost">
    <mxGeometry x="40" y="40" width="120" height="60" as="geometry"/>
  </mxCell>
</root>

<!-- what drawio round-tripped back: cells 0 and 1 are GONE -->
<root>
  <mxCell id="a" style="html=1;" value="Orphan" vertex="1">
    <mxGeometry height="60" width="120" x="40" y="40" as="geometry" />
  </mxCell>
</root>
```

The cell still renders in an export, so a smoke-test that only checks "did a PNG come out" will not catch it. The layer structure is destroyed, and any *other* cell that was correctly parented to `1` disappears. One typo'd parent silently deletes the rest of the page.

Also guard `parent == id`: `mxCodec.insertIntoGraph` throws `'Self Reference'` — one of the very few things mxgraph does throw on. [SOURCE]

### 4.5 Nonexistent shape or resIcon

**Manifestation: silent misrender, exit 0.**

- Bad `resIcon=` → the `resourceIcon` shape draws its square and skips the missing stencil (see the source in 3.2). Result: a solid coloured tile with a label and no icon. [TESTED]
- Bad `shape=` → falls back to a plain rectangle.
- Bad Azure `image=` path → empty box / broken-image placeholder.

A generator that guesses icon names will produce a diagram that looks *almost* right, which is worse than one that looks obviously broken. Validate shape names against the extracted stencil name list (3.5, method 1).

### 4.6 Malformed style strings

**Manifestation: silent fallback, exit 0.** Style parsing is `split(';')` then `split('=')` per token; anything that does not parse is ignored. `style="rounded=0=1;;;whiteSpace"` renders a default box, no complaint. [TESTED]

Rules worth enforcing in your own validator:
- Semicolon-separated `key=value` pairs; trailing `;` conventional.
- A bare token with no `=` in **first** position is the shape name (`ellipse;whiteSpace=wrap;`); elsewhere it is ignored.
- No spaces around `=`.
- A literal `;` or `=` inside a value breaks the parse — this matters for `image=` data URIs and for `points=[[0,0],[1,1]]` (commas and brackets are fine, semicolons are not).
- The style is an XML attribute value, so `&` and `"` inside it still need escaping.

### 4.7 Missing geometry

**Manifestation: invisible or unrouted element, exit 0.**

- **Vertex with no `<mxGeometry>`**: zero width and height. Only the label text renders, at the origin. Export bounding box collapses to the text. [TESTED — a 27x10 px PNG.]
- **Edge with no `<mxGeometry>`**: **the edge is not drawn at all** and its label is rendered at the canvas origin. [TESTED — confirmed visually; this upgrades what the mxgraph source only implies. `mxGraphView.updateCellState` calls `updateEdgeState(state, geo)` only when `geo != null`, so the absolute points are never computed.]

  Note the distinction established in 1.6: it is the **presence of the element** that matters, not `relative="1"`. `<mxGeometry as="geometry"/>` alone routes correctly. Emit `<mxGeometry relative="1" as="geometry" />` on every edge regardless.

### 4.8 Edges with no label

Not a format error — draw.io renders an unlabelled edge happily. It is a **content** requirement from the brief, so enforce it in your validator as a project rule, not a spec rule. Assert every `edge="1"` cell has a non-empty `value` (Form A), and report the ones that do not.

### 4.9 Things that are NOT errors

Worth knowing so your validator does not produce false positives:

- Omitting all `mxfile` attributes.
- Omitting all `mxGraphModel` attributes.
- An edge with `source` but no `target` **if** it has a `targetPoint` in its geometry (a deliberate dangling arrow).
- A vertex with no `style`.
- Reusing an id across different pages.
- Extra unknown attributes on `mxCell` (ignored).

---

## 5. Tooling

### 5.1 Is there a validator? No.

**No maintained tool validates `.drawio` structural integrity.** Nothing on npm or PyPI, and no GitHub repo above ~1 star, checks dangling `source`/`target`, duplicate ids, bad parents, or orphaned cells. The honest answer to the brief's question is: **write your own XML checks.** It is about 40 lines with no dependencies (see 5.4).

The CLI is not a substitute. It exits 1 only for unreadable/non-diagram XML, empty render bounds, or write failures — never for referential corruption inside a well-formed `mxGraphModel`. Section 4's matrix is the proof.

### 5.2 drawio-desktop CLI — real, maintained, useful as a *smoke test*

Latest release **v31.4.4, 2026-09-06**; repo active (~63k stars). Flags verified against `src/main/args.js` and against `drawio --help` on the locally installed 31.3.2.

```sh
brew install --cask drawio           # macOS
# Linux: .deb/.rpm/AppImage from https://github.com/jgraph/drawio-desktop/releases
```

```sh
drawio -x -f png  -o out.png   --page-index 1 --scale 2 in.drawio
drawio -x -f svg  -o out.svg   --page-index 1 in.drawio
drawio -x -f pdf  -o out.pdf   --all-pages --crop in.drawio
drawio -x -f xml  -o out.xml   --uncompressed in.drawio   # round-trip / normalize
```

Key flags:

| flag | meaning |
|---|---|
| `-x, --export` | export mode (also accepts `.vsdx`, `.csv`, `.mmd`/`.mermaid` inputs) |
| `-f, --format` | `pdf svg png jpeg jpg xml html`; **ignored if `-o` has a known extension** |
| `-o, --output` | output file or folder |
| `-p, --page-index` | **1-based** on v27.0.2+; 0-based before. The installed 31.3.2 rejects `0` with `Invalid page index: pages are numbered from 1 (0-based before v27.0.2)` |
| `-g, --page-range <from>..<to>` | PDF only |
| `-a, --all-pages` | PDF and HTML only |
| `--crop` | **PDF only** (`format == 'pdf'` is checked in source) |
| `-u, --uncompressed` | uncompressed XML output (xml and svg formats) |
| `-s --scale`, `--width`, `--height`, `-b --border`, `-t --transparent` | sizing |
| `-e, --embed-diagram` | embed the source diagram in PNG/SVG/PDF |
| `--layout <name\|json>` | run a layout before export: `verticalFlow horizontalFlow verticalTree horizontalTree radialTree organic`, or an ELK JSON config |
| `-k, --check` | **not a validator** — means "do not overwrite existing files" |

`--no-sandbox` is an Electron/Chromium flag, not a drawio option; the parser passes it through.

**Linux needs a display.** [SOURCE: drawio-desktop issues #146, #127]

```sh
xvfb-run -a drawio -x -f png -o out.png --no-sandbox --disable-gpu in.drawio
```

Maintained headless Docker image: `rlespinasse/docker-drawio-desktop-headless` (pushed 2026-09-07).

**What the CLI *is* good for:** the two checks nothing else gives you — that the XML parses, and that the diagram *looks* right. Render to PNG and eyeball it. That is how every icon in section 3 was verified.

### 5.3 Libraries

| package | latest | date | verdict |
|---|---|---|---|
| npm `mxgraph` | 4.2.2 | 2020-10-28 | **deprecated**, repo archived. Do not use. |
| npm `@maxgraph/core` | 0.24.0 | 2026-07-08 | maintained successor, active. Browser/DOM rendering lib — **not** a headless validator. |
| npm `@mxgraph/*` | — | — | **scope does not exist on npm.** The brief's guess here is wrong. |
| npm `drawio-batch`, `mermaid-to-drawio` | — | — | **do not exist.** For mermaid, feed `.mmd` to `drawio -x` directly. |
| npm `@drawio/mcp` | 1.5.0 | 2026-07-19 | official jgraph MCP server; drives the editor, not a validator |
| npm `drawio-headless` | 0.4.2 | 2026-07-20 | Rust, no Electron, JSON→drawio→SVG/PNG. **0 stars, one month old — unproven, do not depend on it.** |
| pip `drawpyo` | 0.2.5 | 2025-12-28 | maintained (412 stars). **Write-only** — builds `.drawio`, no documented reader. |
| pip `graphviz2drawio` | 1.2.0 | 2026-07-09 | maintained; dot → drawio |
| pip `N2G` | 0.3.3 | 2023-02-11 | semi-dormant; reads/writes drawio XML for network graphs |
| pip `drawio`, `pydrawio`, `python-drawio`, `drawio-parser` | — | ≤2023 | dead |
| VS Code `hediet/vscode-drawio` | — | 2026-09-03 | alive (~9.5k stars); editor integration only |

```sh
npm install -g @maxgraph/core     # mxGraph successor (browser lib)
pip install drawpyo               # generate .drawio, write-only
pip install graphviz2drawio       # dot -> .drawio
```

For a generator, **you do not need any of these.** Emitting the XML yourself with a stdlib serializer is less code than learning drawpyo's object model, and gives you exact control over style strings — which is where all the difficulty actually is.

### 5.4 Smallest dependency-free structural validator

Python, stdlib only. Covers every silent failure mode in section 4.

```python
#!/usr/bin/env python3
"""Validate a .drawio file's structure. Exit 1 and print problems, or exit 0 silently."""
import sys, base64, zlib, urllib.parse
import xml.etree.ElementTree as ET

def page_model(diagram):
    """Return the <mxGraphModel> element for a <diagram>, inflating if compressed."""
    model = diagram.find("mxGraphModel")
    if model is not None:
        return model
    text = (diagram.text or "").strip()
    if not text:
        return None
    raw = urllib.parse.unquote(zlib.decompress(base64.b64decode(text), -15).decode("utf-8"))
    return ET.fromstring(raw)

def check(path, require_edge_labels=True, known_shapes=None):
    problems = []
    try:
        root = ET.parse(path).getroot()          # catches unescaped & / < and any malformed XML
    except ET.ParseError as e:
        return [f"XML parse error (likely an unescaped '&' or '<' in a label): {e}"]

    diagrams = root.findall("diagram") if root.tag == "mxfile" else []
    if not diagrams:
        return ["no <diagram> elements found; is the root element <mxfile>?"]

    for pi, diagram in enumerate(diagrams, 1):
        page = diagram.get("name") or f"#{pi}"
        if not diagram.get("id"):
            problems.append(f"[page {page}] <diagram> has no id")
        model = page_model(diagram)
        if model is None:
            problems.append(f"[page {page}] no <mxGraphModel>")
            continue
        cells = model.findall("./root/mxCell") + model.findall("./root/object")
        if not cells:
            problems.append(f"[page {page}] <root> has no cells")
            continue

        ids, seen = set(), set()
        for c in cells:
            cid = c.get("id")
            if cid is None:
                problems.append(f"[page {page}] cell with no id")
            elif cid in seen:
                problems.append(f"[page {page}] duplicate id {cid!r} (drawio will silently renumber one)")
            else:
                seen.add(cid); ids.add(cid)

        if "0" not in ids or "1" not in ids:
            problems.append(f"[page {page}] missing mandatory root cells: need id='0' and id='1' parent='0'")

        for c in cells:
            cid = c.get("id"); ref = f"[page {page}] cell {cid!r}"
            is_v, is_e = c.get("vertex") == "1", c.get("edge") == "1"
            parent = c.get("parent")

            if cid != "0":
                if parent is None:
                    problems.append(f"{ref}: no parent (drawio will make it the model root and DELETE cells 0/1)")
                elif parent not in ids:
                    problems.append(f"{ref}: parent {parent!r} does not exist (same catastrophic effect)")
                elif parent == cid:
                    problems.append(f"{ref}: parent == id (mxCodec throws 'Self Reference')")

            if is_v and is_e:
                problems.append(f"{ref}: both vertex='1' and edge='1'")

            geo = c.find("mxGeometry")
            if geo is not None and geo.get("as") != "geometry":
                problems.append(f"{ref}: <mxGeometry> missing as='geometry'")

            if is_v:
                if geo is None:
                    problems.append(f"{ref}: vertex has no <mxGeometry> (renders at zero size)")
                elif c.get("connectable") != "0":   # edge-label children legitimately lack w/h
                    for a in ("x", "y", "width", "height"):
                        if geo.get(a) is None:
                            problems.append(f"{ref}: vertex geometry missing {a}")

            if is_e:
                if geo is None:
                    problems.append(f"{ref}: edge has no <mxGeometry> (edge will NOT be drawn)")
                for end in ("source", "target"):
                    t = c.get(end)
                    if t is not None and t not in ids:
                        problems.append(f"{ref}: {end}={t!r} does not exist (drawio silently drops it; edge vanishes)")
                if c.get("source") is None and c.get("target") is None:
                    has_pts = geo is not None and any(
                        p.get("as") in ("sourcePoint", "targetPoint") for p in geo.findall("mxPoint"))
                    if not has_pts:
                        problems.append(f"{ref}: edge has no terminals and no terminal points (view discards it)")
                if require_edge_labels and not (c.get("value") or "").strip():
                    if not any(x.get("parent") == cid and x.get("vertex") == "1" for x in cells):
                        problems.append(f"{ref}: edge has no label")

            style = c.get("style") or ""
            for i, tok in enumerate(t for t in style.split(";") if t):
                if "=" not in tok and i != 0:
                    problems.append(f"{ref}: style token {tok!r} has no '=' (silently ignored)")
            if known_shapes is not None:
                for key in ("shape", "resIcon"):
                    for tok in style.split(";"):
                        if tok.startswith(key + "="):
                            name = tok.split("=", 1)[1]
                            if name.startswith("mxgraph.") and name not in known_shapes:
                                problems.append(f"{ref}: {key}={name!r} not in known shape list (renders blank)")
    return problems

if __name__ == "__main__":
    bad = False
    for p in sys.argv[1:]:
        for msg in check(p):
            print(f"{p}: {msg}"); bad = True
    sys.exit(1 if bad else 0)
```

Node equivalent: the only missing piece is an XML parser. `fast-xml-parser` is the smallest sane dependency; truly dependency-free, use `DOMParser` under `jsdom`, or regex only for the id-reference checks (fragile — not recommended for anything that must be correct).

### 5.5 Recommended validation pipeline

Three cheap stages, in order:

1. **`python3 validate_drawio.py out.drawio`** — catches every silent failure in section 4. Milliseconds, no dependencies.
2. **`drawio -x -f xml -o /tmp/rt.xml -u out.drawio` and diff against the input.** Any cell that draw.io renumbered, reparented, or stripped a terminal from shows up as a diff. This is the check that catches the class of corruption stage 1 might miss, because it asks draw.io itself what it thinks your model is.
3. **`drawio -x -f png -o /tmp/check.png --page-index N --scale 2 out.drawio` and look at it.** The only way to catch a valid-but-wrong icon.

Stage 2 is underused and is the strongest deterministic signal available — a byte-identical (modulo attribute ordering and added view-state defaults) round-trip means draw.io accepted your model exactly as written.

---

## Open questions

1. **Which duplicate id wins.** Confirmed that draw.io renumbers one of a colliding pair, but not *which* one an edge's `source`/`target` binds to before the renumber. Assumed last-write-wins in the codec's id map; not tested. Treat duplicate ids as always fatal in your validator rather than relying on a resolution order.
2. **Colliding `<diagram>` page ids.** `getPageById` returns the first match; whether anything else misbehaves (page links, background page references) is `UNVERIFIED:` — inferred from the absence of any de-duplication check, not tested.
3. **Exact compression encoding order.** deflateRaw + base64 over URL-encoded XML is what the inflate snippet in 1.4 assumes and it works on real files, but the precise body of `Graph.compress` was not read. Only matters if you need to *write* compressed files, which you should not.
4. **Where `mxfile` `modified` / `agent` / `etag` are stamped.** Not present in the client save path that was read; likely storage-backend specific. Irrelevant for generation — omit them.
5. **UI gesture → edge-label form mapping.** That typing on a selected edge writes Form A (`Graph.cellLabelChanged`) and that "add label" writes Form B (`Graph.addText`) is read from source, but the exact menu wording and which gesture triggers which was not confirmed by driving the GUI.
6. **Azure/GCP boundary container styles** (3.6, last block) are my own construction. No official Azure or GCP group/container palette ships with draw.io. They render correctly but are not brand-authoritative.
7. **Icon-set drift.** Everything here is from draw.io **31.3.2**. AWS restyled its icon set in the 2025 libraries — `Sidebar-AWS4.js`'s top-level `n2` uses a monochrome `fillColor=#232F3E`, while the per-category palettes still use the colour constants tabulated in 3.2. Shape *names* have been stable across recent versions; *colours* have not. Re-extract from the bundle if you target a much newer or older draw.io.
8. **`mxgraph.aws4` legacy overlap.** `Sidebar-AWS4b.js` (legacy AWS) reuses the same `mxgraph.aws4.*` stencil prefix with different surrounding styles, so a name resolving does not by itself tell you which icon generation you will get. Verify visually (3.5 method 2) for anything unusual.
