// ════════════════════════════════════════
//  波の受信計（1窓＝1観測点）
// ════════════════════════════════════════
//  1点の変位 u を毎 tick 読み、y-t のグラフと、そこから測った振動数 f を出す。
//  観測点は3種類ある：
//    ・物体　　… その位置で水面波（波動場）を読む
//    ・ばねの上の点… その点の節点の変位を読む（横波・縦波の媒質）
//    ・受信器の印… 測定ツールの「波の受信器」で置く点。その位置で水面波を読む。
//                  何もない所に置けばその場に留まり、物体の上に置けばその物体に付いて動く
//
//  ★受信器の印は**物理に参加しない**（測定の道具の約束。counter.js の★と同じ）。
//    物体を受信器にすると、その物体が波をはね返して自分の読みを乱すので「素通し」に
//    設定し直す必要があった（demos-tutorial2.js のドップラーの★）。印は波動場の格子に
//    載らないので、最初からその心配が無い。
//  ★物体に付けるのは「動く観測者」のため。印そのものは速度もジョイントも持てないので、
//    台車などに付けて運ばせる。付け先は物体の局所座標で持つ（回っても同じ場所に付いたまま）。
//
//  ★ばね側の観測点は**物理に参加しない**。途中の節点に物体を取り付けられるようにするのでは
//    なく、計測器の側だけを広げてある。媒質の途中に質量を置けば、そこが反射点になって
//    波形そのものが変わるため（先端おもり WV_TIPM の★と同じ理由）。印は描くだけで、
//    objects にも joints にも入らない。
//  ★観測点は節点番号ではなく**沿った割合 s（0〜1）**で持つ。resegment() が節点数を
//    変えうる（targetSegs＝nodeDensity×restM）ので、番号で持つとばねの設定を触った
//    瞬間に観測点がずれる。読むときは前後の節点を線形補間する——節点をそのまま読むと
//    段差が偽のゼロ交差になるのは、波動場を双一次で読む理由と同じ（field.js の★）。
//
//  ★f の出し方は「上向きゼロ交差の間隔」。f = 1/T そのもので、観測者が単位時間に
//    何個の波面と出会ったかを数えているのと同じ＝ドップラー効果の観測者側の定義に一致する。
//    交差点は線形補間して tick より細かく取る。応答は1周期ぶん遅れる（f=2Hz なら 0.5秒）。
//  ★★振動数が決まらないときは**数値を出さずに理由を書く**（フェーザ図と同じ厳格さ。
//    CLAUDE.md の不変条件を参照）。判定は2つ：
//      ・振幅が小さすぎる（波が届いていない／吸収で消えた）
//      ・直近の周期がそろっていない（振動数が1つに決まらない）
//  ★★★**うなりは「決まらない」側ではない。** 以前ここには「2つの波源が重なった場所や
//    うなりでは意味のある数にならない」と書いてあり、判定もそのつもりで作ってあったが、
//    これは誤り。うなりは
//        u = 2A·cos(Δω·t/2)·sin(ω̄·t)   （ω̄ ＝ 2π(f_A+f_B)/2）
//    ＝ **搬送波 ω̄ の正弦波を包絡線で振幅変調したもの**で、変わるのは音の大きさだけ。
//    振動数は ω̄ でずっと一定なので、出すのが正しい。決まらないのは
//      ・包絡線が 0 を通る瞬間（振幅 0・位相が π 飛ぶ。1周期ぶんだけ）
//      ・振動数が離れすぎて搬送波と包絡線に分けられないとき
//    の2つだけ。実測（2.0Hz ＋ 2.4Hz を 4m 先で 20秒）：ゼロ交差の間隔 39 本のうち
//    **そろっていたのは 32 本**（0.461s ＝ 2.17Hz。理論の (2.0+2.4)/2 = 2.20Hz）で、
//    乱れていたのは節の 7 本だけ＝うなり 0.4Hz × 20秒 に一致した。
//  ★標本化の上限。毎 tick＝60Hz で読むので、1周期あたりの標本は 60/f 個。f=5Hz で12個、
//    10Hz で6個、20Hz では3個しかなく、ゼロ交差の位置が粗くなる。10Hz を超えたら測らない。
const WG_MAX_SAMPLES = 20000;    // 安全上限（velgraph と同じ。60fps で約5.5分）
const WG_MAX_WINDOWS = 8;
// これ未満の振幅では f を出さない。★実測に合わせた値：波源の振幅 1 でも、5m 離れると
//   場の変位は 0.03 まで落ちる（距離で 1/√r、吸収 α=0.15/m）。0.02 だと読める範囲が
//   2〜3m しかなかったので下げた。雑音は下の「周期のばらつき」で弾く。
const WG_MIN_AMP     = 0.008;
const WG_PERIOD_TOL  = 0.12;     // 直近の周期のばらつきがこれを超えたら「単一でない」
const WG_MAX_FREQ    = 10;       // [Hz] これを超えると標本が足りない
// ばらつきを見る周期の本数。★2 が下限（間隔どうしを比べるので1本では判定できない）。
//   ★4 から下げた。長くすると「節の1本の乱れ」が**そのあと N 周期ぶん判定に残り**、
//     現象より広い空白ができる。うなり1周期に搬送波が 5.5 周期しか入らないので、
//     4 だと乱れ1本の巻き添えで4本が消え、残り1〜2本しか数値が出なかった。
//   ★ゆるめても嘘の数は出ない。f_A=2.0Hz 固定で f_B を振った実測（後半10秒の「数値が
//     出た時間の割合」と、出たときの値／理論値 (f_A+f_B)/2）：
//       f_B    2.0      2.2      2.4      3.0   5.0   7.0
//       N=4   100%     62%      27%       0%    0%    0%
//       N=2   100%     81%      64%       0%    0%    0%
//       値    2.00    2.10     2.21        —     —     —   ← どちらの N でも同じ
//     うなり（2.2/2.4）では搬送波の値ぴったりで読める時間が増え、離れすぎた
//     3.0/5.0/7.0 では**どちらも 0%＝黙ったまま**。増えるのは「同じ正しい数を出す時間」だけ。
//   ★2 より狭くはできないし、**判定の形も変えられない**。乱れた1本ぶんだけ空ける
//     （＝空白を半分にする）ために「窓5本の中央値と、いちばん新しい1本だけを比べる」に
//     替えてみたが、対照が壊れた：離れた2つは間隔が**繰り返しの型**を作るので中央値が
//     安定し、型の中の1本1本は中央値と合ってしまう。実測 f_B=5.0Hz で 100% の時間
//     2.21Hz を出した（搬送波は 3.50Hz。まるきり嘘の数）。7.0Hz でも 2.16Hz。
//     「窓の中が**全部**そろっていること」を要求する今の形（max−min）でなければ、
//     繰り返しの型を弾けない。だから空白は乱れ1本につき2周期ぶんが下限。
const WG_KEEP_PERIODS = 2;
// ★ゼロ交差のヒステリシス。直近の振幅のこの割合まで下がってから次の交差を数える。
//   0.25 は「本物の谷（振幅の 100%）は必ず通り、格子の細かい揺れ（数%）は通らない」値。
const WG_ARM_FRAC = 0.25;
const WG_COLOR = { u:'#4dd0e1', uL:'#ff8a65', f:'#ffd54f' };
// 掃引時間つまみの上限[s]。0＝ためた全部を出す。
//   ★これが要るのは、標本を t=0 から捨てずにためる作りだから（上限 WG_MAX_SAMPLES ＝ 5.5分）。
//     波形を**形として**読ませる題材では、30秒走らせた時点で 1.5Hz が 45 周期に潰れて
//     山と谷が数えられなくなる。f は数値で出るので周期は読めるが、y-t の形が主役の
//     ときには足りない。オシロの掃引時間と同じつまみ。
const WG_SWEEP_MAX = 30;
// 既定の掃引時間[s]。★8秒。この装置の 1.5Hz で 12 周期ぶんで、山を数えられて、かつ
//   1周期が窓の幅の 1/12 ＝ 形が見て取れる。0 にすると上の潰れが起きる。
const WG_SWEEP_DEF = 8;
let waveGraphs = [];
let waveGraphSeq = 0;

