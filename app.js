/**
 * SVG → HTML5 Banner Engine · app.js  v4.0
 *
 * Features:
 *  - IAB standard banner formats with live preview resizing
 *  - Batch multi-format ZIP export
 *  - Smart layer detection: BG / IMG / TXT / SHAPE / CTA
 *  - Live preview on layer toggle (debounced)
 *  - Inline text editing per text layer
 *  - Animation timeline: play/pause/restart/scrubber via postMessage
 *  - Undo / Redo for layer changes (Ctrl+Z / Ctrl+Y)
 *  - Toast notifications + loading spinner
 *  - Copy HTML to clipboard
 *  - Embedded-font warning
 *  - Empty-state drop zone
 *  - Reset sliders on clear
 */

// ─── IAB Standard Formats ─────────────────────────────────────────────────────
const IAB_FORMATS = [
  { id: 'auto',    label: 'Auto',      w: null, h: null },
  { id: '300x250', label: '300×250',   w: 300,  h: 250,  name: 'Medium Rectangle' },
  { id: '728x90',  label: '728×90',    w: 728,  h: 90,   name: 'Leaderboard' },
  { id: '320x50',  label: '320×50',    w: 320,  h: 50,   name: 'Mobile Banner' },
  { id: '160x600', label: '160×600',   w: 160,  h: 600,  name: 'Wide Skyscraper' },
  { id: '300x600', label: '300×600',   w: 300,  h: 600,  name: 'Half Page' },
  { id: '970x250', label: '970×250',   w: 970,  h: 250,  name: 'Billboard' },
  { id: '320x480', label: '320×480',   w: 320,  h: 480,  name: 'Mobile Interstitial' },
  { id: '240x400', label: '240×400',   w: 240,  h: 400,  name: 'Vertical Rectangle' },
  { id: '250x250', label: '250×250',   w: 250,  h: 250,  name: 'Square' },
  { id: '1080x1080', label: '1080×1080', w: 1080, h: 1080, name: 'Instagram Square' },
];

// ─── CTA keywords ─────────────────────────────────────────────────────────────
const CTA_KEYWORDS = /\b(ontdek|bekijk|koop|shop|meer|lees|download|start|nu|now|learn|buy|get|try|sign|book|open|apply|join|register|subscribe|check|view|discover|explore|bestellen|aanvragen)\b/i;

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  animSpeed:          1.0,
  animDelay:          0.15,
  lineStagger:        0.08,
  selectedFormat:     IAB_FORMATS[0],   // 'auto'
  showBorder:         false,
  clickTagURL:        'https://www.example.com',
  lastHTML:           '',
  lastSVGRaw:         '',
  lastAnalysis:       null,
  layers:             [],
  _ratioManuallySet:  false,
  // Batch export
  batchFormats:       new Set(['300x250', '728x90', '320x50', '300x600']),
  // Animation timeline state
  animPlaying:        true,
  animDuration:       0,
  animTime:           0,
};

// ─── History (undo/redo) ──────────────────────────────────────────────────────
const hist = { past: [], future: [], MAX: 40 };

function snapshot() {
  const s = JSON.stringify(state.layers.map(l => ({
    id: l.id, animate: l.animate, order: l.order,
    textOverride: l.textOverride || null,
  })));
  hist.past.push({ layers: s, svg: state.lastAnalysis ? state.lastAnalysis.svg : null });
  hist.future = [];
  if (hist.past.length > hist.MAX) hist.past.shift();
  syncUndoButtons();
}

function undo() {
  if (!hist.past.length) return;
  const cur = { layers: JSON.stringify(state.layers.map(l => ({ id:l.id, animate:l.animate, order:l.order, textOverride:l.textOverride||null }))), svg: state.lastAnalysis?.svg || null };
  hist.future.push(cur);
  applySnap(hist.past.pop());
}

function redo() {
  if (!hist.future.length) return;
  const cur = { layers: JSON.stringify(state.layers.map(l => ({ id:l.id, animate:l.animate, order:l.order, textOverride:l.textOverride||null }))), svg: state.lastAnalysis?.svg || null };
  hist.past.push(cur);
  applySnap(hist.future.pop());
}

function applySnap(snap) {
  const saved = JSON.parse(snap.layers);
  saved.forEach(s => {
    const l = state.layers.find(x => x.id === s.id);
    if (l) { l.animate = s.animate; l.order = s.order; l.textOverride = s.textOverride; }
  });
  if (snap.svg && state.lastAnalysis) state.lastAnalysis.svg = snap.svg;
  state.layers.sort((a, b) => a.order - b.order);
  renderLayerTree();
  debouncedPreview();
  syncUndoButtons();
}

