// ════════════════════════════════════════
//  加熱・冷却の領域（HeatField）
//   置いた矩形の内側にあるものへ、外から一定の仕事率で熱を入れる（冷却は負）。
//   バーナー・氷水・ヒーターにあたる、系の外から熱をやりとりする入口。
//
//  ★なぜ要るか
//    熱の入口はこれまで「摩擦・非弾性衝突・抗力の散逸」「恒温物体」「気体室の恒温槽」
//    しか無く、**外から決まった熱量を入れる**手段が無かった。そのため Q = mcΔT の
//    測定も、加熱による定圧膨張も、熱機関を回すことも作れなかった。
//
//  ── 与える熱量の意味（ここが設計の要）────────────────────────────
//    指定する [W] は **領域全体が出す仕事率**。中にあるものへ「浸かっている体積」で
//    按分する。1つあたりの値ではない。
//      ・水は粒子1個ずつが独立した熱容量を持つので、1つあたりにすると 500粒子の水に
//        100W と指定した瞬間に系へ 50kW 入ることになる（＝指定が意味を失う）
//      ・総出力にしておけば、系へ入る熱は中身によらず必ず指定どおりで、
//        Δ(系の熱量) = 散逸で出た熱 + 熱源が与えた熱 という既存の台帳
//        （thermal.js の applyBodyHeat の★）がそのまま閉じる
//    副作用として「中身を増やすと1つあたりは減る」が、これは定格出力のバーナーの
//    正しい振る舞いなので、そのまま見せる。
//
//  ── 断熱のものには与えない ──────────────────────────────────────
//    bodyHasHeat()（比熱か熱伝導率が0＝完全な断熱材）を門番にする。受け取れる相手が
//    1つも居なければ熱そのものを作らない＝addDissipatedHeat と同じ方針で、
//    「断熱材だけを炙ると熱がどこからか湧く」ことにならない。
//
//  ── 部分的に入っているとき ──────────────────────────────────────
//    枠と物体の**重なりの面積**で按分する。中心が入っているかどうかの判定にすると、
//    棒を半分だけ炙るという操作ができないうえ、枠の縁で取り分がカクッと飛ぶ。
//    多角形は凸パーツごとに矩形で切り取って面積を出す（Sutherland–Hodgman）。
//
//  ── 加熱と冷却は1つの符号つき出力 ────────────────────────────────
//    ★power は**符号つき**（正＝加熱・負＝冷却・0＝止まっている）。加熱か冷却かは
//      符号から決まる読み出し（kind）で、別には持たない。
//      以前は「種類 kind ＋ 正の出力」の組で持っていた。それだと種類はつまみで
//      変えられず、P-V 図のデモでは加熱器と冷却器を2つ置いて器を運ぶしかなかった
//      （運ぶと蓋が取り残され、火加減は「載せている時間」でしか変えられない）。
//      符号つきなら器の下に1つ置き、**1本のつまみで 0 をまたいで**回せる。
//    ★以前の懸念「−100W の加熱と +100W の冷却が両方書けると迷う」は、種類の欄を
//      無くしたことで消えている（表し方は符号の1通りだけ）。符号の向きは第一法則の
//      Q（吸熱が正）と、台帳「熱源が与えた熱」（冷却は負で積む）に一致する。
//    ★つまみは 0 に吸着させる（HEATFIELD_DETENT_W）。±5000W を 150〜200px のつまみに
//      載せると 1px ≈ 50W で、吸着が無いと「止める」がつまみで作れない。
const HEATFIELD_COLOR = { heat: '#ff7043', cool: '#26c6da', off: '#90a4ae' };
const HEATFIELD_POWER_MAX = 5000;      // 出力つまみの範囲 ±[W]
// ★0 へ吸着させる幅 [W]。範囲 ±5000W の 1%（0 をはさんで合わせて 2%）で、
//   150px のつまみなら 3px ぶんが 0 になる。これより狭いと指で止めにくく、
//   広いと小さな出力がつまみで打てなくなる（数値欄なら 10〜90W も打てる）。
const HEATFIELD_DETENT_W = 100;
const HEATFIELD_MIN_PX = 8;            // 潰れてハンドルを掴めなくならないための最小サイズ
const HEATFIELD_EDGE_PX = 6;           // 枠の当たり幅 [画面px]（EMFIELD_EDGE_PX と同じ流儀）
const HEAT_FLOOR_K = 1e-3;             // 冷却がここより下へ持っていかない温度 [K]
const HF_CIRCLE_SEG = 24;              // 円を切り取るときの多角形近似の分割数

