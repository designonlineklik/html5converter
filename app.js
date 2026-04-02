/**
 * SVG → HTML5 Banner Engine · app.js  v3.0
 *
 * Architecture:
 *  1. analyzeSVG()          – parse SVG, detect + cluster layers, assign IDs
 *  2. renderLayerTree()     – interactive layer list (drag-reorder, toggles)
 *  3. generateBannerHTML()  – preview HTML (all inline)
 *  4. externalizeImages()   – extract base64 assets for ZIP export
 *  5. generateBannerCSS()   – external stylesheet string
 *  6. buildAnimationScript()– GSAP timeline from ordered layer array
 *  7. downloadZIP()         – structured package: index.html, style.css,
 *                             manifest.json, assets/, README.md
 */

// ─── CTA text keywords (Dutch + English) ──────────────────────────────────────
const CTA_KEYWORDS = /\b(ontdek|bekijk|koop|shop|meer|lees|download|start|nu|now|learn|buy|get|try|sign|book|open|apply|join|register|subscribe|check|view|discover|explore|bestellen|aanvragen)\b/i;

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  animSpeed:   1.0,
  animDelay:   0.15,
  lineStagger: 0.08,      // delay between individual text lines within a group
  ratio:       '1:1',
  adSize:      null,      // { width, height } or null
  showBorder:  false,     // 1px inset border toggle
  clickTagURL: 'https://www.example.com',
  lastHTML:       '',
  lastSVGRaw:     '',     // cache to skip redundant re-analysis
  lastAnalysis:   null,
  layers:         [],
  _ratioManuallySet: false,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const svgInput       = document.getElementById('svg-input');
const previewFrame   = document.getElementById('preview-frame');
const previewPH      = document.getElementById('preview-placeholder');
const ratioContainer = document.getElementById('ratio-container');
const speedSlider    = document.getElementById('speed-slider');
const delaySlider    = document.getElementById('delay-slider');
const staggerSlider  = document.getElementById('stagger-slider');
const speedVal       = document.getElementById('speed-val');
const delayVal       = document.getElementById('delay-val');
const staggerVal     = document.getElementById('stagger-val');
const statusBadge    = document.getElementById('status-badge');
const statusText     = document.getElementById('status-text');
const detectedInfo   = document.getElementById('detected-info');
const replayBtn      = document.getElementById('replay-btn');
const playOverlay    = document.getElementById('play-overlay');
const ctaColorInput  = document.getElementById('cta-color');
const clickTagInput  = document.getElementById('clicktag-url');
const borderToggle   = document.getElementById('border-toggle');
const layerTree      = document.getElementById('layer-tree');
const layerEmpty     = document.getElementById('layer-empty');
const layerCount     = document.getElementById('layer-count');
const adSizeSelect   = document.getElementById('ad-size');

// ─── Slider + toggle listeners ────────────────────────────────────────────────
speedSlider.addEventListener('input', () => {
  state.animSpeed = parseFloat(speedSlider.value);
  speedVal.textContent = state.animSpeed.toFixed(1) + '×';
});

delaySlider.addEventListener('input', () => {
  state.animDelay = parseFloat(delaySlider.value);
  delayVal.textContent = state.animDelay.toFixed(2) + 's';
});

staggerSlider.addEventListener('input', () => {
  state.lineStagger = parseFloat(staggerSlider.value);
  staggerVal.textContent = state.lineStagger.toFixed(2) + 's';
});

borderToggle.addEventListener('change', () => {
  state.showBorder = borderToggle.checked;
});

clickTagInput.addEventListener('input', () => {
  state.clickTagURL = clickTagInput.value.trim() || 'https://www.example.com';
});

// ─── Ad-size selector ─────────────────────────────────────────────────────────
adSizeSelect.addEventListener('change', () => {
  const val = adSizeSelect.value;
  if (!val) {
    state.adSize = null;
  } else {
    const [w, h] = val.split('x').map(Number);
    state.adSize = { width: w, height: h };
    const r = w / h;
    const ratio = r > 1.6 ? '16:9' : r < 0.9 ? '4:5' : '1:1';
    state.ratio = ratio;
    state._ratioManuallySet = true;
    applyRatioToContainer(ratio);
    updateRatioButtons(ratio);
  }
});

// ─── Ratio buttons ────────────────────────────────────────────────────────────
document.querySelectorAll('.ratio-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.ratio = btn.dataset.ratio;
    state._ratioManuallySet = true;
    applyRatioToContainer(state.ratio);
    updateRatioButtons(state.ratio);
  });
});

function applyRatioToContainer(ratio) {
  ratioContainer.classList.remove('aspect-1-1', 'aspect-4-5', 'aspect-16-9');
  if (ratio === '1:1')  ratioContainer.classList.add('aspect-1-1');
  if (ratio === '4:5')  ratioContainer.classList.add('aspect-4-5');
  if (ratio === '16:9') ratioContainer.classList.add('aspect-16-9');
}

