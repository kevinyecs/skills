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
  CANVAS: 'canvas',
  FONT_CONTRAST: 'font-contrast',
  NODE_OVERLAP: 'node-overlap',
  LABEL_COLLISION: 'label-collision',
  EDGE_CROSSES_NODE: 'edge-crosses-node',
  PAGE_SHAPE: 'page-shape',
};

const DRAWIO_EXT = '.drawio';
const SHAPES_FILE = path.join(__dirname, 'shapes.json');
// The five entities XML predefines. Anything else needs a DTD, which draw.io files do not have.
const VALID_ENTITY = /&(?:#[0-9]+|#x[0-9A-Fa-f]+|amp|lt|gt|quot|apos);/y;
const NAME_START = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
const GEOMETRY_ATTRS = ['x', 'y', 'width', 'height'];

// ------------------------------------------------- readability constants
// Every threshold and margin the readability checks use is named here, with the
// reason for the number. None of them are inlined at the call site.

// draw.io renders a missing `background` as transparent, and a dark-mode viewer
// paints its own dark surface behind it. White is the only value that renders
// the same everywhere, and it is the surface the contrast check assumes.
const REQUIRED_BACKGROUND = '#ffffff';

// The editor grid is chrome, not content, and it exports into the PNG. A page
// meant to be read gets visual noise it never asked for, so the grid is off.
const REQUIRED_GRID = '0';

// Minimum contrast of label text against the surface it sits on. 3:1 is the
// WCAG 2.1 large-text / non-text minimum. It is the right cut here rather than
// the 4.5:1 body-text figure because AWS's own official container palette sits
// between 3.0 and 5.4 against white (#00A4A6 is 3.06, #147EBA is 4.45), and
// rejecting the official palette wholesale would be noise. It still rejects
// what this check exists for: #AAB7B8 is 2.07 and #ffffff is 1.0.
const MIN_CONTRAST_RATIO = 3;

// draw.io's label font size when the style omits fontSize.
const DEFAULT_FONT_SIZE = 12;

// Average glyph advance as a fraction of font size, for draw.io's default
// Helvetica at mixed case. Real advances run about 0.45-0.6em for lowercase
// prose; 0.5 is the middle of that band.
const CHAR_WIDTH_RATIO = 0.5;

// Line box height as a fraction of font size. draw.io's default line-height is 1.2.
const LINE_HEIGHT_RATIO = 1.2;

// Estimated label boxes are shrunk to this fraction of the estimate, about their
// own centre, before intersecting anything. There are no font metrics here, so
// the estimate is wrong in both directions; a false positive blocks a good
// diagram, which is worse than missing a marginal collision. 0.6 means only an
// overlap well inside the estimate's error bars is reported.
const LABEL_SHRINK = 0.6;

// A page is read fitted to a screen, so its aspect ratio decides how much of the
// available scale the drawing gets. A 16:9 screen is 1.78:1. A page wider than
// that is width limited and gets only 1.78/ratio of the screen height, so its
// text renders at that fraction of full size. 2.5:1 leaves 71% of it, which
// still reads. The measured failures do not: 3.24:1 leaves 55% and 7.86:1 leaves
// 23%, which is a 12px label drawn at under 3px. The two known-good pages this
// came from sit at 1.54 and 1.59, so the gap between good and bad is wide and
// 2.5 is a judgement call inside it, deliberately at the bad end so a page that
// is merely oblong is not blocked.
const MAX_PAGE_ASPECT = 2.5;

// The ratio is measured long side over short side, so a very tall page is judged
// by the same number. Tall is not the safer direction: a screen is landscape, so
// a 1:2.5 page is height limited and loses at least as much scale as a 2.5:1 one.

// Below this the check does not apply. A page whose long side is under 1200px
// fits a normal viewport at full size, so nothing is shrunk and its shape costs
// no readability whatever it is. Three plain boxes at the 400px column pitch are
// 1000 wide, so a two or three node page is never judged on shape.
const MIN_PAGE_LONG_SIDE = 1200;

// Wrapping a chain of n boxes into rows of k is about 400k wide and 200n/k tall
// at the reference pitch, so the ratio is 2k*k/n. Solving 2k*k/n <=
// MAX_PAGE_ASPECT gives the widest row that still lands inside the limit. Quoted
// in the finding so the fix is arithmetic rather than taste.
const MIN_NODES_PER_ROW = 2;

// Colours the checks understand. Anything else (named colours, gradients,
// 'none', 'default') is treated as unknown rather than guessed at.
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const HTML_BREAK = /<br\s*\/?>/gi;
const HTML_INLINE = /<\/?(?:b|i|u|em|strong|div|p|span|font)\b[^>]*>/gi;

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

// ------------------------------------------------- geometry and colour helpers
// Shared by every readability check so the rectangle maths exists once.

function num(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Geometry exactly as written on the cell, before any parent offset. */
function localRect(cell) {
  const geo = firstNamed(cell.node, 'mxGeometry');
  if (!geo) return null;
  if (geo.attrs.relative === '1') return null; // ports and edge labels: x/y are fractions, not pixels
  const w = num(geo.attrs.width);
  const h = num(geo.attrs.height);
  if (w === null || h === null || w <= 0 || h <= 0) return null;
  return { x: num(geo.attrs.x, 0), y: num(geo.attrs.y, 0), w, h };
}

/**
 * Page coordinates of a vertex. draw.io child geometry is relative to the
 * parent's origin, so every ancestor offset has to be accumulated before two
 * cells from different containers can be compared at all.
 * The cache doubles as a cycle guard: a self-parented or looped cell resolves
 * to null instead of recursing forever.
 */
function absoluteRect(cell, byId, cache) {
  const id = cell.attrs.id;
  if (cache.has(id)) return cache.get(id);
  cache.set(id, null);
  const local = localRect(cell);
  if (!local) return null;
  let { x, y } = local;
  const parent = byId.get(cell.attrs.parent);
  if (parent && parent.attrs.vertex === '1') {
    const outer = absoluteRect(parent, byId, cache);
    if (outer) { x += outer.x; y += outer.y; }
  }
  const rect = { x, y, w: local.w, h: local.h };
  cache.set(id, rect);
  return rect;
}

/** Origin a cell's own coordinates are measured from. */
function parentOrigin(cell, byId, cache) {
  const parent = byId.get(cell.attrs.parent);
  const rect = parent && parent.attrs.vertex === '1' ? absoluteRect(parent, byId, cache) : null;
  return rect ? { x: rect.x, y: rect.y } : { x: 0, y: 0 };
}

function intersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function centre(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function boxAround(point, w, h) {
  return { x: point.x - w / 2, y: point.y - h / 2, w, h };
}

function turn(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Proper crossing only: two segments that merely touch end to end do not count. */
function segmentsCross(a, b, c, d) {
  const d1 = turn(a, b, c);
  const d2 = turn(a, b, d);
  const d3 = turn(c, d, a);
  const d4 = turn(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentHitsRect(p, q, r) {
  const inside = pt => pt.x > r.x && pt.x < r.x + r.w && pt.y > r.y && pt.y < r.y + r.h;
  if (inside(p) || inside(q)) return true;
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  for (let i = 0; i < 4; i++) {
    if (segmentsCross(p, q, corners[i], corners[(i + 1) % 4])) return true;
  }
  return false;
}

/** #rgb or #rrggbb to [r,g,b]. Anything else is unknown, not black. */
function parseColor(value) {
  if (typeof value !== 'string') return null;
  const m = HEX_COLOR.exec(value.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
}

/** WCAG 2.1 relative luminance. */
function relativeLuminance(rgb) {
  const channel = v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The surface a cell's label is actually drawn on. An AWS resourceIcon tile
 * carries verticalLabelPosition=bottom, which puts the label on the canvas
 * BELOW the coloured tile — so a coloured fill there is irrelevant and the
 * label needs to read against white. Only a label drawn inside an opaque fill
 * gets to be measured against that fill.
 */
function labelSurface(style) {
  if (styleValue(style, 'verticalLabelPosition') === 'bottom') return REQUIRED_BACKGROUND;
  if (styleValue(style, 'verticalLabelPosition') === 'top') return REQUIRED_BACKGROUND;
  if (styleValue(style, 'labelPosition') === 'right' || styleValue(style, 'labelPosition') === 'left') return REQUIRED_BACKGROUND;
  const fill = styleValue(style, 'fillColor');
  return parseColor(fill) ? fill : REQUIRED_BACKGROUND;
}

/** Visible text of a label: <br> becomes a line break, inline tags disappear. */
function labelLines(value) {
  return String(value).replace(HTML_BREAK, '\n').replace(HTML_INLINE, '').split('\n');
}

/**
 * Estimated text box, centred on `point`, already shrunk by LABEL_SHRINK.
 * There are no font metrics available, so this is length x fontSize arithmetic
 * and nothing more.
 */
function estimateLabelBox(value, style, point) {
  const lines = labelLines(value);
  const longest = lines.reduce((n, line) => Math.max(n, line.trim().length), 0);
  if (longest === 0) return null;
  const size = num(styleValue(style, 'fontSize'), DEFAULT_FONT_SIZE) || DEFAULT_FONT_SIZE;
  return boxAround(
    point,
    longest * size * CHAR_WIDTH_RATIO * LABEL_SHRINK,
    lines.length * size * LINE_HEIGHT_RATIO * LABEL_SHRINK,
  );
}

/** Both ends of an edge in page coordinates, from terminals or terminal points. */
function edgeEnds(edge, byId, cache) {
  const geo = firstNamed(edge.node, 'mxGeometry');
  const origin = parentOrigin(edge, byId, cache);
  const end = which => {
    const terminal = byId.get(edge.attrs[which]);
    const rect = terminal ? absoluteRect(terminal, byId, cache) : null;
    if (rect) return centre(rect);
    const point = geo ? childrenNamed(geo, 'mxPoint').find(p => p.attrs.as === `${which}Point`) : null;
    if (!point) return null;
    return { x: origin.x + num(point.attrs.x, 0), y: origin.y + num(point.attrs.y, 0) };
  };
  const source = end('source');
  const target = end('target');
  return source && target ? { source, target } : null;
}

function offsetPoint(geo) {
  const point = geo ? childrenNamed(geo, 'mxPoint').find(p => p.attrs.as === 'offset') : null;
  return point ? { x: num(point.attrs.x, 0), y: num(point.attrs.y, 0) } : { x: 0, y: 0 };
}

/**
 * Where a label sits on its edge. Default is the midpoint of the straight line
 * between the terminals; `relative` x slides it along that line (-1..1, 0 is the
 * centre), `relative` y and any <mxPoint as="offset"/> move it in pixels.
 */
function labelAnchor(ends, geo) {
  const offset = offsetPoint(geo);
  const along = geo && geo.attrs.relative === '1' ? num(geo.attrs.x, 0) : 0;
  const t = Math.min(1, Math.max(0, (along + 1) / 2));
  const orthogonal = geo && geo.attrs.relative === '1' ? num(geo.attrs.y, 0) : 0;
  return {
    x: ends.source.x + (ends.target.x - ends.source.x) * t + offset.x,
    y: ends.source.y + (ends.target.y - ends.source.y) * t + offset.y + orthogonal,
  };
}

/**
 * A vertex a label or edge must not run over. Containers are excluded: a label
 * inside a region or VPC box is expected, not a collision. So are edge labels
 * and ports (connectable='0'), and any cell holding children.
 */
function isSolidVertex(cell, hasChildren) {
  if (cell.attrs.vertex !== '1' || cell.attrs.edge === '1') return false;
  if (cell.attrs.connectable === '0') return false;
  if (styleValue(cell.attrs.style || '', 'container') === '1') return false;
  return !hasChildren.has(cell.attrs.id);
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
  checkCanvas(model, pageLabel, add);

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

  checkLayout(cells, { pageLabel, byId, hasChildren, add, line: model.line });
}

function checkCanvas(model, pageLabel, add) {
  const background = model.attrs.background;
  if (background === undefined || background === '' || background === 'none') {
    add(ERROR, CHECK.CANVAS, model.line, `<mxGraphModel> has no background attribute; the canvas exports transparent and a dark-mode viewer paints it dark, so dark labels vanish. Set background="${REQUIRED_BACKGROUND}"`, pageLabel);
  } else {
    const rgb = parseColor(background);
    if (!rgb || rgb[0] !== 255 || rgb[1] !== 255 || rgb[2] !== 255) {
      add(ERROR, CHECK.CANVAS, model.line, `background='${background}' is not white; the palette and the contrast check both assume ${REQUIRED_BACKGROUND}`, pageLabel);
    }
  }

  const grid = model.attrs.grid;
  if (grid !== REQUIRED_GRID) {
    add(ERROR, CHECK.CANVAS, model.line, `<mxGraphModel> has grid='${grid === undefined ? 'absent' : grid}'; the grid is editor chrome that exports into the PNG and adds visual noise to a diagram meant to be read. Set grid="${REQUIRED_GRID}"`, pageLabel);
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
  if (isVertex || isEdge) checkFontContrast(a, isEdge, at);
}

/**
 * Every cell that renders text needs an explicit fontColor dark enough to read.
 * Explicit, because draw.io's default label colour is not written to the file
 * and a dark-mode viewer flips it to white — on the mandated white canvas that
 * is white on white. Dark enough, by luminance rather than a colour blacklist.
 */
function checkFontContrast(a, isEdge, at) {
  if (!(a.value || '').trim()) return;
  const style = a.style || '';
  const declared = styleValue(style, 'fontColor');
  if (!declared) {
    at(ERROR, CHECK.FONT_CONTRAST, "renders a label with no fontColor in its style; draw.io's implicit default is inverted to white in a dark-mode viewer, so the label disappears on the white canvas. Set an explicit dark fontColor");
    return;
  }
  const font = parseColor(declared);
  if (!font) return; // a colour this checker cannot read is not a colour it will guess at
  // An edge label is drawn on the canvas, never on a fill.
  const surface = parseColor(isEdge ? REQUIRED_BACKGROUND : labelSurface(style));
  if (!surface) return;
  const ratio = contrastRatio(font, surface);
  if (ratio < MIN_CONTRAST_RATIO) {
    at(ERROR, CHECK.FONT_CONTRAST, `fontColor='${declared}' has ${ratio.toFixed(2)}:1 contrast against the surface it is drawn on, below the ${MIN_CONTRAST_RATIO}:1 minimum. Note that on a resourceIcon tile the label sits BELOW the tile, so the tile's fill does not help it`);
  }
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

/**
 * The three geometric readability checks. They share one absolute-rect cache so
 * every parent chain is walked once per page.
 */
function checkLayout(cells, ctx) {
  const { pageLabel, byId, hasChildren, add, line } = ctx;
  const cache = new Map();
  const rectOf = cell => absoluteRect(cell, byId, cache);

  checkNodeOverlap(cells, rectOf, pageLabel, add);
  checkPageShape(cells, rectOf, pageLabel, line, add);

  const solid = cells
    .filter(c => isSolidVertex(c, hasChildren))
    .map(c => ({ cell: c, rect: rectOf(c) }))
    .filter(entry => entry.rect);

  const labels = collectEdgeLabels(cells, byId, cache);
  checkLabelCollision(labels, solid, pageLabel, add);
  checkEdgeCrossings(cells, solid, byId, cache, pageLabel, add);
}

/**
 * Two vertices whose rectangles intersect. Exact, no estimation.
 * Only siblings are compared, which is what makes the expected nestings safe:
 * a child inside its container, and a cell against its own parent, are never a
 * pair here. Coordinates are resolved to page space first because a sibling
 * pair still has to be measured in a common frame.
 */
function checkNodeOverlap(cells, rectOf, pageLabel, add) {
  const placed = cells
    .filter(c => c.attrs.vertex === '1' && c.attrs.edge !== '1' && c.attrs.connectable !== '0')
    .map(c => ({ cell: c, rect: rectOf(c) }))
    .filter(entry => entry.rect);

  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (a.cell.attrs.parent !== b.cell.attrs.parent) continue;
      if (!intersects(a.rect, b.rect)) continue;
      add(ERROR, CHECK.NODE_OVERLAP, b.cell.line,
        `cell '${b.cell.attrs.id}' overlaps sibling '${a.cell.attrs.id}': ${describeRect(b.rect)} intersects ${describeRect(a.rect)}. Move one of them`,
        pageLabel);
    }
  }
}

/**
 * The shape of the whole page, from the same absolute rects the overlap check
 * uses. A six box chain in one row at the 400px pitch is 2200x280: nothing
 * overlaps, every other check passes, and fitted to a screen the labels are
 * microscopic. Exact arithmetic, so it is an error like node-overlap, and the
 * limit is loose enough that a legitimately oblong page still passes.
 */
function checkPageShape(cells, rectOf, pageLabel, line, add) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let nodes = 0;
  for (const cell of cells) {
    if (cell.attrs.vertex !== '1' || cell.attrs.edge === '1' || cell.attrs.connectable === '0') continue;
    const r = rectOf(cell);
    if (!r) continue;
    nodes++;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  if (nodes === 0) return;
  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 0) || !(h > 0)) return;
  const long = Math.max(w, h);
  if (long < MIN_PAGE_LONG_SIDE) return;
  const ratio = long / Math.min(w, h);
  if (ratio <= MAX_PAGE_ASPECT) return;

  const perRow = Math.max(MIN_NODES_PER_ROW, Math.floor(Math.sqrt(nodes * MAX_PAGE_ASPECT / 2)));
  const wide = w >= h;
  add(ERROR, CHECK.PAGE_SHAPE, line,
    `page content box is ${w}x${h}, aspect ${ratio.toFixed(2)}:1 (too ${wide ? 'wide' : 'tall'}), past the ${MAX_PAGE_ASPECT}:1 limit. Fitted to a screen the whole page shrinks by that factor and the labels stop being readable, even though nothing overlaps. Wrap the ${wide ? 'chain into rows' : 'stack into columns'} of about ${perRow} nodes, the flow continuing on the next ${wide ? 'row down' : 'column across'}. Do not reduce the grid pitch instead: the pitch is what keeps labels off nodes, so shrinking it brings back the collisions the other checks exist to prevent`,
    pageLabel);
}

function describeRect(r) {
  return `[${r.x},${r.y} ${r.w}x${r.h}]`;
}

/** Every edge label on the page, Form A and Form B alike, with its estimated box. */
function collectEdgeLabels(cells, byId, cache) {
  const labels = [];
  for (const cell of cells) {
    const a = cell.attrs;
    if (a.edge === '1') {
      const ends = edgeEnds(cell, byId, cache);
      if (!ends || !(a.value || '').trim()) continue;
      const box = estimateLabelBox(a.value, a.style || '', labelAnchor(ends, firstNamed(cell.node, 'mxGeometry')));
      if (box) labels.push({ cell, box, edgeId: a.id });
      continue;
    }
    if (a.vertex !== '1' || !(a.value || '').trim()) continue;
    const parent = byId.get(a.parent);
    if (!parent || parent.attrs.edge !== '1') continue;      // Form B label child
    const ends = edgeEnds(parent, byId, cache);
    if (!ends) continue;
    const box = estimateLabelBox(a.value, a.style || '', labelAnchor(ends, firstNamed(cell.node, 'mxGeometry')));
    if (box) labels.push({ cell, box, edgeId: parent.attrs.id });
  }
  return labels;
}

/** An edge label printed over a node, or over another edge label. */
function checkLabelCollision(labels, solid, pageLabel, add) {
  for (const label of labels) {
    for (const node of solid) {
      if (!intersects(label.box, node.rect)) continue;
      add(ERROR, CHECK.LABEL_COLLISION, label.cell.line,
        `label of edge '${label.edgeId}' is printed over vertex '${node.cell.attrs.id}'. Move it with <mxPoint as="offset"/> on the edge geometry, or shorten it`,
        pageLabel);
    }
  }
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (!intersects(labels[i].box, labels[j].box)) continue;
      add(ERROR, CHECK.LABEL_COLLISION, labels[j].cell.line,
        `label of edge '${labels[j].edgeId}' is printed on top of the label of edge '${labels[i].edgeId}'. Offset one of them`,
        pageLabel);
    }
  }
}

/**
 * An edge whose straight source-to-target segment passes through an unrelated
 * vertex. A warning, not an error: draw.io routes orthogonally and waypoints
 * are not followed here, so the straight line is only an approximation of the
 * drawn path.
 */
function checkEdgeCrossings(cells, solid, byId, cache, pageLabel, add) {
  for (const cell of cells) {
    if (cell.attrs.edge !== '1') continue;
    const ends = edgeEnds(cell, byId, cache);
    if (!ends) continue;
    for (const node of solid) {
      const id = node.cell.attrs.id;
      if (id === cell.attrs.source || id === cell.attrs.target) continue;
      if (!segmentHitsRect(ends.source, ends.target, node.rect)) continue;
      add(WARN, CHECK.EDGE_CROSSES_NODE, cell.line,
        `edge '${cell.attrs.id}' runs straight through vertex '${id}', which is neither its source nor its target. Add waypoints or move the node (estimated from the straight line, so a routed edge may be fine)`,
        pageLabel);
    }
  }
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
