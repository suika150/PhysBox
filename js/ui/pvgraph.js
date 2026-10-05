// ════════════════════════════════════════
//  P-V 図（と P-T / V-T）
// ════════════════════════════════════════
//  velgraph / tempgraph と違い、**横軸が時間ではない**。気体の状態が (V, P) 平面を
//  どう動いたかをそのまま線で描く（パラメトリック図）。ウィンドウ枠・ドラッグ・
//  停止/リセット・ホバー読み取りは tempgraph と同じ作りで、CSS も .velgraph-panel を借りる。
//
//  ★等温線（PV = nRT）を薄く重ねられる。断熱変化なら、たどった線が等温線より
//    急に立つ（PV^γ = 一定）のが一目で分かる。
const PV_MAX_SAMPLES = 20000;
const PV_MAX_WINDOWS = 4;
const PV_AXES = {
  pv: { x:'V', y:'P', xl:'V [L]',  yl:'P [kPa]', xf:s=>s.V*1000, yf:s=>s.P/1000 },
  pt: { x:'T', y:'P', xl:'T [K]',  yl:'P [kPa]', xf:s=>s.T,      yf:s=>s.P/1000 },
  vt: { x:'T', y:'V', xl:'T [K]',  yl:'V [L]',   xf:s=>s.T,      yf:s=>s.V*1000 },
};
// 軸の組み合わせ ↔ 窓のラジオボタン。窓を作るときの結線と、外から軸を変える
// pvGraphSetMode() の両方がここを見る（別々に持つと片方だけ増やして食い違う）
const PV_MODE_RADIO = { pv:'.pv-pv', pt:'.pv-pt', vt:'.pv-vt' };
let pvGraphs = [];
let pvGraphSeq = 0;

function pvGraphChamber(g) { return gasChambers.find(c => c.id === g.chamberId) || null; }
function pvGraphPrune() { for (const g of pvGraphs.slice()) if (!pvGraphChamber(g)) pvGraphClose(g); }
function pvGraphOf(chamberId) { return pvGraphs.find(g => g.chamberId === chamberId) || null; }