function waveGraphOf(bodyId) { for (const g of waveGraphs) if (g.bodyId === bodyId) return g; return null; }
function waveGraphBody(g)    { return g.bodyId == null ? null : objects.find(o => o.id === g.bodyId) || null; }
function waveGraphSlinky(g)  { return g.slinkyId == null ? null : slinkies.find(S => S.id === g.slinkyId) || null; }
// 同じばねの「ほぼ同じ点」に開いている窓。右クリックの2回目で閉じるために使う。
//   ★しきい値は割合。ばね 6m なら 12cm ＝ 印の丸（半径 7px）より少し広い
const WG_CTX_SAME_S = 0.02;
function waveGraphOfSlinky(S, s) {
  for (const g of waveGraphs)
    if (g.slinkyId === S.id && Math.abs(g.s - s) < WG_CTX_SAME_S) return g;
  return null;
}
// 観測点が生きているか。物体もばねも消えていたら窓を閉じる
//   ★受信器の印は、付け先の物体が消えたら閉じずに**その場に残す**（付け先を外すだけ）。
//     印は利用者が置いた計器で、物体を消したら計器まで消える、は筋が通らない。
function waveGraphAlive(g) {
  if (g.probe) { wgProbeHost(g); return true; }
  return g.slinkyId != null ? !!waveGraphSlinky(g) : !!waveGraphBody(g);
}
function waveGraphPrune()    { for (const g of waveGraphs.slice()) if (!waveGraphAlive(g)) waveGraphClose(g); }
function waveGraphName(g) {
  const S = waveGraphSlinky(g);
  // ★ばねの観測点は「左端から何 m か」で名乗る。2つ開いて見くらべるときに窓を区別する
  //   のは位置なので、そこを見出しに出す。x は**張った長さ**に対する割合で測る
  //   （自然長 restM ではない）。画面の目盛りで読めるのは張った状態の長さのため。
  if (S) return 'ばね 左端から ' + wgSlinkyArcM(S, g.s).toFixed(2) + ' m';
  // ★受信器の印は番号で名乗る。キャンバスの印の名札と同じ文字にして、どの印がどの窓かを結ぶ
  if (g.probe) {
    const h = wgProbeHost(g);
    return wgProbeTag(g) + (h ? '（' + (h.label || ('Object ' + h.id)) + ' に付けた）' : '');
  }
  const b = waveGraphBody(g);
  return b ? (b.label || ('Object ' + b.id)) : ('Object ' + g.bodyId);
}
// s(0〜1) の位置の節点を線形補間で読む（上の★）
function wgSlinkyPoint(S, s) {
  const nd = S.nodes, N = nd.length;
  if (N < 2) return null;
  const f = Math.max(0, Math.min(1, s)) * (N - 1);
  const i = Math.min(N - 2, Math.floor(f)), a = f - i;
  return { x: nd[i].x + (nd[i + 1].x - nd[i].x) * a,
           y: nd[i].y + (nd[i + 1].y - nd[i].y) * a };
}
// 左端（節点0）からの距離[m]。端から端までの直線で測る＝張った長さに対する s の位置
function wgSlinkyArcM(S, s) {
  const nd = S.nodes, N = nd.length;
  if (N < 2) return 0;
  return toM(Math.hypot(nd[N - 1].x - nd[0].x, nd[N - 1].y - nd[0].y)) * Math.max(0, Math.min(1, s));
}
// ばねの上で、与えた点にいちばん近い s を返す（右クリックした場所 → 観測点）
function wgSlinkyNearestS(S, px, py) {
  const nd = S.nodes, N = nd.length;
  if (N < 2) return 0.5;
  let bestS = 0, bestD = Infinity;
  for (let i = 0; i < N - 1; i++) {
    const ax = nd[i].x, ay = nd[i].y, bx = nd[i + 1].x, by = nd[i + 1].y;
    const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / L2)) : 0;
    const qx = ax + ex * t, qy = ay + ey * t;
    const d = (px - qx) * (px - qx) + (py - qy) * (py - qy);
    if (d < bestD) { bestD = d; bestS = (i + t) / (N - 1); }
  }
  return bestS;
}

