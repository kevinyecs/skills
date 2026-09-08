#!/usr/bin/env node
// Self check for validate-drawio.js. assert only, no framework.
//
// Each fixture is one row of the research's failure matrix, built inline and
// written to a temp file. If a check regresses, the fixture stops being caught
// and this exits non-zero.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { CHECK, ERROR, WARN, validateFile, loadCatalog } = require('./validate-drawio.js');

const catalog = loadCatalog();
const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-validate-'));
let failures = 0;

function validate(xml) {
  const file = path.join(tmpdir, `case-${Math.random().toString(36).slice(2)}.drawio`);
  fs.writeFileSync(file, xml);
  return validateFile(file, catalog);
}

function checksIn(findings, severity) {
  return findings.filter(f => f.severity === severity).map(f => f.check);
}

function run(name, fn) {
  try {
    fn();
    process.stdout.write(`ok   ${name}\n`);
  } catch (e) {
    failures++;
    process.stdout.write(`FAIL ${name}\n     ${e.message}\n`);
  }
}

/** Assert the given check fired at error level, and nothing unrelated blew up. */
function catches(name, xml, check) {
  run(name, () => {
    const errors = checksIn(validate(xml), ERROR);
    assert.ok(errors.includes(check), `expected error '${check}', got [${errors.join(', ')}]`);
  });
}

function warns(name, xml, check) {
  run(name, () => {
    const findings = validate(xml);
    assert.ok(checksIn(findings, WARN).includes(check), `expected warning '${check}', got [${checksIn(findings, WARN).join(', ')}]`);
  });
}

// --------------------------------------------------------------- fixtures

const AWS_LAMBDA = 'sketch=0;outlineConnect=0;fontColor=#232F3E;fillColor=#ED7100;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;';
const AWS_S3 = AWS_LAMBDA.replace('#ED7100', '#7AA116').replace('resIcon=mxgraph.aws4.lambda', 'resIcon=mxgraph.aws4.s3');
const AWS_VPC_GROUP = 'points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;fontStyle=0;container=1;pointerEvents=0;collapsible=0;recursiveResize=0;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_vpc2;strokeColor=#8C4FFF;fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#AAB7B8;dashed=0;';
const AZ_GROUP = 'fillColor=none;strokeColor=#147EBA;dashed=1;verticalAlign=top;fontStyle=0;fontColor=#147EBA;whiteSpace=wrap;html=1;container=1;collapsible=0;';
const EDGE = 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;';