function syncUndoButtons() {
  const u = document.getElementById('undo-btn');
  const r = document.getElementById('redo-btn');
  if (u) u.classList.toggle('enabled', hist.past.length > 0);
  if (r) r.classList.toggle('enabled', hist.future.length > 0);
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const svgInput          = document.getElementById('svg-input');
const previewFrame      = document.getElementById('preview-frame');
const previewPH         = document.getElementById('preview-placeholder');
const previewLoading    = document.getElementById('preview-loading');
const arShell           = document.getElementById('ar-shell');
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
const previewStatusDot  = document.getElementById('preview-status-dot');
const previewStatusLabel= document.getElementById('preview-status-label');
const animControls      = document.getElementById('anim-controls');
const animPlayBtn       = document.getElementById('anim-play-btn');
const animRestartBtn    = document.getElementById('anim-restart-btn');
const animScrubber      = document.getElementById('anim-scrubber');
const animTimeLabel     = document.getElementById('anim-time');
const emptyDropZone     = document.getElementById('empty-drop-zone');
const svgInfoBar        = document.getElementById('svg-info-bar');
const svgInfoText       = document.getElementById('svg-info-text');
const fontWarning       = document.getElementById('font-warning');
const toastArea         = document.getElementById('toast-area');
const batchPanel        = document.getElementById('batch-panel');
const batchFormatList   = document.getElementById('batch-format-list');
const batchChevron      = document.getElementById('batch-chevron');

console.log('[Banner Engine v4.0] Loaded');

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${msg}</span>`;
  toastArea.appendChild(el);
  requestAnimationFrame(() => { requestAnimationFrame(() => el.classList.add('show')); });
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, duration);
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function showSpinner() { previewLoading.classList.add('show'); }
function hideSpinner() { previewLoading.classList.remove('show'); }

// ─── Status helpers ───────────────────────────────────────────────────────────
function setStatus(msg, isError) {
  statusBadge.classList.remove('hidden');
  statusBadge.classList.add('flex');
  statusText.textContent = msg;
  const c = isError ? 'red' : 'emerald';
  statusBadge.className = `flex items-center gap-1.5 text-xs text-${c}-400`;
  const dot = statusBadge.querySelector('span');
  if (dot) dot.className = `w-2 h-2 rounded-full bg-${c}-400 live-dot shrink-0`;
}

function setPreviewStatus(msg, type) {
  const clr = { idle: 'gray-700', working: 'yellow-400', ok: 'emerald-400', error: 'red-400' };
  const c = clr[type] || clr.idle;
  previewStatusDot.className   = `w-1.5 h-1.5 rounded-full bg-${c} shrink-0`;
  previewStatusLabel.className = `text-xs font-mono text-${c}`;
  previewStatusLabel.textContent = msg;
  document.getElementById('preview-status-text').textContent = msg;
}

// ─── Format system ────────────────────────────────────────────────────────────
function buildFormatChips() {
  const container = document.getElementById('format-chips-header');
  if (!container) return;
  IAB_FORMATS.forEach(fmt => {
    const btn = document.createElement('button');
    btn.className = 'fmt-chip' + (fmt.id === state.selectedFormat.id ? ' active' : '');
    btn.textContent = fmt.label;
    btn.title = fmt.name || fmt.label;
    btn.dataset.fmtId = fmt.id;
    container.appendChild(btn);
  });
}

function applyFormat(fmt) {
  state.selectedFormat = fmt;
  // Update chip active state
  document.querySelectorAll('.fmt-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.fmtId === fmt.id);
  });
  // Update preview aspect ratio shell
  if (fmt.w && fmt.h) {
    const pct = (fmt.h / fmt.w * 100).toFixed(4) + '%';
    arShell.style.setProperty('--ar', pct);
    // Constrain the shell so tall banners don't overflow
    const isWide = fmt.w > fmt.h;
    arShell.style.maxWidth  = isWide ? '100%' : '60%';
    arShell.style.maxHeight = '100%';
  } else if (state.lastAnalysis) {
    const pct = (state.lastAnalysis.height / state.lastAnalysis.width * 100).toFixed(4) + '%';
    arShell.style.setProperty('--ar', pct);
    arShell.style.maxWidth = '100%';
  }
  detectedInfo.textContent = fmt.w ? `${fmt.w}×${fmt.h} ${fmt.name ? '· ' + fmt.name : ''}` : (state.lastAnalysis ? `${state.lastAnalysis.width}×${state.lastAnalysis.height} · Auto` : '');
}

// ─── Build batch export UI ────────────────────────────────────────────────────
function buildBatchFormatList() {
  batchFormatList.innerHTML = '';
  IAB_FORMATS.filter(f => f.w).forEach(fmt => {
    const row = document.createElement('label');
    row.className = 'flex items-center gap-2 cursor-pointer py-0.5';
    row.innerHTML = `
      <input type="checkbox" class="batch-fmt-check rounded" data-fmt-id="${fmt.id}" ${state.batchFormats.has(fmt.id) ? 'checked' : ''}>
      <span class="text-xs text-gray-400 font-mono">${fmt.label}</span>
      <span class="text-xs text-gray-700 truncate">${fmt.name}</span>`;
    row.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) state.batchFormats.add(fmt.id);
      else state.batchFormats.delete(fmt.id);
    });
    batchFormatList.appendChild(row);
  });
}

// ─── Slider listeners ─────────────────────────────────────────────────────────
speedSlider.addEventListener('input', () => {
  state.animSpeed = parseFloat(speedSlider.value);
  speedVal.textContent = state.animSpeed.toFixed(1) + '×';
  debouncedPreview();
});
delaySlider.addEventListener('input', () => {
  state.animDelay = parseFloat(delaySlider.value);
  delayVal.textContent = state.animDelay.toFixed(2) + 's';
  debouncedPreview();
});
staggerSlider.addEventListener('input', () => {
  state.lineStagger = parseFloat(staggerSlider.value);
  staggerVal.textContent = state.lineStagger.toFixed(2) + 's';
  debouncedPreview();
});
borderToggle.addEventListener('change', () => { state.showBorder = borderToggle.checked; debouncedPreview(); });
clickTagInput.addEventListener('input', () => { state.clickTagURL = clickTagInput.value.trim() || 'https://www.example.com'; });

// ─── Auto-preview debounce ────────────────────────────────────────────────────
let debounceTimer;
function debouncedPreview(delay = 400) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runPreview, delay);
}

svgInput.addEventListener('input', () => {
  const v = svgInput.value.trim();
  if (v.startsWith('<svg') || v.startsWith('<?xml')) debouncedPreview(700);
});

// ─── Single delegated click handler ──────────────────────────────────────────
document.addEventListener('click', function (e) {
  const btn = e.target.closest('button, .fmt-chip');
  if (!btn) return;

  if (btn.classList.contains('fmt-chip')) {
    const fmt = IAB_FORMATS.find(f => f.id === btn.dataset.fmtId);
    if (fmt) { applyFormat(fmt); if (state.lastAnalysis) debouncedPreview(100); }
    return;
  }

  switch (btn.id) {
    case 'preview-btn':      runPreview(); break;
    case 'download-btn':     downloadZIP(); break;
    case 'replay-btn':       doReplay(); break;
    case 'play-overlay':     doReplay(); break;
    case 'clear-btn':        doClear(); break;
    case 'copy-html-btn':    copyHTML(); break;
    case 'export-all-btn':   downloadAllFormats(); break;
    case 'undo-btn':         undo(); break;
    case 'redo-btn':         redo(); break;
    case 'batch-toggle-btn': toggleBatchPanel(); break;
    case 'anim-play-btn':    toggleAnimPlay(); break;
    case 'anim-restart-btn': doReplay(); break;
  }
});

function toggleBatchPanel() {
  const open = batchPanel.classList.toggle('open');
  batchChevron.textContent = open ? '▾' : '▸';
  if (open) buildBatchFormatList();
}

// ─── Animation timeline controls ─────────────────────────────────────────────
function toggleAnimPlay() {
  state.animPlaying = !state.animPlaying;
  animPlayBtn.textContent = state.animPlaying ? '⏸' : '▶';
  sendTL(state.animPlaying ? 'play' : 'pause');
}

animScrubber.addEventListener('input', () => {
  const pct = parseFloat(animScrubber.value) / 100;
  const t = pct * (state.animDuration || 3);
  sendTL('seek', { t });
});

function sendTL(action, extra) {
  try { previewFrame.contentWindow.postMessage(Object.assign({ a: action }, extra || {}), '*'); } catch (_) {}
}

window.addEventListener('message', function (e) {
  if (!e.data || e.data.type !== 'bannerTL') return;
  const { t, d, p } = e.data;
  state.animTime     = t;
  state.animDuration = d;
  const pct = p * 100;
  if (!animScrubber.matches(':active')) animScrubber.value = pct;
  animTimeLabel.textContent = t.toFixed(1) + ' / ' + d.toFixed(1) + 's';
});

// ─── Keyboard shortcuts (Undo/Redo) ──────────────────────────────────────────
document.addEventListener('keydown', function (e) {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
});

// ─── Drop zone ────────────────────────────────────────────────────────────────
initDropZone();

// ─── Init ─────────────────────────────────────────────────────────────────────
buildFormatChips();
syncUndoButtons();
console.log('[Banner Engine v4.0] Ready');


// ═════════════════════════════════════════════════════════════════════════════
// runPreview
// ═════════════════════════════════════════════════════════════════════════════
function runPreview() {
  const raw = svgInput.value.trim();
  if (!raw) {
    setPreviewStatus('No SVG — drop or paste', 'idle');
    return;
  }

  console.log('[Banner Engine] SVG detected —', raw.length, 'chars');
  setStatus('Analysing…');
  setPreviewStatus('Analysing…', 'working');
  showSpinner();

  if (raw !== state.lastSVGRaw) {
    let analysis;
    try { analysis = analyzeSVG(raw); }
    catch (e) {
      console.error('[Banner Engine] analyzeSVG:', e);
      hideSpinner();
      setStatus('Parse error: ' + e.message, true);
      setPreviewStatus('Parse error', 'error');
      return;
    }

    console.log('[Banner Engine] Layers:', analysis.layers.length, '| Size:', analysis.width + '×' + analysis.height);

    state.lastSVGRaw   = raw;
    state.lastAnalysis = analysis;
    state.layers       = analysis.layers;

    // Update aspect ratio from SVG if no format forced
    if (state.selectedFormat.id === 'auto') {
      const pct = (analysis.height / analysis.width * 100).toFixed(4) + '%';
      arShell.style.setProperty('--ar', pct);
      arShell.style.maxWidth = '100%';
    }

    // SVG info bar
    const hasFonts = /@font-face/i.test(raw) || /font-face/i.test(raw);
    svgInfoText.textContent = `${analysis.width}×${analysis.height} px  ·  ${analysis.layers.length} layers`;
    svgInfoBar.classList.remove('hidden');
    fontWarning.classList.toggle('hidden', !hasFonts);
    if (hasFonts) toast('⚠ Embedded fonts detected — may not render in all ad environments', 'warn', 5000);

    // Show/hide empty drop zone
    emptyDropZone.style.display = 'none';
    renderLayerTree();
  }

  if (!state.lastAnalysis) { hideSpinner(); return; }

  const html = buildPreviewHTML(state.lastAnalysis);
  state.lastHTML = html;

  console.log('[Banner Engine] Injecting srcdoc —', Math.round(html.length / 1024) + ' KB');
  setPreviewStatus('Loading…', 'working');

  previewFrame.srcdoc = html;
  previewFrame.style.display = 'block';
  previewPH.style.display    = 'none';
  replayBtn.classList.remove('hidden');
  animControls.classList.remove('hidden');
  state.animPlaying = true;
  animPlayBtn.textContent = '⏸';

  // Format display
  applyFormat(state.selectedFormat);

  setStatus('Preview ready');
  setPreviewStatus('Preview ready', 'ok');

  // Hide spinner after iframe loads
  previewFrame.onload = () => hideSpinner();
  setTimeout(hideSpinner, 2000); // fallback
}

// ─── Replay ───────────────────────────────────────────────────────────────────
function doReplay() {
  if (!state.lastHTML) return;
  setPreviewStatus('Replaying…', 'working');
  showSpinner();
  state.animPlaying = true;
  animPlayBtn.textContent = '⏸';
  previewFrame.srcdoc = '';
  requestAnimationFrame(() => {
    previewFrame.srcdoc = state.lastHTML;
    setPreviewStatus('Preview ready', 'ok');
    previewFrame.onload = () => hideSpinner();
    setTimeout(hideSpinner, 2000);
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
  animControls.classList.add('hidden');
  statusBadge.classList.add('hidden');
  svgInfoBar.classList.add('hidden');
  emptyDropZone.style.display = '';
  detectedInfo.textContent = '';
  // Reset sliders
  speedSlider.value = '1';   speedVal.textContent = '1.0×';   state.animSpeed = 1.0;
  delaySlider.value = '0.15'; delayVal.textContent = '0.15s'; state.animDelay = 0.15;
  staggerSlider.value = '0.08'; staggerVal.textContent = '0.08s'; state.lineStagger = 0.08;
  setPreviewStatus('Waiting for SVG…', 'idle');
  renderLayerTree();
  hist.past = []; hist.future = [];
  syncUndoButtons();
  console.log('[Banner Engine] Cleared');
}

// ─── Copy HTML ────────────────────────────────────────────────────────────────
function copyHTML() {
  if (!state.lastHTML) { toast('Generate a preview first', 'warn'); return; }
  navigator.clipboard.writeText(state.lastHTML)
    .then(() => toast('HTML copied to clipboard ✓', 'success'))
    .catch(() => toast('Copy failed — check browser permissions', 'error'));
}


// ═════════════════════════════════════════════════════════════════════════════
// buildPreviewHTML
// 100% fill CSS, GSAP inline, postMessage timeline reporting
// ═════════════════════════════════════════════════════════════════════════════
function buildPreviewHTML(analysis) {
  const clickURL   = state.clickTagURL;
  const svgToUse   = applyTextOverrides(analysis.svg, state.layers);
  const animScript = buildAnimationScript(state.layers, {
    speed:       state.animSpeed,
    delay:       state.animDelay,
    lineStagger: state.lineStagger,
    ctaColor:    ctaColorInput.value.trim() || null,
  });

  const borderCSS = state.showBorder
    ? `#banner::after{content:'';position:absolute;inset:0;border:1px solid rgba(0,0,0,.12);pointer-events:none;z-index:9999;}`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}
#banner{position:relative;width:100%;height:100%;overflow:hidden;cursor:pointer}
#banner>svg{width:100%;height:100%;display:block}
${borderCSS}
</style>
</head>
<body>
<script>var clickTag="${clickURL}";<\/script>
<div id="banner">${svgToUse}</div>
<script>
document.getElementById('banner').addEventListener('click',function(){
  var u=(typeof ADC!=='undefined'&&ADC.click)?ADC.click:clickTag;
  window.open(u,'_blank');
});
<\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"><\/script>
<script>
${animScript}
<\/script>
</body>
</html>`;
}

// Apply any inline text edits to the serialized SVG
function applyTextOverrides(svgString, layers) {
  const overrides = layers.filter(l => l.type === 'text' && l.textOverride);
  if (!overrides.length) return svgString;

  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) return svgString;

  overrides.forEach(layer => {
    layer.elementIds.forEach((id, i) => {
      const el = svg.querySelector('#' + CSS.escape(id));
      if (!el) return;
      el.textContent = i === 0 ? layer.textOverride : '';
    });
  });

  return new XMLSerializer().serializeToString(svg);
}


// ═════════════════════════════════════════════════════════════════════════════
// analyzeSVG  —  improved layer detection
// ═════════════════════════════════════════════════════════════════════════════
function analyzeSVG(svgString) {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('SVG parse error');
  const svg = doc.querySelector('svg');
  if (!svg) throw new Error('No <svg> root found');

  const { width, height, aspectRatio } = extractDimensions(svg);

  // Sanitize: remove hardcoded pixel dimensions so CSS fills the iframe
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (!svg.getAttribute('preserveAspectRatio')) svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Detect layers
  const ctaGroups  = findCTAGroups(svg, width, height);
  const ctaClaimed = new Set(ctaGroups.map(g => g.el));
  const textGroups = findTextGroups(svg, ctaClaimed, height);
  const imageEls   = findImageElements(svg);
  const shapeEls   = findShapeElements(svg, ctaClaimed);

  // Stable IDs
  let seq = 0;
  const uid = (el, prefix) => {
    if (!el.id || !el.id.trim()) el.setAttribute('id', `be-${prefix}-${++seq}`);
    return el.id;
  };

  const layers = [];
  let order = 0;

  // Background
  const bgFill = detectBackground(svg);
  layers.push({
    id: 'layer-bg',
    label: bgFill ? `BG: ${bgFill}` : 'Background',
    type: 'background', elementIds: [], animate: true, order: order++,
  });

  // Images
  imageEls.forEach((el, i) => {
    layers.push({
      id: `layer-img-${i}`,
      label: `IMG: ${i + 1}`,
      type: 'image', elementIds: [uid(el, 'img')], animate: true, order: order++,
    });
  });

  // Shapes (non-CTA, not background-rect)
  shapeEls.forEach((el, i) => {
    const tag = el.tagName;
    layers.push({
      id: `layer-shape-${i}`,
      label: `Shape: ${tag}`,
      type: 'shape', elementIds: [uid(el, 'shp')], animate: true, order: order++,
    });
  });

  // Text clusters
  textGroups.forEach((group, i) => {
    const ids   = group.elements.map(el => uid(el, 'txt'));
    const label = group.text.slice(0, 24) + (group.text.length > 24 ? '…' : '');
    layers.push({
      id: `layer-txt-${i}`,
      label: `TXT: ${label || `Group ${i + 1}`}`,
      type: 'text', elementIds: ids, animate: true, order: order++,
      textContent: group.text,   // original full text for inline editing
      textOverride: null,
    });
  });

  // CTAs
  ctaGroups.forEach((group, i) => {
    layers.push({
      id: `layer-cta-${i}`,
      label: group.label, type: 'cta',
      elementIds: [uid(group.el, 'cta')], animate: true, order: order++,
    });
  });

  return {
    svg: new XMLSerializer().serializeToString(svg),
    width, height, aspectRatio, layers,
  };
}

function extractDimensions(svg) {
  let w = 0, h = 0;
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const p = vb.trim().split(/[\s,]+/);
    if (p.length >= 4) { w = parseFloat(p[2]); h = parseFloat(p[3]); }
  }
  if (!w) { const a = svg.getAttribute('width')  || ''; if (a && !a.includes('%')) w = parseFloat(a); }
  if (!h) { const a = svg.getAttribute('height') || ''; if (a && !a.includes('%')) h = parseFloat(a); }
  w = w || 1080; h = h || 1080;
  const r = w / h;
  return { width: w, height: h, aspectRatio: r > 1.6 ? '16:9' : r < 0.9 ? '4:5' : '1:1' };
}

function detectBackground(svg) {
  const first = svg.children[0];
  if (!first) return null;
  if (first.tagName === 'rect') {
    const fill = first.getAttribute('fill') || '';
    return fill || 'rect';
  }
  return null;
}

function findImageElements(svg) { return Array.from(svg.querySelectorAll('image')); }

function findShapeElements(svg, ctaClaimed) {
  return Array.from(svg.querySelectorAll('rect, circle, ellipse, polygon'))
    .filter(el => {
      // Skip if inside a CTA group
      let node = el.parentElement;
      while (node && node !== svg) { if (ctaClaimed.has(node)) return false; node = node.parentElement; }
      // Skip if it looks like a full-bleed background rect
      const w = parseFloat(el.getAttribute('width')  || el.getAttribute('r') || 0);
      const h = parseFloat(el.getAttribute('height') || el.getAttribute('r') || 0);
      return w < 800 || h < 800;
    });
}

function findTextGroups(svg, ctaClaimed, svgH) {
  const THRESHOLD = (svgH || 1080) * 0.1;
  const texts = Array.from(svg.querySelectorAll('text')).filter(t => {
    let el = t.parentElement;
    while (el && el !== svg) { if (ctaClaimed.has(el)) return false; el = el.parentElement; }
    return true;
  });
  if (!texts.length) return [];
  const withY = texts.map(t => ({ el: t, y: getApproxY(t) })).sort((a, b) => a.y - b.y);
  const clusters = [[withY[0]]];
  for (let i = 1; i < withY.length; i++) {
    if (withY[i].y - withY[i - 1].y <= THRESHOLD) clusters[clusters.length - 1].push(withY[i]);
    else clusters.push([withY[i]]);
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

function getFill(el, svg) {
  let fill = el.getAttribute('fill') || el.style?.fill;
  if (!fill || fill === 'none') return null;
  if (fill.startsWith('url(')) {
    const m = fill.match(/url\(#([^)]+)\)/);
    if (m) {
      const g = svg.querySelector('#' + m[1]);
      if (g) { const s = g.querySelector('stop'); if (s) fill = s.getAttribute('stop-color') || s.style?.stopColor || fill; }
    }
  }
  return fill || null;
}

function estimateArea(el) {
  switch (el.tagName) {
    case 'rect': return (parseFloat(el.getAttribute('width'))||0)*(parseFloat(el.getAttribute('height'))||0);
    case 'circle': { const r=parseFloat(el.getAttribute('r'))||0; return Math.PI*r*r; }
    case 'ellipse': return Math.PI*(parseFloat(el.getAttribute('rx'))||0)*(parseFloat(el.getAttribute('ry'))||0);
    case 'path': {
      const ns=(el.getAttribute('d')||'').match(/-?\d+\.?\d*/g);
      if(!ns||ns.length<4) return 0;
      const vs=ns.map(Number),xs=vs.filter((_,i)=>i%2===0),ys=vs.filter((_,i)=>i%2===1);
      return (Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys));
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
  if (hex.startsWith('rgb')) { const m=hex.match(/(\d+)/g); return m&&m.length>=3?rgbToHSL(+m[0],+m[1],+m[2]):null; }
  if (!hex.startsWith('#')) return null;
  hex=hex.slice(1);
  if (hex.length===3) hex=hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  if (hex.length!==6) return null;
  return rgbToHSL(parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16));
}

function rgbToHSL(r,g,b) {
  r/=255;g/=255;b/=255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;
  if(max===min) return{h:0,s:0,l:l*100};
  const d=max-min,s=l>.5?d/(2-max-min):d/(max+min);
  let h;
  if(max===r) h=((g-b)/d+(g<b?6:0))/6;
  else if(max===g) h=((b-r)/d+2)/6;
  else h=((r-g)/d+4)/6;
  return{h:h*360,s:s*100,l:l*100};
}


// ═════════════════════════════════════════════════════════════════════════════
// LAYER TREE  —  with inline text editing
// ═════════════════════════════════════════════════════════════════════════════
const TYPE_META = {
  background: { css: 'type-bg',    badge: 'BG'    },
  image:      { css: 'type-img',   badge: 'IMG'   },
  text:       { css: 'type-text',  badge: 'TXT'   },
  cta:        { css: 'type-cta',   badge: 'CTA'   },
  shape:      { css: 'type-shape', badge: 'SHAPE' },
};

let _dragId = null;

function renderLayerTree() {
  Array.from(layerTree.children).forEach(c => { if (c !== layerEmpty) c.remove(); });
  if (!state.layers.length) {
    layerEmpty.style.display = 'block';
    layerCount.textContent = '';
    return;
  }
  layerEmpty.style.display = 'none';
  layerCount.textContent = state.layers.length + ' layer' + (state.layers.length !== 1 ? 's' : '');
  [...state.layers].sort((a, b) => a.order - b.order).forEach((l, i) => layerTree.appendChild(buildLayerRow(l, i + 1)));
}

function buildLayerRow(layer, n) {
  const meta = TYPE_META[layer.type] || TYPE_META.text;
  const row  = document.createElement('div');
  row.className = 'layer-row flex items-center gap-2 px-2 py-1.5 rounded-lg select-none';
  row.setAttribute('draggable', 'true');
  row.dataset.layerId = layer.id;
  if (!layer.animate) row.style.opacity = '0.4';

  // For text layers: show inline edit input; for others: just the label
  const labelHTML = layer.type === 'text'
    ? `<div class="flex-1 flex flex-col gap-0.5 min-w-0">
         <span class="text-xs text-gray-500 truncate">${escH(layer.label)}</span>
         <input type="text" class="text-edit-input" value="${escA(layer.textOverride ?? layer.textContent ?? '')}"
           data-layer-id="${layer.id}" placeholder="Edit text…">
       </div>`
    : `<span class="flex-1 text-xs text-gray-400 truncate">${escH(layer.label)}</span>`;

  const lineInfo = layer.type === 'text' && layer.elementIds.length > 1
    ? `<span class="shrink-0 text-xs text-gray-700 font-mono">${layer.elementIds.length}L</span>` : '';

  row.innerHTML = `
    <span class="drag-handle text-gray-700 hover:text-gray-500 text-sm px-0.5">⠿</span>
    <span class="shrink-0 w-5 h-5 flex items-center justify-center rounded text-xs font-mono bg-gray-900 text-gray-600">${n}</span>
    <span class="shrink-0 text-xs font-bold px-1.5 py-0.5 rounded ${meta.css}">${meta.badge}</span>
    ${labelHTML}${lineInfo}
    <label class="toggle shrink-0">
      <input type="checkbox" ${layer.animate ? 'checked' : ''} class="anim-toggle" data-layer-id="${layer.id}">
      <span class="toggle-slider"></span>
    </label>`;

  // Toggle animate — with snapshot + live update
  row.querySelector('.anim-toggle').addEventListener('change', e => {
    snapshot();
    const t = state.layers.find(l => l.id === e.target.dataset.layerId);
    if (t) { t.animate = e.target.checked; row.style.opacity = t.animate ? '1' : '0.4'; }
    debouncedPreview(200);
  });

  // Inline text edit
  if (layer.type === 'text') {
    const input = row.querySelector('.text-edit-input');
    input.addEventListener('focus', () => snapshot()); // snapshot before editing
    input.addEventListener('input', e => {
      const t = state.layers.find(l => l.id === e.target.dataset.layerId);
      if (t) t.textOverride = e.target.value;
      debouncedPreview(500);
    });
    // Don't let typing in the input trigger layer drag
    input.addEventListener('mousedown', e => e.stopPropagation());
  }

  // Drag-and-drop
  row.addEventListener('dragstart', e => {
    _dragId = layer.id;
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => row.classList.add('drag-active'));
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('drag-active');
    _dragId = null;
    layerTree.querySelectorAll('.layer-row').forEach(r => r.classList.remove('drag-over'));
  });
  row.addEventListener('dragover', e => {
    if (!_dragId || _dragId === layer.id) return;
    e.preventDefault();
    layerTree.querySelectorAll('.layer-row').forEach(r => r.classList.remove('drag-over'));
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', e => {
    e.preventDefault();
    row.classList.remove('drag-over');
    if (!_dragId || _dragId === layer.id) return;
    snapshot();
    const fi = state.layers.findIndex(l => l.id === _dragId);
    const ti = state.layers.findIndex(l => l.id === layer.id);
    if (fi < 0 || ti < 0) return;
    const [moved] = state.layers.splice(fi, 1);
    state.layers.splice(state.layers.findIndex(l => l.id === layer.id), 0, moved);
    state.layers.forEach((l, i) => { l.order = i; });
    renderLayerTree();
    debouncedPreview(200);
  });

  return row;
}

function escH(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escA(s) { return String(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }


// ═════════════════════════════════════════════════════════════════════════════
// ANIMATION SCRIPT BUILDER  —  with postMessage timeline reporting
// ═════════════════════════════════════════════════════════════════════════════
function buildAnimationScript(layers, opts) {
  const SPD = (1 / (opts.speed || 1.0)).toFixed(3);
  const LAG = (opts.lineStagger || 0.08).toFixed(3);
  const CTAC = opts.ctaColor || null;

  const active = [...layers].filter(l => l.animate).sort((a, b) => a.order - b.order);

  const blocks = active.map(layer => {
    switch (layer.type) {
      case 'background':
        return `  tl.from('#banner>svg',{opacity:0,duration:SPD*0.8},'<');`;
      case 'image': {
        if (!layer.elementIds.length) return '';
        return `  tl.from(${sel(layer.elementIds)},{opacity:0,scale:1.06,transformOrigin:'50% 50%',duration:SPD*1.2,ease:'power1.out'},'>-0.1');`;
      }
      case 'shape': {
        if (!layer.elementIds.length) return '';
        return `  tl.from(${sel(layer.elementIds)},{opacity:0,scale:0.95,transformOrigin:'50% 50%',duration:SPD*0.8},'>-0.05');`;
      }
      case 'text': {
        if (!layer.elementIds.length) return '';
        return `  tl.from(${sel(layer.elementIds)},{opacity:0,y:14,duration:SPD*0.7,stagger:LAG},'>-0.05');`;
      }
      case 'cta': {
        if (!layer.elementIds.length) return '';
        const fb = CTAC ? `||Array.from(document.querySelectorAll('[fill="${CTAC}"]'))` : '';
        return `
  (function(){
    var els=Array.from(document.querySelectorAll(${sel(layer.elementIds)}))${fb};
    if(!els.length)return;
    tl.from(els,{opacity:0,scale:0.82,transformOrigin:'50% 50%',duration:SPD*0.5,ease:'back.out(1.7)',stagger:0.06},'>');
    tl.call(function(){(function p(){gsap.to(els,{scale:1.06,transformOrigin:'50% 50%',duration:0.35,ease:'power1.inOut',yoyo:true,repeat:1,onComplete:function(){gsap.delayedCall(3,p);}});})();});
  })();`;
      }
      default: return '';
    }
  }).filter(Boolean).join('\n');

  return `(function(){
  if(typeof gsap==='undefined'){console.error('[Banner Engine] GSAP not loaded');return;}
  console.log('[Banner Engine] GSAP ready');
  var SPD=${SPD},LAG=${LAG};
  try{
    var tl=gsap.timeline({defaults:{ease:'power2.out'}});
    window._tl=tl;
${blocks}
    // Report timeline progress to parent (scrubber)
    tl.eventCallback('onUpdate',function(){
      try{parent.postMessage({type:'bannerTL',t:tl.time(),d:tl.duration(),p:tl.progress()},'*');}catch(_){}
    });
    tl.eventCallback('onComplete',function(){
      try{parent.postMessage({type:'bannerTL',t:tl.duration(),d:tl.duration(),p:1},'*');}catch(_){}
    });
    console.log('[Banner Engine] Timeline created, duration ~'+tl.duration().toFixed(1)+'s');
  }catch(err){
    console.error('[Banner Engine] Timeline error:',err);
    document.querySelectorAll('#banner *').forEach(function(el){el.style.opacity='';el.style.transform='';});
  }
  // Receive control messages from parent
  window.addEventListener('message',function(e){
    if(!e.data||!window._tl)return;
    var tl=window._tl;
    if(e.data.a==='play')    tl.play();
    else if(e.data.a==='pause')   tl.pause();
    else if(e.data.a==='restart') tl.restart();
    else if(e.data.a==='seek')    tl.seek(parseFloat(e.data.t),false);
  });
})();`;
}

function sel(ids) { return JSON.stringify(ids.map(id => '#' + CSS.escape(id)).join(', ')); }


// ═════════════════════════════════════════════════════════════════════════════
// IMAGE EXTERNALIZER  (ZIP only)
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
    const fn  = `assets/image-${i + 1}.${ext}`;
    img.setAttribute(attr, fn);
    assets.push({ filename: fn, mimeType: m[1], data: m[2] });
  });
  return { svgString: new XMLSerializer().serializeToString(svg), assets };
}


// ═════════════════════════════════════════════════════════════════════════════
// BANNER HTML FOR EXPORT  (fixed pixel dims + meta tags)
// ═════════════════════════════════════════════════════════════════════════════
function generateExportHTML(analysis, fmt, opts = {}) {
  const w = fmt.w || analysis.width;
  const h = fmt.h || analysis.height;
  const { svgString: svgExt, assets } = externalizeImages(analysis.svg);
  const animScript = buildAnimationScript(state.layers, {
    speed: state.animSpeed, delay: state.animDelay,
    lineStagger: state.lineStagger, ctaColor: ctaColorInput.value.trim() || null,
  });
  const borderCSS = state.showBorder
    ? `.banner::after{content:'';position:absolute;inset:0;border:1px solid rgba(0,0,0,.12);pointer-events:none;z-index:9999;}` : '';

  const css = `*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden;background:#000}
.banner{position:relative;width:${w}px;height:${h}px;overflow:hidden;cursor:pointer}
.banner>svg{position:absolute;top:0;left:0;width:100%;height:100%}${borderCSS}`;

  return {
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=${w}, initial-scale=1.0"/>
<meta name="ad.size" content="width=${w},height=${h}"/>
${opts.externalCSS ? `<link rel="stylesheet" href="style.css"/>` : `<style>${css}</style>`}
</head>
<body>
<script>var clickTag="${state.clickTagURL}";<\/script>
<div class="banner" id="banner">${opts.externalCSS ? svgExt : svgExt}</div>
<script>
document.getElementById('banner').addEventListener('click',function(){
  var u=(typeof ADC!=='undefined'&&ADC.click)?ADC.click:clickTag;
  window.open(u,'_blank');
});
<\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"><\/script>
<script>${animScript}<\/script>
</body>
</html>`,
    css, assets,
    manifest: JSON.stringify({
      version: '1.0',
      format: fmt.id,
      width: w, height: h,
      name: fmt.name || fmt.label,
      clickTag: state.clickTagURL,
      created: new Date().toISOString(),
    }, null, 2),
  };
}