// 出力つまみの目盛り：−max〜+max を step 刻みにし、|v| < 吸着幅 の段を全部 0 にする。
//   ★0 を1段だけ置くのではなく**0 の段を並べる**。1段では幅が 1px 未満のまま。
//     段を間引かずに 0 で埋めるので、矢印キーで1段ずつ送っても 0 で詰まらず抜けられる。
function heatPowerTicks(step) {
  step = step || 10;
  const n = Math.round(HEATFIELD_POWER_MAX / step), out = [];
  for (let i = -n; i <= n; i++) {
    const v = i * step;
    out.push(Math.abs(v) < HEATFIELD_DETENT_W ? 0 : v);
  }
  return out;
}

// 符号つきの出力から 'heat' / 'cool' / 'off' を返す（HeatField.kind・ツールの枠色と共通）
function heatKindOf(p) { return p > 0 ? 'heat' : p < 0 ? 'cool' : 'off'; }

class HeatField {
  constructor(opts) {
    opts = opts || {};
    this.id = opts.id !== undefined ? opts.id : ++uidCounter;
    if (opts.id !== undefined && opts.id > uidCounter) uidCounter = opts.id;
    this.x = opts.x || 0;  this.y = opts.y || 0;          // 領域の中心 [px]
    this.w = Math.max(4, opts.w || 200);
    this.h = Math.max(4, opts.h || 200);
    // ★符号つきの出力 [W]（上の★）。旧形式 { kind:'cool', power:正 } も読めるよう、
    //   kind が 'cool' なら負へ畳む（手元に残っている保存ファイルがこの形）。
    let pw = opts.power !== undefined ? (+opts.power || 0) : 200;
    if (opts.kind === 'cool') pw = -Math.abs(pw);
    this.power = pw;
  }
  // 'heat'＝加熱 / 'cool'＝冷却 / 'off'＝0。色・模様・名前の出し分けに使う読み出し
  get kind() { return heatKindOf(this.power); }
  contains(x, y) {
    return Math.abs(x - this.x) <= this.w/2 && Math.abs(y - this.y) <= this.h/2;
  }
  label() { return (this.power > 0 ? '＋' : this.power < 0 ? '−' : '') + Math.abs(this.power) + ' W'; }
  kindName() { return this.power > 0 ? '加熱' : this.power < 0 ? '冷却' : '加熱冷却'; }   // 0 のときは説明文が「止まっている」と書く
}

