// ══════════════════════════════════════════════════════════════
//  運動量 – 時間グラフ
//   ★1ウィンドウ＝1つの「系」（選んだ物体の集合）。エネルギーグラフと同じ単位で、
//     velgraph の「1物体＝1ウィンドウ」とは違う。物体1個の運動量は単に mv で自明で、
//     和が保存するのは系の性質だから、系を単位にしないと見せる意味が無い。
//
//  ★運動量はベクトル。ここが energygraph と決定的に違う設計上の要。
//    **大きさ |p| を1本の線で描いてはいけない。** 正面衝突で撥ね返る2球は Σp⃗ が一定
//    （たとえば 0）のままだが、各球の |p| は変わり Σ|pᵢ| は保存しない。「大きさの和」を
//    描くと、保存しているものが保存していないように見える。だから成分（px / py）で描く。
//    合計ベクトルの大きさ |Σp⃗| は意味を持つので出せるようにしてあるが、そのときは
//    内訳を出さない（|Σp⃗| と Σ|pᵢ| を並べると、まさに上の誤読を誘うため）。
//
//  ★成分で描くと、運動量保存の**成立条件**がそのまま読める。
//      ・水平方向に外力が無い → px は厳密に一定
//      ・重力は外力          → py は時間に比例して増える（dpy/dt = Mg）
//    地面・壁も外力を与える（法線力）ので、載っている系では py は保存しない。
//    無重力（真上から見下ろす見立て）にすると両成分とも保存し、衝突の実験ができる。
//
//  ★エネルギーグラフと並べて見るのが本命の使い方。完全非弾性衝突では
//    「力学的エネルギーは落ちるのに運動量は落ちない」が同時に読め、
//    運動量という量を導入する理由そのものになる。
//
//  ★角運動量は混ぜない。線運動量は Σm·v⃗（重心の速度）だけで決まり、回転は寄与しない。
// ══════════════════════════════════════════════════════════════
const MG_MAX_SAMPLES = 20000;   // 安全上限（60fps で約5.5分ぶん。ほかのグラフと同じ）
const MG_MAX_WINDOWS = 6;
const MG_MAX_PARTS   = 10;      // 内訳で描ける物体の上限（これ以上は読めない）
const MG_COL_TOTAL   = '#ffd54f';                  // 合計（energygraph の力学的エネルギーと同じ色）
const MG_COL_REF     = 'rgba(255,255,255,0.45)';   // p(0) の目安線
const MG_COLORS = ['#42a5f5','#66bb6a','#ef5350','#ab47bc','#26c6da',
                   '#ffa726','#d4e157','#ec407a','#8d6e63','#78909c'];
let momGraphs = [];
let momGraphSeq = 0;

// ── 運動量の計算 ────────────────────────────────────────────
//   内部の速度は px/s なので、PX2M を掛けて [kg·m/s] にする。
//   静的な物体は速度0なので寄与しない（系に入っていても和を変えない）。
function bodyMomentum(b) {
  return { x: b.mass * b.vx * PX2M, y: b.mass * b.vy * PX2M };
}
function systemMomentum(bodies) {
  let x = 0, y = 0;
  for (const b of bodies) { x += b.mass * b.vx; y += b.mass * b.vy; }
  return { x: x * PX2M, y: y * PX2M };
}

// ── ウィンドウの検索 ───────────────────────────────────────
function momGraphBodies(g) {
  const out = [];
  for (const id of g.bodyIds) { const b = objects.find(o => o.id === id); if (b) out.push(b); }
  return out;
}
function momGraphOfSelection() {
  const ids = objects.filter(o => selectedIds.has(o.id) && !o.isStatic).map(o => o.id).sort((a,b) => a-b);
  if (!ids.length) return null;
  return momGraphs.find(g => g.bodyIds.length === ids.length
                          && g.bodyIds.every((v, i) => v === ids[i])) || null;
}
function momGraphName(g) {
  const bs = momGraphBodies(g);
  if (!bs.length) return '（消滅）';
  if (bs.length === 1) return bs[0].label || ('物体 ' + bs[0].id);
  return bs.length + '個の系';
}
function mgBodyName(b) { return b ? (b.label || ('物体 ' + b.id)) : '（消滅）'; }
function momGraphPrune() { for (const g of momGraphs.slice()) if (!momGraphBodies(g).length) momGraphClose(g); }

