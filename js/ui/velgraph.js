// ── グラフの構成 ────────────────────────────────────────────
//   ★1ウィンドウ＝1物体。開いたウィンドウはその物体を追い続け、キャンバス側の
//     選択を変えても対象は乗り換えない。授業中はグラフを見ながら別の物体を触る
//     （力を足す、値を変える）ことが多く、選択に追随すると見ていた記録がそのたびに
//     消えてしまうため。物体を選んで「グラフを表示」を押すたびに新しいウィンドウが
//     増えるので、複数の物体を並べて見比べられる（回路グラフと同じ作り方）。
//   縦に「変位／速度／加速度」の段を積み、時間軸だけを全段で共有する。
//   縦軸は単位が違う（m / m/s / m/s²）ので段ごとに独立スケール。
//   成分の色は段をまたいで固定し、縦に目で追えるようにする。
//   ★表示する量・成分・記録の開始／停止はウィンドウごとに独立している。同じ現象を
//     「片方は変位だけ・片方は加速度だけ」で見る、といった使い方ができる。
//   ★変位だけは基準を選べる（成分ごとに独立）。既定は「記録を始めた位置」だが、
//     成分を座標原点（＝地面の高さ。js/physics/ground.js の ground.y = 0）から測ることも
//     できる。落として跳ね返らせる題材では、y を原点基準にするとグラフの縦軸が
//     そのまま「床からの高さ」になり、0 の線が床、山の高さが跳ね上がった高さになる。
//     記録開始位置を基準にすると同じ曲線が上下反転した「落とした点からの距離」になり、
//     床がどこかはグラフから読めない。x と大きさも同じ理屈で選べるようにしてある
//     （大きさを原点基準にすると「原点からの距離」）。
//     ★両方の値をサンプルに持ち、描くときに選ぶ。記録の途中で切り替えても過去の点まで
//       まとめて基準が変わる（片方だけ記録すると、切り替えた時刻で線が飛ぶ）。
const VG_COMP_COLORS = { x:'#42a5f5', y:'#ef5350', mag:'#66bb6a' };
// 変位を座標原点から測るときの切り替え（成分 → フラグ名 / サンプルのキー）
const VG_ORIGIN_FLAG = { x:'posOriginX', y:'posOriginY', mag:'posOriginMag' };
const VG_ORIGIN_KEYS = { x:'xa', y:'ya', mag:'ra' };
const VG_ORIGIN_COMP = { x:'x(原点)', y:'y(原点)', mag:'原点から' };
const VG_COMP_NAME   = { x:'X', y:'Y', mag:'大きさ' };
const VG_QUANTS = [
  { id:'pos', flag:'showPos', label:'変位',   unit:'m',
    keys:{ x:'x',  y:'y',  mag:'r'     }, comp:{ x:'x',  y:'y',  mag:'距離' } },
  { id:'vel', flag:'showVel', label:'速度',   unit:'m/s',
    keys:{ x:'vx', y:'vy', mag:'speed' }, comp:{ x:'vx', y:'vy', mag:'速さ' } },
  { id:'acc', flag:'showAcc', label:'加速度', unit:'m/s²',
    keys:{ x:'ax', y:'ay', mag:'amag'  }, comp:{ x:'ax', y:'ay', mag:'|a|'  } },
];
const VG_MAX_SAMPLES  = 20000;   // 安全上限（60fps で約5.5分ぶん）
const VG_START_TOL    = 0.9;     // [m/s²] 記録開始トリガー（重力の約1割）
const VG_ACC_SMOOTH_N = 6;       // 加速度の移動平均フレーム数（数値微分のノイズを均す）
const VG_ACC_LAG      = VG_ACC_SMOOTH_N / 2;  // 平均値を書き戻す点数＝窓の中心までの遅れ
const VG_MAX_WINDOWS  = 8;       // 同時に開ける数（画面が埋まる／毎フレーム描くので上限を置く）

// ── ウィンドウの検索 ───────────────────────────────────
function velGraphOf(bodyId) {
  for (const g of velGraphs) if (g.bodyId === bodyId) return g;
  return null;
}
function velGraphBody(g) {
  return objects.find(o => o.id === g.bodyId) || null;
}
function velGraphName(g) {
  const b = velGraphBody(g);
  return b ? (b.label || ('Object ' + b.id)) : ('Object ' + g.bodyId);
}
// 対象が消えたウィンドウを閉じる。物体が無くなれば記録の続きは取れないので残さない
// （Undo で物体が戻ってもウィンドウは戻らない。もう一度「グラフを表示」を押す）
function velGraphPrune() {
  for (const g of velGraphs.slice()) if (!velGraphBody(g)) velGraphClose(g);
}

