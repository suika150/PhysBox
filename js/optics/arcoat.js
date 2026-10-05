// ════════════════════════════════════════
//  反射防止コート（AR コート）
// ════════════════════════════════════════
//  物体の輪郭のうち「ここからここまで」を指定して、その面での反射を消す部品。
//  実物のレンズや窓に蒸着してある無反射コーティングそのもので、取り付け・取り外しができる。
//
//  ★なぜ要るか。この app の光はどんな光路差でも完全に可干渉なので、実験室なら
//    可干渉距離のせいで縞にならない面（レンズの上面・板の裏面・ハーフミラーの裏面）まで
//    干渉に混ざる。実物と同じ手＝その面の反射を消す、で解けるようにする。
//    ニュートンリングを教科書どおり「平板＋平凸レンズ」で組めなかったのはこれが理由だった
//    （js/app/demos-waves.js の demoNewtonRings の★を参照）。
//
//  ★範囲は「輪郭に沿った位置」で持つ。両端をそれぞれ独立した点として覚えると、円のときに
//    「350°側か 10°側か」が決まらない。始点 s と長さ len（どちらも周長に対する割合、
//    増える向きは頂点の並び順）で持てば、全周も含めて一意に決まる。
//  ★割合で持つのは拡大縮小のため。絶対長で覚えると、レンズを大きくした瞬間にコートが
//    端から剥がれる。
//  ★輪郭はローカル座標で作ってキャッシュする。ワールドで作ると物体が動くたびに作り直しに
//    なるが、形が変わらないかぎり中身は同じなので、問い合わせの点のほうをローカルへ移す。
//  ★外周（loop 0）だけを対象にする。穴の内壁を塗る場面が今のところ無く、
//    面の指定が「どの輪の何割か」の2段になって操作が難しくなるため。

// 面の切れ目とみなす曲がり角。★円弧は48角形に近似されていて1辺あたり 7.5°しか曲がらない
//   ので、これより大きくすれば曲面はまるごと1つの面になり、平らな裏面とは 90°で切れる。
//   最初のクリックで「どこまでを1つの面とみなすか」にだけ使う定数。端をドラッグすれば
//   角を越えて隣の面まで伸ばせる（実物のコートも角をまたいで付くので、禁止しない）。
const AR_FACE_TURN = 25 * Math.PI / 180;
const AR_HANDLE_PX = 6;          // 端のつまみの半径 [画面px]
const AR_PICK_PX   = 9;          // 端をつまめる距離 [画面px]（pickElement と揃える）