// ── 生成と破棄 ─────────────────────────────────────────────
function momGraphNew(ids, opts) {
  const list = ids.slice().sort((a,b) => a-b);
  if (!list.length) return null;
  const g = {
    id: ++momGraphSeq,
    bodyIds: list,
    comp: 'x',          // 'x' | 'y' | 'mag'（描く成分）
    showParts: true,    // 物体ごとの内訳を重ねる
    showRef: true,      // p(0) の水平線
    t: 0,
    samples: [],        // {t, tx, ty, parts:[{x,y}...]}
    frozen: false, stopReason: null,
    hover: null,
  };
  // ★シーンから復元するときの表示の選択。窓を組み立てる前に入れる（組み立て側が
  //   g の値からチェックを入れるので、あとから代入すると画面と中身がずれる）
  if (opts) Object.assign(g, opts);
  momGraphs.push(g);
  momGraphBuildPanel(g);
  momGraphSampleNow(g);      // 実行前の状態を t=0 の点にする
  updateMomGraphStatus(g);
  return g;
}
function momGraphClose(g) {
  const at = momGraphs.indexOf(g);
  if (at >= 0) momGraphs.splice(at, 1);
  if (g.panel) g.panel.remove();
  refreshMomGraphButton();
}
function momGraphBuildPanel(g) {
  const host = document.getElementById('canvas-wrap') || document.body;
  const panel = document.createElement('div');
  panel.className = 'velgraph-panel';
  const off = graphCascadeOffset();
  panel.style.right  = (10 + off) + 'px';
  panel.style.bottom = (10 + off) + 'px';
  panel.innerHTML =
    '<div class="vg-header">' +
      '<span class="vg-title"></span><span class="vg-status"></span><span class="vg-close">×</span>' +
    '</div>' +
    '<canvas></canvas>' +
    '<div class="vg-controls mg-legend"></div>' +
    '<div class="vg-controls">' +
      '<span class="vg-grp" title="運動量はベクトルなので、成分ごとに見ます。&#10;水平に外力が無ければ px は厳密に一定、重力があれば py は時間に比例して増えます">成分</span>' +
      '<label class="vg-check"><input type="radio" name="mgcomp' + g.id + '" class="mg-x">px</label>' +
      '<label class="vg-check"><input type="radio" name="mgcomp' + g.id + '" class="mg-y">py</label>' +
      '<label class="vg-check" title="合計ベクトルの大きさ |Σp|。★各物体の |p| の和ではありません（そちらは保存しません）。&#10;この表示のときは内訳を出しません（並べると誤読を招くため）"><input type="radio" name="mgcomp' + g.id + '" class="mg-mag">|Σp|</label>' +
    '</div>' +
    '<div class="vg-controls">' +
      '<label class="vg-check" title="物体ごとの運動量を重ねます。衝突で「Aが失った分だけBが得る」受け渡しが読めます"><input type="checkbox" class="mg-parts">内訳</label>' +
      '<label class="vg-check" title="記録を始めた瞬間の値の水平線。線に乗り続けていれば、その成分は保存しています"><input type="checkbox" class="mg-ref">p(0)の線</label>' +
      '<span class="vg-hint">カーソルを置くと値を読めます</span>' +
      '<button class="btn-small mg-rec" title="記録を一時停止します（グラフは残ります）">停止</button>' +
      '<button class="btn-small mg-reset">リセット</button>' +
    '</div>';
  host.appendChild(panel);
  g.panel    = panel;
  g.canvas   = panel.querySelector('canvas');
  g.ctx      = g.canvas.getContext('2d');
  g.titleEl  = panel.querySelector('.vg-title');
  g.statusEl = panel.querySelector('.vg-status');
  g.recBtn   = panel.querySelector('.mg-rec');
  g.legendEl = panel.querySelector('.mg-legend');
  panel.querySelector('.vg-close').addEventListener('click', () => momGraphClose(g));
  g.recBtn.addEventListener('click', () => toggleMomGraphRecording(g));
  panel.querySelector('.mg-reset').addEventListener('click', () => resetMomGraphOne(g));
  // チェックの初期状態はインスタンスの値から入れる（markup と二重に持つとずれる。
  // velgraph と同じ流儀。シーンから表示の選択を復元できるのはこの形だから）
  panel.querySelector('.mg-' + g.comp).checked = true;
  panel.querySelector('.mg-parts').checked = g.showParts;
  panel.querySelector('.mg-ref').checked   = g.showRef;
  for (const [cls, m] of [['.mg-x','x'], ['.mg-y','y'], ['.mg-mag','mag']])
    panel.querySelector(cls).addEventListener('change', e => {
      if (!e.target.checked) return;
      g.comp = m;
      mgRefreshLegend(g);          // |Σp| では内訳を出さないので凡例も変わる
      updateMomGraphStatus(g);
    });
  panel.querySelector('.mg-parts').addEventListener('change', e => { g.showParts = e.target.checked; mgRefreshLegend(g); });
  panel.querySelector('.mg-ref').addEventListener('change', e => { g.showRef = e.target.checked; });
  g.canvas.addEventListener('mousemove', ev => {
    const r = g.canvas.getBoundingClientRect();
    g.hover = { x: ev.clientX - r.left, y: ev.clientY - r.top };
  });
  g.canvas.addEventListener('mouseleave', () => g.hover = null);
  mgRefreshLegend(g);
  momGraphMakeDraggable(g);
}
// ヘッダーのドラッグで移動（ほかのグラフと同じ理由で left/top 基準へ移し替える）
function momGraphMakeDraggable(g) {
  const panel = g.panel, header = panel.querySelector('.vg-header');
  let dragging = false, offX = 0, offY = 0;
  header.addEventListener('mousedown', e => {
    if (e.target.classList.contains('vg-close')) return;
    const host = panel.offsetParent || document.body;
    const pr = panel.getBoundingClientRect(), hr = host.getBoundingClientRect();
    panel.style.left = (pr.left - hr.left) + 'px';
    panel.style.top  = (pr.top  - hr.top)  + 'px';
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
    dragging = true; offX = e.clientX - pr.left; offY = e.clientY - pr.top;
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const host = panel.offsetParent || document.body;
    const hr = host.getBoundingClientRect();
    panel.style.left = (e.clientX - hr.left - offX) + 'px';
    panel.style.top  = (e.clientY - hr.top  - offY) + 'px';
  });
  window.addEventListener('mouseup', () => dragging = false);
}
// ── 凡例 ───────────────────────────────────────────────────
function mgPartsShown(g) { return g.showParts && g.comp !== 'mag' && g.bodyIds.length <= MG_MAX_PARTS; }
function mgRefreshLegend(g) {
  if (!g.legendEl) return;
  const lab = g.comp === 'mag' ? '|Σp|' : (g.comp === 'x' ? 'px' : 'py');
  // 凡例の見た目は温度グラフと共通（.vg-check + .vg-chip）
  let out = '<span class="vg-check"><span class="vg-chip" style="background:' + MG_COL_TOTAL + '"></span>合計 ' + lab + '</span>';
  if (mgPartsShown(g)) {
    const bs = momGraphBodies(g);
    for (let i = 0; i < bs.length; i++)
      out += '<span class="vg-check"><span class="vg-chip" style="background:' + MG_COLORS[i % MG_COLORS.length] + '"></span>'
           + mgBodyName(bs[i]) + '</span>';
  } else if (g.comp === 'mag' && g.showParts) {
    out += '<span class="vg-hint">（|Σp| では内訳を出しません：各物体の |p| の和は保存しないため）</span>';
  }
  g.legendEl.innerHTML = out;
}
// ── 開閉と記録 ─────────────────────────────────────────────
// いまこのグラフを開けるか（右パネルのボタン・表示メニュー・右クリックで同じ判定を使う）
//   ★tempGraphReady と同じ作り。入口ごとに条件を書くと「押せるのに何も起きない」項目が出る。
//   ★静的物体は系に入れない（toggleMomGraph）ので、それだけを選んでも押せない
function momGraphReady() {
  if (momGraphOfSelection()) return true;
  return objects.some(o => selectedIds.has(o.id) && !o.isStatic) && momGraphs.length < MG_MAX_WINDOWS;
}
function toggleMomGraph() {
  const open = momGraphOfSelection();
  if (open) { momGraphClose(open); return; }
  const ids = objects.filter(o => selectedIds.has(o.id) && !o.isStatic).map(o => o.id);
  if (!ids.length) return;
  if (momGraphs.length >= MG_MAX_WINDOWS) return;
  momGraphNew(ids);
  refreshMomGraphButton();
}
function refreshMomGraphButton() {
  const b = document.getElementById('p-momgraph-btn');
  if (!b) return;
  const has = objects.some(o => selectedIds.has(o.id) && !o.isStatic);
  b.disabled = !momGraphReady();
  b.classList.toggle('active', !!momGraphOfSelection());
  b.title = !has ? '物体を選択してください'
          : !momGraphReady() ? ('運動量のグラフは同時に' + MG_MAX_WINDOWS + '個までです。どれかを閉じてください')
          : (momGraphOfSelection() ? 'もう一度押すと閉じます'
          : '選んだ物体をひとまとめの「系」として、運動量 p = Σmv の時間変化を成分ごとに表示します。'
          + '\n水平に外力が無ければ px は一定、重力があれば py は時間に比例して増えます。'
          + '\n非弾性衝突ではエネルギーが落ちても運動量は落ちません（エネルギーのグラフと並べてどうぞ）');
}
function toggleMomGraphRecording(g) {
  if (g.frozen) {
    if (g.samples.length >= MG_MAX_SAMPLES) return;
    g.frozen = false; g.stopReason = null;
  } else { g.frozen = true; g.stopReason = 'user'; }
  updateMomGraphStatus(g);
}
function resetMomGraphOne(g) {
  g.samples = []; g.t = 0; g.frozen = false; g.stopReason = null;
  momGraphSampleNow(g);
  updateMomGraphStatus(g);
}
function resetMomGraph() { for (const g of momGraphs) resetMomGraphOne(g); }
function updateMomGraphStatus(g) {
  if (g.recBtn) {
    const stuck = g.samples.length >= MG_MAX_SAMPLES;
    g.recBtn.textContent = g.frozen ? '再開' : '停止';
    g.recBtn.disabled = g.frozen && stuck;
    g.recBtn.title = g.recBtn.disabled ? '記録が上限に達しました。「リセット」で最初から記録し直せます'
                   : g.frozen          ? '記録を再開します'
                   :                     '記録を一時停止します（グラフは残ります）';
  }
  if (g.statusEl) g.statusEl.textContent = g.frozen ? (g.stopReason === 'limit' ? '上限' : '停止中') : '';
  if (g.titleEl) {
    const lab = g.comp === 'mag' ? '|Σp|' : (g.comp === 'x' ? 'px' : 'py');
    g.titleEl.textContent = '運動量 ' + g.id + '（' + lab + '）：' + momGraphName(g);
  }
}
function sampleMomGraph(dt) {
  momGraphPrune();
  for (const g of momGraphs) {
    if (g.frozen || dt <= 0) continue;
    g.t += dt;
    momGraphSampleNow(g);
    if (g.samples.length >= MG_MAX_SAMPLES) { g.frozen = true; g.stopReason = 'limit'; updateMomGraphStatus(g); }
  }
}
function momGraphSampleNow(g) {
  const bs = momGraphBodies(g);
  const tot = systemMomentum(bs);
  // 内訳は「開いたときの並び」に合わせる。消えた物体は null で線を切る
  const parts = g.bodyIds.map(id => {
    const b = objects.find(o => o.id === id);
    return b ? bodyMomentum(b) : null;
  });
  g.samples.push({ t: g.t, tx: tot.x, ty: tot.y, parts });
}
function momGraphSampleAt(g, t) {           // 指定時刻に最も近い点（二分探索）
  const s = g.samples;
  if (!s.length) return null;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (s[m].t < t) lo = m + 1; else hi = m; }
  if (lo > 0 && Math.abs(s[lo-1].t - t) < Math.abs(s[lo].t - t)) lo--;
  return s[lo];
}
// ── 描画 ───────────────────────────────────────────────────
const mgTotalOf = (g, s) => g.comp === 'x' ? s.tx : g.comp === 'y' ? s.ty : Math.hypot(s.tx, s.ty);
const mgPartOf  = (g, p) => !p ? null : (g.comp === 'x' ? p.x : p.y);
function drawMomGraph() { for (const g of momGraphs) drawMomGraphOne(g); }
function drawMomGraphOne(g) {
  const cv = g.canvas, c = g.ctx;
  if (!cv || !c) return;
  const cssW = cv.clientWidth || 304, cssH = cv.clientHeight || 150;
  if (cv.width !== cssW) cv.width = cssW;
  if (cv.height !== cssH) cv.height = cssH;
  const W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  const padL = 46, padR = 8, padT = 8, padB = 16;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const tMax = Math.max(g.t, 1);
  const X = t => padL + (t / tMax) * plotW;
  const parts = mgPartsShown(g);
  // 縦のスケールは描く線ぜんぶから決める（同じ単位なので共有してよい）
  let vMin = Infinity, vMax = -Infinity;
  const put = v => { if (v == null) return; if (v < vMin) vMin = v; if (v > vMax) vMax = v; };
  for (const s of g.samples) {
    put(mgTotalOf(g, s));
    if (parts) for (const p of s.parts) put(mgPartOf(g, p));
  }
  if (!(vMin < Infinity)) { vMin = -1; vMax = 1; }
  if (vMax - vMin < 1e-9) { vMin -= 1; vMax += 1; }
  const range = vMax - vMin; vMin -= range * 0.08; vMax += range * 0.08;
  const Y = v => padT + (1 - (v - vMin) / (vMax - vMin)) * plotH;
  c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1;
  c.strokeRect(padL, padT, plotW, plotH);
  if (vMin < 0 && vMax > 0) {                        // 0 の基準線（成分は負にもなる）
    const y0 = Y(0);
    c.strokeStyle = 'rgba(255,255,255,0.3)';
    c.beginPath(); c.moveTo(padL, y0); c.lineTo(padL + plotW, y0); c.stroke();
  }
  // ★p(0) の水平線。線に乗り続けていれば、その成分は保存している
  if (g.showRef && g.samples.length) {
    const p0 = mgTotalOf(g, g.samples[0]);
    const y = Y(p0);
    c.save(); c.setLineDash([4, 3]);
    c.strokeStyle = MG_COL_REF; c.lineWidth = 1;
    c.beginPath(); c.moveTo(padL, y); c.lineTo(padL + plotW, y); c.stroke();
    c.restore();
  }
  c.font = '9px sans-serif';
  c.fillStyle = 'rgba(224,230,240,0.7)'; c.textAlign = 'right';
  c.fillText(vMax.toFixed(2), padL - 3, padT + 8);
  c.fillText(vMin.toFixed(2), padL - 3, padT + plotH);
  // ★0 の線に数字を添える（枠線と紛れて「どこが 0 か」が読めなくなるため）。
  //   上端・下端の数字と 10px 以内で重なるときは出さない。他のグラフの窓と同じ流儀
  if (vMin < 0 && vMax > 0 && Math.abs(Y(0)+3 - (padT+8)) >= 10
                           && Math.abs(Y(0)+3 - (padT+plotH)) >= 10) {
    c.fillStyle = 'rgba(224,230,240,0.45)';
    c.fillText('0', padL - 3, Y(0) + 3);
  }
  c.fillStyle = 'rgba(224,230,240,0.45)'; c.textAlign = 'left';
  c.fillText((g.comp === 'mag' ? '|Σp|' : (g.comp === 'x' ? 'px' : 'py')) + ' [kg·m/s]', padL + 4, padT + 9);
  c.textAlign = 'right';
  c.fillText(tMax.toFixed(1) + ' s', padL + plotW, H - 4);
  c.save();
  c.beginPath(); c.rect(padL, padT, plotW, plotH); c.clip();
  // 内訳（細線）→ 合計（太線）の順。合計が隠れないように後から描く
  if (parts) {
    for (let i = 0; i < g.bodyIds.length; i++) {
      c.strokeStyle = MG_COLORS[i % MG_COLORS.length]; c.lineWidth = 1.2;
      c.beginPath();
      let pen = false;
      for (const s of g.samples) {
        const v = mgPartOf(g, s.parts[i]);
        if (v == null) { pen = false; continue; }
        const x = X(s.t), y = Y(v);
        pen ? c.lineTo(x, y) : c.moveTo(x, y);
        pen = true;
      }
      c.stroke();
    }
  }
  c.strokeStyle = MG_COL_TOTAL; c.lineWidth = 2;
  c.beginPath();
  let pen = false;
  for (const s of g.samples) {
    const x = X(s.t), y = Y(mgTotalOf(g, s));
    pen ? c.lineTo(x, y) : c.moveTo(x, y);
    pen = true;
  }
  c.stroke();
  c.restore();
  // ── カーソルでの読み取り ──
  if (g.hover && g.samples.length) {
    const t = Math.max(0, Math.min(tMax, (g.hover.x - padL) / plotW * tMax));
    const s = momGraphSampleAt(g, t);
    if (s) {
      const x = X(s.t);
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, padT); c.lineTo(x, padT + plotH); c.stroke();
      const rows = [['合計', mgTotalOf(g, s)]];
      if (parts) for (let i = 0; i < g.bodyIds.length; i++) {
        const v = mgPartOf(g, s.parts[i]);
        if (v != null) rows.push([mgBodyName(objects.find(o => o.id === g.bodyIds[i])), v]);
      }
      c.font = '9px sans-serif'; c.textAlign = 'left';
      const bw = 132, bh = 12 * rows.length + 8;
      const bx = Math.min(x + 6, padL + plotW - bw), by = padT + 4;
      c.fillStyle = 'rgba(20,24,32,0.85)';
      c.fillRect(bx, by, bw, bh);
      c.strokeStyle = 'rgba(255,255,255,0.18)'; c.strokeRect(bx, by, bw, bh);
      c.fillStyle = 'rgba(224,230,240,0.9)';
      c.fillText(s.t.toFixed(2) + ' s', bx + 5, by + 11);
      for (let i = 0; i < rows.length; i++) {
        c.fillStyle = i === 0 ? MG_COL_TOTAL : MG_COLORS[(i-1) % MG_COLORS.length];
        c.fillText(rows[i][0] + '  ' + rows[i][1].toFixed(3), bx + 5, by + 11 + 12 * (i + 1) - 12 + 12);
      }
    }
  }
}
