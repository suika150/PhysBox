// ════════════════════════════════════════
//  温度 – 時間グラフ
// ════════════════════════════════════════
//  velgraph / energygraph と同じ作りのフローティングウィンドウ。
//  ウィンドウ枠・つまみ・ドラッグは .velgraph-panel / .vg-* の CSS をそのまま借りる。
//
//  ★1枚に複数の系列を重ねる（velgraph の「1物体＝1ウィンドウ」ではない）。
//    温度のグラフで見たいのは「熱いおもりと冷たい水が同じ温度に近づいていく」
//    ところなので、比べる相手が同じ枠に無いと意味がない。
//    系列は開いたときの選択物体＋（粒子があれば）液体・気体の平均で固定する。
const TG_MAX_SAMPLES = 20000;   // 安全上限（60fps で約5.5分ぶん。velgraph と同じ）
const TG_MAX_WINDOWS = 6;
const TG_MAX_SERIES  = 12;      // 1枚に重ねる系列の上限（これ以上は読めない）
const TG_COLORS = ['#ef5350','#42a5f5','#66bb6a','#ffa726','#ab47bc','#26c6da',
                   '#d4e157','#ec407a','#8d6e63','#78909c','#7e57c2','#26a69a'];
let tempGraphs = [];
let tempGraphSeq = 0;

// ── 系列の定義 ──────────────────────────────────────────────
//   kind:'body' なら物体、'fluid'/'gas' なら粒子の平均温度、'chamber' なら気体室の気体。
//   ★気体室（ピストン容器の中身）は**容器ごとに1本**の系列にする。粒子の気体を
//     世界ぜんぶの平均で1本にまとめているのとは扱いが違うが、これは模型の違いから来る：
//     分子は世界じゅうを飛び回って容器に属さない（だから配れない）が、気体室は
//     容器そのものが持つ状態量 ch.T で、はじめから容器ごとに分かれている。
//     ここを平均にまとめると「同じ熱を入れた2つの器の温度の上がりかたを見比べる」
//     （定積・定圧モル比熱）ができなくなる＝このグラフの目的そのものを潰す。
function tgSeriesValue(s) {
  if (s.kind === 'body') {
    const b = objects.find(o => o.id === s.bodyId);
    return b ? K2C(b.temp) : null;         // 消えた物体は null（線を切る）
  }
  if (s.kind === 'chamber') {
    const ch = gasChambers.find(c => c.id === s.chamberId);
    return ch ? K2C(ch.T) : null;          // 消えた気体室も同じく null
  }
  let sum = 0, n = 0;
  for (const p of particles) if (p.type === s.kind) { sum += p.T; n++; }
  return n ? K2C(sum / n) : null;
}
function tgSeriesName(s) {
  if (s.kind === 'body') {
    const b = objects.find(o => o.id === s.bodyId);
    return b ? (b.label || ('物体 ' + b.id)) : ('物体 ' + s.bodyId + '（消滅）');
  }
  if (s.kind === 'chamber') {
    const ch = gasChambers.find(c => c.id === s.chamberId);
    // 器の名札をそのまま使う（右クリック・右パネルと同じ名前になる）
    return ch ? gasChamberLabel(ch) : ('気体 ' + s.chamberId + '（消滅）');
  }
  return s.kind === 'fluid' ? '液体（平均）' : '気体（平均）';
}
// 同じ系列かどうかの見分け（種別＋対象の id）。足すときの重複よけに使う
function tgSeriesKey(s) {
  return s.kind + ':' + (s.kind === 'body' ? s.bodyId : s.kind === 'chamber' ? s.chamberId : '');
}
// 選択物体と、その場にある気体室・粒子から系列を組み立てる
function tgBuildSeries(ids) {
  const out = [];
  for (const id of ids) {
    if (out.length >= TG_MAX_SERIES) break;
    out.push({ kind: 'body', bodyId: id });
  }
  for (const ch of gasChambers) {
    if (out.length >= TG_MAX_SERIES) break;
    out.push({ kind: 'chamber', chamberId: ch.id });
  }
  for (const k of ['fluid', 'gas']) {
    if (out.length >= TG_MAX_SERIES) break;
    if (particles.some(p => p.type === k)) out.push({ kind: k });
  }
  out.forEach((s, i) => s.col = TG_COLORS[i % TG_COLORS.length]);
  return out;
}
function tempGraphName(g) {
  const n = g.series.length;
  return n === 1 ? tgSeriesName(g.series[0]) : (n + ' 系列');
}
// ── あとから系列を足す ──────────────────────────────────────────
//   ★「1つ目を描き始めてから、2つ目を足す」ができないと、熱平衡を見るという
//     このグラフの目的が果たせない（比べる相手が同じ枠に無ければ意味がない）。
//   ★過去のぶんは埋めない。足す前の標本は v[i] が undefined のままで、描画側が
//     null/undefined で線を切るので、足した時点から線が始まる。実際その物体の
//     温度は測っていなかったのだから、0や現在値で埋めるほうが嘘になる。
function tgHasSeries(g, s) {
  return g.series.some(x => tgSeriesKey(x) === tgSeriesKey(s));
}
function tgAddSeries(g, ids) {
  const add = [];
  for (const id of ids) {
    const s = { kind: 'body', bodyId: id };
    if (!tgHasSeries(g, s)) add.push(s);
  }
  for (const ch of gasChambers) {
    const s = { kind: 'chamber', chamberId: ch.id };
    if (!tgHasSeries(g, s)) add.push(s);
  }
  for (const k of ['fluid', 'gas']) {
    if (!particles.some(p => p.type === k)) continue;
    const s = { kind: k, bodyId: undefined };
    if (!tgHasSeries(g, s)) add.push(s);
  }
  if (!add.length) return 0;
  const room = TG_MAX_SERIES - g.series.length;
  if (room <= 0) return 0;
  const use = add.slice(0, room);
  for (const s of use) { s.col = TG_COLORS[g.series.length % TG_COLORS.length]; g.series.push(s); }
  tgRefreshLegend(g);
  updateTempGraphStatus(g);
  refreshTempGraphButton();
  return use.length;
}
// 凡例を作り直す（系列を足したとき用。生成時と同じ見た目にする）
function tgLegendHTML(g) {
  let out = '<span class="vg-grp" title="「＋選択を追加」で、いま選んでいる物体をあとから足せます。足した時点から線が始まります">系列</span>';
  for (const s of g.series)
    out += '<span class="vg-check"><span class="vg-chip" style="background:' + s.col + '"></span>' +
           tgSeriesName(s) + '</span>';
  return out;
}
function tgRefreshLegend(g) {
  if (g.legendEl) g.legendEl.innerHTML = tgLegendHTML(g);
}