function updateRatioButtons(ratio) {
  document.querySelectorAll('.ratio-btn').forEach(btn => {
    const active = btn.dataset.ratio === ratio;
    btn.classList.toggle('tab-active', active);
    btn.classList.toggle('text-gray-400', !active);
  });
}

// ─── Clear ────────────────────────────────────────────────────────────────────
document.getElementById('clear-btn').addEventListener('click', () => {
  svgInput.value = '';
  state.lastSVGRaw  = '';
  state.lastAnalysis = null;
  state.layers       = [];
  previewFrame.classList.add('hidden');
  previewFrame.srcdoc = '';
  previewPH.classList.remove('hidden');
  replayBtn.classList.add('hidden');
  statusBadge.classList.add('hidden');
  renderLayerTree();
});

// ─── Replay / Play buttons ────────────────────────────────────────────────────
function doReplay() { if (state.lastHTML) previewFrame.srcdoc = state.lastHTML; }
replayBtn.addEventListener('click', doReplay);
playOverlay.addEventListener('click', doReplay);

// ─── Preview button + auto-preview ───────────────────────────────────────────
document.getElementById('preview-btn').addEventListener('click', runPreview);

let debounceTimer;
svgInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const v = svgInput.value.trim();
    if (v.startsWith('<svg') || v.startsWith('<?xml')) runPreview();
  }, 700);
});

// ─── Download ZIP ─────────────────────────────────────────────────────────────
document.getElementById('download-btn').addEventListener('click', downloadZIP);

// ─── Drop zone ────────────────────────────────────────────────────────────────
initDropZone();


// ═════════════════════════════════════════════════════════════════════════════
// CORE: runPreview
// Re-analyses only when SVG content changes; preserves manual layer edits.
// ═════════════════════════════════════════════════════════════════════════════
function runPreview() {
  const raw = svgInput.value.trim();
  if (!raw) { setStatus('No SVG pasted', true); return; }

  setStatus('Analysing…');

  if (raw !== state.lastSVGRaw) {
    let analysis;
    try { analysis = analyzeSVG(raw); }
    catch (e) { setStatus('Invalid SVG: ' + e.message, true); return; }

    state.lastSVGRaw   = raw;
    state.lastAnalysis = analysis;
    state.layers       = analysis.layers;

    if (!state._ratioManuallySet) {
      state.ratio = analysis.aspectRatio;
      applyRatioToContainer(state.ratio);
      updateRatioButtons(state.ratio);
    }
    renderLayerTree();
  }

  if (!state.lastAnalysis) return;

  const html = generateBannerHTML(state.lastAnalysis, {
    layers:      state.layers,
    speed:       state.animSpeed,
    delay:       state.animDelay,
    lineStagger: state.lineStagger,
    ctaColor:    ctaColorInput.value.trim() || null,
    adSize:      state.adSize,
    showBorder:  state.showBorder,
    clickTagURL: state.clickTagURL,
  });

  state.lastHTML = html;
  previewFrame.srcdoc = html;
  previewPH.classList.add('hidden');
  previewFrame.classList.remove('hidden');
  replayBtn.classList.remove('hidden');
  detectedInfo.textContent =
    `${state.lastAnalysis.width}×${state.lastAnalysis.height}` +
    (state.adSize ? ` → ${state.adSize.width}×${state.adSize.height}` : '') +
    ` · ${state.lastAnalysis.aspectRatio}`;
  setStatus('Preview ready');
}


// ═════════════════════════════════════════════════════════════════════════════
// SVG ANALYSER
// Returns { svg, width, height, aspectRatio, layers[] }
// ═════════════════════════════════════════════════════════════════════════════
function analyzeSVG(svgString) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(svgString, 'image/svg+xml');

  if (doc.querySelector('parsererror')) throw new Error('SVG parse error');
  const svg = doc.querySelector('svg');
  if (!svg) throw new Error('No <svg> root found');

  const { width, height, aspectRatio } = extractDimensions(svg);

  // Order: CTA first (so text clustering can exclude CTA text elements)
  const ctaGroups  = findCTAGroups(svg, width, height);
  const ctaClaimed = new Set(ctaGroups.map(g => g.el));

  // Clustered text groups — returns { elements[], text } per cluster
  const textGroups = findTextGroups(svg, ctaClaimed, height);
  const imageEls   = findImageElements(svg);

  // ── Assign stable IDs to individual elements ──────────────────────────────
  let idSeq = 0;
  const uid = (el, prefix) => {
    if (!el.id || el.id.trim() === '') el.setAttribute('id', `${prefix}-${++idSeq}`);
    return el.id;
  };

  // ── Build layer objects ────────────────────────────────────────────────────
  const layers = [];
  let order = 0;

  // 1. Background pseudo-layer (animates the whole SVG element)
  layers.push({
    id: 'layer-bg', label: 'Background', type: 'background',
    elementIds: [], animate: true, order: order++,
  });

  // 2. Images
  imageEls.forEach((el, i) => {
    layers.push({
      id: `layer-img-${i}`, label: `Image ${i + 1}`, type: 'image',
      elementIds: [uid(el, 'img')], animate: true, order: order++,
    });
  });

  // 3. Text clusters — each cluster has ≥1 individual <text> element IDs
  //    GSAP staggers them using lineStagger for a word-processor reveal feel.
  textGroups.forEach((group, i) => {
    const elementIds = group.elements.map(el => uid(el, 'txt'));
    const preview    = group.text.slice(0, 22) + (group.text.length > 22 ? '…' : '');
    layers.push({
      id: `layer-txt-${i}`,
      label: preview || `Text Group ${i + 1}`,
      type: 'text',
      elementIds,              // multiple IDs → GSAP staggers each line
      animate: true,
      order: order++,
    });
  });

  // 4. CTA groups
  ctaGroups.forEach((group, i) => {
    layers.push({
      id: `layer-cta-${i}`, label: group.label, type: 'cta',
      elementIds: [uid(group.el, 'cta')], animate: true, order: order++,
    });
  });

  return {
    svg: new XMLSerializer().serializeToString(svg),
    width, height, aspectRatio, layers,
  };
}