function _waveGraphNew(where, opts) {
  const g = Object.assign({
    id: ++waveGraphSeq,
    bodyId: null,       // 物体を観測点にするとき
    slinkyId: null,     // ばねを観測点にするとき（s とセット）
    s: 0.5,
    probe: false,       // 受信器の印のとき（下の4つとセット）
    px: 0, py: 0,       //   付け先が無いときの位置 [px]
    hostId: null,       //   付け先の物体（null＝その場に留まる）
    lx: 0, ly: 0,       //   付け先の局所座標での位置 [px]
    probeName: null,    //   名札（null＝「受信器 N」）。デモが「前方の受信計」のように名付ける
    probeColor: null,   //   印の色（null＝変位の線と同じ水色）
    // ★変位の縦軸をそろえる組（null＝そろえない）。同じ文字列を持つ窓どうしだけ共通の
    //   目盛りにする（2026-10-03）。既定でそろえない理由は下の「振動数の縦軸」の★のとおり
    //   （距離で振幅が何倍も違う窓が潰れる）。**振幅そのものを比べる**デモ（定常波の腹と節、
    //   ノイズキャンセルの前後）だけが組を名乗る。パネルには出さない（デモの見せ方の約束）。
    uGroup: null,
    // ★変位の縦軸の最小の幅 [m]（0＝いつもの自動目盛り）。2026-10-04、共鳴管のデモ用：
    //   自動目盛りだと共鳴している（0.46）ときもしていない（0.11）ときも波形が枠いっぱいに
    //   描かれ、違いが目盛りの数字にしか出なかった。下限を置くと小さい振れは小さく描かれる。
    //   これより大きく振れたら、そのぶんは自動で広がる（はみ出さない）。パネルには出さない。
    uFloor: 0,
    sound: false,       // ★受信した波を音にして鳴らすか（wgSound* の★）。既定 OFF・シーンに保存しない
    t: 0,
    samples: [],        // {t, u, uL, f}   f は null のことがある（上の★）
    showU: true, showL: true, showF: true,
    sweep: WG_SWEEP_DEF,
    frozen: false,
    _uPrev: null, _tPrev: 0,
    _tCross: null,      // 直前の上向きゼロ交差の時刻
    _armed: false,      // ヒステリシス：いちど谷を通ったか
    _periods: [],       // 直近の周期（ばらつきの判定に使う）
    _ampBuf: [], _ampBufL: [],   // 直近の |u|（振幅の判定に使う）
    _fFrom: 'u',        // f をどちらの成分から出しているか
    _p0: null, _ax: null,        // 変位の原点と、静止時の軸（ばねのとき。下の★）
    reason: '波が届くのを待っています',
    hover: null,
  }, where);
  if (opts) Object.assign(g, opts);
  waveGraphs.push(g);
  waveGraphBuildPanel(g);
  return g;
}
function waveGraphNew(body, opts) { return _waveGraphNew({ bodyId: body.id }, opts); }
// ばねの上の点に開く。s は沿った割合（0＝左端、1＝右端）
function waveGraphNewOnSlinky(S, s, opts) {
  return _waveGraphNew({ slinkyId: S.id, s: Math.max(0, Math.min(1, s)) }, opts);
}
// ── 受信器の印（測定ツールの「波の受信器」）────────────────────────────
function wgProbeTag(g) { return g.probeName || ('受信器 ' + g.id); }
// 付け先の物体。消えていたら、最後にいた場所に留まる印へ戻す（waveGraphAlive の★）
function wgProbeHost(g) {
  if (g.hostId == null) return null;
  const b = objects.find(o => o.id === g.hostId);
  if (b) return b;
  g.hostId = null;
  return null;
}
function wgProbePos(g) {
  const b = wgProbeHost(g);
  if (!b) return { x: g.px, y: g.py };
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  const p = { x: b.x + g.lx * c - g.ly * s, y: b.y + g.lx * s + g.ly * c };
  g.px = p.x; g.py = p.y;         // 付け先が消えたとき、ここに残す
  return p;
}
// 印を (x, y) に置き直す。物体 b の上なら b に付け、b が無ければその場に留める
function wgProbeAttach(g, x, y, b) {
  g.px = x; g.py = y;
  if (b) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle), dx = x - b.x, dy = y - b.y;
    g.hostId = b.id; g.lx = dx * c + dy * s; g.ly = -dx * s + dy * c;
  } else { g.hostId = null; g.lx = 0; g.ly = 0; }
}
function waveGraphNewProbe(x, y, host, opts) {
  const g = _waveGraphNew({ probe: true }, opts);
  wgProbeAttach(g, x, y, host);
  return g;
}
// 印の上に置いた物体を探す。★注釈・ばね・場は付け先にしない（物体だけが運べる）
function wgProbeHostAt(x, y) { return frontmostBodyAtPoint(x, y); }
// ばねの上を指しているか。指していれば { S, s } を返す
//   ★しきい値は画面の px（ばねは細いので、ズームによらず同じ手応えで当たるように）
const WG_PROBE_PICK_PX = 10;
function wgSlinkyAt(x, y) {
  const tol = WG_PROBE_PICK_PX / cam.zoom;
  let best = null, bestD = tol;
  for (const S of slinkies) {
    const s = wgSlinkyNearestS(S, x, y), p = wgSlinkyPoint(S, s);
    if (!p) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bestD) { bestD = d; best = { S, s }; }
  }
  return best;
}
// 測定ツール「波の受信器」でクリックしたとき。置いた場所で中身が変わる：
//   ばねの上 → その点の y-t（右クリックの「この点の y-t グラフ」と同じもの）
//   物体の上 → 物体に付いて動く印／何もない所 → その場に留まる印
//   ★ばねを物体より先に見る。ばねは物体に端を留めて張ることが多く、端の近くを
//     指したときに物体へ取られると、ばねの観測点がその道具から置けなくなる。
//   ★何もない所はグリッドに乗せる（ほかの配置と同じ）。物体の上は指した場所そのまま。
function placeWaveProbe(wp, snapped) {
  if (waveGraphs.length >= WG_MAX_WINDOWS) {
    flashHint('受信の窓が上限（' + WG_MAX_WINDOWS + '）に達しています。どれかを閉じてください');
    return null;
  }
  const hitS = wgSlinkyAt(wp.x, wp.y);
  if (hitS) {
    if (waveGraphOfSlinky(hitS.S, hitS.s)) { flashHint('この点にはもう受信の窓が開いています'); return null; }
    const g = waveGraphNewOnSlinky(hitS.S, hitS.s);
    refreshWaveGraphButton();
    return g;
  }
  const b = wgProbeHostAt(wp.x, wp.y);
  const p = b ? wp : snapped;
  const g = waveGraphNewProbe(p.x, p.y, b);
  refreshWaveGraphButton();
  return g;
}
// 編集ツールで印を掴んで動かす。離した所に物体があればそれに付け替え、無ければ外す。
//   ★印は最前面に描くので、物体の当たり判定より先に見る（通過カウンタと同じ）。
//   ★動かしたらゼロ交差の状態だけ捨てる（記録は残す）。掴んで運んだ間の「周期」は、
//     手で動かした速さで出来た見かけの値で、それが次の f に混ざるのを防ぐため。
let waveProbeDrag = null;       // { g, ox, oy }  掴んだ点と印の中心のずれ
function waveProbeAtPoint(wp) {
  const tol = WG_PROBE_PICK_PX / cam.zoom;
  for (let i = waveGraphs.length - 1; i >= 0; i--) {
    const g = waveGraphs[i];
    if (!g.probe) continue;
    const p = wgProbePos(g);
    if (Math.hypot(wp.x - p.x, wp.y - p.y) <= tol) return { g, p };
  }
  return null;
}
function beginWaveProbeDragIfHit(wp) {
  const h = waveProbeAtPoint(wp);
  if (!h) return false;
  waveProbeDrag = { g: h.g, ox: h.p.x - wp.x, oy: h.p.y - wp.y, moved: false };
  return true;
}
function dragWaveProbeTo(wp) {
  const d = waveProbeDrag; if (!d) return;
  d.moved = true;
  // ★運んでいる間は付け先から外す（付けたままだと、物体の局所座標で動かすことになる）
  wgProbeAttach(d.g, wp.x + d.ox, wp.y + d.oy, null);
}
function endWaveProbeDrag() {
  const d = waveProbeDrag; waveProbeDrag = null;
  if (!d || !d.moved) return;
  const g = d.g;
  wgProbeAttach(g, g.px, g.py, wgProbeHostAt(g.px, g.py));
  g._uPrev = null; g._tCross = null; g._armed = false; g._periods = [];
}
function waveGraphClose(g) {
  if (waveProbeDrag && waveProbeDrag.g === g) waveProbeDrag = null;
  const at = waveGraphs.indexOf(g);
  if (at >= 0) waveGraphs.splice(at, 1);
  if (g.panel) g.panel.remove();
  wgSoundSet(g, false);
  refreshWaveGraphButton();
}
function waveGraphBuildPanel(g) {
  const host = document.getElementById('canvas-wrap') || document.body;
  const panel = document.createElement('div');
  panel.className = 'velgraph-panel';           // ★見た目は速度グラフと共用（CSS を増やさない）
  const off = graphCascadeOffset();
  panel.style.right  = (10 + off) + 'px';
  panel.style.bottom = (10 + off) + 'px';
  // ★ばねの観測点では変位が2成分になる（軸に垂直＝横波／軸方向＝縦波）。物体（波動場）では
  //   面の上下の1成分しかないので、軸方向の段そのものを出さない（触って意味のある操作だけ）。
  const onSlinky = g.slinkyId != null;
  panel.innerHTML =
    '<div class="vg-header"><span class="vg-title"></span><span class="vg-status"></span>' +
      '<span class="vg-close">×</span></div>' +
    '<canvas></canvas>' +
    '<div class="vg-controls">' +
      '<span class="vg-grp" title="上の段が波の変位、下の段がそこから測った振動数です">量</span>' +
      '<label class="vg-check"' +
        (onSlinky ? ' title="ばねの軸に垂直な向きの変位です。横波はこちらに出ます"' : '') +
        '><input type="checkbox" class="wg-u">' +
        '<span class="vg-chip" style="background:' + WG_COLOR.u + '"></span>' +
        (onSlinky ? '変位 軸⊥ [m]' : '変位 y [m]') + '</label>' +
      (onSlinky ?
      '<label class="vg-check" title="ばねの軸に沿った向きの変位です。縦波はこちらに出ます。&#10;横波でも完全な0にはなりません（曲がったぶん節点が軸方向へも動く）">' +
        '<input type="checkbox" class="wg-l">' +
        '<span class="vg-chip" style="background:' + WG_COLOR.uL + '"></span>変位 軸∥ [m]</label>' : '') +
      '<label class="vg-check" title="上向きのゼロ交差の間隔から f = 1/T として出します。&#10;'
        + 'うなっている間も出ます（振動数は2つの平均で一定。変わるのは大きさだけ）。&#10;'
        + '弱め合う瞬間と、振動数が離れすぎているときは数値を出しません">' +
        '<input type="checkbox" class="wg-f">' +
        '<span class="vg-chip" style="background:' + WG_COLOR.f + '"></span>振動数 f [Hz]</label>' +
    '</div>' +
    '<div class="vg-controls">' +
      '<span class="vg-grp" title="グラフに出す時間の幅です。いちばん左まで回すと、ためた全部を出します（長く走らせると波形が潰れます）">掃引</span>' +
      '<input type="range" class="wg-sweep" min="0" max="' + WG_SWEEP_MAX + '" step="1"' +
        ' value="' + g.sweep + '" style="width:92px">' +
      '<span class="vg-hint wg-sweep-val"></span>' +
    '</div>' +
    '<div class="vg-controls">' +
      '<label class="vg-check" title="受けた波を音にします（振動数を ×' + WG_SOUND_K + ' して聞こえる高さへ。'
        + '2 Hz がラ 440 Hz）。&#10;大きさは波の振れ幅のまま＝うなりは実際の速さで大きくなったり小さくなったりします。&#10;'
        + '実行中だけ鳴ります"><input type="checkbox" class="wg-snd">音</label>' +
      '<span class="vg-hint">グラフ上にカーソルを置くと値を読めます</span>' +
      '<button class="btn-small wg-rec" title="記録を一時停止します（グラフは残ります）">停止</button>' +
      '<button class="btn-small wg-reset">リセット</button>' +
    '</div>';
  host.appendChild(panel);
  g.panel = panel;
  g.canvas = panel.querySelector('canvas');
  g.ctx = g.canvas.getContext('2d');
  g.titleEl = panel.querySelector('.vg-title');
  g.statusEl = panel.querySelector('.vg-status');
  g.recBtn = panel.querySelector('.wg-rec');
  g.titleEl.textContent = '波の受信 ' + g.id;
  panel.querySelector('.vg-close').addEventListener('click', () => waveGraphClose(g));
  for (const [cls, key] of [['.wg-u','showU'], ['.wg-l','showL'], ['.wg-f','showF']]) {
    const cb = panel.querySelector(cls);
    if (!cb) continue;                          // 軸方向の段は物体の窓には無い
    cb.checked = g[key];
    cb.addEventListener('change', ev => g[key] = ev.target.checked);
  }
  const sw = panel.querySelector('.wg-sweep');
  g.sweepValEl = panel.querySelector('.wg-sweep-val');
  const showSweep = () => g.sweepValEl.textContent = g.sweep > 0 ? g.sweep + ' 秒ぶん' : '全部';
  sw.addEventListener('input', ev => { g.sweep = +ev.target.value; showSweep(); });
  showSweep();
  g.recBtn.addEventListener('click', () => {
    g.frozen = !g.frozen;
    g.recBtn.textContent = g.frozen ? '再開' : '停止';
  });
  panel.querySelector('.wg-reset').addEventListener('click', () => resetWaveGraphOne(g));
  const snd = panel.querySelector('.wg-snd');
  snd.checked = g.sound;
  snd.addEventListener('change', ev => wgSoundSet(g, ev.target.checked));
  g.canvas.addEventListener('mousemove', ev => {
    const r = g.canvas.getBoundingClientRect();
    g.hover = { x: ev.clientX - r.left, y: ev.clientY - r.top };
  });
  g.canvas.addEventListener('mouseleave', () => g.hover = null);
  velGraphMakeDraggable(g);      // ★ドラッグ移動は速度グラフの実装をそのまま使う
}
// ★リセットは変位の原点（_p0）と軸（_ax）も取り直す。ばねを動かしたあとや、張力を
//   変えて張り直したあとに、そのときの静止位置から測り直せるようにするため
//   （速度グラフの変位が「記録を始めた位置」を原点にするのと同じ流儀）。
function resetWaveGraphOne(g) {
  g.t = 0; g.samples = []; g._uPrev = null; g._tCross = null; g._armed = false;
  g._periods = []; g._ampBuf = []; g._ampBufL = []; g._fFrom = 'u';
  g._p0 = null; g._ax = null; g.reason = '波が届くのを待っています';
  g._sndRef = 0; g._sndPrev = null;
}
function resetWaveGraph() { for (const g of waveGraphs) resetWaveGraphOne(g); }