// ─── 輪郭のキャッシュ（ローカル座標）─────────────────────────
//   pts … 頂点、cum … 各頂点までの累積長、total … 周長
const _arCache = new Map();      // body.id → { key, pts, cum, total }
function _arKey(b) {
  if (b.type === 'circle') return 'c' + b.radius;
  const lv = b._localOutline();                       // ★box は w/h から生成されるのでここを通す
  let s = 0;
  for (const v of lv) s += v.x + v.y * 1.7;           // 形の指紋（_laserSceneKey と同じ手）
  return 'p' + lv.length + ',' + s.toFixed(3);
}
function arOutline(b) {
  const key = _arKey(b);
  let e = _arCache.get(b.id);
  if (e && e.key === key) return e;
  if (b.type === 'circle') {
    e = { key, pts: null, cum: null, total: 2 * Math.PI * b.radius, r: b.radius };
  } else {
    const pts = b._localOutline(), n = pts.length, cum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const a = pts[i], c = pts[(i + 1) % n];
      cum[i + 1] = cum[i] + Math.hypot(c.x - a.x, c.y - a.y);
    }
    e = { key, pts, cum, total: cum[n] };
  }
  _arCache.set(b.id, e);
  return e;
}
// ワールド点 → ローカル点
function _toLocal(b, x, y) {
  const cs = Math.cos(-b.angle), sn = Math.sin(-b.angle);
  const px = x - b.x, py = y - b.y;
  return { x: px * cs - py * sn, y: px * sn + py * cs };
}
// ローカル点 → ワールド点
function _toWorld(b, x, y) {
  const cs = Math.cos(b.angle), sn = Math.sin(b.angle);
  return { x: b.x + x * cs - y * sn, y: b.y + x * sn + y * cs };
}
// ─── 輪郭に沿った位置 u（0〜1）──────────────────────────────
//   世界の点を輪郭の最近点へ落として、その位置を割合で返す。
function arUOfPoint(b, wx, wy) {
  const o = arOutline(b), p = _toLocal(b, wx, wy);
  if (b.type === 'circle') {
    let a = Math.atan2(p.y, p.x);
    if (a < 0) a += 2 * Math.PI;
    return a / (2 * Math.PI);
  }
  const pts = o.pts, n = pts.length;
  let bd = Infinity, bu = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    const ex = c.x - a.x, ey = c.y - a.y;
    const L2 = ex * ex + ey * ey;
    let t = L2 > 1e-12 ? ((p.x - a.x) * ex + (p.y - a.y) * ey) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = a.x + ex * t, qy = a.y + ey * t;
    const d = (p.x - qx) * (p.x - qx) + (p.y - qy) * (p.y - qy);
    if (d < bd) { bd = d; bu = (o.cum[i] + Math.sqrt(L2) * t) / (o.total || 1); }
  }
  return bu;
}
// ★レイキャストの当たりは辺番号を持っているので、そちらがあれば最近点を探さずに済む
//   （頂点のうえに当たったときの取り違えも起きない）。
function arUOfHit(b, hit) {
  if (b.type === 'circle' || !hit || hit.edge === undefined || hit.loop !== 0)
    return arUOfPoint(b, hit.x, hit.y);
  const o = arOutline(b), pts = o.pts, n = pts.length, i = hit.edge % n;
  const p = _toLocal(b, hit.x, hit.y);
  const a = pts[i], c = pts[(i + 1) % n];
  const ex = c.x - a.x, ey = c.y - a.y, L = Math.hypot(ex, ey);
  const t = L > 1e-9 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (L * L))) : 0;
  return (o.cum[i] + L * t) / (o.total || 1);
}
// 割合 u の点（ワールド）
function arPointAtU(b, u) {
  const o = arOutline(b);
  u = u - Math.floor(u);
  if (b.type === 'circle') {
    const a = u * 2 * Math.PI;
    return _toWorld(b, o.r * Math.cos(a), o.r * Math.sin(a));
  }
  const s = u * o.total, pts = o.pts, n = pts.length;
  for (let i = 0; i < n; i++) {
    if (s <= o.cum[i + 1] || i === n - 1) {
      const a = pts[i], c = pts[(i + 1) % n];
      const seg = o.cum[i + 1] - o.cum[i];
      const t = seg > 1e-9 ? (s - o.cum[i]) / seg : 0;
      return _toWorld(b, a.x + (c.x - a.x) * t, a.y + (c.y - a.y) * t);
    }
  }
  return _toWorld(b, pts[0].x, pts[0].y);
}
// ─── 覆っているか ───────────────────────────────────────────
const _arIn = (u, s, len) => {
  if (len >= 1) return true;
  const d = u - s - Math.floor(u - s);        // [0,1) に畳む
  return d < len;
};
function arCoatCoversU(b, u) {
  const cs = b.arCoats;
  if (!cs || !cs.length) return false;
  for (const c of cs) if (_arIn(u, c.s, c.len)) return true;
  return false;
}
// レイキャストの当たりがコートされた面か（traceLaser から呼ぶ）
function arCoatCoversHit(b, hit) {
  if (!b.arCoats || !b.arCoats.length) return false;
  return arCoatCoversU(b, arUOfHit(b, hit));
}
// ─── 最初のクリックで入れる範囲（曲がりが AR_FACE_TURN 以下で繋がっている区間）───
function arFaceSpanAt(b, wx, wy) {
  const o = arOutline(b);
  if (b.type === 'circle') return { s: 0, len: 1 };          // 円は1クリックで全面
  const pts = o.pts, n = pts.length;
  const u = arUOfPoint(b, wx, wy);
  let e0 = 0;                                                 // 押した辺
  for (let i = 0; i < n; i++) if (u * o.total < o.cum[i + 1] + 1e-9) { e0 = i; break; }
  const dirOf = i => {
    const a = pts[i], c = pts[(i + 1) % n];
    return Math.atan2(c.y - a.y, c.x - a.x);
  };
  const turn = (i, j) => {
    let d = dirOf(j) - dirOf(i);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d);
  };
  let lo = e0, hi = e0;
  for (let k = 0; k < n - 1; k++) {                           // 後ろへ伸ばす
    const p = (lo - 1 + n) % n;
    if (turn(p, lo) > AR_FACE_TURN) break;
    lo = p;
  }
  for (let k = 0; k < n - 1; k++) {                           // 前へ伸ばす
    const q = (hi + 1) % n;
    if (turn(hi, q) > AR_FACE_TURN) break;
    hi = q;
  }
  const s = o.cum[lo] / o.total;
  let len = (o.cum[hi + 1] - o.cum[lo]) / o.total;
  if (len <= 0) len += 1;
  return { s, len: Math.min(1, len) };
}
// ─── 付ける・外す ───────────────────────────────────────────
function arCoatAdd(b, wx, wy) {
  if (!b.arCoats) b.arCoats = [];
  b.arCoats.push(arFaceSpanAt(b, wx, wy));
  return b.arCoats.length - 1;
}
function arCoatRemove(b, i) {
  if (!b.arCoats) return;
  b.arCoats.splice(i, 1);
  if (!b.arCoats.length) b.arCoats = [];
}
// 端の位置（ワールド）。end='A' が始点、'B' が終点
function arCoatEndPos(b, i, end) {
  const c = b.arCoats && b.arCoats[i];
  if (!c) return { x: b.x, y: b.y };
  return arPointAtU(b, end === 'B' ? c.s + c.len : c.s);
}
// 端をドラッグしたときの更新。★動かした端だけが動き、もう一方は動かない。
//   長さが 0 を跨がないよう [最小, 1] に収める（0 にすると面が消えて掴めなくなる）。
const AR_MIN_LEN = 0.004;
function arCoatDragEnd(b, i, end, wx, wy) {
  const c = b.arCoats && b.arCoats[i];
  if (!c) return;
  const u = arUOfPoint(b, wx, wy);
  if (end === 'B') {
    let len = u - c.s - Math.floor(u - c.s);
    c.len = Math.max(AR_MIN_LEN, Math.min(1, len));
  } else {
    const uEnd = c.s + c.len;                       // 終点は固定
    let len = uEnd - u - Math.floor(uEnd - u);
    len = Math.max(AR_MIN_LEN, Math.min(1, len));
    c.s = uEnd - len;
    c.s -= Math.floor(c.s);
    c.len = len;
  }
}
// ─── 描画 ───────────────────────────────────────────────────
//   ★実物の反射防止コートが紫や緑に光るのに寄せた色。輪郭の上に重ねて描く。
//     端のつまみは、選択中か指しているときだけ出す（ギズモを選択時だけ出す作法に合わせる）。
const AR_COLOR = '#b388ff';
function drawArCoats() {
  ctx.save();
  for (const b of objects) {
    const cs = b.arCoats;
    if (!cs || !cs.length) continue;
    const sel = selectedElement && selectedElement.kind === 'arcoat' && selectedElement.body === b;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      // 覆っている区間を、輪郭に沿って折れ線で描く
      const steps = Math.max(2, Math.ceil(c.len * (b.type === 'circle' ? 64 : arOutline(b).pts.length * 2)) + 1);
      ctx.beginPath();
      for (let k = 0; k <= steps; k++) {
        const p = worldToScreen2(arPointAtU(b, c.s + c.len * k / steps));
        k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = AR_COLOR;
      ctx.lineWidth = sel && selectedElement.index === i ? 4 : 3;
      ctx.globalAlpha = 0.85;
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (sel && selectedElement.index === i) {
        for (const end of ['A', 'B']) {
          const p = worldToScreen2(arCoatEndPos(b, i, end));
          ctx.beginPath(); ctx.arc(p.x, p.y, AR_HANDLE_PX, 0, Math.PI * 2);
          ctx.fillStyle = selectedElement.end === end ? '#fff' : AR_COLOR;
          ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
}
const worldToScreen2 = p => worldToScreen(p.x, p.y);