// ═══ 幾何：矩形と重なっている面積 ═══════════════════════════════
// 凸多角形を軸に沿った矩形で切り取る（Sutherland–Hodgman）。
//   4つの半平面で順に切るだけ。凸パーツにしか使わないので、これで厳密。
function _hfClipToRect(poly, x0, y0, x1, y1) {
  let cur = poly;
  // [軸(0=x,1=y), 符号(+1=下限, -1=上限), 値]
  const planes = [[0, 1, x0], [0, -1, x1], [1, 1, y0], [1, -1, y1]];
  for (const [ax, sgn, lim] of planes) {
    if (!cur.length) return cur;
    const out = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i], b = cur[(i + 1) % cur.length];
      const da = sgn * ((ax ? a.y : a.x) - lim);      // ≥0 なら内側
      const db = sgn * ((ax ? b.y : b.x) - lim);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);                     // 辺が面を横切る点
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    cur = out;
  }
  return cur;
}
function _hfPolyArea(p) {
  if (!p || p.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i], r = p[(i + 1) % p.length];
    a += q.x * r.y - r.x * q.y;
  }
  return Math.abs(a) / 2;
}
// 円を多角形で近似する。切り取りの「割合」を出すためだけに使うので、近似で面積が
// 数%小さいことは効かない（分母も同じ多角形で測り、最後に本物の areaM2 へ掛け直す）。
function _hfCirclePoly(b) {
  const out = [];
  for (let i = 0; i < HF_CIRCLE_SEG; i++) {
    const t = i / HF_CIRCLE_SEG * Math.PI * 2;
    out.push({ x: b.x + Math.cos(t) * b.radius, y: b.y + Math.sin(t) * b.radius });
  }
  return out;
}
// 物体のうち領域に浸かっている面積 [m²]
function heatFieldBodyAreaM2(f, b) {
  const x0 = f.x - f.w/2, y0 = f.y - f.h/2, x1 = f.x + f.w/2, y1 = f.y + f.h/2;
  const ab = b._aabb;
  if (!ab) return 0;
  if (ab.maxX < x0 || ab.minX > x1 || ab.maxY < y0 || ab.minY > y1) return 0;      // 掠りもしない
  if (ab.minX >= x0 && ab.maxX <= x1 && ab.minY >= y0 && ab.maxY <= y1)            // 丸ごと内側
    return b.areaM2();
  let whole = 0, inside = 0;
  if (b.type === 'circle') {
    const poly = _hfCirclePoly(b);
    whole = _hfPolyArea(poly);
    inside = _hfPolyArea(_hfClipToRect(poly, x0, y0, x1, y1));
  } else {
    // ★凸パーツで測る。穴あき多角形は buildConvexParts が穴を除いた形に分解して
    //   いるので、そのまま足せば穴のぶんは入らない。
    for (const part of b._worldParts()) {
      whole  += _hfPolyArea(part);
      inside += _hfPolyArea(_hfClipToRect(part, x0, y0, x1, y1));
    }
  }
  if (!(whole > 0)) return 0;
  const frac = inside / whole;
  return b.areaM2() * (frac > 1 ? 1 : frac);      // 面積は本物（areaM2）に合わせる
}
// 気体室のうち領域に浸かっている面積 [m²]（気体の領域は傾いた矩形）
function heatFieldChamberAreaM2(f, ch) {
  const c = ch.corners();
  if (!c || c.length < 3) return 0;
  const x0 = f.x - f.w/2, y0 = f.y - f.h/2, x1 = f.x + f.w/2, y1 = f.y + f.h/2;
  return _hfPolyArea(_hfClipToRect(c, x0, y0, x1, y1)) * PX2M * PX2M;
}
// 粒子1個が代表する面積 [m²]。質量・熱容量が restArea から作られている
// （particles.js の refreshParticleThermal）ので、体積の按分も同じ量で測る。
function _hfParticleAreaM2(p) {
  return (p.prm && p.prm.restArea ? p.prm.restArea : 0) * PX2M * PX2M;
}

