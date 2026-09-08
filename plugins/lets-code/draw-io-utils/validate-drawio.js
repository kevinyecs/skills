#!/usr/bin/env node
// Structural validator for .drawio files.
//
// Why this exists: exactly one way of corrupting a .drawio file fails loudly
// (an unescaped '&'). Every other corruption exits 0 and silently misrenders
// or mutates the model — an edge pointing at a missing id loses the edge and
// its label, a bad `parent` destroys cells 0 and 1 and deletes the rest of the
// page, and the file still exports a PNG. An agent reviewing its own diagram
// cannot see any of that. This can.
//
// Dependency free by design: Node has no built-in XML parser, so the scanner
// below is purpose built for the subset draw.io emits. It is not a general XML
// library and does not pretend to be — anything it cannot decide reliably is
// reported as a warning rather than passed.

const fs = require('fs');
const path = require('path');

const ERROR = 'error';
const WARN = 'warning';

// Check names. One per failure mode in the research matrix.
const CHECK = {
  XML: 'xml-not-well-formed',
  ESCAPE: 'unescaped-character',
  STRUCTURE: 'file-structure',
  PAGE_ID: 'page-id',
  PAGE_NAME: 'page-name',
  PAGE_MODEL: 'page-model',
  ROOT_CELLS: 'root-cells',
  CELL_ID: 'cell-id',
  DUPLICATE_ID: 'duplicate-cell-id',
  PARENT: 'parent-reference',
  VERTEX_EDGE: 'vertex-and-edge',
  GEOMETRY: 'geometry',
  EDGE_TERMINAL: 'edge-terminal',
  EDGE_LABEL: 'edge-label',
  ORPHAN: 'orphan-vertex',
  STYLE_TOKEN: 'style-token',
  SHAPE_NAME: 'shape-name',
};

const DRAWIO_EXT = '.drawio';
const SHAPES_FILE = path.join(__dirname, 'shapes.json');
// The five entities XML predefines. Anything else needs a DTD, which draw.io files do not have.
const VALID_ENTITY = /&(?:#[0-9]+|#x[0-9A-Fa-f]+|amp|lt|gt|quot|apos);/y;
const NAME_START = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
const GEOMETRY_ATTRS = ['x', 'y', 'width', 'height'];

// ---------------------------------------------------------------- XML scanner

class ParseError extends Error {}

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Parse the draw.io subset of XML into a tree.
 * @returns {{root: object, findings: object[]}} findings holds escaping warnings only;
 *          anything that would stop a real parser throws ParseError.
 */
function parseXml(text) {
  const starts = lineIndex(text);
  const findings = [];
  const root = { name: '#document', attrs: {}, children: [], text: '', line: 1 };
  const stack = [root];
  let i = 0;

  const fail = (offset, message) => {
    throw new ParseError(`line ${lineAt(starts, offset)}: ${message}`);
  };

  // Raw '&' must open a known entity; a raw '<' inside an attribute value is fatal.
  const checkChars = (value, offset, where) => {
    for (let k = 0; k < value.length; k++) {
      if (value[k] === '&') {
        VALID_ENTITY.lastIndex = k;
        if (!VALID_ENTITY.test(value)) {
          fail(offset + k, `unescaped '&' in ${where} (write &amp;)`);
        }
      } else if (value[k] === '>') {
        findings.push({
          severity: WARN,
          check: CHECK.ESCAPE,
          line: lineAt(starts, offset + k),
          message: `raw '>' in ${where}, should be &gt;`,
        });
      }
    }
  };

  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      checkChars(text.slice(i), i, 'text');
      break;
    }
    if (lt > i) {
      const chunk = text.slice(i, lt);
      checkChars(chunk, i, 'text');
      stack[stack.length - 1].text += chunk;
    }

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt);
      if (end < 0) fail(lt, 'unterminated comment');
      i = end + 3;
      continue;
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt);
      if (end < 0) fail(lt, 'unterminated processing instruction');
      i = end + 2;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt);
      if (end < 0) fail(lt, 'unterminated CDATA section');
      stack[stack.length - 1].text += text.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt);
      if (end < 0) fail(lt, 'unterminated declaration');
      i = end + 1;
      continue;
    }

    if (text.startsWith('</', lt)) {
      const name = (NAME_START.exec(text.slice(lt + 2)) || [])[0];
      if (!name) fail(lt, 'malformed closing tag');
      const end = text.indexOf('>', lt);
      if (end < 0) fail(lt, 'unterminated closing tag');
      const open = stack[stack.length - 1];
      if (stack.length === 1) fail(lt, `closing tag </${name}> with nothing open`);
      if (open.name !== name) fail(lt, `closing tag </${name}> does not match <${open.name}>`);
      stack.pop();
      i = end + 1;
      continue;
    }

    // Start tag.
    let j = lt + 1;
    const name = (NAME_START.exec(text.slice(j)) || [])[0];
    if (!name) fail(lt, "malformed tag (a bare '<' in text must be written &lt;)");
    j += name.length;

    const node = { name, attrs: {}, children: [], text: '', line: lineAt(starts, lt) };
    let selfClosing = false;

    for (;;) {
      while (j < text.length && /\s/.test(text[j])) j++;
      if (j >= text.length) fail(lt, `unterminated tag <${name}>`);
      if (text[j] === '>') { j++; break; }
      if (text[j] === '/' && text[j + 1] === '>') { selfClosing = true; j += 2; break; }

      const attr = (NAME_START.exec(text.slice(j)) || [])[0];
      if (!attr) fail(j, `malformed attribute in <${name}>`);
      j += attr.length;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] !== '=') fail(j, `attribute '${attr}' has no value`);
      j++;
      while (j < text.length && /\s/.test(text[j])) j++;
      const quote = text[j];
      if (quote !== '"' && quote !== "'") fail(j, `attribute '${attr}' value is not quoted`);
      const close = text.indexOf(quote, j + 1);
      if (close < 0) fail(j, `attribute '${attr}' value is not terminated`);
      const value = text.slice(j + 1, close);
      if (value.includes('<')) fail(j + 1, `raw '<' in attribute '${attr}' (write &lt;)`);
      checkChars(value, j + 1, `attribute '${attr}'`);
      node.attrs[attr] = unescapeXml(value);
      j = close + 1;
    }

    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = j;
  }

  if (stack.length > 1) {
    throw new ParseError(`unclosed element <${stack[stack.length - 1].name}>`);
  }
  return { root, findings };
}

