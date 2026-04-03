/**
 * SVG → HTML5 Banner Engine · app.js  v3.2
 */

// ─── CTA keywords ────────────────────────────────────────────────────────────
const CTA_KEYWORDS = /\b(ontdek|bekijk|koop|shop|meer|lees|download|start|nu|now|learn|buy|get|try|sign|book|open|apply|join|register|subscribe|check|view|discover|explore|bestellen|aanvragen)\b/i;

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  animSpeed:         1.0,
  animDelay:         0.15,
  lineStagger:       0.08,
  ratio:             '1:1',
  adSize:            null,
  showBorder:        false,
  clickTagURL:       'https://www.example.com',
  lastHTML:          '',
  lastSVGRaw:        '',
  lastAnalysis:      null,
  layers:            [],
  _ratioManuallySet: false,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const svgInput          = document.getElementById('svg-input');
const previewFrame      = document.getElementById('preview-frame');
const previewPH         = document.getElementById('preview-placeholder');
const ratioContainer    = document.getElementById('ratio-container');
const speedSlider       = document.getElementById('speed-slider');
const delaySlider       = document.getElementById('delay-slider');
const staggerSlider     = document.getElementById('stagger-slider');
const speedVal          = document.getElementById('speed-val');
const delayVal          = document.getElementById('delay-val');
const staggerVal        = document.getElementById('stagger-val');
const statusBadge       = document.getElementById('status-badge');
const statusText        = document.getElementById('status-text');
const detectedInfo      = document.getElementById('detected-info');
const replayBtn         = document.getElementById('replay-btn');
const ctaColorInput     = document.getElementById('cta-color');
const clickTagInput     = document.getElementById('clicktag-url');
const borderToggle      = document.getElementById('border-toggle');
const layerTree         = document.getElementById('layer-tree');
const layerEmpty        = document.getElementById('layer-empty');
const layerCount        = document.getElementById('layer-count');
const adSizeSelect      = document.getElementById('ad-size');
const previewStatusDot  = document.getElementById('preview-status-dot');
const previewStatusText = document.getElementById('preview-status-text');

console.log('[Banner Engine] Script loaded, DOM refs resolved');

// ─── Status helpers ───────────────────────────────────────────────────────────
function setStatus(msg, isError) {
  statusBadge.classList.remove('hidden');
  statusBadge.classList.add('flex');
  statusText.textContent = msg;
  const colour = isError ? 'red' : 'emerald';
  statusBadge.className = `flex items-center gap-1.5 text-xs text-${colour}-400`;
  const dot = statusBadge.querySelector('span');
  if (dot) dot.className = `w-2 h-2 rounded-full bg-${colour}-400 live-dot`;
}

// type: 'idle' | 'working' | 'ok' | 'error'
function setPreviewStatus(msg, type) {
  const colours = { idle: 'gray-600', working: 'yellow-400', ok: 'emerald-400', error: 'red-400' };
  const c = colours[type] || colours.idle;
  previewStatusDot.className  = `w-1.5 h-1.5 rounded-full bg-${c} shrink-0`;
  previewStatusText.className = `text-xs font-mono text-${c}`;
  previewStatusText.textContent = 'Status: ' + msg;
}

// ─── Slider listeners ─────────────────────────────────────────────────────────
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
borderToggle.addEventListener('change', () => { state.showBorder = borderToggle.checked; });
clickTagInput.addEventListener('input', () => {
  state.clickTagURL = clickTagInput.value.trim() || 'https://www.example.com';
});

// ─── Ad-size selector ─────────────────────────────────────────────────────────
adSizeSelect.addEventListener('change', () => {
  const val = adSizeSelect.value;
  if (!val) { state.adSize = null; return; }
  const [w, h] = val.split('x').map(Number);
  state.adSize = { width: w, height: h };
  const r = w / h;
  const ratio = r > 1.6 ? '16:9' : r < 0.9 ? '4:5' : '1:1';
  state.ratio = ratio;
  state._ratioManuallySet = true;
  applyRatio(ratio);
});

// ─── Ratio buttons ────────────────────────────────────────────────────────────
document.querySelectorAll('.ratio-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.ratio = btn.dataset.ratio;
    state._ratioManuallySet = true;
    applyRatio(state.ratio);
  });
});