// ── Dimensions ────────────────────────────────────────────────────────────────
function extractDimensions(svg) {
  let width = 0, height = 0;
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const p = vb.trim().split(/[\s,]+/);
    if (p.length === 4) { width = parseFloat(p[2]); height = parseFloat(p[3]); }
  }
  if (!width)  width  = parseFloat(svg.getAttribute('width'))  || 1080;
  if (!height) height = parseFloat(svg.getAttribute('height')) || 1080;
  const r = width / height;
  return { width, height, aspectRatio: r > 1.6 ? '16:9' : r < 0.9 ? '4:5' : '1:1' };
}

// ── Text group finder with spatial clustering ─────────────────────────────────
//
// Problem: Canva often splits a single paragraph into many <text> elements
// inside separate <g> containers.  We sort all text elements by their
// approximate Y coordinate and cluster those within CLUSTER_THRESHOLD pixels
// of each other into one animation unit.  Each unit fans out with lineStagger
// in the animation script.
//
// Returns: Array<{ elements: SVGTextElement[], text: string }>
function findTextGroups(svg, ctaClaimed, svgH) {
  const CLUSTER_THRESHOLD = (svgH || 1080) * 0.1;  // ≈10% of SVG height

  // Collect all <text> nodes not inside a CTA group
  const allTexts = Array.from(svg.querySelectorAll('text')).filter(t => {
    let el = t.parentElement;
    while (el && el !== svg) {
      if (ctaClaimed.has(el)) return false;
      el = el.parentElement;
    }
    return true;
  });

  if (allTexts.length === 0) return [];

  // Sort by approximate Y (absolute coordinate in SVG user units)
  const withY = allTexts.map(t => ({ el: t, y: getApproxY(t) }));
  withY.sort((a, b) => a.y - b.y);

  // Cluster: consecutive elements within threshold → same group
  const clusters = [];
  let current = [withY[0]];
  for (let i = 1; i < withY.length; i++) {
    if (withY[i].y - withY[i - 1].y <= CLUSTER_THRESHOLD) {
      current.push(withY[i]);
    } else {
      clusters.push(current);
      current = [withY[i]];
    }
  }
  clusters.push(current);

  return clusters.map(cluster => ({
    elements: cluster.map(c => c.el),
    text: cluster.map(c => c.el.textContent.trim()).join(' ').trim(),
  }));
}