// ═════════════════════════════════════════════════════════════════════════════
// ZIP EXPORT (single format)
// ═════════════════════════════════════════════════════════════════════════════
async function downloadZIP() {
  const raw = svgInput.value.trim();
  if (!raw) { toast('Load an SVG first', 'warn'); return; }

  setStatus('Building ZIP…');
  setPreviewStatus('Building ZIP…', 'working');

  let analysis = (raw === state.lastSVGRaw && state.lastAnalysis) ? state.lastAnalysis : null;
  if (!analysis) {
    try { analysis = analyzeSVG(raw); state.lastSVGRaw = raw; state.lastAnalysis = analysis; state.layers = analysis.layers; renderLayerTree(); }
    catch (e) { toast('Invalid SVG: ' + e.message, 'error'); setStatus('Export failed', true); return; }
  }

  const fmt = state.selectedFormat.w ? state.selectedFormat : { id: `${analysis.width}x${analysis.height}`, label: `${analysis.width}×${analysis.height}`, w: analysis.width, h: analysis.height };
  const { html, css, assets, manifest } = generateExportHTML(analysis, fmt, { externalCSS: true });

  const zip    = new JSZip();
  const folder = zip.folder(`banner_${fmt.w}x${fmt.h}`);
  folder.file('index.html', html);
  folder.file('style.css',  css);
  folder.file('manifest.json', manifest);
  folder.file('source.svg', raw);
  assets.forEach(a => folder.file(a.filename, a.data, { base64: true }));

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `banner_${fmt.w}x${fmt.h}_${Date.now()}.zip`);

  const msg = `ZIP ready (${assets.length} asset${assets.length !== 1 ? 's' : ''})`;
  setStatus(msg);
  setPreviewStatus(msg, 'ok');
  toast(msg + ' ✓', 'success');
}


