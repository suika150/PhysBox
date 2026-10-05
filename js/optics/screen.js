// ════════════════════════════════════════
//  スクリーン（受光面）
//
//  何をするものか
//   当たった光を吸収して、面に沿った強度分布 I(y) を残す板。
//   干渉縞は空中にも見えているが、「スクリーン上のどこが明るいか」「明線の間隔はいくらか」を
//   読むのが実験そのものなので、面の上の縞と断面グラフを出す。
//
//  強度をどこから取るか
//   可干渉な光は干渉バッファ（複素振幅の和）から直接読む：
//
//     I(y) = |Σⱼ aⱼ·e^{iφⱼ}|²  ＝ re² + im²
//
//   ★レイの当たりを数える方式にしなかった理由。回折光は「広がっていくくさび」なので、
//     面に届くレイの本数はスクリーンまでの距離で変わってしまい、本数を数えると
//     分布が距離に依存する偽物になる。バッファは空間の各点の場そのものなので、
//     そこを読めば標本化の都合が結果に出ない。おまけに縞に対する分解能が空中の絵と
//     ぴたり一致する（見えている縞と、グラフの山が必ず対応する）。
//
//   非可干渉な光にはバッファが作られない（そもそも縞が立たない）ので、そちらは
//   レイの当たりから直接積む。なめらかな1つの山になる。
//
//  足し合わせの単位
//   干渉するのは「同じ光源 × 同じ波長」だけなので、群ごとに |Σa|² を出して群をまたいで
//   足す。laser.js の 'lighter' 合成とまったく同じ規則なので、空中の絵とグラフが食い違わない。
// ════════════════════════════════════════
const SCREEN_MIN_CELLS = 32;      // 分布の標本数の下限
const SCREEN_MAX_CELLS = 2048;    // 〃 上限（面が画面より長くても増やさない）
const SCREEN_PROBE_PX  = 2.0;     // 受光面から何px外側を読むか [画面px]
const SCREEN_EDGE_CELLS = 6;      // 画面の縁から何セルぶんを「測れていない」とみなすか
const SCREEN_GRAPH_H   = 90;      // 断面グラフの高さ [画面px]
const SCREEN_LEVELS    = 32;      // 面の帯を描くときの明るさの段数（stroke をまとめるため）
// id → { n, len, prof:Float32Array, max, side }
//   ★Body には持たせない。シーンをJSONへ書き出すとき、Float32Array が
//     「添字と値の巨大なオブジェクト」として保存されてしまうため。
const screenProfiles = new Map();
const screenBodies = () => objects.filter(b => b.opticKind === 'screen' && b.layers !== 0);
// 面の標本数。画面上での長さに合わせる（拡大したら細かく、縮めたら粗く）
const _screenCells = b => Math.max(SCREEN_MIN_CELLS,
                          Math.min(SCREEN_MAX_CELLS, Math.round(2 * b.opticH * cam.zoom)));