// ── 出し入れ ──────────────────────────────────────────
// いまこのグラフを開けるか（右パネルのボタン・表示メニュー・右クリックで同じ判定を使う）
//   ★tempGraphReady と同じ作り。入口ごとに条件を書くと「押せるのに何も起きない」項目が出る。
//   ★波源が1つも無い画面では開けない（右パネル・右クリックとも同じ門番）
function waveGraphReady() {
  if (!waveSources.length) return false;
  const sel = objects.filter(o => selectedIds.has(o.id));
  if (!sel.length) return false;
  return sel.every(o => waveGraphOf(o.id)) || waveGraphs.length < WG_MAX_WINDOWS;
}
// ばねの点 s の y-t グラフ。その点に開いていれば「閉じる」で押せる
function slinkyGraphReady(S, s) {
  return !!S && (!!waveGraphOfSlinky(S, s) || waveGraphs.length < WG_MAX_WINDOWS);
}
function toggleWaveGraph() {
  const sel = [...selectedIds].map(id => objects.find(o => o.id === id)).filter(Boolean);
  if (!sel.length) return;
  const allOpen = sel.every(o => waveGraphOf(o.id));
  if (allOpen) { for (const o of sel) waveGraphClose(waveGraphOf(o.id)); }
  else for (const o of sel) {
    if (waveGraphOf(o.id)) continue;
    if (waveGraphs.length >= WG_MAX_WINDOWS) break;
    waveGraphNew(o);
  }
  refreshWaveGraphButton();
}
// 右パネルの「波の受信」ボタン。★波源が1つも無い画面では出さない（右クリックと同じ門番）。
//   押してある表示は「選んでいる物体が全部、受信計を持っている」とき（右クリックの ✔ と同じ判定）
function refreshWaveGraphButton() {
  const b = document.getElementById('p-wavegraph-btn');
  if (!b) return;
  const sel = objects.filter(o => selectedIds.has(o.id));
  b.style.display = waveSources.length ? '' : 'none';
  b.disabled = !waveGraphReady();
  b.classList.toggle('active', !!sel.length && sel.every(o => waveGraphOf(o.id)));
  // ばねのパネルの「この点の y-t グラフ」も、窓の開け閉めのたびにここで合わせる
  if (selectedElement && selectedElement.kind === 'slinky') refreshSlinkyGraphButton(selectedElement.slinky);
}