// ═════════════════════════════════════════════════════════════════════════════
// BATCH ZIP EXPORT (all selected formats)
// ═════════════════════════════════════════════════════════════════════════════
async function downloadAllFormats() {
  const raw = svgInput.value.trim();
  if (!raw) { toast('Load an SVG first', 'warn'); return; }
  if (!state.batchFormats.size) { toast('Select at least one format', 'warn'); return; }

  setStatus('Building batch ZIP…');
  setPreviewStatus('Building batch ZIP…', 'working');
  showSpinner();

  let analysis = (raw === state.lastSVGRaw && state.lastAnalysis) ? state.lastAnalysis : null;
  if (!analysis) {
    try { analysis = analyzeSVG(raw); state.lastSVGRaw = raw; state.lastAnalysis = analysis; state.layers = analysis.layers; renderLayerTree(); }
    catch (e) { toast('Invalid SVG: ' + e.message, 'error'); hideSpinner(); return; }
  }

  const zip      = new JSZip();
  const selected = IAB_FORMATS.filter(f => f.w && state.batchFormats.has(f.id));

  for (const fmt of selected) {
    const { html, css, assets, manifest } = generateExportHTML(analysis, fmt, { externalCSS: true });
    const folder = zip.folder(fmt.id);
    folder.file('index.html',    html);
    folder.file('style.css',     css);
    folder.file('manifest.json', manifest);
    assets.forEach(a => folder.file(a.filename, a.data, { base64: true }));
  }

  // Top-level README
  zip.file('README.md', `# HTML5 Banner Package\n\nFormats included:\n${selected.map(f => `- ${f.id} (${f.name})`).join('\n')}\n\nClickTag: ${state.clickTagURL}\nGenerated: ${new Date().toLocaleString()}\n`);

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `banners_batch_${Date.now()}.zip`);
  hideSpinner();

  const msg = `Batch ZIP ready — ${selected.length} format${selected.length !== 1 ? 's' : ''}`;
  setStatus(msg);
  setPreviewStatus(msg, 'ok');
  toast(msg + ' ✓', 'success');
}