// ── ウィンドウの生成と破棄 ─────────────────────────────
function velGraphNew(body, opts) {
  const g = {
    id: ++velGraphSeq,
    bodyId: body.id,       // ★追跡する物体（生きているかぎり変わらない）
    t: 0,                  // 記録開始からのシミュ時間[s]
    samples: [],           // {t, x,y,r, vx,vy,speed, ax,ay,amag}
    showPos: true, showVel: true, showAcc: true,   // 表示する段（変位・速度・加速度）
    showX: true, showY: true, showMag: true,       // 段の中で表示する成分
    // 変位の基準。false＝記録を始めた位置（既定）／true＝座標原点。成分ごとに独立
    posOriginX: false, posOriginY: false, posOriginMag: false,
    frozen: false,         // 記録停止フラグ（停止ボタン、または上限到達）
    stopReason: null,      // 'user' | 'limit' | null（停止の理由。表示文言の切り替え用）
    started: false,        // ★記録開始済みフラグ（加速度が生じるまで false＝待機）
    // ★記録開始トリガー（|a| ≥ VG_START_TOL）を使わず、実行と同時に記録する。
    //   「加速度が生じるまで待つ」は、置いただけの物体が動き出す瞬間を逃さないための
    //   既定だが、等速直線運動そのものが読みどころの題材（速度の合成＝川を渡る船）では
    //   逆に困る：合成する前の一定速度が1点も残らず、比較ができない。
    //   ★started と別に持つ理由は「リセットしても消えないこと」。started は
    //     resetVelGraphOne が false へ戻すので、この選択を started に畳むと
    //     リセットのたびに待機へ落ちてしまう（実測：リセット→実行で t=0 が川に入った瞬間になった）。
    autoStart: false,
    hover: null,           // {x,y} カーソル位置（canvas内CSS px）。null＝カーソルが外
    _x0: null,             // 記録開始位置[px]（変位の原点）
    _vPrev: null,
  };
  // ★シーンから復元するときの表示の選択。窓を組み立てる前に入れる（組み立て側が
  //   g の値からチェックを入れるので、あとから代入すると画面と中身がずれる）
  if (opts) Object.assign(g, opts);
  if (g.autoStart) g.started = true;   // ★変位の原点 _x0 は最初のサンプルで入る（sampleVelGraphOne）
  velGraphs.push(g);
  velGraphBuildPanel(g);
  updateVelGraphStatus(g);
  return g;
}
function velGraphClose(g) {
  const at = velGraphs.indexOf(g);
  if (at >= 0) velGraphs.splice(at, 1);
  if (g.panel) g.panel.remove();
  refreshVelGraphButton();
}
function velGraphBuildPanel(g) {
  const host = document.getElementById('canvas-wrap') || document.body;
  const panel = document.createElement('div');
  panel.className = 'velgraph-panel';
  // 開くたびに少しずらして、下のウィンドウが完全に隠れないようにする
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
    '<div class="vg-controls">' +
      '<span class="vg-grp" title="選んだ量が段になって縦に並びます。時間軸は全段で共通です">量</span>' +
      '<label class="vg-check"><input type="checkbox" class="vg-pos">変位 [m]</label>' +
      '<label class="vg-check"><input type="checkbox" class="vg-vel">速度 [m/s]</label>' +
      '<label class="vg-check" title="速度の数値微分です。ノイズを抑えるため数フレームの移動平均をかけています">' +
        '<input type="checkbox" class="vg-acc">加速度 [m/s²]</label>' +
    '</div>' +
    '<div class="vg-controls">' +
      '<span class="vg-grp" title="どの段でも同じ色で描かれるので、段をまたいで縦に目で追えます">成分</span>' +
      '<label class="vg-check"><input type="checkbox" class="vg-x"><span class="vg-chip" style="background:#42a5f5"></span>X</label>' +
      '<label class="vg-check"><input type="checkbox" class="vg-y"><span class="vg-chip" style="background:#ef5350"></span>Y</label>' +
      '<label class="vg-check"><input type="checkbox" class="vg-mag"><span class="vg-chip" style="background:#66bb6a"></span>大きさ</label>' +
    '</div>' +
    // ★変位の基準を選ぶ段。変位を出していないときは隠す（updateVelGraphStatus）
    '<div class="vg-controls vg-originrow">' +
      '<span class="vg-grp" title="チェックした成分の変位を、座標原点（既定では地面の高さ）から測ります。&#10;外すと記録を始めた位置からの変位です。&#10;床との衝突なら Y を入れると、縦軸がそのまま床からの高さになります">次の変位の基準を原点にする</span>' +
      '<label class="vg-check"><input type="checkbox" class="vg-ox">X</label>' +
      '<label class="vg-check"><input type="checkbox" class="vg-oy">Y</label>' +
      '<label class="vg-check"><input type="checkbox" class="vg-omag">大きさ</label>' +
    '</div>' +
    '<div class="vg-controls">' +
      '<span class="vg-hint">グラフ上にカーソルを置くと値を読めます</span>' +
      '<button class="btn-small vg-start" style="display:none" title="加速度が小さくて自動で始まらないときに、その場で記録を開始します（導体棒のようにゆっくり動く物体で使います）">今すぐ記録</button>' +
      '<button class="btn-small vg-rec" title="記録を一時停止します（グラフは残ります）">停止</button>' +
      '<button class="btn-small vg-reset">リセット</button>' +
    '</div>';
  host.appendChild(panel);
  g.panel    = panel;
  g.canvas   = panel.querySelector('canvas');
  g.ctx      = g.canvas.getContext('2d');
  g.titleEl  = panel.querySelector('.vg-title');
  g.statusEl = panel.querySelector('.vg-status');
  g.startBtn = panel.querySelector('.vg-start');
  g.recBtn   = panel.querySelector('.vg-rec');
  g.originRow = panel.querySelector('.vg-originrow');
  g.titleEl.textContent = 'グラフ ' + g.id;
  panel.querySelector('.vg-close').addEventListener('click', () => velGraphClose(g));
  // チェックの初期状態はインスタンスの値から入れる（markup と二重に持つとずれるため）
  for (const [cls, key] of [['.vg-pos','showPos'], ['.vg-vel','showVel'], ['.vg-acc','showAcc'],
                            ['.vg-x','showX'], ['.vg-y','showY'], ['.vg-mag','showMag'],
                            ['.vg-ox','posOriginX'], ['.vg-oy','posOriginY'], ['.vg-omag','posOriginMag']]) {
    const cb = panel.querySelector(cls);
    cb.checked = g[key];
    cb.addEventListener('change', ev => g[key] = ev.target.checked);
  }
  g.startBtn.addEventListener('click', () => startVelGraphNow(g));
  g.recBtn.addEventListener('click', () => toggleVelGraphRecording(g));
  panel.querySelector('.vg-reset').addEventListener('click', () => resetVelGraphOne(g));
  g.canvas.addEventListener('mousemove', ev => {
    const r = g.canvas.getBoundingClientRect();
    g.hover = { x: ev.clientX - r.left, y: ev.clientY - r.top };
  });
  g.canvas.addEventListener('mouseleave', () => g.hover = null);
  velGraphMakeDraggable(g);
}
// ヘッダーのドラッグで移動できるようにする。
// right/bottom 基準のままだとドラッグでサイズが変わってしまうので、親(canvas-wrap)基準の
// left/top へ変換してから動かす
function velGraphMakeDraggable(g) {
  const panel = g.panel, header = panel.querySelector('.vg-header');
  let dragging = false, offX = 0, offY = 0;
  header.addEventListener('mousedown', e => {
    if (e.target.classList.contains('vg-close')) return;   // ×ボタンは対象外
    const r = panel.getBoundingClientRect(), wr = panel.parentElement.getBoundingClientRect();
    dragging = true; offX = e.clientX - r.left; offY = e.clientY - r.top;
    panel.style.left = (r.left - wr.left) + 'px';
    panel.style.top  = (r.top  - wr.top)  + 'px';
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const wr = panel.parentElement.getBoundingClientRect();
    // canvas-wrap 内のローカル座標へ変換してから配置・クランプ
    let x = e.clientX - offX - wr.left, y = e.clientY - offY - wr.top;
    x = Math.max(0, Math.min(x, wr.width  - panel.offsetWidth));
    y = Math.max(0, Math.min(y, wr.height - panel.offsetHeight));
    panel.style.left = x + 'px'; panel.style.top = y + 'px';
  });
  window.addEventListener('mouseup', () => dragging = false);
}