// ── 記録（simTick から毎 tick）────────────────────────
//   ★波動場の格子の外に出たらデータ無し。窓は閉じない（戻ってくれば続きが取れる）。
// 物体の観測点＝その場所の波動場を読む。読めないときは理由を入れて null を返す
function wgReadField(g, b) {
  // ★波の壁になっている物体は、自分の中の変位が常に 0 になる（waveRasterize が solid に
  //   する）。読めない理由がそれだと分からないと延々「波が届いていません」に見えるので、
  //   ここで名指しする。実測でこれに嵌った（観測者の既定が 'fixed' だった）。
  //   ★無反射の壁も同じ扱い。中の変位は 0 ではないが、壁が吸い込んだあとの残りかす
  //     ＝その場所に本来届いていた波ではないので、読ませても嘘になる。
  const wm = b.waveMode || 'fixed';
  if (wm === 'fixed' || wm === 'free' || wm === 'absorb') {
    g.reason = 'この物体が波の壁になっています（プロパティの「波」を「素通し」にしてください）';
    return null;
  }
  // ★双一次で読む（waveSampleAt）。節点をそのまま読むと、動く観測者はセルを跨ぐ
  //   たびに値が飛び、その段差が偽のゼロ交差になる（field.js の★に実測）。
  const u = waveSampleAt(b.x, b.y);
  if (u === null) { g.reason = '波動場の外にいます'; return null; }
  return { u, uL: null };
}
// 受信器の印＝印の位置の波動場を読む
//   ★印そのものは波をはね返さないが、印の下にある物体が波の壁なら、そこには波が無い
//     （waveRasterize が solid にする）。付け先の台車が既定の「固定端」のままだと必ずこれに
//     なるので、黙って 0 を描かずに理由で知らせる（wgReadField の★と同じ）。
function wgWallAt(x, y) {
  for (const o of objects) {
    const wm = o.waveMode || 'fixed';
    if ((wm === 'fixed' || wm === 'free' || wm === 'absorb') && o.containsPoint(x, y)) return o;
  }
  return null;
}
function wgReadProbe(g) {
  if (!waveSources.length) { g.reason = '波源がありません'; return null; }
  const p = wgProbePos(g);
  const w = wgWallAt(p.x, p.y);
  if (w) {
    g.reason = (w.id === g.hostId ? '付け先の物体' : '印の下の物体')
             + 'が波の壁になっています（プロパティの「波」を「素通し」にしてください）';
    return null;
  }
  const u = waveSampleAt(p.x, p.y);
  if (u === null) { g.reason = '波動場の外にいます'; return null; }
  return { u, uL: null };
}
// ばねの観測点＝その点の節点の変位。変位は「記録を始めた瞬間のその点の位置」から測る
function wgReadSlinky(g, S) {
  const p = wgSlinkyPoint(S, g.s);
  const nd = S.nodes, N = nd.length;
  if (!p) { g.reason = 'ばねに節点がありません（理想ばねでは波は伝わりません）'; return null; }
  if (!g._p0) {
    // ★軸は「記録を始めた瞬間の端から端」を1回だけ控える。今の両端で毎 tick 結び直すと、
    //   波源として上下する左端のぶんだけ軸が傾き、その成分が途中の点の変位から引かれる
    //   （真ん中の点では波源の振幅の半分が消える）。静止状態から記録を始める前提。
    const ex = nd[N - 1].x - nd[0].x, ey = nd[N - 1].y - nd[0].y;
    const L = Math.hypot(ex, ey) || 1;
    g._p0 = { x: p.x, y: p.y };
    g._ax = { x: ex / L, y: ey / L };
  }
  const dx = p.x - g._p0.x, dy = p.y - g._p0.y;
  // ★軸方向は A→B を正。軸に垂直は**画面の上を正**に取る（内部の y は下向きが正なので、
  //   垂直ベクトルを (ay, −ax) にする＝ UI に見せる y の向きと同じ約束。units.js の yUI）。
  return { u:  toM(dx * g._ax.y - dy * g._ax.x),
           uL: toM(dx * g._ax.x + dy * g._ax.y) };
}
// 直近 1 秒の |値| の最大（振幅の判定に使う）
function wgPushAmp(buf, v, keep) {
  buf.push(Math.abs(v));
  if (buf.length > keep) buf.shift();
  let a = 0; for (const x of buf) a = Math.max(a, x);
  return a;
}
function sampleWaveGraph(dt) {
  if (!waveGraphs.length) return;
  waveGraphPrune();
  for (const g of waveGraphs) {
    if (g.frozen) continue;
    const S = waveGraphSlinky(g);
    const b = S || g.probe ? null : waveGraphBody(g);
    if (!S && !b && !g.probe) continue;
    g.t += dt;
    const r = g.probe ? wgReadProbe(g) : S ? wgReadSlinky(g, S) : wgReadField(g, b);
    if (!r) { g._uPrev = null; continue; }       // 理由は読み取り側が入れている
    const u = r.u, uL = r.uL;
    // 振幅（直近 1 秒の最大）。ばねでは2成分ぶん取る
    const keep = Math.max(10, Math.round(1 / Math.max(1e-6, dt)));
    const amp  = wgPushAmp(g._ampBuf, u, keep);
    const ampL = uL === null ? 0 : wgPushAmp(g._ampBufL, uL, keep);
    // ★f は一方の成分からしか出せない（ゼロ交差の間隔なので、2つの信号を混ぜられない）。
    //   振幅の大きいほうを信号に選ぶ＝横波の装置なら軸⊥、縦波の装置なら軸∥から出る。
    //   どちらから出したかは見出しに書く（黙って選ぶと、縦波の窓を見て「横波の周期」を
    //   読んだつもりになれてしまう）。
    //   ★選ぶ成分が変わったらゼロ交差の状態を捨てる。前の成分で数えた半端な周期が
    //     残ると、切り替わった直後だけ出鱈目な f が出る。
    const from = ampL > amp ? 'uL' : 'u';
    if (from !== g._fFrom) {
      g._fFrom = from; g._uPrev = null; g._armed = false; g._tCross = null; g._periods = [];
    }
    const sig = from === 'uL' ? uL : u, sigAmp = Math.max(amp, ampL);
    // 上向きゼロ交差 → 周期
    //   ★ヒステリシス（シュミットトリガ）を入れる。0 をまたいだ瞬間をそのまま数えると、
    //     格子スケールの細かい揺れが偽の交差を作る。実測：遠ざかる観測者の真の周期
    //     0.967/0.990 秒（＝1.02 Hz、理論 1.00）のあいだに 0.04 秒の交差が挟まり、
    //     平均が 1.93 Hz に化けていた。いったん −h まで下がってからでないと次を数えない。
    //     h は直近の振幅の WG_ARM_FRAC 倍。振幅に比例させるので、遠くて弱い波でも効く。
    if (sig < -WG_ARM_FRAC * sigAmp) g._armed = true;
    if (g._armed && g._uPrev !== null && g._uPrev < 0 && sig >= 0) {
      const frac = (0 - g._uPrev) / (sig - g._uPrev || 1);      // 線形補間
      const tc = g.t - dt + frac * dt;
      if (g._tCross !== null) {
        const T = tc - g._tCross;
        if (T > 1e-6) {
          g._periods.push(T);
          if (g._periods.length > WG_KEEP_PERIODS) g._periods.shift();
        }
      }
      g._tCross = tc;
      g._armed = false;
    }
    g._uPrev = sig;
    // f を出してよいかの判定（上の★★）
    let f = null;
    if (sigAmp < WG_MIN_AMP) g.reason = '波が届いていません（振幅が小さすぎます）';
    else if (g._periods.length < 2) g.reason = '測定中（1周期ぶん待っています）';
    else {
      let mn = Infinity, mx = 0, s = 0;
      for (const T of g._periods) { mn = Math.min(mn, T); mx = Math.max(mx, T); s += T; }
      const mean = s / g._periods.length;
      // ★理由に「うなり」と書かない。うなっている間の振動数は搬送波で決まっていて、
      //   測れないのは節（包絡線が 0 を通る瞬間）だけ＝ここに来るのはその一瞬か、
      //   振動数が離れすぎて搬送波に分けられないときのどちらか（冒頭の★★★）。
      if ((mx - mn) / mean > WG_PERIOD_TOL) g.reason = '周期がそろっていません（うなりの節／振動数が離れすぎ）';
      else if (1 / mean > WG_MAX_FREQ) g.reason = '速すぎて測れません（1周期あたりの標本が足りない）';
      else { f = 1 / mean; g.reason = null; }
    }
    g.samples.push({ t: g.t, u, uL, f });
    if (g.sound) wgSoundUpdate(g, sig, f, dt);
    if (g.samples.length > WG_MAX_SAMPLES) { g.samples.shift(); g.frozen = false; }
  }
}
// ── ばねの上の観測点の印（キャンバスに描く）────────────────────────────
//   ★印は節点と一緒に動く。動かないと「ばねのどこを見ているか」は分かっても
//     「その点が今どこにいるか」が分からず、窓の y-t と目の前の媒質がつながらない。
//   ★名札は窓の見出しと同じ「左端から ◯ m」。2つ開いたときに、どの印がどの窓かを
//     見くらべる手がかりが位置しかないため（色で分けると3つ目から破綻する）。
//   ★物体の観測点には印を付けない。物体そのものが画面に見えているので足すと二重になる。
//   ★受信器の印は付ける（印そのものが計器で、物体に付けたときも「物体のどこで」読むかを示す）。
//     ばねの印と同じ形に、真ん中を十字にして区別する。名札は窓の見出しと同じ「受信器 N」。
function drawWaveGraphMarks() {
  if (!waveGraphs.length) return;
  ctx.save();
  ctx.setLineDash([]);
  for (const g of waveGraphs) {
    if (g.probe) {
      const p = wgProbePos(g), sp = worldToScreen(p.x, p.y), col = g.probeColor || WG_COLOR.u;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sp.x - 4, sp.y); ctx.lineTo(sp.x + 4, sp.y);
      ctx.moveTo(sp.x, sp.y - 4); ctx.lineTo(sp.x, sp.y + 4);
      ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = col; ctx.font = '11px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(wgProbeTag(g), sp.x, sp.y - 10);
      continue;
    }
    const S = waveGraphSlinky(g);
    if (!S) continue;
    const p = wgSlinkyPoint(S, g.s);
    if (!p) continue;
    const sp = worldToScreen(p.x, p.y);
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 7, 0, Math.PI * 2);
    ctx.strokeStyle = WG_COLOR.u; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = WG_COLOR.u; ctx.fill();
    ctx.fillStyle = WG_COLOR.u; ctx.font = '11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(wgSlinkyArcM(S, g.s).toFixed(2) + ' m', sp.x, sp.y - 10);
  }
  ctx.restore();
}