function applyRatio(ratio) {
  ratioContainer.classList.remove('aspect-1-1', 'aspect-4-5', 'aspect-16-9');
  ratioContainer.classList.add(
    ratio === '1:1' ? 'aspect-1-1' : ratio === '4:5' ? 'aspect-4-5' : 'aspect-16-9'
  );
  document.querySelectorAll('.ratio-btn').forEach(b => {
    b.classList.toggle('tab-active', b.dataset.ratio === ratio);
    b.classList.toggle('text-gray-400', b.dataset.ratio !== ratio);
  });
}

// ─── Auto-preview on paste/type ───────────────────────────────────────────────
let debounceTimer;
svgInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const v = svgInput.value.trim();
    if (v.startsWith('<svg') || v.startsWith('<?xml')) runPreview();
  }, 700);
});

// ─── Single delegated click handler for ALL buttons ──────────────────────────
// This guarantees buttons work even if a partial JS error occurs elsewhere.
document.addEventListener('click', function (e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  switch (btn.id) {
    case 'preview-btn':  runPreview(); break;
    case 'download-btn': downloadZIP(); break;
    case 'replay-btn':   doReplay(); break;
    case 'play-overlay': doReplay(); break;
    case 'clear-btn':    doClear(); break;
  }
});

// ─── Drop zone ────────────────────────────────────────────────────────────────
initDropZone();
console.log('[Banner Engine] All listeners attached');


// ═════════════════════════════════════════════════════════════════════════════
// CORE: runPreview
// ═════════════════════════════════════════════════════════════════════════════
function runPreview() {
  const raw = svgInput.value.trim();
  if (!raw) {
    setStatus('No SVG — paste or drop a file', true);
    setPreviewStatus('No SVG found', 'error');
    return;
  }

  console.log('[Banner Engine] SVG detected — length:', raw.length, 'chars');
  setStatus('Analysing…');
  setPreviewStatus('Analysing SVG…', 'working');

  if (raw !== state.lastSVGRaw) {
    let analysis;
    try {
      analysis = analyzeSVG(raw);
    } catch (e) {
      console.error('[Banner Engine] analyzeSVG failed:', e);
      setStatus('Invalid SVG: ' + e.message, true);
      setPreviewStatus('Parse error — check console', 'error');
      return;
    }
    console.log('[Banner Engine] Layers analysed:', analysis.layers.length,
      '| size:', analysis.width + '×' + analysis.height);

    state.lastSVGRaw   = raw;
    state.lastAnalysis = analysis;
    state.layers       = analysis.layers;

    if (!state._ratioManuallySet) {
      state.ratio = analysis.aspectRatio;
      applyRatio(state.ratio);
    }
    renderLayerTree();
  }

  if (!state.lastAnalysis) return;

  const html = buildPreviewHTML(state.lastAnalysis);
  state.lastHTML = html;

  console.log('[Banner Engine] Injecting into iframe — HTML size:',
    Math.round(html.length / 1024) + ' KB');

  // ── Inject via srcdoc ────────────────────────────────────────────────────
  previewFrame.srcdoc = html;
  previewFrame.style.display = 'block';
  previewPH.style.display    = 'none';
  replayBtn.classList.remove('hidden');

  detectedInfo.textContent =
    state.lastAnalysis.width + '×' + state.lastAnalysis.height +
    (state.adSize ? ' → ' + state.adSize.width + '×' + state.adSize.height : '') +
    ' · ' + state.lastAnalysis.aspectRatio;

  setStatus('Preview ready');
  setPreviewStatus('Preview ready', 'ok');

  alert('SVG Injected — ' + state.lastAnalysis.layers.length + ' layers. Check the preview panel.');
}

// ─── Replay ───────────────────────────────────────────────────────────────────
function doReplay() {
  if (!state.lastHTML) return;
  console.log('[Banner Engine] Replaying…');
  setPreviewStatus('Replaying…', 'working');
  previewFrame.srcdoc = '';
  requestAnimationFrame(() => {
    previewFrame.srcdoc = state.lastHTML;
    setPreviewStatus('Preview ready', 'ok');
  });
}