// ── 出し入れ ──────────────────────────────────────────
//   選択中の物体のグラフを開く／閉じる。複数選択しているときは選んだぶんだけ並べる。
//   すでに全員ぶん開いているときだけ閉じる側に回る（トグル）。
// いまこのグラフを開けるか（右パネルのボタン・表示メニュー・右クリックで同じ判定を使う）
//   ★tempGraphReady と同じ作り。入口ごとに条件を書くと「押せるのに何も起きない」項目が出る。
//   ★全員ぶん開いていれば「閉じる」で押せる。1つでも欠けていて窓が上限なら、開く側に回っても何も起きない
function velGraphReady() {
  const sel = objects.filter(o => selectedIds.has(o.id));
  if (!sel.length) return false;
  return sel.every(o => velGraphOf(o.id)) || velGraphs.length < VG_MAX_WINDOWS;
}
function toggleVelGraph() {
  const sel = objects.filter(o => selectedIds.has(o.id));
  if (!sel.length) return;
  const lack = sel.filter(b => !velGraphOf(b.id));
  if (!lack.length) {                       // 全員ぶん開いている＝2度目の操作なので閉じる
    for (const b of sel) { const g = velGraphOf(b.id); if (g) velGraphClose(g); }
  } else {
    for (const b of lack) {
      if (velGraphs.length >= VG_MAX_WINDOWS) break;
      velGraphNew(b);
    }
  }
  refreshVelGraphButton();
}
// プロパティパネル側の入口ボタンの見た目を現在の表示状態に合わせる
function refreshVelGraphButton() {
  const b = document.getElementById('p-graph-btn');
  if (!b) return;
  const sel = objects.filter(o => selectedIds.has(o.id));
  const open = sel.length && sel.every(o => velGraphOf(o.id));
  // ★表記は変えず、開いていることは枠の色（.active）で示す。「グラフ」の見出しの下に
  //   量の名前で並ぶボタンなので、押すたびに文言が変わると何のボタンか分からなくなる
  b.classList.toggle('active', !!open);
  const full = !open && velGraphs.length >= VG_MAX_WINDOWS;
  b.disabled = !velGraphReady();
  b.title = open ? 'もう一度押すと閉じます（選択中の物体のグラフ）'
                 : full ? ('グラフは同時に' + VG_MAX_WINDOWS + '個までです。どれかを閉じてください')
                 : '選択中の物体の 変位・速度・加速度 の時間変化を表示します。'
                 + 'ウィンドウはその物体の記録を持ち続けるので、別の物体を選んでも切り替わりません'
                 + '（複数選べば、その数だけ並べて見比べられます）';
}
// 停止／再開ボタン：記録を手動で止める・再び続ける
function toggleVelGraphRecording(g) {
  if (g.frozen) {
    if (g.samples.length >= VG_MAX_SAMPLES) return;  // 上限到達時はリセットしないと再開できない
    g.frozen = false; g.stopReason = null;
    g._vPrev = null;                                 // 再開直後の dv/dt が跳ねないよう基準を捨てる
  } else {
    g.frozen = true; g.stopReason = 'user';
  }
  updateVelGraphStatus(g);
}
// 指定時刻にいちばん近いサンプルを二分探索で取り出す
function velGraphSampleAt(g, t) {
  const a = g.samples;
  if (!a.length) return null;
  let lo = 0, hi = a.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid].t < t) lo = mid + 1; else hi = mid;
  }
  const prev = a[lo - 1];
  if (prev && Math.abs(prev.t - t) < Math.abs(a[lo].t - t)) return prev;
  return a[lo];
}
// 「幅 W 点ぶんとぎれずに続いた上限／下限」を、増えたサンプルぶんだけ進めて求める。
//   窓移動の最小・最大（単調両端キュー）。サンプルは末尾に伸びるだけなので、
//   キューと最良値を成分ごとに持ち越せば 1 tick あたり O(1) で済む。
//   ★毎フレーム全点を舐め直す作りにしたら、18000点・3成分で 15.5 ms/回かかった
//     （記録中は tick ごとに計算し直すので、それだけで 1 フレームの予算を使い切る）。
//     持ち越しにすると 0.01 ms/回。添字はサンプル配列の伸長でしか変わらないので、
//     配列を作り直すリセット時にだけ捨てればよい（resetVelGraphOne）。
function vgAccScan(g, samples, key) {
  const all = g._accScan || (g._accScan = {});
  const st = all[key] || (all[key] = { n: 0, dqLo: [], dqHi: [],
                                       lo: Infinity, hi: -Infinity,
                                       tMin: Infinity, tMax: -Infinity });
  const W = VG_SPIKE_W, dqLo = st.dqLo, dqHi = st.dqHi;
  // ★末尾 VG_ACC_LAG 点は走査しない。そこはまだ窓が閉じておらず、狭い窓で埋めた
  //   暫定値が入っている（vgFillAcc の★）。走査済みの印は添字で持ち越すので、
  //   一度読むと、狭い窓のノイズが縦軸の範囲に焼き付いて消せなくなる。
  const end = samples.length - VG_ACC_LAG;
  for (let i = st.n; i < end; i++) {
    const v = samples[i][key];
    if (v < st.tMin) st.tMin = v;
    if (v > st.tMax) st.tMax = v;
    while (dqLo.length && samples[dqLo[dqLo.length-1]][key] <= v) dqLo.pop();  // 先頭＝窓の最大
    dqLo.push(i);
    if (dqLo[0] <= i - W) dqLo.shift();
    while (dqHi.length && samples[dqHi[dqHi.length-1]][key] >= v) dqHi.pop();  // 先頭＝窓の最小
    dqHi.push(i);
    if (dqHi[0] <= i - W) dqHi.shift();
    if (i >= W - 1) {
      const a = samples[dqLo[0]][key]; if (a < st.lo) st.lo = a;   // 窓の最大の最小＝続いた下限
      const b = samples[dqHi[0]][key]; if (b > st.hi) st.hi = b;   // 窓の最小の最大＝続いた上限
    }
  }
  if (end > st.n) st.n = end;   // ★記録が VG_ACC_LAG 点に満たないうちは end が負になりうる
  return st;
}
// 加速度の段の縦軸を返す。衝突の瞬間の加速度は数百 m/s² に跳ねるので、素直に min/max を
// 取ると他の区間がぺしゃんこになって読めない。スパイクだけを枠の外へ出す。
//   ★判定は「幅」で行う。以前は上下 n% を切り捨てていたが、割合は記録の長さに比例して
//     増えるので、短命な本物の信号を外れ値と区別できない。落下（空気抵抗）は「最初の
//     0.6 秒だけ −9.8 に居て、あとはずっと 0」という信号なので、衝突が1回も無いのに
//     立ち上がりごと切られていた（実測：軸の下端が 5秒で −10.36、20秒で −7.19、
//     40秒で −2.68 と浅くなり、40秒では 47 点＝0.78 秒ぶんが枠外に落ちた。
//     速度の段は無傷なので「速度の微分が加速度になっていない」ように見える）。
//   ★幅で見分けられるのは、スパイクの出どころが必ず 1 tick の力積だから
//     （接触＝collision.js、留め具の解放＝demos-mechanics.js:147 の★）。
//     1 tick の力積は移動平均でちょうど VG_ACC_SMOOTH_N 点に広がるので、
//     窓＋1 点続いたかどうかで本物と切り分けられる。記録の長さには依存しない
//     （実測：落下（空気抵抗）の軸は 5秒でも 20秒でも 40秒でも −10.05〜0.74 で同じ）。
//   ★窓より細い山は、そもそも移動平均が潰していて描かれていない＝判定の物差しは
//     平滑化の窓と同じものを使う。実測でも、なだらかな振動は削れない
//     （単振動と円運動の射影：生 ±8.2 に対し軸 ±9.42、枠外 0 点）。
//   ★上限も下限も「窓ぶん続いた値」なので、山が窓より細い信号では帯が逆転する
//     （下限＞上限）。これは「この物差しでは何も言えていない」という意味なので、
//     そのときだけ素直に全体を収める。振動が速すぎて移動平均が潰している領域で、
//     スパイク除去が信号ぜんぶを枠外へ出すのを防ぐ（実測：k=300 N/m・0.1 kg＝8.7 Hz の
//     ばねで帯が 149.43〜−191.61 と逆転した。他の題材はどれも逆転しない——
//     落下（空気抵抗）−9.31〜0.00、床との衝突 −9.81〜0.00、単振動 −8.12〜8.12）。
const VG_SPIKE_W = VG_ACC_SMOOTH_N + 1;   // スパイクと認める最大の幅[点]
function vgAccAxisRange(g, samples, keys, comps) {
  let vMin = Infinity, vMax = -Infinity, tMin = Infinity, tMax = -Infinity;
  for (const k of comps) {
    const st = vgAccScan(g, samples, keys[k]);   // ★成分ごとに別の系列なので、判定も成分ごと
    let lo = st.lo, hi = st.hi;
    if (lo > hi) { lo = st.tMin; hi = st.tMax; } // 帯が逆転＝窓より細い山しかない（上の★）
    if (st.tMin < tMin) tMin = st.tMin;
    if (st.tMax > tMax) tMax = st.tMax;
    if (lo < vMin) vMin = lo;
    if (hi > vMax) vMax = hi;
  }
  if (!isFinite(vMin) || !isFinite(vMax)) return null;
  // ★実際に枠からはみ出したかは、余白を足したあとの軸と比べないと分からない。
  //   はみ出すのは必ず最大か最小なので、生の両端だけ返して呼び出し側で見る。
  return { vMin, vMax, tMin, tMax };
}
// 段が使うサンプルのキーと、読み取り箱に出す成分の見出し。
//   変位だけは成分ごとに基準（記録開始位置／座標原点）を選べるので、描くときに解決する。
//   ほかの量は基準が1つしかないので q の定義をそのまま返す。
function vgRowKeys(g, q) {
  if (q.id !== 'pos') return { keys: q.keys, comp: q.comp };
  const keys = {}, comp = {};
  for (const k of ['x', 'y', 'mag']) {
    const org = !!g[VG_ORIGIN_FLAG[k]];
    keys[k] = org ? VG_ORIGIN_KEYS[k] : q.keys[k];
    comp[k] = org ? VG_ORIGIN_COMP[k] : q.comp[k];
  }
  return { keys, comp };
}
// ★「停止」で止めている間はリセットしても再開しない。
//   止めたのは見たい瞬間を逃さないためなので、記録を捨てた拍子に走り出すと目的を壊す。
//   上限到達・対象消失で止まった場合だけは、リセットが唯一の復帰手段なので解除する。
function resetKeepsStopped(g) { return g.stopReason === 'user'; }
function resetVelGraphOne(g) {
  const stay = resetKeepsStopped(g);
  g.t = 0; g.samples = []; g.frozen = stay; g.stopReason = stay ? 'user' : null;
  g.started = !!g.autoStart;            // ★加速度が生じるまで記録を始めない（autoStart のときだけ即開始）
  g._x0 = null; g._vPrev = null; g._accScan = null;   // 縦軸の走査（添字）も捨てる
  updateVelGraphStatus(g);
}
// 「リセット」「戻る／進む」「全消去」からの一括リセット。ウィンドウ自体は閉じない
// （対象が消えたウィンドウは velGraphPrune が畳む）
function resetVelGraph() {
  for (const g of velGraphs) resetVelGraphOne(g);
}
// ★記録開始トリガー（|a| ≥ VG_START_TOL）を待たずに、その場で記録を始める。
//   導体棒のように「電磁力は働いているが加速度が小さい」物体は、既定のしきい値
//   （0.9 m/s²＝重力の約1割）に届かず、いつまでも記録が始まらないことがある。
function startVelGraphNow(g) {
  const b = velGraphBody(g);
  if (!b) return;
  g.started = true;
  g._x0 = { x: b.x, y: b.y };     // 変位の原点＝この瞬間の位置
  g.frozen = false;
  updateVelGraphStatus(g);
}
function updateVelGraphStatus(g) {
  if (g.startBtn) g.startBtn.style.display = (!g.started && !g.frozen) ? '' : 'none';  // 待機中だけ出す
  // 変位を出していないときに「変位の原点」を出しても効かないので隠す（触って意味のある操作だけ出す）
  if (g.originRow) g.originRow.style.display = g.showPos ? '' : 'none';
  if (g.recBtn) {
    const atLimit = g.samples.length >= VG_MAX_SAMPLES;
    g.recBtn.textContent = g.frozen ? '再開' : '停止';
    g.recBtn.disabled = g.frozen && atLimit;
    g.recBtn.title = g.recBtn.disabled ? '記録が上限に達しました。「リセット」で最初から記録し直せます'
                   : g.frozen          ? '記録を再開します'
                   :                     '記録を一時停止します（グラフは残ります）';
  }
  const name = velGraphName(g);
  if (g.titleEl && g.titleEl.textContent !== name) {
    g.titleEl.textContent = name;                 // ★見出し＝追跡中の物体。選択では変わらない
    g.titleEl.title = 'このウィンドウは ' + name + ' の記録です（選択を変えても切り替わりません）';
  }
  const el = g.statusEl;
  if (!el) return;
  if (g.stopReason === 'limit')   { el.textContent = '記録停止（上限）'; el.style.color = 'var(--accent3)'; }
  else if (g.frozen)              { el.textContent = '記録停止'; el.style.color = 'var(--accent3)'; }
  else if (running && !g.started) { el.textContent = '加速度が生じるまで待機'; el.style.color = 'var(--text2)'; }
  else if (running)               { el.textContent = '記録中'; el.style.color = '#66bb6a'; }
  else                            { el.textContent = '待機中'; el.style.color = 'var(--text2)'; }
}
// 末尾まわりの点の加速度を、幅 VG_ACC_SMOOTH_N の移動平均で置き直す。
//   ★平均した値は、窓の末尾ではなく「窓の中心の時刻」の点に置く。生の差分
//     (v_i − v_{i−1})/dt は区間 (t−dt, t) の平均なので中心が t−dt/2 にあり、それを
//     N 点平均すると中心はさらに (N−1)/2 点ぶん手前へ寄る。合わせて N/2 点＝
//     VG_ACC_LAG 点。末尾の時刻に貼ると加速度の段だけが時間軸上でそのぶん遅れ、
//     「速度の微分が加速度になっていない」ように見える（実測：落下（空気抵抗）の
//     t=0.367s で、記録値 −7.281 に対し真の dv/dt は −6.765。記録した a を積分すると
//     終端速度 5.856 m/s に対して 0.488 m/s＝8.3% はみ出していた。中心に置くと 0.0036 m/s）。
//     a が一定の題材（自由落下）ではずらしても曲線が変わらないので見えず、抵抗つき
//     落下のように減衰の時定数が短い（0.67 秒）題材でだけ表に出る。
//   ★中心を揃えたまま半幅 h を縮められるところまで縮める：raw を j−h+1..j+h で
//     平均した値は (v_{j+h} − v_{j−h}) / 2h·dt に等しく、h によらず中心は t_j のまま。
//     窓が閉じていない末尾と、さかのぼれない先頭は、これで狭い窓に落として埋める。
//     後ろ向きの平均を暫定値として置くやり方だと、確定済みの点との間に段差が残った
//     （実測：落下（空気抵抗）を a の変化がいちばん速い t=0.4s で止めると、先端に
//       0.62 m/s²＝加速度の段で 2.0px の折れ）。狭い窓に落とすと 0.105 m/s²＝0.33px まで
//       減り、先端まで単調になる（狭い窓が残るのは半幅 0 の最後の1点だけなので）。
//     窓が狭いぶん先端はノイズに弱いが、段は行ごとにクリップしてあるので枠から漏れず、
//     次の tick で広い窓に置き換わる。
//   ★触るのは末尾 VG_ACC_LAG+1 点だけ。それより前の点は h が VG_ACC_LAG で頭打ちに
//     なっていて、もう値が変わらない（全点を舐め直すと記録の長さに比例して重くなる）。
function vgFillAcc(samples, dt) {
  const n = samples.length;
  for (let j = Math.max(0, n - 1 - VG_ACC_LAG); j < n; j++) {
    const h = Math.min(VG_ACC_LAG, n - 1 - j, j);
    let ax, ay;
    if (h > 0) {
      const lo = samples[j - h], hi = samples[j + h], d = 2 * h * dt;
      ax = (hi.vx - lo.vx) / d; ay = (hi.vy - lo.vy) / d;
    } else if (j > 0) {                       // 先端の1点は均せない＝生の差分のまま
      ax = (samples[j].vx - samples[j - 1].vx) / dt;
      ay = (samples[j].vy - samples[j - 1].vy) / dt;
    } else continue;                          // 記録の最初の1点は前が無いので押し込んだ値を使う
    const s = samples[j];
    s.ax = ax; s.ay = ay; s.amag = Math.hypot(ax, ay);
  }
}
function sampleVelGraph(dt) {
  velGraphPrune();
  for (const g of velGraphs) sampleVelGraphOne(g, dt);
}
function sampleVelGraphOne(g, dt) {
  const b = velGraphBody(g);
  if (!b) return;
  if (g.frozen || dt <= 0) return;
  const vx = b.vx * PX2M, vy = yUI(b.vy * PX2M);   // [m/s] 表示は上向き正
  const speed = Math.hypot(vx, vy);
  // ★記録開始トリガー：加速度が生じるまで待機（時間軸も進めない）。
  //   前フレームとの速度差から a=dv/dt を求め、|a| が VG_START_TOL を超えた瞬間に開始する。
  if (!g.started) {
    if (g._vPrev) {
      const ax = (vx - g._vPrev.vx) / dt, ay = (vy - g._vPrev.vy) / dt;
      if (Math.hypot(ax, ay) >= VG_START_TOL) {
        g.started = true;               // トリガー成立→このフレームを最初の記録点として下へ進む
        g._x0 = { x: b.x, y: b.y };     // ★変位の原点＝記録を始めた瞬間の位置
        updateVelGraphStatus(g);
      }
    }
    if (!g.started) { g._vPrev = { vx, vy }; return; }   // まだ加速なし＝待機継続（記録しない）
  }
  // ★前フレームの速度が無いフレームは記録しない（a=dv/dt が取れないため）。
  //   a=0 を1点でも混ぜると、移動平均がその0を VG_ACC_SMOOTH_N フレーム引きずり、
  //   実在しない立ち上がりが加速度の段に出る（実測：落下（空気抵抗）で「今すぐ記録」を
  //   押してから実行すると 0 → −9.66(0.12s) → 0 の山になった。正しくは −9.79 から
  //   単調に 0 へ近づく）。待機トリガー経由なら _vPrev は必ず埋まっているので、
  //   これが効くのは autoStart と「今すぐ記録」の2つの入口。
  //   ★捨てるのは1フレームだけで、待機トリガー経由が最初のフレームを記録しないのと同じ。
  if (!g._vPrev) { g._vPrev = { vx, vy }; return; }
  if (!g._x0) g._x0 = { x: b.x, y: b.y };
  // 加速度は v の数値微分なので1フレームごとに大きく暴れる（特に衝突の瞬間）。
  // 幅 VG_ACC_SMOOTH_N の窓で均してから記録する（実際に置くのは下の vgFillAcc）。
  const ax = (vx - g._vPrev.vx) / dt, ay = (vy - g._vPrev.vy) / dt;
  // 変位は記録開始位置を原点にとる（画面の上向きが正）
  const x = (b.x - g._x0.x) * PX2M, y = yUI((b.y - g._x0.y) * PX2M);
  // ★座標原点から測った位置も一緒に控える。どちらで描くかは成分ごとの選択（冒頭の★）で、
  //   描くときに選ぶ。片方だけ記録すると、途中で切り替えたときにその時刻で線が飛ぶ
  const xa = b.x * PX2M, ya = yUI(b.y * PX2M);
  g.t += dt;
  g.samples.push({ t: g.t, x, y, r: Math.hypot(x, y),
                   xa, ya, ra: Math.hypot(xa, ya),
                   vx, vy, speed, ax, ay, amag: Math.hypot(ax, ay) });
  vgFillAcc(g.samples, dt);
  g._vPrev = { vx, vy };
  // 記録の終了はユーザーの停止ボタン頼み。安全上限に達したときだけ自動で止める
  if (g.samples.length >= VG_MAX_SAMPLES) { g.frozen = true; g.stopReason = 'limit'; updateVelGraphStatus(g); }
}
function drawVelGraph() {
  velGraphPrune();                    // ★物体が消えたウィンドウはここで畳む（停止中でも効くように）
  for (const g of velGraphs) drawVelGraphOne(g);
}
function drawVelGraphOne(g) {
  const cv = g.canvas, c = g.ctx;
  if (!cv || !c) return;
  const cssW = cv.clientWidth  || 304;
  const cssH = cv.clientHeight || 150;
  if (cv.width  !== cssW) cv.width  = cssW;               // 表示幅に合わせる（にじみ防止）
  if (cv.height !== cssH) cv.height = cssH;               // ★リサイズで変わる高さも同期
  const W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  const comps = [];
  if (g.showX)   comps.push('x');
  if (g.showY)   comps.push('y');
  if (g.showMag) comps.push('mag');
  const quants = VG_QUANTS.filter(q => g[q.flag]);
  if (!quants.length || !comps.length) {
    c.fillStyle = 'rgba(224,230,240,0.5)'; c.font = '10px sans-serif'; c.textAlign = 'center';
    c.fillText('表示する量と成分を選んでください', W/2, H/2);
    c.textAlign = 'left';
    updateVelGraphStatus(g);
    return;
  }
  const padL = 34, padR = 8, padT = 8, padB = 16, gapY = 12;
  const n = quants.length;
  const plotW = W - padL - padR;
  const rowH  = (H - padT - padB - gapY*(n-1)) / n;
  const tMax  = Math.max(g.t, 1);
  const X = t => padL + (t / tMax) * plotW;
  // 段ごとに縦スケールを独立して決める（単位が違うので共有できない）
  const rows = quants.map((q, i) => {
    const top = padT + i*(rowH + gapY);
    const { keys, comp } = vgRowKeys(g, q);      // 変位は成分ごとに基準を選べる
    let vMin = 0, vMax = 0;
    // 加速度だけは衝突スパイクを外れ値として除く。変位・速度は素直に全体を収める
    //   （判定の仕方と、なぜ割合ではなく幅で見るかは vgAccAxisRange の★）
    const rb = (q.id === 'acc' && g.samples.length > VG_SPIKE_W * 2)
             ? vgAccAxisRange(g, g.samples, keys, comps) : null;
    if (rb) { vMin = Math.min(0, rb.vMin); vMax = Math.max(0, rb.vMax); }
    else for (const s of g.samples) for (const k of comps) {
      const v = s[keys[k]];
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    if (vMax - vMin < 1e-9) { vMin -= 1; vMax += 1; }
    const range = vMax - vMin; vMin -= range*0.08; vMax += range*0.08;
    // 段の見出しに「どの成分を原点から測っているか」を添える。基準が2通りあるのに
    // 曲線の形だけでは見分けられないので、書かないと 0 の線の意味が読めなくなる
    const org = q.id === 'pos' ? comps.filter(k => g[VG_ORIGIN_FLAG[k]]) : [];
    // ★見出しの断り書きは、実際に枠外へ出した点があるときだけ出す。以前は「外れ値を
    //   除く計算を通ったか」で出していたので、衝突が1回も無い落下でも必ず出ていた。
    return { q, keys, comp, top, vMin, vMax,
             clipped: !!rb && (rb.tMin < vMin || rb.tMax > vMax),
             note: org.length ? '（原点基準：' + org.map(k => VG_COMP_NAME[k]).join('・') + '）' : '',
             Y: v => top + (1 - (v - vMin)/(vMax - vMin)) * rowH };
  });
  for (const r of rows) {
    c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1;
    c.strokeRect(padL, r.top, plotW, rowH);
    const zero = (r.vMin < 0 && r.vMax > 0) ? r.Y(0) : null;   // 値=0 の基準線
    if (zero !== null) {
      c.strokeStyle = 'rgba(255,255,255,0.3)';
      c.beginPath(); c.moveTo(padL, zero); c.lineTo(padL+plotW, zero); c.stroke();
    }
    c.font = '9px sans-serif';
    c.fillStyle = 'rgba(224,230,240,0.7)'; c.textAlign = 'right';
    c.fillText(r.vMax.toFixed(2), padL-3, r.top+8);
    c.fillText(r.vMin.toFixed(2), padL-3, r.top+rowH);
    // ★0 の線には必ず数字を添える。段が増えると枠線だけで横線が 2n 本並び、
    //   基準線がそのうちの1本に紛れて「どこが 0 か」が読めなくなる（力学的エネルギーの
    //   グラフが先にこの書き方をしている：energygraph.js の同じ位置）。
    //   ★上端・下端の数字と 10px 以内に重なるときは出さない。0 が枠のきわにある
    //     ＝上端か下端の数字がほぼ 0 なので、数字を2つ重ねてまで書く価値がない。
    if (zero !== null && Math.abs(zero+3 - (r.top+8)) >= 10
                     && Math.abs(zero+3 - (r.top+rowH)) >= 10) {
      c.fillStyle = 'rgba(224,230,240,0.45)';
      c.fillText('0', padL-3, zero+3);
    }
    c.fillStyle = 'rgba(224,230,240,0.45)'; c.textAlign = 'left';
    c.fillText(r.q.label + ' [' + r.q.unit + ']' + r.note + (r.clipped ? '（スパイクは枠外）' : ''),
               padL+4, r.top+9);                                      // 段の見出し
    c.save();
    c.beginPath(); c.rect(padL, r.top, plotW, rowH); c.clip();        // はみ出しを隣の段へ漏らさない
    for (const k of comps) {
      c.strokeStyle = VG_COMP_COLORS[k]; c.lineWidth = 1.5;
      c.beginPath();
      let began = false;
      const key = r.keys[k];
      for (const s of g.samples) {
        const x = X(s.t), y = r.Y(s[key]);
        began ? c.lineTo(x, y) : (c.moveTo(x, y), began = true);
      }
      c.stroke();
    }
    c.restore();
  }
  // 時間軸の目盛りは最下段の下に1回だけ
  const last = rows[rows.length-1];
  c.font = '9px sans-serif'; c.fillStyle = 'rgba(224,230,240,0.7)';
  c.textAlign = 'left';  c.fillText('0', padL+1, last.top+rowH+13);
  c.textAlign = 'right'; c.fillText(tMax.toFixed(1)+'s', padL+plotW, last.top+rowH+13);
  if (g.frozen && g.samples.length) {
    c.fillStyle = 'rgba(165,214,167,0.9)'; c.textAlign = 'right';
    c.fillText(g.stopReason === 'limit' ? '記録停止（上限）' : '記録停止', padL+plotW-2, padT+10);
  }
  c.textAlign = 'left';
  // ── カーソル読み取り：全段を貫く1本の縦線で、同じ時刻の値をまとめて読む ──
  const hv = g.hover;
  if (hv && g.samples.length &&
      hv.x >= padL && hv.x <= padL+plotW && hv.y >= padT && hv.y <= H-padB) {
    const s = velGraphSampleAt(g, (hv.x - padL) / plotW * tMax);
    const sx = X(s.t);
    c.save();
    c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 1; c.setLineDash([3,3]);
    c.beginPath(); c.moveTo(sx, padT); c.lineTo(sx, last.top+rowH); c.stroke();
    c.setLineDash([]);
    for (const r of rows) {
      c.save();
      c.beginPath(); c.rect(padL, r.top, plotW, rowH); c.clip();   // 枠外の値の点は出さない
      for (const k of comps) {
        c.fillStyle = VG_COMP_COLORS[k];
        c.beginPath(); c.arc(sx, r.Y(s[r.keys[k]]), 3, 0, Math.PI*2); c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1; c.stroke();
      }
      c.restore();
    }
    // 1行＝1つの量。行内を「見出し／各成分／単位」の色つき断片に分けて並べる
    c.font = '10px sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
    const GAP = 6;
    let headW = 0;
    for (const r of rows) headW = Math.max(headW, c.measureText(r.q.label).width);
    const lines = [[{ txt:'t = ' + s.t.toFixed(3) + ' s', col:'rgba(224,230,240,0.95)', w:0 }]];
    for (const r of rows) {
      const segs = [{ txt:r.q.label, col:'rgba(224,230,240,0.55)', w:headW }];
      for (const k of comps) segs.push({ txt:r.comp[k] + ' ' + s[r.keys[k]].toFixed(2), col:VG_COMP_COLORS[k], w:0 });
      segs.push({ txt:'[' + r.q.unit + ']', col:'rgba(224,230,240,0.4)', w:0 });
      lines.push(segs);
    }
    let bw = 0;
    for (const segs of lines) {
      let w = 0;
      for (const sg of segs) w += Math.max(sg.w, c.measureText(sg.txt).width) + GAP;
      bw = Math.max(bw, w - GAP);
    }
    bw += 12;
    const bh = lines.length * 13 + 7;
    // 読み取り箱はカーソルに追従させず、カーソルから最も遠い隅に固定する。
    // 「どこを指しているか」は縦線が示すので、箱まで動くと見たい波形を隠して邪魔になる。
    let bx = (hv.x < W/2) ? (W - padR - bw) : (padL + 4);
    let by = (hv.y < H/2) ? (H - padB - bh) : (padT + 4);
    bx = Math.max(2, Math.min(bx, W - 2 - bw));
    by = Math.max(2, Math.min(by, H - 2 - bh));
    c.fillStyle = 'rgba(18,20,26,0.92)';
    c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 1;
    c.beginPath(); c.rect(bx, by, bw, bh); c.fill(); c.stroke();
    lines.forEach((segs, i) => {
      let tx = bx + 6;
      for (const sg of segs) {
        c.fillStyle = sg.col;
        c.fillText(sg.txt, tx, by + 4 + i*13);
        tx += Math.max(sg.w, c.measureText(sg.txt).width) + GAP;
      }
    });
    c.restore();                 // textAlign / textBaseline も save 時点へ戻る
  }
  updateVelGraphStatus(g);
}