// ── Approximate Y position of an element (no getBBox / layout needed) ─────────
function getApproxY(el) {
  // 1. Direct y attribute (most common on <text>)
  const y = parseFloat(el.getAttribute('y'));
  if (!isNaN(y)) return y;

  // 2. translate(x, Y) on the element itself
  const t = el.getAttribute('transform') || '';
  const m = t.match(/translate\s*\(\s*[\d.eE+-]+\s*,\s*([\d.eE+-]+)/);
  if (m) return parseFloat(m[1]);

  // 3. Walk up through parent <g> transforms and accumulate Y
  let accY = 0;
  let node = el.parentElement;
  while (node && node.tagName !== 'svg') {
    const pt = (node.getAttribute('transform') || '').match(/translate\s*\(\s*[\d.eE+-]+\s*,\s*([\d.eE+-]+)/);
    if (pt) accY += parseFloat(pt[1]);
    node = node.parentElement;
  }
  return accY;
}

// ── Smart CTA group finder ────────────────────────────────────────────────────
// Strategy A: <g> containing BOTH a small vibrant shape AND short CTA text.
// Strategy B: fallback to the largest standalone vibrant shape.
function findCTAGroups(svg, svgWidth, svgHeight) {
  const svgArea = (svgWidth || 1080) * (svgHeight || 1080);
  const groups  = [];

  // Strategy A ────────────────────────────────────────────────────────────────
  for (const g of svg.querySelectorAll('g')) {
    const shapes = Array.from(g.children).filter(el =>
      ['rect','path','circle','ellipse'].includes(el.tagName)
    );
    const texts = Array.from(g.querySelectorAll('text'));
    if (!shapes.length || !texts.length) continue;

    let vibrantShape = null;
    for (const s of shapes) {
      if (isVibrantColor(getFill(s, svg))) { vibrantShape = s; break; }
    }
    if (!vibrantShape) continue;
    if (estimateArea(vibrantShape) / svgArea > 0.20) continue;

    const textContent = texts.map(t => t.textContent.trim()).join(' ').trim();
    if (!textContent || textContent.length > 60) continue;
    if (!CTA_KEYWORDS.test(textContent) && textContent.length > 20) continue;

    groups.push({
      el: g,
      label: `CTA: ${textContent.slice(0, 22)}${textContent.length > 22 ? '…' : ''}`,
    });
    if (groups.length >= 3) break;
  }

  // Strategy B (fallback) ──────────────────────────────────────────────────────
  if (groups.length === 0) {
    Array.from(svg.querySelectorAll('rect, path, circle, ellipse'))
      .map(el => ({ el, fill: getFill(el, svg), area: estimateArea(el) }))
      .filter(c => c.fill && isVibrantColor(c.fill) && c.area / svgArea < 0.20)
      .sort((a, b) => b.area - a.area)
      .slice(0, 2)
      .forEach((c, i) => groups.push({ el: c.el, label: `CTA Button ${i + 1}` }));
  }

  return groups;
}

// ── Image finder ──────────────────────────────────────────────────────────────
function findImageElements(svg) {
  return Array.from(svg.querySelectorAll('image'));
}

// ── Fill resolver ─────────────────────────────────────────────────────────────
function getFill(el, svg) {
  let fill = el.getAttribute('fill') || el.style?.fill;
  if (!fill || fill === 'none') return null;
  if (fill.startsWith('url(')) {
    const m = fill.match(/url\(#([^)]+)\)/);
    if (m) {
      const grad = svg.querySelector(`#${m[1]}`);
      if (grad) {
        const stop = grad.querySelector('stop');
        if (stop) fill = stop.getAttribute('stop-color') || stop.style?.stopColor || fill;
      }
    }
  }
  return fill || null;
}

// ── Area estimator (no getBBox — works in DOMParser context) ──────────────────
function estimateArea(el) {
  switch (el.tagName) {
    case 'rect':
      return (parseFloat(el.getAttribute('width'))  || 0) *
             (parseFloat(el.getAttribute('height')) || 0);
    case 'circle': { const r = parseFloat(el.getAttribute('r')) || 0; return Math.PI*r*r; }
    case 'ellipse': {
      const rx = parseFloat(el.getAttribute('rx')) || 0;
      const ry = parseFloat(el.getAttribute('ry')) || 0;
      return Math.PI * rx * ry;
    }
    case 'path': {
      const nums = (el.getAttribute('d') || '').match(/-?\d+\.?\d*/g);
      if (!nums || nums.length < 4) return 0;
      const vs = nums.map(Number);
      const xs = vs.filter((_, i) => i % 2 === 0), ys = vs.filter((_, i) => i % 2 === 1);
      return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    }
    default: return 0;
  }
}

// ── Colour helpers ────────────────────────────────────────────────────────────
function isVibrantColor(c) {
  if (!c) return false;
  const hsl = colorToHSL(c);
  return hsl && hsl.s > 45 && hsl.l > 25 && hsl.l < 90;
}

function colorToHSL(colorStr) {
  let hex = colorStr.trim();
  if (hex.startsWith('#')) hex = hex.slice(1);
  else if (hex.startsWith('rgb')) {
    const m = hex.match(/(\d+)/g);
    return (m && m.length >= 3) ? rgbToHSL(+m[0], +m[1], +m[2]) : null;
  } else return null;
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  if (hex.length !== 6) return null;
  return rgbToHSL(parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16));
}

function rgbToHSL(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), l = (max+min)/2;
  if (max === min) return { h:0, s:0, l:l*100 };
  const d = max-min, s = l > 0.5 ? d/(2-max-min) : d/(max+min);
  let h;
  switch(max) {
    case r: h=((g-b)/d+(g<b?6:0))/6; break;
    case g: h=((b-r)/d+2)/6;         break;
    default:h=((r-g)/d+4)/6;
  }
  return { h:h*360, s:s*100, l:l*100 };
}


// ═════════════════════════════════════════════════════════════════════════════
// IMAGE EXTERNALIZER
// Strips base64 data URIs from <image> hrefs, returns the modified SVG string
// plus an assets array for ZIP packaging.  The preview always uses the
// original inline SVG; this runs only during ZIP export.
// ═════════════════════════════════════════════════════════════════════════════
function externalizeImages(svgString) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(svgString, 'image/svg+xml');
  const svg    = doc.querySelector('svg');
  const assets = [];

  if (!svg) return { svgString, assets };

  svg.querySelectorAll('image').forEach((img, i) => {
    // SVG 2.0 uses href; SVG 1.1 used xlink:href
    const attrName = img.hasAttribute('href') ? 'href' : 'xlink:href';
    const href     = img.getAttribute(attrName) || img.getAttribute('href') || '';

    if (!href.startsWith('data:')) return;  // already external

    const match = href.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return;

    const [, mimeType, base64Data] = match;
    const ext      = (mimeType.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
    const filename = `assets/image-${i + 1}.${ext}`;

    img.setAttribute(attrName, filename);
    assets.push({ filename, mimeType, data: base64Data });
  });

  return {
    svgString: new XMLSerializer().serializeToString(svg),
    assets,
  };
}


// ═════════════════════════════════════════════════════════════════════════════
// LAYER TREE – render + drag-and-drop
// ═════════════════════════════════════════════════════════════════════════════
const LAYER_TYPE_META = {
  background: { css: 'type-bg',   label: 'BG'  },
  image:      { css: 'type-img',  label: 'IMG' },
  text:       { css: 'type-text', label: 'TXT' },
  cta:        { css: 'type-cta',  label: 'CTA' },
};

let _dragLayerId = null;

function renderLayerTree() {
  Array.from(layerTree.children).forEach(c => { if (c !== layerEmpty) c.remove(); });

  if (!state.layers || state.layers.length === 0) {
    layerEmpty.style.display = 'flex';
    layerCount.textContent = '';
    return;
  }

  layerEmpty.style.display = 'none';
  layerCount.textContent = `${state.layers.length} layer${state.layers.length !== 1 ? 's' : ''}`;

  [...state.layers].sort((a, b) => a.order - b.order)
    .forEach((layer, idx) => layerTree.appendChild(buildLayerRow(layer, idx + 1)));
}

function buildLayerRow(layer, displayOrder) {
  const meta = LAYER_TYPE_META[layer.type] || LAYER_TYPE_META.text;

  const row = document.createElement('div');
  row.className = 'layer-row flex items-center gap-2 px-2 py-1.5 rounded-lg select-none';
  row.setAttribute('draggable', 'true');
  row.dataset.layerId = layer.id;
  if (!layer.animate) row.style.opacity = '0.45';

  // Line count badge (shows how many text lines are in the cluster)
  const lineInfo = layer.type === 'text' && layer.elementIds.length > 1
    ? `<span class="shrink-0 text-xs text-gray-600 font-mono">${layer.elementIds.length}L</span>`
    : '';

  row.innerHTML = `
    <span class="drag-handle text-gray-600 hover:text-gray-400 text-sm leading-none px-0.5">⠿</span>
    <span class="shrink-0 w-5 h-5 flex items-center justify-center rounded text-xs font-mono font-bold bg-gray-800 text-gray-400">${displayOrder}</span>
    <span class="shrink-0 text-xs font-bold px-1.5 py-0.5 rounded ${meta.css}">${meta.label}</span>
    <span class="flex-1 text-xs text-gray-300 truncate" title="${escapeAttr(layer.label)}">${escapeHTML(layer.label)}</span>
    ${lineInfo}
    <label class="toggle" title="Animate this layer">
      <input type="checkbox" ${layer.animate ? 'checked' : ''} class="anim-toggle" data-layer-id="${layer.id}">
      <span class="toggle-slider"></span>
    </label>`;

  // Toggle animate
  row.querySelector('.anim-toggle').addEventListener('change', e => {
    const target = state.layers.find(l => l.id === e.target.dataset.layerId);
    if (target) { target.animate = e.target.checked; row.style.opacity = target.animate ? '1' : '0.45'; }
  });

  // Drag-and-drop
  row.addEventListener('dragstart', e => {
    _dragLayerId = layer.id;
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => row.classList.add('drag-active'));
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('drag-active');
    _dragLayerId = null;
    layerTree.querySelectorAll('.layer-row').forEach(r => r.classList.remove('drag-over'));
  });
  row.addEventListener('dragover', e => {
    if (!_dragLayerId || _dragLayerId === layer.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    layerTree.querySelectorAll('.layer-row').forEach(r => r.classList.remove('drag-over'));
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', e => {
    e.preventDefault();
    row.classList.remove('drag-over');
    if (!_dragLayerId || _dragLayerId === layer.id) return;
    const fromIdx = state.layers.findIndex(l => l.id === _dragLayerId);
    const toIdx   = state.layers.findIndex(l => l.id === layer.id);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = state.layers.splice(fromIdx, 1);
    state.layers.splice(state.layers.findIndex(l => l.id === layer.id), 0, moved);
    state.layers.forEach((l, i) => { l.order = i; });
    renderLayerTree();
  });

  return row;
}

function escapeHTML(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escapeAttr(s) { return escapeHTML(s); }


// ═════════════════════════════════════════════════════════════════════════════
// BANNER CSS GENERATOR
// Used for the external style.css in the ZIP package.
// ═════════════════════════════════════════════════════════════════════════════
function generateBannerCSS(w, h, opts = {}) {
  const borderRule = opts.showBorder
    ? `\n/* Publisher 1px border requirement */\n.banner::after {\n  content: '';\n  position: absolute;\n  inset: 0;\n  border: 1px solid rgba(0, 0, 0, 0.12);\n  pointer-events: none;\n  z-index: 9999;\n}`
    : '';

  return `/* Banner Engine v3.0 — generated stylesheet */
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

html, body {
  width: ${w}px;
  height: ${h}px;
  overflow: hidden;
  background: #000000;
}

.banner {
  position: relative;
  width: ${w}px;
  height: ${h}px;
  overflow: hidden;
  cursor: pointer;
}

/* SVG scales to fill; preserveAspectRatio="xMidYMid meet" is SVG default */
.banner > svg {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
}
${borderRule}`;
}


// ═════════════════════════════════════════════════════════════════════════════
// BANNER HTML GENERATOR
//
// opts.externalCSS  – filename string → <link> instead of inline <style>
// opts.svgOverride  – use this SVG string instead of analysis.svg
//                     (ZIP export passes the externalized version)
// opts.showBorder   – injects .banner::after border rule (inline mode only)
// opts.clickTagURL  – the URL injected into var clickTag
// ═════════════════════════════════════════════════════════════════════════════
function generateBannerHTML(analysis, opts = {}) {
  const { svg: analysisSVG, width: svgW, height: svgH } = analysis;
  const adSize    = opts.adSize || null;
  const bannerW   = adSize ? adSize.width  : svgW;
  const bannerH   = adSize ? adSize.height : svgH;
  const svgToUse  = opts.svgOverride || analysisSVG;
  const clickURL  = opts.clickTagURL || 'https://www.example.com';

  const animScript = buildAnimationScript(opts.layers || [], {
    speed:       opts.speed       || 1.0,
    delay:       opts.delay       || 0.15,
    lineStagger: opts.lineStagger || 0.08,
    ctaColor:    opts.ctaColor    || null,
  });

  // ── CSS: inline (preview) or external (ZIP) ───────────────────────────────
  const cssTag = opts.externalCSS
    ? `  <link rel="stylesheet" href="${opts.externalCSS}"/>`
    : `  <style>\n${generateBannerCSS(bannerW, bannerH, { showBorder: opts.showBorder })}\n  </style>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${bannerW}, initial-scale=1.0"/>
${cssTag}
</head>
<body>
  <!--
    ┌─ clickTag ──────────────────────────────────────────────────────────────┐
    │  Standard ad-trafficking variable.                                       │
    │  • Google Ads / Campaign Manager: leave as-is, platform overrides it.   │
    │  • Adform: ADC.click is used automatically (see click handler below).   │
    │  • Manual: set the URL here before uploading.                            │
    └─────────────────────────────────────────────────────────────────────────┘
  -->
  <script>var clickTag = "${clickURL}";<\/script>

  <div class="banner" id="banner">
    ${svgToUse}
  </div>

  <script>
  // Click handler — Adform-compatible (ADC.click) with clickTag fallback
  document.getElementById('banner').addEventListener('click', function () {
    var url = (typeof ADC !== 'undefined' && ADC.click) ? ADC.click : clickTag;
    window.open(url, '_blank');
  });
  <\/script>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"><\/script>
  <script>
${animScript}
  <\/script>
</body>
</html>`;
}


// ═════════════════════════════════════════════════════════════════════════════
// ANIMATION SCRIPT BUILDER
//
// Consumes the ordered, user-modified layers[] and emits a self-contained
// GSAP timeline.  All steps use relative position (">") so adjusting one
// duration automatically cascades to every subsequent step.
//
// Text layers target individual <text> elements (from the clustering step)
// and stagger them with LINE_STAGGER for a line-by-line reveal.
// ═════════════════════════════════════════════════════════════════════════════
function buildAnimationScript(layers, opts) {
  const SPD          = (1 / (opts.speed || 1.0)).toFixed(3);
  const DELAY        = (opts.delay       || 0.15).toFixed(3);
  const LINE_STAGGER = (opts.lineStagger || 0.08).toFixed(3);
  const ctaOverride  = opts.ctaColor || null;

  const activeLayers = [...layers]
    .filter(l => l.animate)
    .sort((a, b) => a.order - b.order);

  const blocks = activeLayers.map(layer => {
    switch (layer.type) {

      // ── Background: fade the whole SVG element ───────────────────────────
      case 'background':
        return `
  // ── Background ─────────────────────────────────────────────────────────
  tl.from('#banner > svg', { opacity: 0, duration: SPD * 0.8 }, '<');`;

      // ── Image: zoom-and-fade ─────────────────────────────────────────────
      case 'image': {
        if (!layer.elementIds.length) return '';
        const sel = selStr(layer.elementIds);
        return `
  // ── Image: ${esc(layer.label)} ─────────────────────────────────────────
  tl.from(${sel}, {
    opacity: 0, scale: 1.06, transformOrigin: '50% 50%',
    duration: SPD * 1.2, ease: 'power1.out'
  }, '>-0.1');`;
      }

      // ── Text cluster: staggered line-by-line reveal ──────────────────────
      //    Each element in the cluster (an individual <text> node) slides up
      //    with LINE_STAGGER between lines.
      case 'text': {
        if (!layer.elementIds.length) return '';
        const sel = selStr(layer.elementIds);
        return `
  // ── Text: ${esc(layer.label)} ───────────────────────────────────────────
  tl.from(${sel}, {
    opacity: 0, y: 16, duration: SPD * 0.7, stagger: LINE_STAGGER
  }, '>-0.05');`;
      }

      // ── CTA: elastic pop-in + recurring attention pulse ──────────────────
      case 'cta': {
        if (!layer.elementIds.length) return '';
        const sel         = selStr(layer.elementIds);
        const ctaFallback = ctaOverride
          ? `|| Array.from(document.querySelectorAll('[fill="${ctaOverride}"]'))`
          : '';
        return `
  // ── CTA: ${esc(layer.label)} ────────────────────────────────────────────
  (function () {
    var ctaEls = Array.from(document.querySelectorAll(${sel})) ${ctaFallback};
    if (!ctaEls.length) return;

    tl.from(ctaEls, {
      opacity: 0, scale: 0.82, transformOrigin: '50% 50%',
      duration: SPD * 0.5, ease: 'back.out(1.7)', stagger: 0.06
    }, '>');

    // Recurring attention pulse — every 3 seconds after the intro finishes
    tl.call(function () {
      (function pulse() {
        gsap.to(ctaEls, {
          scale: 1.06, transformOrigin: '50% 50%',
          duration: 0.35, ease: 'power1.inOut', yoyo: true, repeat: 1,
          onComplete: function () { gsap.delayedCall(3, pulse); }
        });
      })();
    });
  })();`;
      }

      default: return '';
    }
  }).filter(Boolean).join('\n');

  return `(function () {
  'use strict';

  var SPD          = ${SPD};           // base duration unit (seconds)
  var DELAY        = ${DELAY};         // delay between layer animations
  var LINE_STAGGER = ${LINE_STAGGER};  // delay between text lines in a cluster

  var tl = gsap.timeline({ defaults: { ease: 'power2.out' } });

${blocks}

})();`;
}

// Serialise element IDs to a quoted selector string for use in GSAP calls
function selStr(ids) { return JSON.stringify(ids.map(id => '#' + id).join(', ')); }
// Strip */ so labels are safe inside JS comments
function esc(s) { return String(s).replace(/\*\//g, ''); }


// ═════════════════════════════════════════════════════════════════════════════
// STATUS
// ═════════════════════════════════════════════════════════════════════════════
function setStatus(msg, isError = false) {
  statusBadge.classList.remove('hidden');
  statusBadge.classList.add('flex');
  statusText.textContent = msg;
  statusBadge.className = statusBadge.className.replace(/text-\S+-\d+/g,'').trim()
    + (isError ? ' text-red-400' : ' text-emerald-400');
  const dot = statusBadge.querySelector('span');
  if (dot) dot.className = dot.className.replace(/bg-\S+-\d+/g,'').trim()
    + (isError ? ' bg-red-400' : ' bg-emerald-400');
}


// ═════════════════════════════════════════════════════════════════════════════
// DROP ZONE
// Turns the #svg-drop-zone area into a file-drop target.
// Accepted: .svg / image/svg+xml
// Rejected: everything else → friendly status message + shake animation
// ═════════════════════════════════════════════════════════════════════════════
function initDropZone() {
  const zone = document.getElementById('svg-drop-zone');
  if (!zone) return;

  // dragCounter prevents dragleave from firing spuriously when the cursor
  // moves over a child element (the textarea, the overlay text, etc.).
  let dragCounter = 0;

  // ── dragenter: increment counter + show overlay ───────────────────────────
  zone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    zone.classList.add('drag-hover');
  });

  // ── dragover: must preventDefault to make the element a valid drop target ─
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  // ── dragleave: only hide overlay when cursor truly leaves the zone ─────────
  zone.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      zone.classList.remove('drag-hover');
    }
  });

  // ── drop: validate file type, read with FileReader, auto-parse ────────────
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    zone.classList.remove('drag-hover');

    const file = e.dataTransfer.files[0];
    if (!file) return;

    // Accept .svg by MIME type OR by file extension (some OS report no MIME type)
    const isSVG = file.type === 'image/svg+xml'
               || file.name.toLowerCase().endsWith('.svg');

    if (!isSVG) {
      // Show a clear error without modal dialogs
      setStatus(`"${file.name}" is not an SVG — please drop a .svg file exported from Canva`, true);
      // Brief red shake so the user notices at a glance
      zone.classList.add('drop-error');
      // Keep the error overlay visible for 800 ms then reset cleanly
      setTimeout(() => zone.classList.remove('drop-error'), 800);
      return;
    }

    setStatus('Reading file…');

    const reader = new FileReader();

    reader.onload = (evt) => {
      svgInput.value = evt.target.result;
      // Trigger the full analysis + preview pipeline automatically
      runPreview();
    };

    reader.onerror = () => {
      setStatus(`Could not read "${file.name}"`, true);
    };

    reader.readAsText(file);
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// ZIP EXPORT — structured package
//
// Output folder structure:
//   banner_WxH/
//   ├── index.html        (the ad — links to style.css, refs assets/)
//   ├── style.css         (extracted stylesheet)
//   ├── manifest.json     (GDN / Adform clickTag manifest)
//   ├── assets/
//   │   └── image-1.jpg   (extracted from base64)
//   └── README.md
// ═════════════════════════════════════════════════════════════════════════════
async function downloadZIP() {
  const raw = svgInput.value.trim();
  if (!raw) { alert('Please paste SVG code first.'); return; }

  setStatus('Building ZIP…');

  // Ensure analysis is fresh
  let analysis = (raw === state.lastSVGRaw && state.lastAnalysis) ? state.lastAnalysis : null;
  if (!analysis) {
    try {
      analysis = analyzeSVG(raw);
      state.lastSVGRaw   = raw;
      state.lastAnalysis = analysis;
      state.layers       = analysis.layers;
      renderLayerTree();
    } catch (e) {
      alert('Invalid SVG: ' + e.message);
      setStatus('Export failed', true);
      return;
    }
  }

  const outW = state.adSize ? state.adSize.width  : analysis.width;
  const outH = state.adSize ? state.adSize.height : analysis.height;
  const opts = {
    layers:      state.layers,
    speed:       state.animSpeed,
    delay:       state.animDelay,
    lineStagger: state.lineStagger,
    ctaColor:    ctaColorInput.value.trim() || null,
    adSize:      state.adSize,
    showBorder:  state.showBorder,
    clickTagURL: state.clickTagURL,
  };

  // ── 1. Externalize base64 images ──────────────────────────────────────────
  const { svgString: svgExternal, assets } = externalizeImages(analysis.svg);
  const hasAssets = assets.length > 0;

  // ── 2. Generate banner HTML (external CSS + externalized SVG) ─────────────
  const bannerHTML = generateBannerHTML(
    { ...analysis, svg: svgExternal },   // use asset-ref SVG for export
    { ...opts, externalCSS: 'style.css' }
  );

  // ── 3. External stylesheet ────────────────────────────────────────────────
  const styleCSS = generateBannerCSS(outW, outH, { showBorder: state.showBorder });

  // ── 4. manifest.json (GDN / Campaign Manager format) ─────────────────────
  const manifest = JSON.stringify({
    version:     '1.0',
    title:       `Banner ${outW}x${outH}`,
    description: 'HTML5 Display Banner — generated by Banner Engine v3.0',
    width:       outW,
    height:      outH,
    clickTags: [{ name: 'clickTag', enabledTargets: ['url'] }],
    // Sizmek / Adform also read these top-level fields:
    clickTag:    state.clickTagURL,
    features:    ['GSAP 3.12'],
  }, null, 2);

  // ── 5. README ─────────────────────────────────────────────────────────────
  const readme = [
    '# HTML5 Banner',
    `Generated by SVG → HTML5 Banner Engine v3.0`,
    '',
    '## Files',
    '- `index.html`       – Ad-ready banner. Upload this ZIP to your ad platform.',
    '- `style.css`        – External stylesheet (banner dimensions + optional border).',
    '- `manifest.json`    – Click-tag manifest (Google Ads / Adform / Sizmek).',
    hasAssets ? '- `assets/`          – Extracted bitmap images.' : '',
    '- `README.md`        – This file.',
    '',
    '## Platform upload notes',
    '- **Google Ads / DV360**: "New creative" → "Upload display ads" → upload ZIP.',
    '- **Adform**:            "Create banner" → "HTML5" → upload ZIP.',
    '- **Sizmek**:            "New Ad" → "HTML5" → upload ZIP.',
    '',
    `## Set clickTag before trafficking`,
    `Edit line 1 of index.html:  var clickTag = "${state.clickTagURL}";`,
    '',
    '## Dimensions',
    `Output: ${outW} × ${outH} px`,
    `Source: ${analysis.width} × ${analysis.height} px  (${analysis.aspectRatio})`,
    '',
    '## Animation sequence',
    ...state.layers.map((l, i) => `  ${i + 1}. [${l.animate ? '✓' : '✗'}] ${l.label}  (${l.type})`),
  ].filter(l => l !== '').join('\n');

  // ── 6. Package the ZIP ────────────────────────────────────────────────────
  const zip    = new JSZip();
  const folder = zip.folder(`banner_${outW}x${outH}`);

  folder.file('index.html',    bannerHTML);
  folder.file('style.css',     styleCSS);
  folder.file('manifest.json', manifest);
  folder.file('README.md',     readme);
  folder.file('source.svg',    raw);   // original SVG for reference

  // Add extracted assets into the assets/ sub-folder
  assets.forEach(asset => {
    folder.file(asset.filename, asset.data, { base64: true });
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `banner_${outW}x${outH}_${Date.now()}.zip`);
  setStatus(`ZIP ready — ${assets.length} asset${assets.length !== 1 ? 's' : ''} extracted`);
}