// ─── Clear ────────────────────────────────────────────────────────────────────
function doClear() {
  svgInput.value             = '';
  state.lastSVGRaw           = '';
  state.lastAnalysis         = null;
  state.layers               = [];
  state.lastHTML             = '';
  previewFrame.srcdoc        = '';
  previewFrame.style.display = 'none';
  previewPH.style.display    = 'flex';
  replayBtn.classList.add('hidden');
  statusBadge.classList.add('hidden');
  setPreviewStatus('Waiting for SVG…', 'idle');
  renderLayerTree();
  console.log('[Banner Engine] Cleared');
}


// ═════════════════════════════════════════════════════════════════════════════
// buildPreviewHTML
// Constructs the srcdoc document.  CSS forces 100% fill so the SVG is always
// visible regardless of the iframe's rendered pixel size.
// ═════════════════════════════════════════════════════════════════════════════
function buildPreviewHTML(analysis) {
  const clickURL   = state.clickTagURL;
  const svgToUse   = analysis.svg;   // already sanitized by analyzeSVG
  const animScript = buildAnimationScript(state.layers, {
    speed:       state.animSpeed,
    delay:       state.animDelay,
    lineStagger: state.lineStagger,
    ctaColor:    ctaColorInput.value.trim() || null,
  });

  const borderCSS = state.showBorder ? `
#banner::after {
  content: ''; position: absolute; inset: 0;
  border: 1px solid rgba(0,0,0,.12); pointer-events: none; z-index: 9999;
}` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
/* Force full-bleed fill — works at any iframe pixel size */
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  width: 100%; height: 100%;
  overflow: hidden;
  background: #000;
}
#banner {
  position: relative;
  width: 100%; height: 100%;
  overflow: hidden;
  cursor: pointer;
}
/* The SVG fills the banner; viewBox keeps correct proportions */
#banner > svg {
  width: 100%; height: 100%;
  display: block;
}
${borderCSS}
</style>
</head>
<body>

<script>var clickTag = "${clickURL}";<\/script>

<div id="banner">
  ${svgToUse}
</div>

<script>
document.getElementById('banner').addEventListener('click', function () {
  var url = (typeof ADC !== 'undefined' && ADC.click) ? ADC.click : clickTag;
  window.open(url, '_blank');
});
<\/script>

<!-- GSAP loaded explicitly inside every generated banner -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"><\/script>
<script>
${animScript}
<\/script>