// ── ウィンドウの生成と破棄 ─────────────────────────────
function tempGraphNew(ids, opts) {
  const g = {
    id: ++tempGraphSeq,
    series: tgBuildSeries(ids),
    t: 0,
    samples: [],            // {t, v:[系列ぶんの℃]}
    frozen: false,
    stopReason: null,       // 'user' | 'limit' | null
    hover: null,
  };
  if (!g.series.length) return null;
  tempGraphs.push(g);
  tempGraphBuildPanel(g);
  tempGraphSampleNow(g);    // 実行前の状態を t=0 の点にする
  updateTempGraphStatus(g);
  return g;
}
function tempGraphClose(g) {
  const at = tempGraphs.indexOf(g);
  if (at >= 0) tempGraphs.splice(at, 1);
  if (g.panel) g.panel.remove();
  refreshTempGraphButton();
}
function tempGraphBuildPanel(g) {
  const host = document.getElementById('canvas-wrap') || document.body;
  const panel = document.createElement('div');
  panel.className = 'velgraph-panel';
  const off = graphCascadeOffset();
  panel.style.right  = (10 + off) + 'px';
  panel.style.bottom = (10 + off) + 'px';
  panel.innerHTML =
    '<div class="vg-header">' +
      '<span class="vg-title"></span>' +
      '<span class="vg-status"></span>' +
      '<span class="vg-close">×</span>' +
    '</div>' +
    '<canvas></canvas>' +
    '<div class="vg-controls tg-legend"></div>' +
    '<div class="vg-controls">' +
      '<button class="btn-small tg-add" title="いま選んでいる物体を、このグラフに系列として足します（液体・気体があれば一緒に）。&#10;足した時点から線が始まります">＋選択を追加</button>' +
      '<span class="vg-hint">グラフ上にカーソルを置くと値を読めます</span>' +
      '<button class="btn-small tg-rec" title="記録を一時停止します（グラフは残ります）">停止</button>' +
      '<button class="btn-small tg-reset">リセット</button>' +
    '</div>';
  host.appendChild(panel);
  g.panel    = panel;
  g.canvas   = panel.querySelector('canvas');
  g.ctx      = g.canvas.getContext('2d');
  g.titleEl  = panel.querySelector('.vg-title');
  g.statusEl = panel.querySelector('.vg-status');
  g.recBtn   = panel.querySelector('.tg-rec');
  g.legendEl = panel.querySelector('.tg-legend');
  g.titleEl.textContent = '温度 ' + g.id;
  tgRefreshLegend(g);
  panel.querySelector('.vg-close').addEventListener('click', () => tempGraphClose(g));
  panel.querySelector('.tg-add').addEventListener('click',
    () => tgAddSeries(g, objects.filter(o => selectedIds.has(o.id)).map(o => o.id)));
  g.recBtn.addEventListener('click', () => toggleTempGraphRecording(g));
  panel.querySelector('.tg-reset').addEventListener('click', () => resetTempGraphOne(g));
  g.canvas.addEventListener('mousemove', ev => {
    const r = g.canvas.getBoundingClientRect();
    g.hover = { x: ev.clientX - r.left, y: ev.clientY - r.top };
  });
  g.canvas.addEventListener('mouseleave', () => g.hover = null);
  tempGraphMakeDraggable(g);
}
// ヘッダーのドラッグで移動（velgraph と同じ理由で left/top 基準へ移し替える）
function tempGraphMakeDraggable(g) {
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
// ── 入口ボタン ────────────────────────────────────────
// いま選んでいる物体を「ちょうどその顔ぶれで」開いている窓（無ければ null）
function tempGraphOfSelection() {
  const key = objects.filter(o => selectedIds.has(o.id)).map(o => o.id).sort().join(',');
  return tempGraphs.find(g =>
    g.series.filter(s => s.kind === 'body').map(s => s.bodyId).sort().join(',') === key) || null;
}
// 選択をまだ含んでいない窓のうち、いちばん新しいもの（＝「追加」の行き先）
function tempGraphToAppend() {
  const ids = objects.filter(o => selectedIds.has(o.id)).map(o => o.id);
  if (!ids.length) return null;
  for (let i = tempGraphs.length - 1; i >= 0; i--) {
    const g = tempGraphs[i];
    if (g.series.length >= TG_MAX_SERIES) continue;
    if (ids.some(id => !g.series.some(s => s.kind === 'body' && s.bodyId === id))) return g;
  }
  return null;
}
// いま温度グラフを開けるか（右パネルのボタン・表示メニュー・右クリックで同じ判定を使う）
//   ★入口が3つあるので、押せる条件も1か所に置く。片方だけ直すと「メニューでは灰色なのに
//     ボタンは押せる」という食い違いが出る（選択の3経路と同じ話）。
//   ★物体を選んでいなくても、粒子か気体室があれば開ける。液体・気体の系列は選択ではなく
//     その場にいる粒子・気体室から作られるため（tgBuildSeries）。
function tempGraphReady() {
  if (!world.thermalOn) return false;
  const ids = objects.filter(o => selectedIds.has(o.id));
  if (!ids.length && !particles.length && !gasChambers.length) return false;
  return !!tempGraphOfSelection() || tempGraphs.length < TG_MAX_WINDOWS;   // 開いていれば「閉じる」で押せる
}
// 右クリックメニューから：開いているグラフへ選択を足す
function ctxAddToTempGraph() {
  const g = tempGraphToAppend();
  if (g) tgAddSeries(g, objects.filter(o => selectedIds.has(o.id)).map(o => o.id));
  refreshTempGraphButton();
}
function toggleTempGraph() {
  const ids = objects.filter(o => selectedIds.has(o.id)).map(o => o.id);
  if (!ids.length && !particles.length && !gasChambers.length) return;
  // 同じ顔ぶれの窓が既にあれば閉じる（velgraph の2度押しと同じ操作感）
  const key = ids.slice().sort().join(',');
  const same = tempGraphs.find(g =>
    g.series.filter(s => s.kind === 'body').map(s => s.bodyId).sort().join(',') === key);
  if (same) { tempGraphClose(same); refreshTempGraphButton(); return; }
  if (tempGraphs.length >= TG_MAX_WINDOWS) return;
  tempGraphNew(ids);
  refreshTempGraphButton();
}
function refreshTempGraphButton() {
  const b = document.getElementById('p-tempgraph-btn');
  if (!b) return;
  const ids = objects.filter(o => selectedIds.has(o.id)).map(o => o.id);
  const key = ids.slice().sort().join(',');
  const open = tempGraphs.some(g =>
    g.series.filter(s => s.kind === 'body').map(s => s.bodyId).sort().join(',') === key);
  b.classList.toggle('active', !!open);
  const full = !open && tempGraphs.length >= TG_MAX_WINDOWS;
  b.disabled = !tempGraphReady();
  b.title = !world.thermalOn ? '熱のやりとりがOFFです（全体設定タブの「熱」で入れてください）'
          : open ? 'もう一度押すと閉じます'
          : full ? ('グラフは同時に' + TG_MAX_WINDOWS + '個までです。どれかを閉じてください')
          : '選択した物体の温度の時間変化を、1枚に重ねて表示します。'
          + '気体の入った容器があれば器ごとに1本、液体・気体の粒子があればその平均温度も'
          + '系列として一緒に描きます'
          + '（熱いおもりを水に入れて、両方が同じ温度へ近づく様子をそのまま見られます）';
  // 「開いているグラフに追加」は、足せる窓があるときだけ出す（右クリックと同じ門番）
  const add = document.getElementById('p-tempadd-btn');
  if (add) add.style.display = (world.thermalOn && tempGraphToAppend()) ? '' : 'none';
}
function toggleTempGraphRecording(g) {
  if (g.frozen) {
    if (g.samples.length >= TG_MAX_SAMPLES) return;   // 上限到達時はリセットしないと再開できない
    g.frozen = false; g.stopReason = null;
  } else {
    g.frozen = true; g.stopReason = 'user';
  }
  updateTempGraphStatus(g);
}
function resetTempGraphOne(g) {
  const stay = resetKeepsStopped(g);      // 「停止」中のリセットで勝手に再開しない（velgraph.js）
  g.t = 0; g.samples = []; g.frozen = stay; g.stopReason = stay ? 'user' : null;
  tempGraphSampleNow(g);
  updateTempGraphStatus(g);
}
function resetTempGraph() {
  for (const g of tempGraphs) resetTempGraphOne(g);
}
function updateTempGraphStatus(g) {
  if (g.recBtn) {
    const stuck = g.samples.length >= TG_MAX_SAMPLES;
    g.recBtn.textContent = g.frozen ? '再開' : '停止';
    g.recBtn.disabled = g.frozen && stuck;
    g.recBtn.title = g.recBtn.disabled ? '記録が上限に達しました。「リセット」で最初から記録し直せます'
                   : g.frozen          ? '記録を再開します'
                   :                     '記録を一時停止します（グラフは残ります）';
  }
  if (g.statusEl) {
    g.statusEl.textContent = g.frozen
      ? (g.stopReason === 'limit' ? '上限' : '停止中')
      : (world.thermalOn ? '' : '熱OFF');
  }
  if (g.titleEl) g.titleEl.textContent = '温度 ' + g.id + '：' + tempGraphName(g);
}
// ── 記録 ──────────────────────────────────────────────
function sampleTempGraph(dt) {
  for (const g of tempGraphs) {
    if (g.frozen || dt <= 0) continue;
    g.t += dt;
    tempGraphSampleNow(g);
    if (g.samples.length >= TG_MAX_SAMPLES) { g.frozen = true; g.stopReason = 'limit'; updateTempGraphStatus(g); }
  }
}
function tempGraphSampleNow(g) {
  g.samples.push({ t: g.t, v: g.series.map(tgSeriesValue) });
}
function tempGraphSampleAt(g, t) {          // 指定時刻に最も近い点（二分探索）
  const s = g.samples;
  if (!s.length) return null;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (s[m].t < t) lo = m + 1; else hi = m; }
  if (lo > 0 && Math.abs(s[lo-1].t - t) < Math.abs(s[lo].t - t)) lo--;
  return s[lo];
}
// ── 描画 ──────────────────────────────────────────────
function tgDecimals(range) {
  if (!(range > 0)) return 1;
  for (let d = 1; d < 4; d++) if (range / 20 >= Math.pow(10, -d)) return d;
  return 4;
}
function drawTempGraph() {
  for (const g of tempGraphs) drawTempGraphOne(g);
}
function drawTempGraphOne(g) {
  const cv = g.canvas, c = g.ctx;
  if (!cv || !c) return;
  const cssW = cv.clientWidth  || 304;
  const cssH = cv.clientHeight || 150;
  if (cv.width  !== cssW) cv.width  = cssW;
  if (cv.height !== cssH) cv.height = cssH;
  const W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  const padL = 40, padR = 8, padT = 8, padB = 16;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const tMax = Math.max(g.t, 1);
  const X = t => padL + (t / tMax) * plotW;
  // ★縦軸に要る小数桁。上端と下端が別の数字として読めるところまで増やす。
  //   「範囲の 1/20 が見える」を目安にした（＝目盛りの上下で2桁ぶんの差が出る）。
  //   温度は ℃ 表示なので上限は 4 桁で足りる（0.0001℃ より細かい話は教材にならない）。
  // 縦は全系列の実データから決める（温度は全系列で同じ単位なのでスケールを共有する）
  let vMin = Infinity, vMax = -Infinity;
  for (const s of g.samples) for (const v of s.v) {
    if (v == null) continue;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  if (!(vMin < Infinity)) { vMin = 0; vMax = 100; }
  // ★温度で色をつけているときは、縦軸に色の目盛り（world.thermalVizMin〜Max）を必ず含める。
  //   色とグラフを同じ物差しにするため。データだけで決めると、0.18℃ の一段でも窓の高さ
  //   いっぱいに広がり、色は 1/10 しか進まないのにグラフは「急に上がった」と見えていた
  //   （袋を落とすジュールの実験）。目盛りを決めた人が「どれだけの差を見せたいか」を
  //   決めているので、グラフもそれに従う。はみ出したデータは従来どおり軸が伸びて追う。
  //   実測（乱数固定・60秒）：熱平衡 20〜80℃／色 0〜90、伝導 20〜193／20〜200、
  //   放射 20〜132／20〜200、ジュール（斜面）20〜20.163／20〜20.2 と、どれも色の範囲に
  //   ほぼ収まっていて、軸が途中で伸び縮みしなくなるだけ。
  if (world.thermalOn && world.thermalViz && world.thermalVizMax > world.thermalVizMin) {
    vMin = Math.min(vMin, world.thermalVizMin);
    vMax = Math.max(vMax, world.thermalVizMax);
  }
  if (vMax - vMin < 1e-6) { vMin -= 1; vMax += 1; }
  const range = vMax - vMin; vMin -= range * 0.08; vMax += range * 0.08;
  const Y = v => padT + (1 - (v - vMin) / (vMax - vMin)) * plotH;
  c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1;
  c.strokeRect(padL, padT, plotW, plotH);
  if (vMin < 0 && vMax > 0) {                       // 0℃ の基準線
    const y0 = Y(0);
    c.strokeStyle = 'rgba(255,255,255,0.3)';
    c.beginPath(); c.moveTo(padL, y0); c.lineTo(padL + plotW, y0); c.stroke();
  }
  c.font = '9px sans-serif';
  c.fillStyle = 'rgba(224,230,240,0.7)'; c.textAlign = 'right';
  // ★桁数は縦軸の幅から決める。0.1℃ 決め打ちだと、範囲が狭いときに上端と下端が
  //   同じ文字になり「20.0 から 20.0 まで」という読めない目盛りになる（実測：
  //   摩擦で止まる箱の温度上昇は 0.023℃ で、両端とも 20.0 と出ていた）。
  //   温度の上がり方が小さいこと自体は物理として正しい（ΔT = v²/2c）ので、
  //   隠さずに読めるようにするのはグラフの側の仕事。
  const dp = tgDecimals(vMax - vMin);
  c.fillText(vMax.toFixed(dp), padL - 3, padT + 8);
  c.fillText(vMin.toFixed(dp), padL - 3, padT + plotH);
  // ★0℃ の線に数字を添える（枠線と紛れて「どこが 0 か」が読めなくなるため）。
  //   上端・下端の数字と 10px 以内で重なるときは出さない。他のグラフの窓と同じ流儀
  if (vMin < 0 && vMax > 0 && Math.abs(Y(0)+3 - (padT+8)) >= 10
                           && Math.abs(Y(0)+3 - (padT+plotH)) >= 10) {
    c.fillStyle = 'rgba(224,230,240,0.45)';
    c.fillText('0', padL - 3, Y(0) + 3);
  }
  c.fillStyle = 'rgba(224,230,240,0.45)'; c.textAlign = 'left';
  c.fillText('温度 [℃]', padL + 4, padT + 9);
  c.textAlign = 'right';
  c.fillText(tMax.toFixed(1) + ' s', padL + plotW, H - 4);
  c.save();
  c.beginPath(); c.rect(padL, padT, plotW, plotH); c.clip();
  for (let i = 0; i < g.series.length; i++) {
    c.strokeStyle = g.series[i].col; c.lineWidth = 1.5;
    c.beginPath();
    let began = false;
    for (const s of g.samples) {
      const v = s.v[i];
      if (v == null) { began = false; continue; }    // 消えた物体は線を切る
      const x = X(s.t), y = Y(v);
      began ? c.lineTo(x, y) : (c.moveTo(x, y), began = true);
    }
    c.stroke();
  }
  c.restore();
  // カーソル位置の読み取り
  if (g.hover && g.hover.x >= padL && g.hover.x <= padL + plotW && g.samples.length) {
    const t = (g.hover.x - padL) / plotW * tMax;
    const s = tempGraphSampleAt(g, t);
    if (s) {
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.beginPath(); c.moveTo(X(s.t), padT); c.lineTo(X(s.t), padT + plotH); c.stroke();
      const rows = [];
      for (let i = 0; i < g.series.length; i++)
        if (s.v[i] != null) rows.push({ col: g.series[i].col, txt: s.v[i].toFixed(1) + '℃' });
      const bw = 62, bh = 12 * rows.length + 14;
      let bx = X(s.t) + 6; if (bx + bw > W - 2) bx = X(s.t) - bw - 6;
      const by = Math.min(padT + 2, H - bh - 2);
      c.fillStyle = 'rgba(20,24,32,0.85)';
      c.fillRect(bx, by, bw, bh);
      c.strokeStyle = 'rgba(255,255,255,0.2)';
      c.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      c.textAlign = 'left'; c.font = '9px sans-serif';
      c.fillStyle = 'rgba(224,230,240,0.8)';
      c.fillText(s.t.toFixed(2) + ' s', bx + 4, by + 10);
      rows.forEach((r, i) => {
        c.fillStyle = r.col;
        c.fillRect(bx + 4, by + 15 + i * 12, 6, 6);
        c.fillStyle = 'rgba(224,230,240,0.9)';
        c.fillText(r.txt, bx + 14, by + 21 + i * 12);
      });
    }
  }
  c.textAlign = 'left';
}