// ── 描画 ──────────────────────────────────────────────
// ── 振動数の縦軸は、開いている受信計すべてで共通にする ──────────────────
//   ★窓ごとに自動目盛りにすると、どの窓でも線が枠の上のほうへ来るので、**値が違うのに
//     同じ絵に見える**。実測（音源が動くデモ）：前方 4.06 Hz の窓は 0〜4.11、後方 1.33 Hz の
//     窓は 0〜1.34 になり、3倍違う2つが並んで「同じ高さの直線」に見えていた。
//     受信計を2つ開くのは値を**見くらべる**ためなので、そろえないと道具の意味が消える。
//   ★変位のほうはそろえない。振幅は距離でいくらでも変わる量（実測：観測者Aは 0.44、
//     Bは 0.05 で9倍違う）で、そろえると遠いほうが1本の直線に潰れて、波が来ていることも
//     周期も読めなくなる。比べる対象は振動数であって振幅ではない。
//   ★上端は 1/2/2.5/5 の切りのいい値へ丸める。線が枠のふちに貼り付かないよう、
//     いちばん大きい値より必ず上に取る。
// 段の名札。ばねは2成分あるので向きで呼び分け、物体（水面波）は今までどおり「y」
const WG_ROW_LABEL = (g, key) =>
  g.slinkyId == null ? 'y' : (key === 'uL' ? '軸∥' : '軸⊥');