</body>
</html>`;
}


// ═════════════════════════════════════════════════════════════════════════════
// analyzeSVG
// ═════════════════════════════════════════════════════════════════════════════
function analyzeSVG(svgString) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(svgString, 'image/svg+xml');

  const parseErr = doc.querySelector('parsererror');
  if (parseErr) throw new Error('SVG parse error: ' + parseErr.textContent.slice(0, 80));

  const svg = doc.querySelector('svg');
  if (!svg) throw new Error('No <svg> root found');

  // ── 1. Extract true dimensions from viewBox first ────────────────────────
  const { width, height, aspectRatio } = extractDimensions(svg);

  // ── 2. SVG Sanitization — strip hardcoded pixel dimensions ───────────────
  // Canva exports width="1080" height="1080" which overrides CSS in iframes.
  // Removing them lets CSS control the size; viewBox preserves proportions.
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  // Ensure viewBox is present so proportions are maintained
  if (!svg.getAttribute('viewBox')) {
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  // preserveAspectRatio: default (xMidYMid meet) is correct — keep it
  // unless Canva set something else
  if (!svg.getAttribute('preserveAspectRatio')) {
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }

  // ── 3. Layer detection ───────────────────────────────────────────────────
  const ctaGroups  = findCTAGroups(svg, width, height);
  const ctaClaimed = new Set(ctaGroups.map(g => g.el));
  const textGroups = findTextGroups(svg, ctaClaimed, height);
  const imageEls   = findImageElements(svg);

  // ── 4. Assign stable IDs ─────────────────────────────────────────────────
  let idSeq = 0;
  const uid = (el, prefix) => {
    if (!el.id || !el.id.trim()) el.setAttribute('id', `be-${prefix}-${++idSeq}`);
    return el.id;
  };

  const layers = [];
  let order = 0;

  layers.push({ id: 'layer-bg', label: 'Background', type: 'background', elementIds: [], animate: true, order: order++ });

  imageEls.forEach((el, i) => {
    layers.push({ id: `layer-img-${i}`, label: `Image ${i + 1}`, type: 'image', elementIds: [uid(el, 'img')], animate: true, order: order++ });
  });

  textGroups.forEach((group, i) => {
    const ids     = group.elements.map(el => uid(el, 'txt'));
    const preview = group.text.slice(0, 22) + (group.text.length > 22 ? '…' : '');
    layers.push({ id: `layer-txt-${i}`, label: preview || `Text ${i + 1}`, type: 'text', elementIds: ids, animate: true, order: order++ });
  });

  ctaGroups.forEach((group, i) => {
    layers.push({ id: `layer-cta-${i}`, label: group.label, type: 'cta', elementIds: [uid(group.el, 'cta')], animate: true, order: order++ });
  });

  return {
    svg: new XMLSerializer().serializeToString(svg),
    width, height, aspectRatio, layers,
  };
}

// ── extractDimensions: prefer viewBox, skip any "100%" values ────────────────
function extractDimensions(svg) {
  let width = 0, height = 0;

  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const p = vb.trim().split(/[\s,]+/);
    if (p.length >= 4) { width = parseFloat(p[2]); height = parseFloat(p[3]); }
  }

  if (!width) {
    const w = svg.getAttribute('width') || '';
    if (w && !w.includes('%')) width = parseFloat(w);
  }
  if (!height) {
    const h = svg.getAttribute('height') || '';
    if (h && !h.includes('%')) height = parseFloat(h);
  }

  width  = width  || 1080;
  height = height || 1080;

  const r = width / height;
  return { width, height, aspectRatio: r > 1.6 ? '16:9' : r < 0.9 ? '4:5' : '1:1' };
}

// ── Text clustering ───────────────────────────────────────────────────────────
function findTextGroups(svg, ctaClaimed, svgH) {
  const THRESHOLD = (svgH || 1080) * 0.1;

  const texts = Array.from(svg.querySelectorAll('text')).filter(t => {
    let el = t.parentElement;
    while (el && el !== svg) { if (ctaClaimed.has(el)) return false; el = el.parentElement; }
    return true;
  });

  if (!texts.length) return [];

  const withY = texts.map(t => ({ el: t, y: getApproxY(t) }));
  withY.sort((a, b) => a.y - b.y);

  const clusters = [[withY[0]]];
  for (let i = 1; i < withY.length; i++) {
    if (withY[i].y - withY[i - 1].y <= THRESHOLD) {
      clusters[clusters.length - 1].push(withY[i]);
    } else {
      clusters.push([withY[i]]);
    }
  }

  return clusters.map(c => ({
    elements: c.map(x => x.el),
    text: c.map(x => x.el.textContent.trim()).join(' ').trim(),
  }));
}

function getApproxY(el) {
  const y = parseFloat(el.getAttribute('y'));
  if (!isNaN(y)) return y;
  const m = (el.getAttribute('transform') || '').match(/translate\s*\(\s*[\d.+-]+\s*,\s*([\d.+-]+)/);
  if (m) return parseFloat(m[1]);
  let acc = 0, node = el.parentElement;
  while (node && node.tagName !== 'svg') {
    const pt = (node.getAttribute('transform') || '').match(/translate\s*\(\s*[\d.+-]+\s*,\s*([\d.+-]+)/);
    if (pt) acc += parseFloat(pt[1]);
    node = node.parentElement;
  }
  return acc;
}

// ── CTA detection ─────────────────────────────────────────────────────────────
function findCTAGroups(svg, svgW, svgH) {
  const svgArea = (svgW || 1080) * (svgH || 1080);
  const groups  = [];

  for (const g of svg.querySelectorAll('g')) {
    const shapes = Array.from(g.children).filter(el => ['rect','path','circle','ellipse'].includes(el.tagName));
    const texts  = Array.from(g.querySelectorAll('text'));
    if (!shapes.length || !texts.length) continue;

    let vibrant = null;
    for (const s of shapes) { if (isVibrantColor(getFill(s, svg))) { vibrant = s; break; } }
    if (!vibrant || estimateArea(vibrant) / svgArea > 0.20) continue;

    const text = texts.map(t => t.textContent.trim()).join(' ').trim();
    if (!text || text.length > 60) continue;
    if (!CTA_KEYWORDS.test(text) && text.length > 20) continue;

    groups.push({ el: g, label: `CTA: ${text.slice(0, 22)}${text.length > 22 ? '…' : ''}` });
    if (groups.length >= 3) break;
  }

  if (!groups.length) {
    Array.from(svg.querySelectorAll('rect,path,circle,ellipse'))
      .map(el => ({ el, fill: getFill(el, svg), area: estimateArea(el) }))
      .filter(c => c.fill && isVibrantColor(c.fill) && c.area / svgArea < 0.20)
      .sort((a, b) => b.area - a.area).slice(0, 2)
      .forEach((c, i) => groups.push({ el: c.el, label: `CTA Button ${i + 1}` }));
  }

  return groups;
}

function findImageElements(svg) { return Array.from(svg.querySelectorAll('image')); }

function getFill(el, svg) {
  let fill = el.getAttribute('fill') || el.style?.fill;
  if (!fill || fill === 'none') return null;
  if (fill.startsWith('url(')) {
    const m = fill.match(/url\(#([^)]+)\)/);
    if (m) {
      const grad = svg.querySelector('#' + m[1]);
      if (grad) { const stop = grad.querySelector('stop'); if (stop) fill = stop.getAttribute('stop-color') || stop.style?.stopColor || fill; }
    }
  }
  return fill || null;
}

function estimateArea(el) {
  switch (el.tagName) {
    case 'rect': return (parseFloat(el.getAttribute('width'))||0) * (parseFloat(el.getAttribute('height'))||0);
    case 'circle': { const r = parseFloat(el.getAttribute('r'))||0; return Math.PI*r*r; }
    case 'ellipse': return Math.PI * (parseFloat(el.getAttribute('rx'))||0) * (parseFloat(el.getAttribute('ry'))||0);
    case 'path': {
      const ns = (el.getAttribute('d')||'').match(/-?\d+\.?\d*/g);
      if (!ns || ns.length < 4) return 0;
      const vs = ns.map(Number), xs = vs.filter((_,i)=>i%2===0), ys = vs.filter((_,i)=>i%2===1);
      return (Math.max(...xs)-Math.min(...xs)) * (Math.max(...ys)-Math.min(...ys));
    }
    default: return 0;
  }
}

function isVibrantColor(c) {
  if (!c) return false;
  const h = colorToHSL(c);
  return h && h.s > 45 && h.l > 25 && h.l < 90;
}

function colorToHSL(c) {
  let hex = c.trim();
  if (hex.startsWith('rgb')) { const m = hex.match(/(\d+)/g); return m&&m.length>=3 ? rgbToHSL(+m[0],+m[1],+m[2]) : null; }
  if (!hex.startsWith('#')) return null;
  hex = hex.slice(1);
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  if (hex.length !== 6) return null;
  return rgbToHSL(parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16));
}

function rgbToHSL(r, g, b) {
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), l=(max+min)/2;
  if (max===min) return {h:0,s:0,l:l*100};
  const d=max-min, s=l>.5?d/(2-max-min):d/(max+min);
  let h;
  if (max===r) h=((g-b)/d+(g<b?6:0))/6;
  else if (max===g) h=((b-r)/d+2)/6;
  else h=((r-g)/d+4)/6;
  return {h:h*360, s:s*100, l:l*100};
}


// ═════════════════════════════════════════════════════════════════════════════
// LAYER TREE
// ═════════════════════════════════════════════════════════════════════════════
const TYPE_META = {
  background: { css: 'type-bg',   label: 'BG'  },
  image:      { css: 'type-img',  label: 'IMG' },
  text:       { css: 'type-text', label: 'TXT' },
  cta:        { css: 'type-cta',  label: 'CTA' },
};

let _dragId = null;

function renderLayerTree() {
  Array.from(layerTree.children).forEach(c => { if (c !== layerEmpty) c.remove(); });
  if (!state.layers.length) {
    layerEmpty.style.display = 'flex';
    layerCount.textContent = '';
    return;
  }
  layerEmpty.style.display = 'none';
  layerCount.textContent = state.layers.length + ' layer' + (state.layers.length !== 1 ? 's' : '');
  [...state.layers].sort((a,b)=>a.order-b.order).forEach((l,i)=>layerTree.appendChild(buildLayerRow(l,i+1)));
}

function buildLayerRow(layer, n) {
  const meta = TYPE_META[layer.type] || TYPE_META.text;
  const row  = document.createElement('div');
  row.className = 'layer-row flex items-center gap-2 px-2 py-1.5 rounded-lg select-none';
  row.setAttribute('draggable', 'true');
  row.dataset.layerId = layer.id;
  if (!layer.animate) row.style.opacity = '0.45';

  const lineInfo = layer.type === 'text' && layer.elementIds.length > 1
    ? `<span class="shrink-0 text-xs text-gray-600 font-mono">${layer.elementIds.length}L</span>` : '';

  row.innerHTML = `
    <span class="drag-handle text-gray-600 hover:text-gray-400 text-sm px-0.5">⠿</span>
    <span class="shrink-0 w-5 h-5 flex items-center justify-center rounded text-xs font-mono bg-gray-800 text-gray-400">${n}</span>
    <span class="shrink-0 text-xs font-bold px-1.5 py-0.5 rounded ${meta.css}">${meta.label}</span>
    <span class="flex-1 text-xs text-gray-300 truncate">${escH(layer.label)}</span>
    ${lineInfo}
    <label class="toggle">
      <input type="checkbox" ${layer.animate ? 'checked' : ''} class="anim-toggle" data-layer-id="${layer.id}">
      <span class="toggle-slider"></span>
    </label>`;

  row.querySelector('.anim-toggle').addEventListener('change', e => {
    const t = state.layers.find(l => l.id === e.target.dataset.layerId);
    if (t) { t.animate = e.target.checked; row.style.opacity = t.animate ? '1' : '0.45'; }
  });

  row.addEventListener('dragstart', e => {
    _dragId = layer.id; e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => row.classList.add('drag-active'));
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('drag-active'); _dragId = null;
    layerTree.querySelectorAll('.layer-row').forEach(r => r.classList.remove('drag-over'));
  });
  row.addEventListener('dragover', e => {
    if (!_dragId || _dragId === layer.id) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    layerTree.querySelectorAll('.layer-row').forEach(r => r.classList.remove('drag-over'));
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', e => {
    e.preventDefault(); row.classList.remove('drag-over');
    if (!_dragId || _dragId === layer.id) return;
    const fi = state.layers.findIndex(l => l.id === _dragId);
    const ti = state.layers.findIndex(l => l.id === layer.id);
    if (fi < 0 || ti < 0) return;
    const [moved] = state.layers.splice(fi, 1);
    state.layers.splice(state.layers.findIndex(l => l.id === layer.id), 0, moved);
    state.layers.forEach((l, i) => { l.order = i; });
    renderLayerTree();
  });

  return row;
}

function escH(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


// ═════════════════════════════════════════════════════════════════════════════
// ANIMATION SCRIPT BUILDER
// ═════════════════════════════════════════════════════════════════════════════
function buildAnimationScript(layers, opts) {
  const SPD   = (1 / (opts.speed || 1.0)).toFixed(3);
  const LAG   = (opts.lineStagger || 0.08).toFixed(3);
  const CTA_C = opts.ctaColor || null;

  const active = [...layers].filter(l => l.animate).sort((a,b) => a.order - b.order);

  const blocks = active.map(layer => {
    switch (layer.type) {
      case 'background':
        return `  tl.from('#banner > svg', { opacity:0, duration:SPD*0.8 }, '<');`;

      case 'image': {
        if (!layer.elementIds.length) return '';
        return `  tl.from(${sel(layer.elementIds)}, { opacity:0, scale:1.06, transformOrigin:'50% 50%', duration:SPD*1.2, ease:'power1.out' }, '>-0.1');`;
      }

      case 'text': {
        if (!layer.elementIds.length) return '';
        return `  tl.from(${sel(layer.elementIds)}, { opacity:0, y:16, duration:SPD*0.7, stagger:LAG }, '>-0.05');`;
      }

      case 'cta': {
        if (!layer.elementIds.length) return '';
        const fallback = CTA_C ? `|| Array.from(document.querySelectorAll('[fill="${CTA_C}"]'))` : '';
        return `
  (function(){
    var els = Array.from(document.querySelectorAll(${sel(layer.elementIds)})) ${fallback};
    if (!els.length) return;
    tl.from(els, { opacity:0, scale:0.82, transformOrigin:'50% 50%', duration:SPD*0.5, ease:'back.out(1.7)', stagger:0.06 }, '>');
    tl.call(function(){ (function pulse(){ gsap.to(els, { scale:1.06, transformOrigin:'50% 50%', duration:0.35, ease:'power1.inOut', yoyo:true, repeat:1, onComplete:function(){ gsap.delayedCall(3, pulse); } }); })(); });
  })();`;
      }

      default: return '';
    }
  }).filter(Boolean).join('\n');

  return `(function(){
  if (typeof gsap === 'undefined') { console.error('[Banner Engine] GSAP not loaded'); return; }
  console.log('[Banner Engine] GSAP ready, building timeline');

  var SPD = ${SPD};
  var LAG = ${LAG};

  try {
    var tl = gsap.timeline({ defaults:{ ease:'power2.out' } });
${blocks}
    console.log('[Banner Engine] GSAP timeline created');
  } catch(err) {
    console.error('[Banner Engine] Timeline error:', err);
    document.querySelectorAll('#banner *').forEach(function(el){ el.style.opacity=''; el.style.transform=''; });
  }
})();`;
}

// CSS.escape-safe selector string
function sel(ids) {
  return JSON.stringify(ids.map(id => '#' + CSS.escape(id)).join(', '));
}


// ═════════════════════════════════════════════════════════════════════════════
// IMAGE EXTERNALIZER  (ZIP export only)
// ═════════════════════════════════════════════════════════════════════════════
function externalizeImages(svgString) {
  const doc  = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const svg  = doc.querySelector('svg');
  const assets = [];
  if (!svg) return { svgString, assets };

  svg.querySelectorAll('image').forEach((img, i) => {
    const attr = img.hasAttribute('href') ? 'href' : 'xlink:href';
    const href = img.getAttribute(attr) || '';
    if (!href.startsWith('data:')) return;
    const m = href.match(/^data:([^;]+);base64,(.+)$/s);
    if (!m) return;
    const ext = (m[1].split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
    const filename = `assets/image-${i + 1}.${ext}`;
    img.setAttribute(attr, filename);
    assets.push({ filename, mimeType: m[1], data: m[2] });
  });

  return { svgString: new XMLSerializer().serializeToString(svg), assets };
}


// ═════════════════════════════════════════════════════════════════════════════
// BANNER CSS  (for ZIP export — uses fixed pixel dimensions)
// ═════════════════════════════════════════════════════════════════════════════
function generateBannerCSS(w, h, opts) {
  const border = opts && opts.showBorder ? `