// 局所yの位置 → 標本の添字
const _screenIdx = (e, ly) => Math.floor((ly / e.len + 0.5) * e.n);
// 1フレームぶんの積算を始める（長さが変わったときだけ確保し直す）
function screenBegin() {
  const list = screenBodies();
  for (const b of list) {
    const n = _screenCells(b);
    let e = screenProfiles.get(b.id);
    if (!e || e.n !== n) screenProfiles.set(b.id, e = { n, len: 2*b.opticH, prof: new Float32Array(n),
                                                       ok: new Uint8Array(n), max: 0, side: 0 });
    e.len = 2 * b.opticH;
    e.prof.fill(0);
    e.ok.fill(1);
    e.max = 0; e.side = 0;
  }
  if (screenProfiles.size > list.length) {          // 削除されたスクリーンの分布は捨てる
    const live = new Set(list.map(b => b.id));
    for (const id of [...screenProfiles.keys()]) if (!live.has(id)) screenProfiles.delete(id);
  }
}
// どちら側から照らされているかを、面で終わった光の進行方向から数える。
//   ★グラフを光の来ない側へ立てるために要る。レーザーの位置から推測すると、
//     鏡で折り返して裏から当てた配置で必ず外す。
function _noteSide(g, b, e) {
  const ux = Math.cos(b.angle), uy = Math.sin(b.angle);
  for (const tr of g.traces) for (const s of tr.segs) {
    if (s.end !== b) continue;
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    e.side -= (dx*ux + dy*uy) > 0 ? 1 : -1;         // 進む向きの逆側＝光が来た側
  }
}
// 可干渉な群：干渉バッファを受光面に沿って読み取る
function screenCollect(g, F) {
  for (const b of screenBodies()) {
    const e = screenProfiles.get(b.id);
    if (!e) continue;
    _noteSide(g, b, e);
    const ux = Math.cos(b.angle), uy = Math.sin(b.angle);   // 面の法線（局所x）
    const tx = -uy, ty = ux;                                // 面に沿う向き（局所y）
    const off = opticPlateT('screen', b.opticH) / 2 + SCREEN_PROBE_PX / Math.max(0.05, cam.zoom);
    for (let k = 0; k < e.n; k++) {
      const ly = (k + 0.5) / e.n * e.len - e.len / 2;
      const bx = b.x + tx * ly, by = b.y + ty * ly;
      // 表と裏の両方を読む。どちらから照らしても同じように読めるようにするため
      //   （光が来ていない側は 0 なので、足しても害はない）。
      // ★画面（バッファ）の縁ぎわは「測れていない」印を付ける。
      //   バッファは画面のぶんしか無いので、縁の近くには外から入ってくるはずの光が
      //   積まれていない。そこを有効な値として扱うと、絵の外の事情がグラフの山として出る。
      //   ★判定は「どちらかの面が読めたか」。両面を要求してはいけない：
      //     光の来ない裏側が画面の外に出ているだけで面全体が無効になり、
      //     スクリーンを画面の端に置いた瞬間に何も出なくなる。
      let v = 0, seen = 0;
      for (let s = -1; s <= 1; s += 2) {
        const p = worldToScreen(bx + ux*s*off, by + uy*s*off);
        const ix = (p.x / IF_DOWNSCALE) | 0, iy = (p.y / IF_DOWNSCALE) | 0;
        if (ix < SCREEN_EDGE_CELLS || iy < SCREEN_EDGE_CELLS ||
            ix >= F.W - SCREEN_EDGE_CELLS || iy >= F.H - SCREEN_EDGE_CELLS) continue;
        const q = iy * F.W + ix;
        v += F.re[q]*F.re[q] + F.im[q]*F.im[q];
        seen++;
      }
      if (!seen) e.ok[k] = 0;
      e.prof[k] += v;
    }
  }
}
// 非可干渉な群：バッファが無いので、面で終わったレイの強度を直接積む
function screenCollectPlain(g) {
  for (const b of screenBodies()) {
    const e = screenProfiles.get(b.id);
    if (!e) continue;
    _noteSide(g, b, e);
    const cs = Math.cos(-b.angle), sn = Math.sin(-b.angle);
    const cellW = e.len / e.n;
    for (const tr of g.traces) for (const s of tr.segs) {
      if (s.end !== b) continue;
      const ly = (s.x2 - b.x)*sn + (s.y2 - b.y)*cs;         // 当たり位置（局所y）
      // このレイが受け持つ幅 [ワールドpx]。回折光は距離とともに広がるのでそのぶんを使う
      let w = tr.spanCells > 0 ? tr.spanCells * IF_DOWNSCALE / Math.max(1e-6, cam.zoom) : 0;
      let inten = s.i;
      if (s.dif) {
        const r = s.dif.r0 + len(s.x2 - s.x1, s.y2 - s.y1);
        w = difSpanAt(s, r);
        inten = difIntensityAt(s, r);
      }
      if (!(inten > 0)) continue;
      if (w <= cellW) {                                     // 1マスに収まる細い光
        const k = _screenIdx(e, ly);
        if (k >= 0 && k < e.n) e.prof[k] += inten;
        continue;
      }
      // 幅のある光は受け持つ範囲へならして積む（強度は面の単位長さあたりの量なので値は割らない）
      const k0 = Math.max(0, _screenIdx(e, ly - w/2));
      const k1 = Math.min(e.n - 1, _screenIdx(e, ly + w/2));
      for (let k = k0; k <= k1; k++) e.prof[k] += inten;
    }
  }
}
// 積算の締め：標本化のさざ波をならしてから最大値を出す
//   ★なぜ必要か。複素振幅を「線分に沿って 0.9 セル刻みで、四隅へ按分して」積んでいるので、
//     セルごとに拾う位相がわずかにずれ、強度に ±3% ほどの細かいさざ波が乗る。
//     絵としては 20段に丸めるので見えないが、山を数えて明線の間隔を出すときには致命的で、
//     本来3本の明線が数十本に割れてしまう。
//   ★ならして失うものは無い。干渉バッファはもともと画面上 3px（IF_FADE_LO）より細かい縞を
//     表現できず、それより細かい縞は干渉そのものをフェードで切っている。つまり
//     3px 相当の幅でならすことは、表現できない帯域を落としているだけである。
const SCREEN_SMOOTH_PX = 3;
function screenEnd() {
  for (const e of screenProfiles.values()) {
    const w = Math.max(1, Math.round(SCREEN_SMOOTH_PX / 2));   // 片側の幅 [セル]
    if (w >= 1 && e.n > 4 * w) {
      const src = e.prof.slice();
      const norm = 1 / (2 * w + 1);
      for (let k = 0; k < e.n; k++) {
        let s = 0;
        for (let j = -w; j <= w; j++) s += src[Math.min(e.n - 1, Math.max(0, k + j))];
        e.prof[k] = s * norm;
      }
    }
    let m = 0;
    for (let k = 0; k < e.n; k++) if (e.ok[k] && e.prof[k] > m) m = e.prof[k];
    e.max = m;
  }
}
// ─── 描画 ─────────────────────────────────────
//   ★正規化は「そのスクリーンの最大値＝1」。絶対値は出さない。
//     光の強さの絶対値はレーザーの設定しだいでいくらでも変わるので読んでも意味がなく、
//     実験で読むのは「明線の位置」と「次数ごとの明るさの比」＝どちらも相対量だから。
function drawScreens() {
  // ★光源が1つも無ければ分布を捨てる。_paintBeams が呼ばれなくなるので、
  //   捨てないと最後に光っていたときの縞が残り続ける。
  if (!lasers.length) { screenProfiles.clear(); return; }
  const list = screenBodies();
  if (!list.length) return;
  ctx.save();
  for (const b of list) {
    if (b.showProfile === false) continue;     // ★右パネルで切れる。測るのは続ける（入れ直した瞬間に出る）
    const e = screenProfiles.get(b.id);
    if (!e || !(e.max > 0)) continue;
    const ux = Math.cos(b.angle), uy = Math.sin(b.angle);
    const tx = -uy, ty = ux;
    const T = opticPlateT('screen', b.opticH);
    const inv = 1 / e.max;
    // ── 受光面に映った縞 ──
    //   ★段に丸めて1段を1本のパスにまとめる。標本ごとに stroke すると、
    //     面が長いフレームでは2000回の stroke になってそれだけで重くなる。
    const paths = new Array(SCREEN_LEVELS);
    for (let k = 0; k < e.n; k++) {
      if (!e.ok[k]) continue;                                           // 画面外は測れていない
      const v = Math.pow(Math.max(0, e.prof[k] * inv), 1 / RAY_GAMMA);   // 表示ガンマはビームと共通
      const q = Math.min(SCREEN_LEVELS - 1, Math.round(v * (SCREEN_LEVELS - 1)));
      if (q <= 0) continue;
      const ly0 = k / e.n * e.len - e.len/2, ly1 = (k+1) / e.n * e.len - e.len/2;
      const p0 = worldToScreen(b.x + tx*ly0 + ux*T/2, b.y + ty*ly0 + uy*T/2);
      const p1 = worldToScreen(b.x + tx*ly1 + ux*T/2, b.y + ty*ly1 + uy*T/2);
      const p = paths[q] || (paths[q] = new Path2D());
      p.moveTo(p0.x, p0.y); p.lineTo(p1.x, p1.y);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt';
    ctx.lineWidth = Math.max(2, T * cam.zoom);
    for (let q = 1; q < SCREEN_LEVELS; q++) {
      if (!paths[q]) continue;
      ctx.strokeStyle = `rgba(255,255,255,${(q / (SCREEN_LEVELS - 1)).toFixed(3)})`;
      ctx.stroke(paths[q]);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    // ── 断面グラフ（光の来ない側へ立てる。面に重ねると縞そのものが読めなくなる）──
    const back = e.side >= 0 ? -1 : 1;
    const nx = ux * back, ny = uy * back;
    const a0 = worldToScreen(b.x - tx*e.len/2, b.y - ty*e.len/2);
    const a1 = worldToScreen(b.x + tx*e.len/2, b.y + ty*e.len/2);
    const H = SCREEN_GRAPH_H;
    ctx.strokeStyle = 'rgba(255,255,255,0.30)'; ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(a0.x, a0.y);
    for (let k = 0; k < e.n; k++) {
      const t = (k + 0.5) / e.n;
      const px = a0.x + (a1.x - a0.x)*t, py = a0.y + (a1.y - a0.y)*t;
      const v = e.ok[k] ? e.prof[k] * inv : 0;   // 測れていない範囲は 0 として描く（線を切らない）
      ctx.lineTo(px + nx*H*v, py + ny*H*v);
    }
    ctx.lineTo(a1.x, a1.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(79,195,247,0.22)'; ctx.fill();
    ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';           // 相対強度 0.5 / 1.0 の目盛り
    for (const v of [0.5, 1]) {
      ctx.beginPath();
      ctx.moveTo(a0.x + nx*H*v, a0.y + ny*H*v);
      ctx.lineTo(a1.x + nx*H*v, a1.y + ny*H*v);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('相対強度 1', a1.x + nx*H + 5, a1.y + ny*H);
    _drawScreenPeaks(e, a0, a1);
  }
  ctx.restore();
}
// 明線（山）に印を付け、隣り合う山の間隔を書く。
//   ★これが授業でいちばん読みたい量（縞の間隔 Δy）で、定規で測る作業をそのまま置き換える。
// ★「谷の深さ（卓越度）」で山をまとめる。
//   極大をそのまま拾ってはいけない：ヤングの明線のように頂上が平らな山では、
//   積算に乗るわずか1%のさざ波（扇のくさびの境目で位相が階段状になるため）でも
//   頂上が複数の極大に割れ、本来3本の明線が数十本に化ける。
//   隣り合う極大のあいだに「低いほうの PROMINENCE 倍」を下回る谷が無ければ、
//   その2つは同じ1つの山とみなして高いほうだけを残す。
const SCREEN_PROMINENCE = 0.75;
const SCREEN_PEAK_TH = 0.25;
function _mergePeaks(prof, idx) {
  let a = idx;
  for (;;) {
    let merged = false;
    const out = [];
    for (let t = 0; t < a.length; t++) {
      if (t === a.length - 1) { out.push(a[t]); break; }
      const i = a[t], j = a[t+1];
      let valley = Infinity;
      for (let k = i; k <= j; k++) if (prof[k] < valley) valley = prof[k];
      if (valley > SCREEN_PROMINENCE * Math.min(prof[i], prof[j])) {
        out.push(prof[i] >= prof[j] ? i : j);      // 谷が浅い＝同じ山。高いほうを残す
        t++; merged = true;
      } else out.push(i);
    }
    a = out;
    if (!merged) return a;
  }
}
function _drawScreenPeaks(e, a0, a1) {
  // ★明線として数えるのは最大の 25% 以上の山だけ。
  //   面の縁で切れた次数（縁の外にある明線へ向かって上っている途中）には、積算の
  //   わずかなさざ波で見かけの極大が立つ。実測ではそれが最大の 13% 程度なので、
  //   本物の主極大（包絡線の効いた範囲では 40% 以上ある）と切り分けられる。
  const th = e.max * SCREEN_PEAK_TH;
  // ★面の端は数えない。縞の山が面の縁で切れているだけの「見かけの山」を拾うと、
  //   本物の明線に混ざって間隔の平均が狂う（端で切れた次数が1本ぶんとして数えられる）。
  //   （平滑化は端で値を折り返さず留め置くので、縁の数セルは必ず平らになる。
  //     その平らな部分の端が極大として拾われるのを避けるぶんの余裕も込みで 2%）
  const edge = Math.max(4, Math.round(e.n * 0.02));
  const cand = [];
  for (let k = edge; k < e.n - edge; k++) {
    if (!(e.ok[k] && e.ok[k-1] && e.ok[k+1])) continue;   // 測れていない範囲では山を数えない
    const v = e.prof[k];
    if (v >= th && v >= e.prof[k-1] && v > e.prof[k+1]) cand.push(k);
  }
  // 放物線あてはめで山の位置を小数の添字まで出す（標本の粗さで間隔が量子化されないように）
  const peaks = _mergePeaks(e.prof, cand).map(k => {
    const dn = e.prof[k-1] - 2*e.prof[k] + e.prof[k+1];
    const off = Math.abs(dn) > 1e-12 ? 0.5 * (e.prof[k-1] - e.prof[k+1]) / dn : 0;
    return k + 0.5 + Math.max(-1, Math.min(1, off));
  });
  if (!peaks.length) return;
  const pt = f => ({ x: a0.x + (a1.x - a0.x)*(f/e.n), y: a0.y + (a1.y - a0.y)*(f/e.n) });
  ctx.fillStyle = '#ffe082';
  for (const f of peaks) {
    const p = pt(f);
    ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI*2); ctx.fill();
  }
  if (peaks.length < 2) return;
  // 間隔は両端どうしの平均で出す。★隣り合う1組だけで測るより標本の粗さに強い
  const dy = (peaks[peaks.length-1] - peaks[0]) / (peaks.length - 1) * (e.len / e.n);
  const mid = pt((peaks[0] + peaks[peaks.length-1]) / 2);
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`明線の間隔 ${(dy * PX2M).toFixed(3)} m（${peaks.length}本）`, mid.x, mid.y - 9);
  ctx.textAlign = 'left';
}
