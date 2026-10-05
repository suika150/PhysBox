function normalizeHex(c) {
  if (typeof c !== 'string') return null;
  let s = c.trim();
  if (/^#[0-9a-f]{3}$/i.test(s)) s = '#' + s[1]+s[1] + s[2]+s[2] + s[3]+s[3];
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  const m = /^rgba?\(([^)]+)\)/i.exec(s);   // 素材「ガラス」等の rgba() も受け付ける（α は無視）
  if (m) {
    const p = m[1].split(',').map(Number);
    return '#' + [p[0],p[1],p[2]].map(v => Math.max(0, Math.min(255, Math.round(v||0))).toString(16).padStart(2,'0')).join('');
  }
  return null;
}
function hexToHsv(hex) {
  hex = normalizeHex(hex) || '#000000';
  const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const mx = Math.max(r,g,b), mn = Math.min(r,g,b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r)      h = 60 * (((g-b)/d) % 6);
    else if (mx === g) h = 60 * (((b-r)/d) + 2);
    else               h = 60 * (((r-g)/d) + 4);
  }
  if (h < 0) h += 360;
  return { h, s: mx > 0 ? d/mx : 0, v: mx };
}
function hsvToHex(h, s, v) {
  const c = v*s, x = c * (1 - Math.abs(((h/60) % 2) - 1)), m = v - c;
  let r=0, g=0, b=0;
  if (h < 60)       { r=c; g=x; }
  else if (h < 120) { r=x; g=c; }
  else if (h < 180) { g=c; b=x; }
  else if (h < 240) { g=x; b=c; }
  else if (h < 300) { r=c; b=x; }   // 見た目の連続性優先
  else              { r=c; b=x; }
  if (h >= 240 && h < 300) { r=x; g=0; b=c; }
  const q = n => Math.round((n + m) * 255).toString(16).padStart(2,'0');
  return '#' + q(r) + q(g) + q(b);
}
// ─── 履歴（localStorage に永続化）───
let recentColors = (() => {
  try {
    const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(a) ? a.map(normalizeHex).filter(Boolean).slice(0, RECENT_MAX) : [];
  } catch (e) { return []; }   // プライベートモード等で失敗しても動作は継続
})();
function saveRecentColors() {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentColors)); } catch (e) {}
}
function pushRecentColor(c) {
  const hex = normalizeHex(c);
  if (!hex) return;
  recentColors = [hex, ...recentColors.filter(x => x !== hex)].slice(0, RECENT_MAX);
  saveRecentColors();
}
// 透明度（物体単位。塗り・枠線の両方に効く）
function updateAlpha(v) {
  const a = Math.max(0, Math.min(1, parseFloat(v)));
  if (isNaN(a)) return;
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (b) b.alpha = a;
  }
  // ★drawProps へは伝播させない（新規物体は既定の不透明のまま）
}
// ─── 色の適用先（見本ごとの get/set）───
const _selAlpha = () => { const b = objects.find(o => selectedIds.has(o.id)); return b ? b.alpha : drawProps.alpha; };
const COLOR_TARGETS = {
  fill:   { get: () => { const b = objects.find(o => selectedIds.has(o.id)); return b ? b.fillColor   : drawProps.fillColor; },
            set: v => updateColor('fill', v),
            getA: _selAlpha, setA: updateAlpha },
  stroke: { get: () => { const b = objects.find(o => selectedIds.has(o.id)); return b ? b.strokeColor : drawProps.strokeColor; },
            set: v => updateColor('stroke', v),
            getA: _selAlpha, setA: updateAlpha },
  tracer: { get: () => (selectedElement && selectedElement.kind === 'tracer') ? (selectedElement.body.tracerColor || '#ff7043') : '#ff7043',
            set: v => updateTracerColor(v) },
  slinky: { get: () => (selectedElement && selectedElement.kind === 'slinky') ? selectedElement.slinky.color : '#ffd54f',
            set: v => updateSlinkyColor(v) },
  tracerNew: { get: () => tracerColor,
               set: v => { tracerColor = v;
                           const sw = document.getElementById('tr-swatch');
                           if (sw) sw.style.background = v; } },          
  // 注釈（テキスト・お絵描き）。選択中のものがあればそれを、無ければ次に置くものの色を変える
  annotNew: { get: () => (selectedAnnotation ? selectedAnnotation.color : annotColor),
              set: v => applyAnnotColor(v) },
  // 粒子の印。選んでいる粒子があればそれを、無ければ次に置く粒子の色を変える
  //   （注釈の annotNew と同じ約束。粒子は群れなので「選択ぜんぶ」に配る）
  particleNew: { get: () => { const l = selectedParticles();
                              return l.length ? l[0].color : (particleColor || PARTICLE_TYPES.fluid.color); },
                 set: v => applyParticleColor(v) },
  shapeNew: { get: () => drawProps.fillColor,
              set: v => { drawProps.fillColor = v;
                          const sw = document.getElementById('sh-swatch');
                          if (sw) sw.style.background = v; } },
  // 見本は全体設定タブとシミュレーションメニューの設定ウィンドウの2か所にある
  ground: { get: () => ground.fillColor,
            set: v => { ground.fillColor = v;
                        for (const id of ['ground-swatch', 'sp-ground-swatch']) {
                          const sw = document.getElementById(id);
                          if (sw) sw.style.background = v;
                        } } },
  bg:     { get: () => world.bgColor,
            set: v => worldUpdate('bgColor', v) },
};
let colorPopup = null;
let _cpOutside = null;
function _cpKey(e) { if (e.key === 'Escape') closeColorPicker(); }
function closeColorPicker() {
  if (!colorPopup) { colorPickerOpen = false; return; }
  const hex = colorPopup._hex;
  colorPopup.remove();
  colorPopup = null;
  document.removeEventListener('mousedown', _cpOutside);
  document.removeEventListener('keydown', _cpKey, true);
  colorPickerOpen = false;
  pushRecentColor(hex);          // 閉じた時点の色を履歴へ
}
function openColorPicker(anchorEl, key) {
  const t = COLOR_TARGETS[key];
  if (!t) return;
  if (colorPopup && colorPopup._key === key) { closeColorPicker(); return; }   // 同じ見本を再クリック＝閉じる
  closeColorPicker();
  const start = normalizeHex(t.get()) || '#ffffff';
  let { h, s, v } = hexToHsv(start);
  const hasAlpha = typeof t.getA === 'function';
  let alpha = hasAlpha ? t.getA() : 1;
  if (isNaN(alpha)) alpha = 1;
  const pop = document.createElement('div');
  pop.id = 'color-popup';
  pop._key = key; pop._hex = start;
  pop.style.visibility = 'hidden';
  pop.innerHTML = `
    <div class="cp-sv" id="cp-sv"><div class="cp-sv-cursor" id="cp-sv-cur"></div></div>
    <div class="cp-hue" id="cp-hue"><div class="cp-hue-cursor" id="cp-hue-cur"></div></div>
    <div class="cp-alpha" id="cp-alpha">
      <span class="cp-alpha-label">透明度</span>
      <input type="range" id="cp-alpha-slider" min="0" max="1" step="0.01">
      <span class="cp-alpha-val" id="cp-alpha-val"></span>
    </div>
    <div class="cp-row">
      <div class="cp-preview" id="cp-preview"></div>
      <input class="cp-hex" id="cp-hex" type="text" spellcheck="false">
    </div>
    <div class="cp-title">最近使った色</div>
    <div class="cp-grid" id="cp-recent"></div>
    <div class="cp-title">プリセット</div>
    <div class="cp-grid" id="cp-preset"></div>
  `;
  document.body.appendChild(pop);
  colorPopup = pop;
  colorPickerOpen = true;   // キャンバスの誤クリック（図形設置）を防ぐ既存フラグ
  const svEl = pop.querySelector('#cp-sv'),  svCur  = pop.querySelector('#cp-sv-cur');
  const hueEl = pop.querySelector('#cp-hue'), hueCur = pop.querySelector('#cp-hue-cur');
  const prev = pop.querySelector('#cp-preview'), hexIn = pop.querySelector('#cp-hex');
  const aRow = pop.querySelector('#cp-alpha');
  const aSld = pop.querySelector('#cp-alpha-slider'), aVal = pop.querySelector('#cp-alpha-val');
  const CHECKER = 'repeating-conic-gradient(#4a4a4a 0% 25%, #2e2e2e 0% 50%) 50% / 10px 10px';
  if (hasAlpha) { aRow.style.display = 'flex'; aSld.value = alpha; }
  const paint = (apply = true) => {
    const hex = hsvToHex(h, s, v);
    pop._hex = hex;
    svEl.style.background =
      `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${h},100%,50%))`;
    svCur.style.left = (s * 100) + '%';
    svCur.style.top  = ((1 - v) * 100) + '%';
    hueCur.style.left = (h / 360 * 100) + '%';
    // 市松模様の上に半透明色を重ね、実際の見え方をプレビューする
    const rgba = hexToRgba(hex, hasAlpha ? alpha : 1);
    prev.style.background = `linear-gradient(${rgba}, ${rgba}), ${CHECKER}`;
    if (hasAlpha) aVal.textContent = alpha.toFixed(2);
    if (document.activeElement !== hexIn) hexIn.value = hex;
    if (apply) {                     // ドラッグ中もリアルタイム反映
      t.set(hex);
      if (hasAlpha) t.setA(alpha);
    }
  };
  const bindDrag = (el, fn) => {
    el.addEventListener('mousedown', e => {
      e.preventDefault(); fn(e);
      const mv = ev => fn(ev);
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    });
  };
  bindDrag(svEl, e => {
    const r = svEl.getBoundingClientRect();
    s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    paint();
  });
  bindDrag(hueEl, e => {
    const r = hueEl.getBoundingClientRect();
    h = Math.min(359.9, Math.max(0, (e.clientX - r.left) / r.width * 360));
    paint();
  });
  hexIn.addEventListener('input', () => {
    const hex = normalizeHex(hexIn.value);
    if (!hex) return;
    const c = hexToHsv(hex); h = c.h; s = c.s; v = c.v;
    paint();
  });
  if (hasAlpha) {
    let armed = false;   // ドラッグ開始時に一度だけ undo を積む（既存スライダーと同じ流儀）
    aSld.addEventListener('pointerdown', () => armed = true);
    aSld.addEventListener('keydown',     e => { if (_keyBurstArm(aSld, e)) armed = true; });   // 連打は1回の編集（state.js）
    aSld.addEventListener('input', () => {
      if (armed) { if (selectedIds.size > 0) pushUndo(); armed = false; }
      alpha = parseFloat(aSld.value);
      paint();
    });
  }
  const fillGrid = (el, cols) => {
    el.innerHTML = '';
    if (!cols.length) { el.innerHTML = '<span class="cp-empty">まだありません</span>'; return; }
    for (const col of cols) {
      const d = document.createElement('div');
      d.className = 'cp-sw'; d.style.background = col; d.title = col;
      d.addEventListener('mousedown', e => e.preventDefault());
      d.addEventListener('click', () => { const c = hexToHsv(col); h = c.h; s = c.s; v = c.v; paint(); });
      el.appendChild(d);
    }
  };
  fillGrid(pop.querySelector('#cp-recent'), recentColors);
  fillGrid(pop.querySelector('#cp-preset'), PALETTE);
  paint(false);   // 初期描画（開いただけでは色を書き換えない）
  // ─── クリックされた見本のすぐ横に配置（画面外にはみ出さないようクランプ）───
  const r = anchorEl.getBoundingClientRect();
  const m = 6, pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = r.left - pw - 8;                 // 右パネル上の見本なので既定は左側へ
  if (left < m) left = r.right + 8;
  let top = r.top - 6;
  left = Math.max(m, Math.min(left, window.innerWidth  - pw - m));
  top  = Math.max(m, Math.min(top,  window.innerHeight - ph - m));
  pop.style.left = left + 'px';
  pop.style.top  = top  + 'px';
  pop.style.visibility = '';
  _cpOutside = e => {
    if (colorPopup && !colorPopup.contains(e.target) && e.target !== anchorEl) closeColorPicker();
  };
  document.addEventListener('mousedown', _cpOutside);   // ※バブリング側（キャンバスの mousedown が先に走る）
  document.addEventListener('keydown', _cpKey, true);
}