function pvGraphNew(ch, opts) {
  const g = {
    id: ++pvGraphSeq,
    chamberId: ch.id,
    mode: 'pv',
    samples: [],           // {V, P, T, t}
    showIso: true,         // いまの温度の等温線を重ねる
    // ★軸に原点（0）を入れる。既定は切（データの範囲に自動で合わせる）。
    //   入れると V-T 図で「直線を伸ばすとどこで体積が 0 になるか」＝絶対零度が読める。
    //   P-V や P-T でも「圧力 0・体積 0 がどこか」が見えるので、比の読み違いが減る。
    showOrigin: false,
    frozen: false, stopReason: null,
    hover: null,
  };
  // ★シーンから復元するときの表示の選択。窓を組み立てる前に入れる（組み立て側が
  //   g の値からチェックを入れるので、あとから代入すると画面と中身がずれる）
  if (opts) Object.assign(g, opts);
  pvGraphs.push(g);
  pvGraphBuildPanel(g);
  pvGraphSampleNow(g);
  updatePvGraphStatus(g);
  return g;
}
function pvGraphClose(g) {
  const at = pvGraphs.indexOf(g);
  if (at >= 0) pvGraphs.splice(at, 1);
  if (g.panel) g.panel.remove();
  refreshPvGraphButton();
}
function pvGraphBuildPanel(g) {
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
    '<div class="vg-controls">' +
      '<span class="vg-grp" title="どの2つの状態量を軸に取るかを選びます。時間は軸に出てきません（状態が平面をどう動いたかの図です）">軸</span>' +
      '<label class="vg-check"><input type="radio" name="pvmode' + g.id + '" class="pv-pv">P–V</label>' +
      '<label class="vg-check"><input type="radio" name="pvmode' + g.id + '" class="pv-pt">P–T</label>' +
      '<label class="vg-check"><input type="radio" name="pvmode' + g.id + '" class="pv-vt">V–T</label>' +
    '</div>' +
    '<div class="vg-controls">' +
      '<label class="vg-check" title="いまの温度での PV = nRT を薄い線で重ねます。断熱変化だと、たどった線がこの線より急になります（PV^γ = 一定）"><input type="checkbox" class="pv-iso">等温線を重ねる</label>' +
      '<label class="vg-check" title="軸に原点（0）を入れます。V–T 図では、直線を伸ばした先で体積が 0 になる温度＝絶対零度が読めます"><input type="checkbox" class="pv-org">原点を入れる</label>' +
      '<span class="vg-hint">グラフ上にカーソルを置くと値を読めます</span>' +
      '<button class="btn-small pv-rec" title="記録を一時停止します（線は残ります）">停止</button>' +
      '<button class="btn-small pv-reset">リセット</button>' +
    '</div>';
  host.appendChild(panel);
  g.panel = panel;
  g.canvas = panel.querySelector('canvas');
  g.ctx = g.canvas.getContext('2d');
  g.titleEl = panel.querySelector('.vg-title');
  g.statusEl = panel.querySelector('.vg-status');
  g.recBtn = panel.querySelector('.pv-rec');
  panel.querySelector('.vg-close').addEventListener('click', () => pvGraphClose(g));
  g.recBtn.addEventListener('click', () => togglePvGraphRecording(g));
  panel.querySelector('.pv-reset').addEventListener('click', () => resetPvGraphOne(g));
  // チェックの初期状態はインスタンスの値から入れる（markup と二重に持つとずれる。
  // velgraph と同じ流儀。シーンから軸の選択を復元できるのはこの形だから）
  panel.querySelector(PV_MODE_RADIO[g.mode] || PV_MODE_RADIO.pv).checked = true;
  panel.querySelector('.pv-iso').checked = g.showIso;
  panel.querySelector('.pv-iso').addEventListener('change', e => g.showIso = e.target.checked);
  panel.querySelector('.pv-org').checked = !!g.showOrigin;
  panel.querySelector('.pv-org').addEventListener('change', e => g.showOrigin = e.target.checked);
  for (const m in PV_MODE_RADIO)
    panel.querySelector(PV_MODE_RADIO[m]).addEventListener('change', e => {
      if (e.target.checked) { g.mode = m; updatePvGraphStatus(g); }   // 見出しも軸に合わせる
    });
  g.canvas.addEventListener('mousemove', ev => {
    const r = g.canvas.getBoundingClientRect();
    g.hover = { x: ev.clientX - r.left, y: ev.clientY - r.top };
  });
  g.canvas.addEventListener('mouseleave', () => g.hover = null);
  pvGraphMakeDraggable(g);
}
function pvGraphMakeDraggable(g) {
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
// いまこのグラフを開けるか（右パネルのボタン・表示メニュー・右クリックで同じ判定を使う）
//   ★tempGraphReady と同じ作り。入口ごとに条件を書くと「押せるのに何も起きない」項目が出る。
//   ★1つの気体に窓は1つ（toggleGasGraph）。開いていれば軸の差し替え・閉じるで押せる
function pvGraphReady(ch) {
  return !!ch && (!!pvGraphOf(ch.id) || pvGraphs.length < PV_MAX_WINDOWS);
}
function togglePvGraph() {
  // ボタンは気体のパネルにしか無いので、選択中の気体をそのまま使う
  let ch = (typeof selectedGasChamber === 'function') ? selectedGasChamber() : null;
  if (!ch) ch = gasChambers[0];
  if (!ch) return;
  const open = pvGraphOf(ch.id);
  if (open) { pvGraphClose(open); return; }
  if (pvGraphs.length >= PV_MAX_WINDOWS) return;
  pvGraphNew(ch);
  refreshPvGraphButton();
}
// 軸の組み合わせを外から差し替える。
// ★窓のラジオも一緒に動かすこと。g.mode だけ書き換えると、ラジオは前の軸を指したまま
//   残り、そのラジオをもう一度押しても change が飛ばない＝窓から元の軸へ戻せなくなる。
function pvGraphSetMode(g, mode) {
  if (!g || !PV_AXES[mode]) return g;
  g.mode = mode;
  const r = g.panel && g.panel.querySelector(PV_MODE_RADIO[mode]);
  if (r) r.checked = true;
  updatePvGraphStatus(g);
  return g;
}
// 右クリックメニューの「グラフを表示」から、軸を選んで開く／切り替える／閉じる。
// ★1つの気体につき窓は1つに保つ。pvGraphOf() は最初の1つしか返さないので、同じ気体で
//   2つ目を開くと、2つ目を閉じる手段が右クリックからも右パネルからも無くなる。
//   すでに開いているときは窓を増やさず軸だけ差し替える（同じ軸をもう一度選んだら閉じる）。
function toggleGasGraph(mode) {
  const ch = (typeof selectedGasChamber === 'function') ? selectedGasChamber() : null;
  if (!ch || !PV_AXES[mode]) return;
  const open = pvGraphOf(ch.id);
  if (open) {
    if (open.mode === mode) pvGraphClose(open);   // ✔の付いた軸＝いま出ている軸をもう一度
    else pvGraphSetMode(open, mode);
  } else {
    if (pvGraphs.length >= PV_MAX_WINDOWS) return;
    pvGraphSetMode(pvGraphNew(ch), mode);
  }
  refreshPvGraphButton();
}
function refreshPvGraphButton() {
  const b = document.getElementById('p-pvgraph-btn');
  if (!b) return;
  const ch = (typeof selectedGasChamber === 'function') ? selectedGasChamber() : null;
  b.disabled = !pvGraphReady(ch);
  b.classList.toggle('active', !!(ch && pvGraphOf(ch.id)));
  b.title = !ch ? '気体を選択してください'
          : !pvGraphReady(ch) ? ('P-V 図は同時に' + PV_MAX_WINDOWS + '個までです。どれかを閉じてください')
          : (pvGraphOf(ch.id) ? 'もう一度押すと閉じます'
          : '気体の状態が (V, P) 平面をどう動いたかを描きます。時間は軸に出ません。'
          + '等温線を重ねられるので、断熱変化ならたどった線がそれより急になるのが見えます');
  // 温度 – 時間のグラフ（右クリックの ctxGasGraphSub と同じ門番）。★熱がOFFなら出さない
  const tb = document.getElementById('p-gastemp-btn');
  if (tb) {
    tb.style.display = world.thermalOn ? '' : 'none';
    tb.disabled = !tempGraphReady();
    tb.classList.toggle('active', !!tempGraphOfSelection());
  }
}
function togglePvGraphRecording(g) {
  if (g.frozen) {
    if (g.samples.length >= PV_MAX_SAMPLES) return;
    g.frozen = false; g.stopReason = null;
  } else { g.frozen = true; g.stopReason = 'user'; }
  updatePvGraphStatus(g);
}
function resetPvGraphOne(g) {
  const stay = resetKeepsStopped(g);
  g.samples = []; g.frozen = stay; g.stopReason = stay ? 'user' : null;
  pvGraphSampleNow(g);
  updatePvGraphStatus(g);
}
function resetPvGraph() { for (const g of pvGraphs) resetPvGraphOne(g); }
function updatePvGraphStatus(g) {
  const ch = pvGraphChamber(g);
  // ★見出しはいまの軸から作る（'P-V' 固定にしない）。右クリックから P-T / V-T を選んで
  //   開けるようになったので、固定だと窓の名前と中身の軸が食い違う
  const ax = PV_AXES[g.mode] || PV_AXES.pv;
  if (g.titleEl) g.titleEl.textContent = ax.y + '-' + ax.x + ' ' + g.id + (ch && ch.label ? '：' + ch.label : '');
  if (g.recBtn) {
    const stuck = g.samples.length >= PV_MAX_SAMPLES;
    g.recBtn.textContent = g.frozen ? '再開' : '停止';
    g.recBtn.disabled = g.frozen && stuck;
    g.recBtn.title = g.recBtn.disabled ? '記録が上限に達しました。「リセット」で描き直せます'
                   : g.frozen ? '記録を再開します' : '記録を一時停止します（線は残ります）';
  }
  if (g.statusEl) g.statusEl.textContent = g.frozen
    ? (g.stopReason === 'limit' ? '上限' : '停止中') : '';
}
// ── 記録 ──────────────────────────────────────────────
//   ★状態がほとんど動いていないときは点を積まない。停止中の点で配列が埋まると、
//     上限に達して「本当に動いたところ」が記録できなくなる。
function samplePvGraph(dt) {
  pvGraphPrune();
  for (const g of pvGraphs) {
    if (g.frozen || dt <= 0) continue;
    const ch = pvGraphChamber(g);
    if (!ch) continue;
    const last = g.samples[g.samples.length - 1];
    if (last) {
      const dV = Math.abs(ch.V - last.V) / Math.max(ch.V, 1e-12);
      const dP = Math.abs(ch.P - last.P) / Math.max(ch.P, 1e-12);
      const dT = Math.abs(ch.T - last.T) / Math.max(ch.T, 1e-12);
      // ★continue（このグラフを飛ばす）であって return ではない。return にすると、
      //   静止している気体のグラフが1つあるだけで、それより後ろのグラフが記録を
      //   止めてしまう（P-V図を2つ開いて片方だけ動かすと再現した）。
      if (dV < 2e-4 && dP < 2e-4 && dT < 2e-4) continue;
    }
    pvGraphSampleNow(g);
    if (g.samples.length >= PV_MAX_SAMPLES) { g.frozen = true; g.stopReason = 'limit'; updatePvGraphStatus(g); }
  }
}
function pvGraphSampleNow(g) {
  const ch = pvGraphChamber(g);
  if (!ch) return;
  // ★手で体積を変えた（停止中に蓋をスライドさせた）直後の点は、前の点と線で結ばない。
  //   連続した状態変化ではなく初期条件の作り直しなので、線で繋ぐと通っていない経路を
  //   通ったように見え、囲む面積＝仕事も嘘になる。帳簿に載せないのと同じ理由。
  const gap = !!ch._pvBreak;
  ch._pvBreak = false;
  g.samples.push({ V: ch.V, P: ch.P, T: ch.T, t: world.simTime, gap });
}
// ── たどった線が囲む面積 = ∮P dV = 1サイクルの正味の仕事 [J] ──────────
//   靴ひも公式。線が閉じていなければ、始点と終点を結んだものとして扱う。
//   符号は「時計回り＝正の仕事（熱機関）」になるようにとる。P-V図では
//   横軸V・縦軸Pで、膨張（右）で圧力が高く、圧縮（左）で低いと正味で仕事を取り出せる。
function pvLoopWork(g) {
  const s = g.samples;
  if (s.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < s.length; i++) {
    const p0 = s[i], p1 = s[(i + 1) % s.length];
    a += p0.V * p1.P - p1.V * p0.P;
  }
  return -a / 2;      // [J]（画面の上下反転ではなく数式どおりの向き）
}
// 線が「閉じている」か（始点と終点が十分近いか）。開いていれば面積は目安にしかならない
function pvLoopClosed(g) {
  const s = g.samples;
  if (s.length < 3) return false;
  let vMin = Infinity, vMax = -Infinity, pMin = Infinity, pMax = -Infinity;
  for (const x of s) {
    if (x.V < vMin) vMin = x.V; if (x.V > vMax) vMax = x.V;
    if (x.P < pMin) pMin = x.P; if (x.P > pMax) pMax = x.P;
  }
  const dv = (s[0].V - s[s.length-1].V) / Math.max(vMax - vMin, 1e-12);
  const dp = (s[0].P - s[s.length-1].P) / Math.max(pMax - pMin, 1e-12);
  return Math.hypot(dv, dp) < 0.05;
}
// ── 描画 ──────────────────────────────────────────────
function drawPvGraph() { for (const g of pvGraphs) drawPvGraphOne(g); }
function drawPvGraphOne(g) {
  const cv = g.canvas, c = g.ctx;
  if (!cv || !c) return;
  const cssW = cv.clientWidth || 304, cssH = cv.clientHeight || 150;
  if (cv.width !== cssW) cv.width = cssW;
  if (cv.height !== cssH) cv.height = cssH;
  const W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  const ch = pvGraphChamber(g);
  const ax = PV_AXES[g.mode];
  if (!ch || !g.samples.length) {
    c.fillStyle = 'rgba(224,230,240,0.5)'; c.font = '10px sans-serif'; c.textAlign = 'center';
    c.fillText('気体室がありません', W/2, H/2); c.textAlign = 'left';
    return;
  }
  const padL = 44, padR = 10, padT = 10, padB = 22;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const s of g.samples) {
    const x = ax.xf(s), y = ax.yf(s);
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
  }
  // 等温線も収まるように範囲を広げる
  if (g.showIso && g.mode === 'pv' && ch.n > 0) {
    const nRT = ch.n * R_GAS * ch.T;
    for (const vL of [xMin, xMax]) {
      const p = nRT / (vL/1000) / 1000;
      if (p < yMin) yMin = p; if (p > yMax) yMax = p;
    }
  }
  // ★原点を入れる（上の★）。データの範囲を 0 まで広げてから余白を足す
  if (g.showOrigin) {
    if (xMin > 0) xMin = 0; if (xMax < 0) xMax = 0;
    if (yMin > 0) yMin = 0; if (yMax < 0) yMax = 0;
  }
  if (xMax - xMin < 1e-9) { xMin -= 1; xMax += 1; }
  if (yMax - yMin < 1e-9) { yMin -= 1; yMax += 1; }
  const rx = xMax - xMin, ry = yMax - yMin;
  xMin -= rx*0.08; xMax += rx*0.08; yMin -= ry*0.10; yMax += ry*0.10;
  const X = v => padL + (v - xMin)/(xMax - xMin)*plotW;
  const Y = v => padT + (1 - (v - yMin)/(yMax - yMin))*plotH;
  c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1;
  c.strokeRect(padL, padT, plotW, plotH);
  c.font = '9px sans-serif';
  c.fillStyle = 'rgba(224,230,240,0.7)';
  c.textAlign = 'right';
  c.fillText(yMax.toFixed(1), padL-3, padT+8);
  c.fillText(yMin.toFixed(1), padL-3, padT+plotH);
  c.fillText(xMax.toFixed(1), padL+plotW, H-6);
  c.textAlign = 'left';
  c.fillText(xMin.toFixed(1), padL, H-6);
  c.fillStyle = 'rgba(224,230,240,0.45)';
  c.fillText(ax.yl, padL+4, padT+9);
  c.textAlign = 'right'; c.fillText(ax.xl, padL+plotW, padT+9); c.textAlign = 'left';
  // ★囲む面積＝∮P dV＝1サイクルの正味の仕事。P-V図のときだけ意味を持つ
  if (g.mode === 'pv') {
    const Wnet = pvLoopWork(g), closed = pvLoopClosed(g);
    let t = `囲む面積 W = ${Wnet.toFixed(1)} J`;
    if (closed && Wnet > 0 && ch.Qin > 1e-9) t += `　η = ${(Wnet/ch.Qin*100).toFixed(1)}%`;
    if (!closed) t += '（線が閉じていません）';
    c.fillStyle = closed ? '#ffd54f' : 'rgba(255,213,79,0.5)';
    c.fillText(t, padL+4, padT+22);
  }

  c.save();
  c.beginPath(); c.rect(padL, padT, plotW, plotH); c.clip();
  // 等温線（PV = nRT、いまの温度）
  if (g.showIso && g.mode === 'pv' && ch.n > 0) {
    const nRT = ch.n * R_GAS * ch.T;
    c.strokeStyle = 'rgba(255,255,255,0.28)';
    c.setLineDash([4,3]); c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i <= 60; i++) {
      const vL = xMin + (xMax - xMin) * i/60;
      if (vL <= 0) continue;
      const p = nRT / (vL/1000) / 1000;
      const x = X(vL), y = Y(p);
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.stroke(); c.setLineDash([]);
  }
  // たどった経路
  c.strokeStyle = '#26c6da'; c.lineWidth = 1.5;
  c.beginPath();
  g.samples.forEach((s, i) => {
    const x = X(ax.xf(s)), y = Y(ax.yf(s));
    (i === 0 || s.gap) ? c.moveTo(x, y) : c.lineTo(x, y);   // gap＝手で体積を変えた飛び（上の★）
  });
  c.stroke();
  // いまの点
  const last = g.samples[g.samples.length-1];
  const lx = X(ax.xf(last)), ly = Y(ax.yf(last));
  c.fillStyle = '#ffd54f';
  c.beginPath(); c.arc(lx, ly, 3, 0, Math.PI*2); c.fill();
  c.restore();

  // ホバー：いちばん近い点を読む
  if (g.hover) {
    let best = null, bd = 1e9;
    for (const s of g.samples) {
      const dx = X(ax.xf(s)) - g.hover.x, dy = Y(ax.yf(s)) - g.hover.y;
      const d = dx*dx + dy*dy;
      if (d < bd) { bd = d; best = s; }
    }
    if (best && bd < 900) {
      const bx0 = X(ax.xf(best)), by0 = Y(ax.yf(best));
      c.strokeStyle = 'rgba(255,255,255,0.5)';
      c.beginPath(); c.arc(bx0, by0, 5, 0, Math.PI*2); c.stroke();
      const rows = [ (best.V*1000).toFixed(2)+' L', (best.P/1000).toFixed(2)+' kPa',
                     K2C(best.T).toFixed(1)+'℃' ];
      const bw = 66, bh = 12*rows.length + 8;
      let bx = bx0 + 8; if (bx + bw > W-2) bx = bx0 - bw - 8;
      let by = by0 - bh/2; by = Math.max(2, Math.min(H - bh - 2, by));
      c.fillStyle = 'rgba(20,24,32,0.88)'; c.fillRect(bx, by, bw, bh);
      c.strokeStyle = 'rgba(255,255,255,0.2)'; c.strokeRect(bx+0.5, by+0.5, bw-1, bh-1);
      c.fillStyle = 'rgba(224,230,240,0.9)'; c.font = '9px sans-serif'; c.textAlign = 'left';
      rows.forEach((r,i)=>c.fillText(r, bx+5, by+12+i*12));
    }
  }
  c.textAlign = 'left';
}