// 掃引の窓の中の変位の最大（縦軸の目盛りの元）
function wgDispAmp(g, rows, i0) {
  let a = 1e-6;
  for (let i = i0; i < g.samples.length; i++)
    for (const k of rows) {
      if (k === 'f') continue;
      const v = g.samples[i][k];
      if (v !== null && v !== undefined) a = Math.max(a, Math.abs(v));
    }
  return a;
}
// 掃引の窓の先頭。標本は時刻順なので二分探索で足りる（全部を舐めると 20000 点×毎フレーム）
function wgFirstIndex(samples, tMin) {
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (samples[m].t < tMin) lo = m + 1; else hi = m; }
  return lo;
}
function wgNiceCeil(v) {
  if (!(v > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  for (const s of [1, 2, 2.5, 5]) if (v <= s * e * (1 + 1e-9)) return s * e;
  return 10 * e;
}
let wgSharedFMax = 1;
function drawWaveGraphs() {
  let mx = 0;
  for (const g of waveGraphs) for (const s of g.samples) if (s.f != null && s.f > mx) mx = s.f;
  wgSharedFMax = wgNiceCeil(mx);
  for (const g of waveGraphs) drawWaveGraphOne(g);
  wgSoundIdle();
}

// ════════════════════════════════════════
//  受信した波を音にする（2026-10-04）
// ════════════════════════════════════════
//  ★波形をそのまま早回しにはしない。**振動数だけ一定倍して、大きさは実時間のまま**鳴らす。
//    ・振動数を一定倍（WG_SOUND_K）するので比は保たれる：ドップラーの 4.0／1.33 Hz は
//      同じ比の音程の差として聞こえる。
//    ・大きさ（包絡線）は時間を引き伸ばさない：うなり（0.4 回/秒）は「ワン、ワン」という
//      大きさの揺れとして実際の速さで聞こえる。波形ごと周波数を上げると、うなりまで ×K で
//      速くなって音程の差（80 Hz）に化け、うなりとして聞こえなくなる。
//    ・共鳴管で鳴る深さ、ノイズキャンセルで消える瞬間、昼と夜の届き方の差は、どれも
//      大きさの差として耳で分かる。
//  ★振動数は窓が測った f（上向きゼロ交差の周期）を使う。測れない瞬間（うなりの節など）は
//    直前の値を保つ（音程が飛ばない）。一度も測れていなければ鳴らさない。
//  ★大きさは包絡線 √(u² + (u̇/ω)²) を、その窓でこれまでに出た最大で割った比。
//    窓ごとに絶対の大きさで鳴らすと、遠い受信計は聞こえないほど小さくなる。比にすると
//    「この点でいちばん大きかったとき」が基準になり、打ち消し・共鳴の変化がそのまま
//    聞こえる。★uGroup の窓どうしは基準をそろえる（縦軸をそろえるのと同じ理由。腹と節を
//    比べる窓で、節が腹と同じ大きさで鳴ってはいけない）。
//  ★実測（乱数固定・ヘッドレス。鳴らす値を読む）：
//    うなり … 音程 477〜486 Hz（2.2 Hz × 220 = 484）で動かず、大きさが 0.13〜0.91 を 2.47 秒周期で
//             くり返す（理論 1/|fA−fB| = 2.5 秒）
//    ノイズキャンセル … 耳の音量 0.82 → 合わせたあと 0.009
//    音源が動く … 前方 870 Hz・後方 293 Hz（4.0 / 1.33 Hz × 220 ＝ 880 / 293）
//  ★実行中だけ鳴らす（止めた・記録を止めた窓は黙る）。ブラウザは操作なしに音を出せないので、
//    AudioContext はチェックを入れた瞬間（＝クリック）に作る。シーンには保存しない
//    （読み込んだとたんに鳴り出さない）。
const WG_SOUND_K   = 220;     // 振動数の倍率（2 Hz → 440 Hz）
const WG_SOUND_VOL = 0.15;    // いちばん大きいときの音量（耳に痛くない大きさ）
const WG_SOUND_TC  = 0.02;    // [s] 音量・音程をなめらかに変える時定数（ぷつぷつ音を消す）
let wgAudio = null;
function wgSoundSet(g, on) {
  g.sound = !!on;
  if (!on) {
    if (g._snd) { try { g._snd.osc.stop(); g._snd.osc.disconnect(); g._snd.gain.disconnect(); } catch (e) {} }
    g._snd = null;
    return;
  }
  try {
    if (!wgAudio) wgAudio = new (window.AudioContext || window.webkitAudioContext)();
    if (wgAudio.state === 'suspended') wgAudio.resume();
    const osc = wgAudio.createOscillator(), gain = wgAudio.createGain();
    osc.type = 'sine'; gain.gain.value = 0;
    osc.connect(gain).connect(wgAudio.destination);
    osc.start();
    g._snd = { osc, gain };
    g._sndRef = g._sndRef || 0; g._sndPrev = null;
  } catch (e) {
    g.sound = false;
    if (g.panel) g.panel.querySelector('.wg-snd').checked = false;
  }
}
function _wgSoundTo(param, v) {
  param.setTargetAtTime(v, wgAudio.currentTime, WG_SOUND_TC);
}
function wgSoundUpdate(g, u, f, dt) {
  if (!g._snd || !wgAudio) return;
  if (f != null) g._sndF = f;
  const fr = g._sndF;
  if (!fr) { g._sndPrev = u; _wgSoundTo(g._snd.gain.gain, 0); return; }
  const du = g._sndPrev == null ? 0 : (u - g._sndPrev) / dt;
  g._sndPrev = u;
  const env = Math.hypot(u, du / (2 * Math.PI * fr));
  g._sndEnv = env;
  g._sndRef = Math.max(g._sndRef || 0, env);
  let ref = g._sndRef;
  if (g.uGroup) for (const h of waveGraphs) if (h.uGroup === g.uGroup) ref = Math.max(ref, h._sndRef || 0);
  const lv = env < WG_MIN_AMP ? 0 : Math.min(1, env / Math.max(1e-9, ref));
  _wgSoundTo(g._snd.osc.frequency, fr * WG_SOUND_K);
  _wgSoundTo(g._snd.gain.gain, WG_SOUND_VOL * lv);
}
// 実行を止めている・記録を止めている窓は黙らせる（毎フレーム）
function wgSoundIdle() {
  if (!wgAudio) return;
  for (const g of waveGraphs)
    if (g._snd && (!running || g.frozen)) _wgSoundTo(g._snd.gain.gain, 0);
}
// 枠の幅で折り返して中央に書く。★日本語は単語の切れ目が無いので1文字ずつ詰めて測る
function wgWrapText(c, text, cx, cy, maxW, lh) {
  const lines = [];
  let cur = '';
  for (const ch of text) {
    if (c.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; }
    else cur += ch;
  }
  if (cur) lines.push(cur);
  const y0 = cy - (lines.length - 1) * lh / 2;
  lines.forEach((s, i) => c.fillText(s, cx, y0 + i * lh));
}
function drawWaveGraphOne(g) {
  const cv = g.canvas, ctx2 = g.ctx;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  ctx2.clearRect(0, 0, w, h);
  g.titleEl.textContent = '波の受信：' + waveGraphName(g);
  const last = g.samples.length ? g.samples[g.samples.length - 1] : null;
  // ★見出しには数値だけを出す。読めない理由は長い文なので、見出しに入れると折り返して
  //   窓の中身を押し下げる（実測：3行に折り返し、下の「停止／リセット」が窓の外へ出た）。
  //   理由は下の f のグラフの中へ書く——空いている場所であり、読めない当人の隣でもある。
  const onSlinky = g.slinkyId != null;
  // ★どちらの成分から f を出したかを見出しに添える（ばねのときだけ）。黙って選ぶと、
  //   縦波の窓を見て「横波の周期」を読んだつもりになれてしまう。
  g.statusEl.textContent = last && last.f !== null
    ? 'f = ' + last.f.toFixed(2) + ' Hz' + (onSlinky ? '（' + WG_ROW_LABEL(g, g._fFrom) + '）' : '')
    : '—';
  g.statusEl.title = g.reason || '';
  if (g.samples.length < 2) return;
  const rows = [];
  if (g.showU) rows.push('u');
  if (onSlinky && g.showL) rows.push('uL');
  if (g.showF) rows.push('f');
  if (!rows.length) return;
  const padL = 46, padR = 8, padT = 10, padB = 18;
  const rh = (h - padT - padB) / rows.length;
  // 掃引の窓（上の★）。0 なら全部
  const tEnd = g.samples[g.samples.length - 1].t;
  const i0 = g.sweep > 0 ? wgFirstIndex(g.samples, tEnd - g.sweep) : 0;
  if (g.samples.length - i0 < 2) return;
  const t0 = g.samples[i0].t, t1 = Math.max(t0 + 1e-6, tEnd);
  const X = t => padL + (w - padL - padR) * (t - t0) / (t1 - t0);
  // ★変位の2段は縦軸をそろえる。どちらも同じ点の変位を同じ単位で測った量で、見くらべる
  //   ために並べているので、段ごとに自動目盛りにすると意味が消える。実測（横波の装置、
  //   振幅 0.26m）：軸∥ の成分は 0.043m しかないのに、段ごとに合わせると軸⊥ と同じ高さの
  //   波に描かれ、「横波なのに軸方向にも同じだけ動いている」という正反対の絵になった。
  //   そろえると軸∥ は 1/6 の細い波になり、〈ほぼ 0〉が形で読める。
  //   ★振動数の段はこれに加えない（単位が違う）。あちらは全窓で共通（下の★）。
  let dispAmp = Math.max(wgDispAmp(g, rows, i0), g.uFloor || 0);
  // ★組（uGroup）を名乗っている窓は、同じ組の窓の振れ幅も見て大きいほうへそろえる
  if (g.uGroup) for (const h of waveGraphs) {
    if (h === g || h.uGroup !== g.uGroup || h.samples.length < 2) continue;
    const hEnd = h.samples[h.samples.length - 1].t;
    dispAmp = Math.max(dispAmp, wgDispAmp(h, ['u'], h.sweep > 0 ? wgFirstIndex(h.samples, hEnd - h.sweep) : 0));
  }
  rows.forEach((key, ri) => {
    const y0 = padT + rh * ri, y1 = y0 + rh - 6;
    let mn, mx;
    if (key === 'f') { mn = 0; mx = wgSharedFMax; }   // ★振動数は全窓で共通（上の★）
    else { mn = -dispAmp; mx = dispAmp; }             // ★変位の段どうしは共通（上の★）
    const Y = v => y1 - (y1 - y0) * (v - mn) / (mx - mn || 1);
    // 枠と目盛り
    ctx2.strokeStyle = 'rgba(255,255,255,0.15)'; ctx2.lineWidth = 1;
    ctx2.strokeRect(padL + 0.5, y0 + 0.5, w - padL - padR, y1 - y0);
    ctx2.fillStyle = 'rgba(224,230,240,0.75)'; ctx2.font = '10px sans-serif';
    ctx2.textAlign = 'right'; ctx2.textBaseline = 'middle';
    ctx2.fillText(mx.toFixed(2), padL - 4, y0 + 6);
    ctx2.fillText(mn.toFixed(2), padL - 4, y1 - 6);
    ctx2.textAlign = 'left';
    ctx2.fillText(key === 'f' ? '振動数 f [Hz]' : '変位 ' + WG_ROW_LABEL(g, key) + ' [m]',
                  padL + 4, y0 + 8);
    // ★波源が1つだけのときは、出している振動数に基準線を引く。共通の縦軸と合わせて、
    //   「この線より上＝詰まる側／下＝広がる側」が2つの窓を見るだけで読める。
    //   ★2つ以上あるときは引かない。どの波源の値なのか決められないし、重なった場所の
    //     振動数はそもそも1つに決まらない（f を出さない判定と同じ厳格さ）。
    if (key === 'f' && waveSources.length === 1) {
      const f0 = waveSources[0].freq;
      if (f0 > mn && f0 < mx) {
        const yr = Y(f0);
        ctx2.save();
        ctx2.strokeStyle = 'rgba(224,230,240,0.35)'; ctx2.setLineDash([4, 3]); ctx2.lineWidth = 1;
        ctx2.beginPath(); ctx2.moveTo(padL, yr); ctx2.lineTo(w - padR, yr); ctx2.stroke();
        ctx2.restore();
        ctx2.fillStyle = 'rgba(224,230,240,0.6)'; ctx2.font = '9px sans-serif';
        ctx2.textAlign = 'right'; ctx2.textBaseline = 'bottom';
        ctx2.fillText('波源 ' + f0.toFixed(1) + ' Hz', w - padR - 2, yr - 1);
        ctx2.textAlign = 'left'; ctx2.textBaseline = 'middle';
      }
    }
    // 曲線。★f が null の区間は線を切る（測れていないことを線で埋めない）
    ctx2.strokeStyle = WG_COLOR[key]; ctx2.lineWidth = 1.5;
    ctx2.beginPath();
    let pen = false;
    for (let i = i0; i < g.samples.length; i++) {
      const s = g.samples[i], v = s[key];
      if (v === null || v === undefined) { pen = false; continue; }
      const px = X(s.t), py = Y(v);
      pen ? ctx2.lineTo(px, py) : ctx2.moveTo(px, py);
      pen = true;
    }
    ctx2.stroke();
    // ★いま f を出せていない理由を、f の枠の中へ書く（上の★）。数が出ないときに
    //   「壊れている」のか「測れない条件なのか」が、その場で分かるようにする。
    if (key === 'f' && last && last.f === null && g.reason) {
      ctx2.fillStyle = 'rgba(255,213,79,0.85)'; ctx2.font = '10px sans-serif';
      ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
      // ★枠の下のほうへ置く。真ん中に置くと、波源の基準線とその値札に重なって
      //   どちらも読めなくなる（実測：観測者Aの窓で線・札・理由が同じ高さで団子になった）。
      wgWrapText(ctx2, g.reason, (padL + w - padR) / 2, y1 - 16, w - padL - padR - 12, 12);
      ctx2.textAlign = 'left'; ctx2.textBaseline = 'middle';
    }
  });
  // 時間軸
  ctx2.fillStyle = 'rgba(224,230,240,0.6)'; ctx2.textAlign = 'center'; ctx2.textBaseline = 'top';
  ctx2.fillText(t0.toFixed(1) + ' s', padL, h - padB + 3);
  ctx2.fillText(t1.toFixed(1) + ' s', w - padR, h - padB + 3);
  // カーソルの読み取り
  if (g.hover && g.hover.x > padL) {
    const t = t0 + (t1 - t0) * (g.hover.x - padL) / Math.max(1, w - padL - padR);
    let best = g.samples[i0];
    for (let i = i0; i < g.samples.length; i++)
      if (Math.abs(g.samples[i].t - t) < Math.abs(best.t - t)) best = g.samples[i];
    ctx2.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx2.beginPath(); ctx2.moveTo(X(best.t), padT); ctx2.lineTo(X(best.t), h - padB); ctx2.stroke();
    ctx2.fillStyle = '#e0e6f0'; ctx2.textAlign = 'left'; ctx2.textBaseline = 'top';
    ctx2.fillText(best.t.toFixed(2) + ' s　' + WG_ROW_LABEL(g, 'u') + '=' + best.u.toFixed(3)
                  + (best.uL !== null && best.uL !== undefined
                     ? '　' + WG_ROW_LABEL(g, 'uL') + '=' + best.uL.toFixed(3) : '')
                  + (best.f !== null ? '　f=' + best.f.toFixed(2) + ' Hz' : '　f=—'),
                  padL + 6, padT + 2);
  }
}