function unescapeXml(value) {
  return value.replace(/&(#x?[0-9A-Fa-f]+|amp|lt|gt|quot|apos);/g, (whole, body) => {
    if (body === 'amp') return '&';
    if (body === 'lt') return '<';
    if (body === 'gt') return '>';
    if (body === 'quot') return '"';
    if (body === 'apos') return "'";
    const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  });
}

function childrenNamed(node, name) {
  return node.children.filter(c => c.name === name);
}

function firstNamed(node, name) {
  return node.children.find(c => c.name === name) || null;
}

// -------------------------------------------------------------- shape catalog

/**
 * Names we can vouch for, from shapes.json: the explicit lists plus every
 * shape=/resIcon= appearing in a catalogued style. Absent from this set does
 * not mean fake — the catalog is a verified subset, so misses are warnings.
 */
function loadCatalog() {
  try {
    const data = JSON.parse(fs.readFileSync(SHAPES_FILE, 'utf8'));
    const shapes = new Set(data.knownShapeNames || []);
    const images = new Set(data.knownAzureImages || []);
    const scan = value => {
      // Bare names in the catalog's own fields, plus anything inside a style string.
      if (value.startsWith('mxgraph.')) shapes.add(value);
      if (value.startsWith('img/lib/')) images.add(value);
      let m;
      const named = /(?:shape|resIcon|grIcon)=([^;]+)/g;
      while ((m = named.exec(value)) !== null) shapes.add(m[1]);
      const img = /image=([^;]+)/g;
      while ((m = img.exec(value)) !== null) images.add(m[1]);
    };
    const walk = node => {
      if (typeof node === 'string') return scan(node);
      if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(data);
    return { shapes, images };
  } catch (e) {
    return null; // No catalog: shape checks are skipped rather than guessed at.
  }
}

// -------------------------------------------------------------------- checks

function styleTokens(style) {
  return style.split(';').filter(Boolean);
}

function styleValue(style, key) {
  for (const token of styleTokens(style)) {
    if (token.startsWith(key + '=')) return token.slice(key.length + 1);
  }
  return null;
}

/** Flatten <object>/<UserObject> wrappers so every cell reads the same way. */
function collectCells(rootNode) {
  const cells = [];
  for (const child of rootNode.children) {
    if (child.name === 'mxCell') {
      cells.push({ attrs: child.attrs, node: child, line: child.line });
      continue;
    }
    if (child.name === 'object' || child.name === 'UserObject') {
      const inner = firstNamed(child, 'mxCell');
      if (!inner) continue;
      const attrs = Object.assign({}, inner.attrs, child.attrs);
      if (attrs.label !== undefined && attrs.value === undefined) attrs.value = attrs.label;
      cells.push({ attrs, node: inner, line: child.line });
    }
  }
  return cells;
}

function checkPage(diagram, pageLabel, add, catalog) {
  const model = firstNamed(diagram, 'mxGraphModel');
  if (!model) {
    if ((diagram.text || '').trim()) {
      add(WARN, CHECK.PAGE_MODEL, diagram.line, 'page content is compressed, structure cannot be validated; write uncompressed XML', pageLabel);
    } else {
      add(ERROR, CHECK.PAGE_MODEL, diagram.line, 'no <mxGraphModel> element', pageLabel);
    }
    return;
  }
  const modelRoot = firstNamed(model, 'root');
  if (!modelRoot) {
    add(ERROR, CHECK.PAGE_MODEL, model.line, '<mxGraphModel> has no <root>', pageLabel);
    return;
  }

  const cells = collectCells(modelRoot);
  if (cells.length === 0) {
    add(ERROR, CHECK.ROOT_CELLS, modelRoot.line, '<root> has no cells', pageLabel);
    return;
  }

  const ids = new Set();
  for (const cell of cells) {
    const id = cell.attrs.id;
    if (id === undefined) {
      add(ERROR, CHECK.CELL_ID, cell.line, 'cell has no id', pageLabel);
    } else if (ids.has(id)) {
      add(ERROR, CHECK.DUPLICATE_ID, cell.line, `duplicate id '${id}' (draw.io silently renumbers one, so cross references bind to the wrong cell)`, pageLabel);
    } else {
      ids.add(id);
    }
  }
  if (!ids.has('0') || !ids.has('1')) {
    add(ERROR, CHECK.ROOT_CELLS, modelRoot.line, "missing mandatory root cells: need id='0' and id='1' parent='0'", pageLabel);
  }

  const byId = new Map(cells.filter(c => c.attrs.id !== undefined).map(c => [c.attrs.id, c]));
  const hasChildren = new Set(cells.map(c => c.attrs.parent).filter(Boolean));
  const connected = new Set();
  for (const cell of cells) {
    if (cell.attrs.edge !== '1') continue;
    if (cell.attrs.source) connected.add(cell.attrs.source);
    if (cell.attrs.target) connected.add(cell.attrs.target);
  }

  for (const cell of cells) {
    checkCell(cell, { pageLabel, ids, byId, hasChildren, connected, add, catalog });
  }
}

function checkCell(cell, ctx) {
  const { pageLabel, ids, byId, hasChildren, connected, add, catalog } = ctx;
  const a = cell.attrs;
  const id = a.id;
  const at = (severity, check, message) => add(severity, check, cell.line, `cell '${id}': ${message}`, pageLabel);
  const isVertex = a.vertex === '1';
  const isEdge = a.edge === '1';

  if (id !== '0') {
    if (a.parent === undefined) {
      at(ERROR, CHECK.PARENT, 'no parent attribute (draw.io makes it the model root and DELETES cells 0 and 1, taking the rest of the page with them)');
    } else if (!ids.has(a.parent)) {
      at(ERROR, CHECK.PARENT, `parent '${a.parent}' does not exist (same catastrophic effect: cells 0 and 1 are destroyed)`);
    } else if (a.parent === id) {
      at(ERROR, CHECK.PARENT, "parent equals id (mxCodec throws 'Self Reference')");
    }
  }

  if (isVertex && isEdge) at(ERROR, CHECK.VERTEX_EDGE, "has both vertex='1' and edge='1'");

  const geo = firstNamed(cell.node, 'mxGeometry');
  if (geo && geo.attrs.as !== 'geometry') {
    at(ERROR, CHECK.GEOMETRY, "<mxGeometry> is missing as='geometry'");
  }

  if (isVertex) {
    if (!geo) {
      at(ERROR, CHECK.GEOMETRY, 'vertex has no <mxGeometry> (renders at zero size, only the label appears)');
    } else if (a.connectable !== '0') {
      for (const attr of GEOMETRY_ATTRS) {
        if (geo.attrs[attr] === undefined) at(ERROR, CHECK.GEOMETRY, `vertex geometry is missing ${attr}`);
      }
    }
  }

  if (isEdge) checkEdge(cell, geo, ctx, at);
  if (isVertex && !isEdge) checkOrphan(cell, { ids, byId, hasChildren, connected }, at);

  checkStyle(a.style || '', at, catalog);
}

function checkEdge(cell, geo, ctx, at) {
  const a = cell.attrs;
  if (!geo) at(ERROR, CHECK.GEOMETRY, 'edge has no <mxGeometry> (the edge is not drawn at all and its label lands at the canvas origin)');

  for (const end of ['source', 'target']) {
    const ref = a[end];
    if (ref !== undefined && !ctx.ids.has(ref)) {
      at(ERROR, CHECK.EDGE_TERMINAL, `${end}='${ref}' does not exist (draw.io silently strips it; the edge and its label vanish)`);
    }
  }

  if (a.source === undefined && a.target === undefined) {
    const points = geo ? childrenNamed(geo, 'mxPoint').map(p => p.attrs.as) : [];
    if (!points.includes('sourcePoint') && !points.includes('targetPoint')) {
      at(ERROR, CHECK.EDGE_TERMINAL, 'edge has no terminals and no terminal points (the view discards it)');
    }
  }

  // Every edge must say what happens on it. Form A is the value; Form B is a child label cell.
  if (!(a.value || '').trim()) {
    const hasLabelChild = [...ctx.byId.values()].some(c => c.attrs.parent === a.id && c.attrs.vertex === '1' && (c.attrs.value || '').trim());
    if (!hasLabelChild) at(ERROR, CHECK.EDGE_LABEL, 'edge has no label, every edge must say what happens on it');
  }
}

function checkOrphan(cell, ctx, at) {
  const a = cell.attrs;
  if (ctx.connected.has(a.id)) return;
  if (ctx.hasChildren.has(a.id)) return;                  // a container holding things
  if (styleValue(a.style || '', 'container') === '1') return;
  if (a.connectable === '0') return;                      // edge label or port
  const parent = ctx.byId.get(a.parent);
  if (parent && parent.attrs.edge === '1') return;        // edge label child
  at(ERROR, CHECK.ORPHAN, 'vertex is connected to nothing and contains nothing');
}

function checkStyle(style, at, catalog) {
  styleTokens(style).forEach((token, index) => {
    if (index === 0) return; // A bare first token is the shape name, which is legal.
    if (!token.includes('=')) at(WARN, CHECK.STYLE_TOKEN, `style token '${token}' has no '=' and is silently ignored`);
  });

  if (!catalog) return;
  for (const key of ['shape', 'resIcon', 'grIcon']) {
    const name = styleValue(style, key);
    if (name && name.startsWith('mxgraph.') && !catalog.shapes.has(name)) {
      at(WARN, CHECK.SHAPE_NAME, `${key}='${name}' is not in the verified shape catalog; if it is not a real stencil it renders as a blank coloured square. Verify it against the shipped stencil file or by rendering.`);
    }
  }
  const image = styleValue(style, 'image');
  if (image && image.startsWith('img/lib/') && !catalog.images.has(image)) {
    at(WARN, CHECK.SHAPE_NAME, `image='${image}' is not in the verified image catalog; a bad path renders as a broken-image placeholder.`);
  }
}

/**
 * Validate one .drawio file.
 * @returns {object[]} findings, each {file, page, line, severity, check, message}
 */
function validateFile(file, catalog) {
  const findings = [];
  const add = (severity, check, line, message, page) => {
    findings.push({ file, page: page || null, line: line || null, severity, check, message });
  };

  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    add(ERROR, CHECK.STRUCTURE, null, `cannot read file: ${e.message}`);
    return findings;
  }

  let parsed;
  try {
    parsed = parseXml(text);
  } catch (e) {
    add(ERROR, CHECK.XML, null, `XML is not well formed — ${e.message}`);
    return findings;
  }
  for (const f of parsed.findings) add(f.severity, f.check, f.line, f.message);

  const mxfile = firstNamed(parsed.root, 'mxfile');
  if (!mxfile) {
    add(ERROR, CHECK.STRUCTURE, null, 'root element is not <mxfile>');
    return findings;
  }

  const diagrams = childrenNamed(mxfile, 'diagram');
  if (diagrams.length === 0) {
    add(ERROR, CHECK.STRUCTURE, mxfile.line, '<mxfile> has no <diagram> pages');
    return findings;
  }

  const names = new Set();
  const pageIds = new Set();
  diagrams.forEach((diagram, index) => {
    const name = diagram.attrs.name;
    const label = name || `#${index + 1}`;
    if (!name) {
      add(ERROR, CHECK.PAGE_NAME, diagram.line, '<diagram> has no name attribute', label);
    } else if (names.has(name)) {
      add(ERROR, CHECK.PAGE_NAME, diagram.line, `duplicate page name '${name}'`, label);
    } else {
      names.add(name);
    }

    const pageId = diagram.attrs.id;
    if (!pageId) {
      add(ERROR, CHECK.PAGE_ID, diagram.line, '<diagram> has no id attribute', label);
    } else if (pageIds.has(pageId)) {
      add(ERROR, CHECK.PAGE_ID, diagram.line, `duplicate page id '${pageId}' (page links resolve to the first match)`, label);
    } else {
      pageIds.add(pageId);
    }

    checkPage(diagram, label, add, catalog);
  });

  return findings;
}