// ═════════════════════════════════════════════════════════════════════════════
// DROP ZONE
// ═════════════════════════════════════════════════════════════════════════════
function initDropZone() {
  const zone = document.getElementById('svg-drop-zone');
  if (!zone) return;

  // Clicking the empty-drop-zone focuses the textarea
  if (emptyDropZone) {
    emptyDropZone.addEventListener('click', () => svgInput.focus());
    // Make empty zone also a drop target
    emptyDropZone.addEventListener('dragover', e => e.preventDefault());
    emptyDropZone.addEventListener('drop', e => { zone.dispatchEvent(new DragEvent('drop', { dataTransfer: e.dataTransfer, bubbles: true })); e.preventDefault(); });
  }

  let counter = 0;
  zone.addEventListener('dragenter', e => { e.preventDefault(); counter++; zone.classList.add('drag-hover'); });
  zone.addEventListener('dragover',  e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  zone.addEventListener('dragleave', () => { if (--counter <= 0) { counter = 0; zone.classList.remove('drag-hover'); } });

  zone.addEventListener('drop', e => {
    e.preventDefault(); counter = 0; zone.classList.remove('drag-hover');
    const file = e.dataTransfer.files[0];
    if (!file) return;

    const ok = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
    if (!ok) {
      setStatus(`"${file.name}" is not an SVG`, true);
      setPreviewStatus('Wrong file type', 'error');
      zone.classList.add('drop-error');
      setTimeout(() => zone.classList.remove('drop-error'), 800);
      toast(`"${file.name}" is not an SVG file`, 'error');
      return;
    }

    setPreviewStatus('Reading file…', 'working');
    console.log('[Banner Engine] Reading:', file.name, Math.round(file.size / 1024) + ' KB');

    const reader = new FileReader();
    reader.onload = evt => { svgInput.value = evt.target.result; runPreview(); };
    reader.onerror = () => { toast('Could not read file', 'error'); };
    reader.readAsText(file);
  });
}