/** A single page whose <root> body is supplied by the caller. */
function page(body, { name = 'Page-1', id = 'p1' } = {}) {
  return `<mxfile host="app.diagrams.net">
  <diagram id="${id}" name="${name}">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageWidth="850" pageHeight="1100">
      <root>
${body}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
}

const ROOT_CELLS = '        <mxCell id="0" />\n        <mxCell id="1" parent="0" />';

function twoBoxes(edgeAttrs = 'source="a" target="b"', edgeBody = '<mxGeometry relative="1" as="geometry" />', edgeValue = 'calls over HTTPS') {
  return page(`${ROOT_CELLS}
        <mxCell id="a" value="API" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry" /></mxCell>
        <mxCell id="b" value="Worker" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="320" y="40" width="120" height="60" as="geometry" /></mxCell>
        <mxCell id="e1" value="${edgeValue}" style="${EDGE}" edge="1" parent="1" ${edgeAttrs}>${edgeBody}</mxCell>`);
}

// The known-good file: two pages, five levels of nesting, escaped ampersand.
const GOOD = `<mxfile host="app.diagrams.net">
  <diagram id="infra" name="Infrastructure">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="vpc" value="VPC 10.0.0.0/16" style="${AWS_VPC_GROUP}" vertex="1" parent="1">
          <mxGeometry x="20" y="20" width="520" height="380" as="geometry" />
        </mxCell>
        <mxCell id="az" value="eu-west-1a" style="${AZ_GROUP}" vertex="1" parent="vpc">
          <mxGeometry x="20" y="40" width="480" height="300" as="geometry" />
        </mxCell>
        <mxCell id="lam" value="Order processor" style="${AWS_LAMBDA}" vertex="1" parent="az">
          <mxGeometry x="40" y="60" width="78" height="78" as="geometry" />
        </mxCell>
        <mxCell id="s3" value="Receipts bucket" style="${AWS_S3}" vertex="1" parent="az">
          <mxGeometry x="300" y="60" width="78" height="78" as="geometry" />
        </mxCell>
        <mxCell id="e1" value="writes object &amp; emits event" style="${EDGE}" edge="1" parent="az" source="lam" target="s3">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
  <diagram id="flow" name="Checkout flow">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="client" value="Client" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="40" y="40" width="120" height="60" as="geometry" />
        </mxCell>
        <mxCell id="api" value="Checkout API" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="320" y="40" width="120" height="60" as="geometry" />
        </mxCell>
        <mxCell id="ce" value="POST /orders" style="${EDGE}" edge="1" parent="1" source="client" target="api">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

// ------------------------------------------------------------------ cases

run('known good multi page file with nested containers passes clean', () => {
  const findings = validate(GOOD);
  assert.deepStrictEqual(findings.filter(f => f.severity === ERROR), [], JSON.stringify(findings, null, 2));
  assert.deepStrictEqual(findings, [], `expected zero findings, got ${JSON.stringify(findings, null, 2)}`);
});

catches('unescaped & in a label', twoBoxes().replace('calls over HTTPS', 'extract & load'), CHECK.XML);
catches('unescaped < in a label', twoBoxes().replace('calls over HTTPS', 'a < b'), CHECK.XML);
catches('unknown entity in a label', twoBoxes().replace('calls over HTTPS', 'a&nbsp;b'), CHECK.XML);
catches('unescaped & in a style string', twoBoxes().replace('rounded=0;whiteSpace=wrap;html=1;', 'rounded=0;label=a&b;'), CHECK.XML);
catches('mismatched tags', twoBoxes().replace('</mxfile>', '</mxfyle>'), CHECK.XML);
catches('unterminated attribute quote', twoBoxes().replace('id="a"', 'id="a'), CHECK.XML);

warns('raw > in a label', twoBoxes().replace('calls over HTTPS', 'a > b'), CHECK.ESCAPE);

// The escaped forms must NOT trip the escaping checks.
run('escaped &amp; and &lt; are accepted', () => {
  const findings = validate(twoBoxes().replace('calls over HTTPS', 'extract &amp; load &lt;batch&gt;'));
  assert.deepStrictEqual(findings, [], JSON.stringify(findings, null, 2));
});

catches('duplicate cell id', page(`${ROOT_CELLS}
        <mxCell id="a" value="A" style="rounded=0;html=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry" /></mxCell>
        <mxCell id="a" value="A2" style="rounded=0;html=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry" /></mxCell>
        <mxCell id="e" value="l" style="${EDGE}" edge="1" parent="1" source="a" target="a"><mxGeometry relative="1" as="geometry" /></mxCell>`), CHECK.DUPLICATE_ID);

catches('edge target names a non-existent cell', twoBoxes('source="a" target="NOPE"'), CHECK.EDGE_TERMINAL);
catches('edge source names a non-existent cell', twoBoxes('source="NOPE" target="b"'), CHECK.EDGE_TERMINAL);
catches('edge with no terminals and no terminal points', twoBoxes(''), CHECK.EDGE_TERMINAL);

run('dangling edge with a targetPoint is allowed', () => {
  const xml = twoBoxes('source="a"', '<mxGeometry relative="1" as="geometry"><mxPoint x="400" y="80" as="targetPoint" /></mxGeometry>');
  const errors = checksIn(validate(xml), ERROR);
  assert.ok(!errors.includes(CHECK.EDGE_TERMINAL), `unexpected terminal error: [${errors.join(', ')}]`);
});

catches('parent names a non-existent cell', twoBoxes().replace('id="a" value="API" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"', 'id="a" value="API" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="ghost"'), CHECK.PARENT);
catches('parent attribute missing', twoBoxes().replace('id="b" value="Worker" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"', 'id="b" value="Worker" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1"'), CHECK.PARENT);
catches('parent equals id', twoBoxes().replace('id="b" value="Worker" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"', 'id="b" value="Worker" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="b"'), CHECK.PARENT);

catches('missing root cells 0 and 1', page(`        <mxCell id="a" value="A" style="rounded=0;html=1;" vertex="1" parent="0"><mxGeometry x="0" y="0" width="10" height="10" as="geometry" /></mxCell>`), CHECK.ROOT_CELLS);

catches('edge with no mxGeometry', twoBoxes('source="a" target="b"', ''), CHECK.GEOMETRY);
catches('vertex with no mxGeometry', twoBoxes().replace('<mxGeometry x="40" y="40" width="120" height="60" as="geometry" />', ''), CHECK.GEOMETRY);
catches('vertex geometry missing width', twoBoxes().replace('<mxGeometry x="40" y="40" width="120" height="60" as="geometry" />', '<mxGeometry x="40" y="40" height="60" as="geometry" />'), CHECK.GEOMETRY);
catches("mxGeometry missing as='geometry'", twoBoxes('source="a" target="b"', '<mxGeometry relative="1" />'), CHECK.GEOMETRY);

catches('edge with no label', twoBoxes('source="a" target="b"', '<mxGeometry relative="1" as="geometry" />', ''), CHECK.EDGE_LABEL);

run('edge labelled by a Form B child cell passes', () => {
  const xml = page(`${ROOT_CELLS}
        <mxCell id="a" value="A" style="rounded=0;html=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry" /></mxCell>
        <mxCell id="b" value="B" style="rounded=0;html=1;" vertex="1" parent="1"><mxGeometry x="90" y="0" width="10" height="10" as="geometry" /></mxCell>
        <mxCell id="e" style="${EDGE}" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry" /></mxCell>
        <mxCell id="e-label" value="publishes an event" style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];" vertex="1" connectable="0" parent="e"><mxGeometry x="-0.2" y="2" relative="1" as="geometry"><mxPoint as="offset" /></mxGeometry></mxCell>`);
  const errors = checksIn(validate(xml), ERROR);
  assert.deepStrictEqual(errors, [], `expected no errors, got [${errors.join(', ')}]`);
});

catches('orphan vertex connected to nothing', page(`${ROOT_CELLS}
        <mxCell id="a" value="A" style="rounded=0;html=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry" /></mxCell>
        <mxCell id="b" value="B" style="rounded=0;html=1;" vertex="1" parent="1"><mxGeometry x="90" y="0" width="10" height="10" as="geometry" /></mxCell>
        <mxCell id="lonely" value="Nobody talks to me" style="rounded=0;html=1;" vertex="1" parent="1"><mxGeometry x="200" y="0" width="10" height="10" as="geometry" /></mxCell>
        <mxCell id="e" value="l" style="${EDGE}" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry" /></mxCell>`), CHECK.ORPHAN);

catches('duplicate page name', GOOD.replace('name="Checkout flow"', 'name="Infrastructure"'), CHECK.PAGE_NAME);
catches('missing page name', GOOD.replace(' name="Checkout flow"', ''), CHECK.PAGE_NAME);
catches('duplicate page id', GOOD.replace('id="flow"', 'id="infra"'), CHECK.PAGE_ID);
catches('missing page id', GOOD.replace('<diagram id="flow"', '<diagram'), CHECK.PAGE_ID);

catches('root element is not mxfile', '<root><mxCell id="0" /></root>', CHECK.STRUCTURE);
catches('mxfile with no pages', '<mxfile host="app.diagrams.net"></mxfile>', CHECK.STRUCTURE);
catches('page with no mxGraphModel', '<mxfile host="app.diagrams.net"><diagram id="p" name="P"></diagram></mxfile>', CHECK.PAGE_MODEL);

warns('compressed page cannot be structurally validated', '<mxfile host="app.diagrams.net"><diagram id="p" name="P">7VjLcpswFP0aLzsDKDws4zTdddFFF10qIINaGVEhx7hfXwld8ZLtOG2cSTvNJujcB9K5D8FiE23q3XtB2+ojLxlfBF65W0S3iyAgKUnUP43sDRImxAClELQ0mDcCX+kvBqBrpFtass4xlJxzSVsXLHjTsEI6GBWCP7tmG87dt7a0ZBPga0H5FP1CS1kBGqZeb/GB0bLCd8cJGGqKxgB0FS35swMt7hbRRnAuzVO925hEc8+HAX07Yh32JVgjLwn4kfHo7uslyzoowwiRPZDA97xrpASccG5ULiOybgUvt4XkAmxyj0RxlqIn0aTMgw2VtGmuaydwsWccjw8QzYSlIiLpVSp3nDbSNIfvL9Y2A2R/lQIw7wPfSPDvbAOaVQu2plyi3hAZ+PgKZFOgqW3s0RchLoPYIB5eOMLCkyMsPDPCsplhvbcFHKZ9UOSSl7z16BLCU2NM4/+jTHXFSDXtiaMdUmruH+d/wRRVDpaeSU7ycb1SS3TSLBBUvY9EfUEK0jgO4mS1XiWr1L5g89rOfyt31yq5LDb0OQnXqSNhnCXsr6vJdVvOWNGFThNS2SbUsu5w6b1uu8xUw1i0EUcGGkiTV0K1URl1yj+Ynz1rpXvOhAdEG0OO3Xjb3nJcRXEs1ANbXfUpZaVBLyIhtIvbQ+2wR9hzuLWBSuOWNUw1UukcOSjqz5+/aVLWlwavCC4YEcLYbBQrztUgYQ0EJK/nAf29ZBqOoolYRtVwLnUFmVFRUdWDwuMFH8lYlSk1AA3z+PBWD8VjS5hjEwedDDG7ppOWo4L7BFEeziq++qOMmuLR1DUFqYVoLBjkA1XdxCTraDcQuEXtjKKtvhhZ+dpuXQIkkQq3rp9CtOK/QIhLbTIrjP5FL06/AQ==</diagram></mxfile>', CHECK.PAGE_MODEL);

warns('style token with no equals sign', twoBoxes().replace('rounded=0;whiteSpace=wrap;html=1;', 'rounded=0;whiteSpace;html=1;'), CHECK.STYLE_TOKEN);
warns('resIcon that is not in the shape catalog', twoBoxes().replace('rounded=0;whiteSpace=wrap;html=1;', AWS_LAMBDA.replace('mxgraph.aws4.lambda', 'mxgraph.aws4.lamdba')), CHECK.SHAPE_NAME);
warns('azure image path that is not in the catalog', twoBoxes().replace('rounded=0;whiteSpace=wrap;html=1;', 'image;aspect=fixed;html=1;points=[];align=center;fontSize=12;image=img/lib/azure2/compute/Not_A_Real_Service.svg;'), CHECK.SHAPE_NAME);

run('a catalogued azure image path does not warn', () => {
  const xml = twoBoxes().replace('rounded=0;whiteSpace=wrap;html=1;', 'image;aspect=fixed;html=1;points=[];align=center;fontSize=12;image=img/lib/azure2/containers/Kubernetes_Services.svg;');
  assert.deepStrictEqual(validate(xml), []);
});

run('warnings alone do not count as errors', () => {
  const findings = validate(twoBoxes().replace('calls over HTTPS', 'a > b'));
  assert.strictEqual(findings.filter(f => f.severity === ERROR).length, 0);
  assert.ok(findings.length > 0);
});

run('the good file also passes through a directory scan', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-dir-'));
  fs.writeFileSync(path.join(dir, 'diagram.drawio'), GOOD);
  fs.writeFileSync(path.join(dir, 'notes.md'), 'ignored');
  const { main } = require('./validate-drawio.js');
  assert.strictEqual(main([dir, '--json']), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

fs.rmSync(tmpdir, { recursive: true, force: true });

if (failures > 0) {
  process.stdout.write(`\n${failures} test(s) failed\n`);
  process.exit(1);
}
process.stdout.write('\nall tests passed\n');