// ---------------------------------------------------------------------- CLI

function collectTargets(target) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch (e) {
    return null;
  }
  if (stat.isFile()) return [target];
  const found = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) walk(full);
      } else if (entry.name.endsWith(DRAWIO_EXT)) {
        found.push(full);
      }
    }
  };
  walk(target);
  return found;
}

function report(findings) {
  const errors = findings.filter(f => f.severity === ERROR);
  const warnings = findings.filter(f => f.severity === WARN);
  const lines = [];
  let currentFile = null;
  for (const f of findings) {
    if (f.file !== currentFile) {
      currentFile = f.file;
      lines.push(currentFile);
    }
    const where = [f.page ? `page ${f.page}` : null, f.line ? `line ${f.line}` : null].filter(Boolean).join(', ');
    lines.push(`  ${f.severity.toUpperCase()} ${f.check}${where ? ` (${where})` : ''}: ${f.message}`);
  }
  lines.push(`${errors.length} error(s), ${warnings.length} warning(s)`);
  return lines.join('\n');
}

function main(argv) {
  const asJson = argv.includes('--json');
  const targets = argv.filter(arg => !arg.startsWith('--'));
  if (targets.length === 0) {
    process.stderr.write('usage: validate-drawio.js [--json] <file.drawio | directory> ...\n');
    return 2;
  }

  const catalog = loadCatalog();
  const findings = [];
  for (const target of targets) {
    const files = collectTargets(target);
    if (files === null) {
      findings.push({ file: target, page: null, line: null, severity: ERROR, check: CHECK.STRUCTURE, message: 'path does not exist' });
      continue;
    }
    for (const file of files) findings.push(...validateFile(file, catalog));
  }

  const errors = findings.filter(f => f.severity === ERROR).length;
  if (asJson) {
    process.stdout.write(JSON.stringify({ ok: errors === 0, errors, warnings: findings.length - errors, findings }, null, 2) + '\n');
  } else if (findings.length === 0) {
    process.stdout.write('ok, no problems found\n');
  } else {
    process.stdout.write(report(findings) + '\n');
  }
  return errors > 0 ? 1 : 0;
}

if (require.main === module) {
  let code = 0;
  try {
    code = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`validate-drawio: internal failure: ${e && e.message}\n`);
    code = 2;
  }
  process.exit(code);
}

module.exports = { CHECK, ERROR, WARN, parseXml, validateFile, loadCatalog, report, main };