.banner::after { content:''; position:absolute; inset:0; border:1px solid rgba(0,0,0,.12); pointer-events:none; z-index:9999; }` : '';
  return `/* Banner Engine v3.2 */
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden;background:#000}
.banner{position:relative;width:${w}px;height:${h}px;overflow:hidden;cursor:pointer}
.banner>svg{position:absolute;top:0;left:0;width:100%;height:100%}${border}`;
}


// ═════════════════════════════════════════════════════════════════════════════
// ZIP EXPORT
// ═════════════════════════════════════════════════════════════════════════════
async function downloadZIP() {
  const raw = svgInput.value.trim();
  if (!raw) { alert('Please paste or drop an SVG first.'); return; }

  setStatus('Building ZIP…');
  setPreviewStatus('Building ZIP…', 'working');

  let analysis = (raw === state.lastSVGRaw && state.lastAnalysis) ? state.lastAnalysis : null;
  if (!analysis) {
    try {
      analysis = analyzeSVG(raw);
      state.lastSVGRaw = raw; state.lastAnalysis = analysis; state.layers = analysis.layers;
      renderLayerTree();
    } catch (e) {
      alert('Invalid SVG: ' + e.message);
      setStatus('Export failed', true);
      setPreviewStatus('Export failed', 'error');
      return;
    }
  }

  const outW = state.adSize ? state.adSize.width  : analysis.width;
  const outH = state.adSize ? state.adSize.height : analysis.height;

  const { svgString: svgExt, assets } = externalizeImages(analysis.svg);

  const animScript = buildAnimationScript(state.layers, {
    speed: state.animSpeed, delay: state.animDelay,
    lineStagger: state.lineStagger, ctaColor: ctaColorInput.value.trim() || null,
  });

  const borderCSS = state.showBorder ? `