// ═══ 物理：1tick に一度、熱を配る ═══════════════════════════════
//   ① 受け取れる相手をなめて「浸かっている体積」の合計を出す
//   ② P·dt を体積比で配る。冷却は絶対零度で頭打ちにし、実際に動いた熱だけを台帳へ
//   ★2パスにしてあるのは、按分の分母を先に確定させるため。ついでに、粒子1500個ぶんの
//     一時オブジェクトを毎tick作らずに済む（判定は矩形の内外だけなので測り直しても安い）。
function applyHeatFields(dt) {
  if (!world.thermalOn || !heatFields.length || !(dt > 0)) return;
  if (particles.length) refreshParticleThermal();     // 型ごとの熱容量（奥行きに依存する）
  const D = world.depth;
  for (const f of heatFields) {
    if (!f.power) continue;
    // ── ① 分母 ──
    let volTotal = 0;
    for (const b of objects) {
      if (!bodyHasHeat(b)) continue;                  // ★断熱のものは対象外
      volTotal += heatFieldBodyAreaM2(f, b) * D;
    }
    for (const p of particles) {
      if (!f.contains(p.x, p.y) || !(p.heatC > 0)) continue;
      volTotal += _hfParticleAreaM2(p) * D;
    }
    for (const ch of gasChambers) {
      if (!(ch.heatCapJK() > 0)) continue;
      volTotal += heatFieldChamberAreaM2(f, ch) * D;
    }
    // ★受け取れる相手が1つも居なければ、熱そのものを作らない（addDissipatedHeat と同じ）
    if (!(volTotal > 0)) continue;
    // ── ② 配る ──
    const Q = f.power * dt;                           // [J] この tick の総量（冷却は負）
    let given = 0;
    for (const b of objects) {
      if (!bodyHasHeat(b)) continue;
      const v = heatFieldBodyAreaM2(f, b) * D;
      if (!(v > 0)) continue;
      // ★恒温物体は温度が動かないので下限も要らない。applyBodyHeat が別勘定へ回し、
      //   こちらが足す供給ぶんと打ち消し合って「系の熱量は変わらない」になる。
      const dQ = b.tempFixed ? Q * (v / volTotal)
                             : _hfClampCool(Q * (v / volTotal), b.heatCap * b.mass, b.temp);
      if (!dQ) continue;
      // ★眠っている物体を起こさない。剛体は温度に力学で応じない（熱膨張は水と気体だけ）
      //   ので、起こす理由が無い。熱伝導も止まらない：接触ペアはこの物体が眠っていても
      //   立つ（実測：積んだ2個を眠らせたまま上だけ炙って600tick、ペアは600回とも立ち、
      //   下も同じ 2.222K だけ温まった。起こす版と小数点以下まで一致）。
      //   逆に起こすと、バーナーの下の物体は600tick中600tickとも起きたまま＝
      //   スリープが丸ごと効かなくなる。
      applyBodyHeat(b, dQ);
      given += dQ;
    }
    for (const p of particles) {
      if (!f.contains(p.x, p.y)) continue;
      const C = p.heatC;
      if (!(C > 0)) continue;
      const v = _hfParticleAreaM2(p) * D;
      if (!(v > 0)) continue;
      const dQ = _hfClampCool(Q * (v / volTotal), C, p.T);
      if (!dQ) continue;
      p.T += dQ / C;
      given += dQ;
    }
    for (const ch of gasChambers) {
      const C = ch.heatCapJK();
      if (!(C > 0)) continue;
      const v = heatFieldChamberAreaM2(f, ch) * D;
      if (!(v > 0)) continue;
      const dQ = _hfClampCool(Q * (v / volTotal), C, ch.T);
      if (!dQ) continue;
      ch.addHeat(dQ);        // ★第一法則の帳簿（Q・Qin・Qout）と P-V 図にそのまま乗る
      given += dQ;
    }
    // ★台帳は「実際に動いた熱」で積む。頭打ちで入らなかったぶんまで供給に数えると、
    //   Δ(系の熱量) = 散逸 + 供給 が合わなくなる。
    reservoirHeatTotal += given;
  }
}
// 冷却が絶対零度より下へ持っていかないように、抜ける熱量を頭打ちにする [J]
function _hfClampCool(dQ, C, T) {
  if (dQ >= 0) return dQ;
  const room = -C * (T - HEAT_FLOOR_K);     // ≤0。これ以上は抜けない
  return dQ < room ? (room < 0 ? room : 0) : dQ;
}

// ═══ 当たり判定（EMField と同じ流儀）═══════════════════════════
//   面が広いので、左クリックで拾うのは枠のそばだけ。内側はダブルクリックで拾う。
function heatFieldAtPoint(x, y) {
  for (const f of heatFields) if (f.contains(x, y)) return f;
  return null;
}
function heatFieldEdgeAtPoint(x, y) {
  const tol = HEATFIELD_EDGE_PX / cam.zoom;
  for (const f of heatFields) {
    const dx = Math.abs(x - f.x) - f.w/2, dy = Math.abs(y - f.y) - f.h/2;
    const d = (dx > 0 || dy > 0) ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
                                 : -Math.max(dx, dy);
    if (d <= tol) return f;
  }
  return null;
}
function selectedHeatField() {
  return (selectedElement && selectedElement.kind === 'heatfield') ? selectedElement.field : null;
}

// ═══ 描画（物体より下のレイヤー）═══════════════════════════════
function drawHeatFields() {
  if (!heatFields.length) return;
  ctx.save();
  for (let i = heatFields.length - 1; i >= 0; i--) {      // 先頭ほど手前
    const f = heatFields[i];
    // ★ワールドの矩形として描く（scene.js の worldRectPath の★）
    const col = HEATFIELD_COLOR[f.kind];
    const sel = selectedElement && selectedElement.kind === 'heatfield' && selectedElement.field === f;
    const q = worldRectPath(ctx, f.x, f.y, f.w, f.h);
    ctx.fillStyle = hexToRgba(col, 0.07);
    ctx.fill();
    ctx.setLineDash(sel ? [] : [6, 4]);
    ctx.strokeStyle = sel ? '#4fc3f7' : hexToRgba(col, 0.55);
    ctx.lineWidth = sel ? 2.5 : 1.2;
    ctx.stroke();
    ctx.setLineDash([]);
    if (f.power) _drawHeatGlyphs(f, col);          // 0 なら模様を出さない＝止まっている
    ctx.fillStyle = hexToRgba(col, 0.9);
    ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${f.kindName()} ${f.label()}`, q[0].x + 4, q[0].y - 3);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}
// 加熱は立ちのぼる湯気の波線、冷却は雪の結晶。
//   ★向きだけを反転した同じ模様（上へ揺れる／下へ揺れる波線）にしていたら、この大きさでは
//     加熱と冷却が見分けられなかった（実測：スクリーンショットで並べても判別できない）。
//     形そのものを変え、ツールボタンの ♨／❄ と同じ絵にして対応を取る。
//   間隔はワールド基準で決める（画面px基準にすると、拡大したとき本数が増えて模様が流れる。
//   _drawEMGlyphs の★と同じ）。
//   ★マス目もワールドで割る（_drawEMGlyphs の★と同じ。画面座標で割ると、カメラを
//     回したときにグリフが領域の外へこぼれる）。模様そのものは画面の縦横のまま描く
//     ＝湯気は必ず画面の上へ立ちのぼる（回した画面で斜めに立つ湯気は読みにくい）。
function _drawHeatGlyphs(f, col) {
  const stepW = 44, minPx = 14;
  let nx = Math.max(1, Math.round(f.w / stepW)), ny = Math.max(1, Math.round(f.h / stepW));
  nx = Math.max(1, Math.min(nx, Math.floor(f.w * cam.zoom / minPx)));
  ny = Math.max(1, Math.min(ny, Math.floor(f.h * cam.zoom / minPx)));
  const W = f.w * cam.zoom, H = f.h * cam.zoom;
  const r = Math.min(9, Math.min(W / nx, H / ny) * 0.35);
  ctx.strokeStyle = hexToRgba(col, 0.6);
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const _c = worldToScreen(f.x - f.w/2 + f.w * (i + 0.5) / nx,
                             f.y - f.h/2 + f.h * (j + 0.5) / ny);
    const cx = _c.x, cy = _c.y;
    if (f.kind === 'heat') {
      for (const dx of [-r * 0.45, r * 0.45]) {          // 湯気を2本
        ctx.beginPath();
        for (let k = 0; k <= 10; k++) {
          const t = k / 10;
          const px = cx + dx + Math.sin(t * Math.PI * 2) * r * 0.3;
          const py = cy + (0.5 - t) * r * 2;             // 下から上へ
          k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
    } else {
      ctx.beginPath();                                   // 雪の結晶（6本の枝）
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3, ux = Math.cos(a), uy = Math.sin(a);
        ctx.moveTo(cx, cy); ctx.lineTo(cx + ux * r, cy + uy * r);
        ctx.moveTo(cx + ux * r * 0.62, cy + uy * r * 0.62);   // 枝の小枝
        ctx.lineTo(cx + ux * r * 0.62 - uy * r * 0.28, cy + uy * r * 0.62 + ux * r * 0.28);
        ctx.moveTo(cx + ux * r * 0.62, cy + uy * r * 0.62);
        ctx.lineTo(cx + ux * r * 0.62 + uy * r * 0.28, cy + uy * r * 0.62 - ux * r * 0.28);
      }
      ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';
}

// ═══ 保存・復元 ═══════════════════════════════════════════════
function serializeHeatField(f) {
  return { id:f.id, x:f.x, y:f.y, w:f.w, h:f.h, power:f.power };   // ★power は符号つき
}
function deserializeHeatFields(arr) { return (arr || []).map(d => new HeatField(d)); }