.banner::after { content:''; position:absolute; inset:0; border:1px solid rgba(0,0,0,.12); pointer-events:none; z-index:9999; }` : '';

  const bannerHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=${outW}, initial-scale=1.0"/>
<link rel="stylesheet" href="style.css"/>
</head>
<body>
<script>var clickTag = "${state.clickTagURL}";<\/script>
<div class="banner" id="banner">${svgExt}<\/div>
<script>
document.getElementById('banner').addEventListener('click', function(){
  var u = (typeof ADC!=='undefined'&&ADC.click)?ADC.click:clickTag;
  window.open(u,'_blank');
});
<\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"><\/script>
<script>${animScript}<\/script>
</body>
</html>`;

  const styleCSS = generateBannerCSS(outW, outH, { showBorder: state.showBorder });

  const manifest = JSON.stringify({
    version: '1.0', title: `Banner ${outW}x${outH}`,
    width: outW, height: outH,
    clickTags: [{ name: 'clickTag', enabledTargets: ['url'] }],
    clickTag: state.clickTagURL,
  }, null, 2);

  const zip = new JSZip();
  const folder = zip.folder(`banner_${outW}x${outH}`);
  folder.file('index.html', bannerHTML);
  folder.file('style.css',  styleCSS);
  folder.file('manifest.json', manifest);
  folder.file('source.svg', raw);
  assets.forEach(a => folder.file(a.filename, a.data, { base64: true }));

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `banner_${outW}x${outH}_${Date.now()}.zip`);

  const msg = `ZIP ready — ${assets.length} asset${assets.length !== 1 ? 's' : ''} extracted`;
  setStatus(msg);
  setPreviewStatus(msg, 'ok');
  console.log('[Banner Engine]', msg);
}


// ═════════════════════════════════════════════════════════════════════════════
// DROP ZONE
// ═════════════════════════════════════════════════════════════════════════════
function initDropZone() {
  const zone = document.getElementById('svg-drop-zone');
  if (!zone) return;

  let counter = 0;

  zone.addEventListener('dragenter', e => { e.preventDefault(); counter++; zone.classList.add('drag-hover'); });
  zone.addEventListener('dragover',  e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  zone.addEventListener('dragleave', () => { if (--counter <= 0) { counter = 0; zone.classList.remove('drag-hover'); } });

  zone.addEventListener('drop', e => {
    e.preventDefault();
    counter = 0;
    zone.classList.remove('drag-hover');

    const file = e.dataTransfer.files[0];
    if (!file) return;

    const ok = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
    if (!ok) {
      setStatus(`"${file.name}" is not an SVG`, true);
      setPreviewStatus('Wrong file type', 'error');
      zone.classList.add('drop-error');
      setTimeout(() => zone.classList.remove('drop-error'), 800);
      return;
    }

    setStatus('Reading file…');
    setPreviewStatus('Reading file…', 'working');
    console.log('[Banner Engine] Reading file:', file.name, Math.round(file.size / 1024) + ' KB');

    const reader = new FileReader();
    reader.onload = evt => { svgInput.value = evt.target.result; runPreview(); };
    reader.onerror = () => { setStatus('Could not read file', true); setPreviewStatus('File read error', 'error'); };
    reader.readAsText(file);
  });
}
