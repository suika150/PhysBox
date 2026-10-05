// ════════════════════════════════════════
//  気体室の描画
// ════════════════════════════════════════
//  圧力の描き方について。
//  1気圧・断面積0.05m² なら、気体が押す力も大気が押す力も 5000N 台で、差は数十N
//  しかない。この2本を力ベクトル表示（FORCE_VIZ）の同じスケールで描くと、どちらも
//  長さの上限（maxLen）に張り付いて見分けがつかず、肝心の「正味の力」が見えない。
//  そこで3層に分ける：
//    ① 正味の力 (P−大気圧)·A … recordForce('pressure') で既存の力ベクトルへ。
//       重力と同程度の大きさなので、既存のスケールと凡例にそのまま乗る（gas.js 側）。
//    ② 圧力そのもの … 面に並ぶ短い矢印。長さは「圧力」に比例する別スケールなので
//       ①と競合しない。ほぼ同じ長さの矢印が向かい合う絵になり、
//       「釣り合っていて、わずかな差だけが正味の力」がそのまま見える。
//    ③ 大気はどこにでもある … シリンダー外周の薄い内向き矢印。これらは打ち消し合い、
//       ピストン面だけが残る＝「一様な圧力に合力は無い」を絵で示す。
//
//  ★②③ の出し入れはピストンの showForces に従える（①と同じスイッチ）。
//    以前は world.showGasPressure という別のスイッチを全体設定に置いていたが、
//    ①②③ は「同じ1つの力を3つの見方で描いたもの」なので、①だけ出て②③が出ない、
//    という組み合わせに意味が無い。しかもスイッチが別のタブにあるせいで、
//    ピストンの力を出したいのに全体設定まで往復することになっていた。
const GAS_ARROW_PX_PER_ATM = 22;    // 圧力矢印の長さ [画面px / 1気圧]
const GAS_ARROW_MIN = 3;
const GAS_ARROW_MAX = 60;
const GAS_COL_IN  = '#26c6da';      // 気体の圧力
const GAS_COL_OUT = '#ffa726';      // 大気圧

function _gasArrow(x, y, dx, dy, len, color, width, head) {
  if (!(len > 0.5)) return;
  const ex = x + dx*len, ey = y + dy*len;
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
  const h = head !== undefined ? head : Math.min(5, len*0.5);
  const px = -dy, py = dx;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - dx*h + px*h*0.5, ey - dy*h + py*h*0.5);
  ctx.lineTo(ex - dx*h - px*h*0.5, ey - dy*h - py*h*0.5);
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
}
// 面に沿って矢印を並べる。from は面上の始点、along は面に沿う単位ベクトル、
// dir は矢印の向き（面から出ていく向き）。
function _gasFaceArrows(sx, sy, ax, ay, lenPx, dirx, diry, alen, color) {
  const n = Math.max(2, Math.min(9, Math.round(lenPx / 26)));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = sx + ax*lenPx*t, y = sy + ay*lenPx*t;
    // 矢印は「面へ向かって」描く＝面の外側から始めて面で終わる
    _gasArrow(x - dirx*alen, y - diry*alen, dirx, diry, alen, color, 1.5);
  }
}
// ── 管でつないだ2室のあいだに配管を描く ──────────────────────────
//   ★**見えないつながりを作らない。** つないだ2室は中身が1つの気体で、圧力も物質量も
//     互いに決め合っている（gas.js の solveGasLinks）。線が無いと、画面には器が2つ
//     並んでいるだけに見えて、その一点が図から読めない。
//   ★**器と同じ作りの通路として描く**＝壁2枚と、その間の内径。以前は灰色の1本線で、
//     装置の一部ではなく画面に渡した「配線」に見えていた。壁の厚みは器と同じ
//     VESSEL_WALL_PX を使い、内径は**器の気体とまったく同じ塗り方**（背景の上に
//     同じ色を同じ濃さで乗せる）にする。こうすると2室の気体と通路の気体が地続きに
//     見えて、「中身は1つの気体」が絵から読める。
//   ★**閉端からいったん軸の外へ抜いてから曲げる**（実物の配管と同じ取り回し）。
//     閉端の中心どうしを直線で結ぶと器の側壁を斜めに貫くが、細い1本線のうちは
//     それが見えなかった。壁のある通路にした瞬間に破綻するので、軸方向へ逃がす。
//   ★**この通路には体積が無い**。solveGasLinks は気体を V₁ と V₂ にしか分けない
//     （＝死容積 0 の Schmidt 解析の素の形）。だから**絵として太らせてはいけない**。
//     実測：スターリングの2気筒（作業体積 180 L）は 5.0 m 離れているので、
//     内径 16px・奥行き 0.05m の通路に体積を持たせると 35 L ＝ 19% の死容積にあたる。
//     模型がそれを 0 と理想化している以上、通路は細いまま＝「絵で払える嘘の量」に留める。
const GAS_PIPE_BORE_PX = 16;        // 通路の内径 [px]（世界の寸法。上の★のとおり細く保つ）
const GAS_PIPE_STUB_PX = 26;        // 閉端から軸方向へ逃がす長さ [px]（器の壁 10px を越える）
// 折れ線を法線方向へ d だけずらす（角は二等分線で継ぐので、角でも壁の厚みが変わらない）
//   ★伸び率に頭打ちを置く。器どうしが向かい合うと折れ角が鋭くなり、素の 1/cos が
//     発散して壁が画面の外まで飛ぶ。
function _gasPipeOffset(pts, d) {
  const nrm = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i+1].x - pts[i].x, dy = pts[i+1].y - pts[i].y;
    const L = Math.hypot(dx, dy) || 1;
    nrm.push({ x: -dy / L, y: dx / L });
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const n0 = nrm[Math.max(0, i - 1)], n1 = nrm[Math.min(nrm.length - 1, i)];
    let mx = n0.x + n1.x, my = n0.y + n1.y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { out.push({ x: p.x + n1.x*d, y: p.y + n1.y*d }); continue; }
    mx /= ml; my /= ml;
    const k = Math.min(3, 1 / Math.max(0.33, mx*n0.x + my*n0.y));
    out.push({ x: p.x + mx*d*k, y: p.y + my*d*k });
  }
  return out;
}
function _gasPipeStroke(pts, w, style) {
  if (pts.length < 2 || !(w > 0)) return;
  ctx.strokeStyle = style; ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}
function drawGasLinks() {
  const done = new Set();
  for (const a of gasChambers) {
    if (a.linkId == null || done.has(a.id)) continue;
    const b = gasChambers.find(c => c.id === a.linkId);
    if (!b || done.has(b.id)) continue;
    done.add(a.id); done.add(b.id);
    const axA = a.axis(), axB = b.axis(), S = GAS_PIPE_STUB_PX;
    // 閉端 → 軸の外へ逃がす → 相手の逃がし先 → 相手の閉端（上の★）
    const route = [
      { x: a.cx,              y: a.cy },
      { x: a.cx - axA.x * S,  y: a.cy - axA.y * S },
      { x: b.cx - axB.x * S,  y: b.cy - axB.y * S },
      { x: b.cx,              y: b.cy },
    ].map(p => worldToScreen(p.x, p.y));
    const lit = selectedElement && selectedElement.kind === 'gas'
              && (selectedElement.chamber === a || selectedElement.chamber === b);
    // 下限は画面px で持つ（コックの★と同じ理由。倍率 0.4 のデモでも通路だと読める太さ）
    const bore = Math.max(5, GAS_PIPE_BORE_PX * cam.zoom);
    const wall = Math.max(2.5, VESSEL_WALL_PX * cam.zoom);
    ctx.save();
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    // ── 壁2枚。内径は塗り残す（塗ると背景が隠れて、器の気体と濃さが揃わなくなる）──
    //   輪郭を太めに敷いてから中身を重ねる＝器の本体（fill + strokeWidth 1）と同じ見え方。
    for (const s of [1, -1]) {
      const side = _gasPipeOffset(route, s * (bore + wall) / 2);
      _gasPipeStroke(side, wall + 2, lit ? '#e1f5fe' : '#cfd8dc');
      _gasPipeStroke(side, wall,     lit ? '#90a4ae' : '#78909c');
    }
    // ── 内径の気体。★器の塗りと同じ式（drawGasChambers の fillStyle と揃える）
    const open = a.linkOpen && b.linkOpen;
    const gasCol = (world.thermalOn && world.thermalViz)
      ? tempToColor((a.T + b.T) / 2, 0.35) : 'rgba(38,198,218,0.13)';
    // コックは長い区間（route[1]→route[2]）の中点に据える。★閉じていればそこで切る
    let ux = route[2].x - route[1].x, uy = route[2].y - route[1].y;
    let ul = Math.hypot(ux, uy);
    if (ul < 1) { ux = route[3].x - route[0].x; uy = route[3].y - route[0].y;
                  ul = Math.hypot(ux, uy) || 1; }                 // 逃がし先が重なった場合の保険
    const tx = ux / ul, ty = uy / ul;
    const mx = (route[1].x + route[2].x) / 2, my = (route[1].y + route[2].y) / 2;
    const gap = Math.max(8, 16 * cam.zoom);            // コックの座のぶん
    if (open) {
      _gasPipeStroke(route, bore, gasCol);
    } else {
      _gasPipeStroke([route[0], route[1], { x: mx - tx*gap, y: my - ty*gap }], bore, gasCol);
      _gasPipeStroke([{ x: mx + tx*gap, y: my + ty*gap }, route[2], route[3]], bore, gasCol);
    }
    // ── コック（弁体＋ハンドル）──────────────────────────────
    //   ★**一目で開閉が分かる大きさで描く**。はじめはハンドルの線だけ（半径7px）に
    //     していたが、装置全体の中では見つけられなかった（実測：画面で 14px の線は
    //     管の一部にしか見えない）。弁体の箱を描き、ハンドルをその上に載せる。
    //   ★向きの約束は実物の弁と同じ：**開＝ハンドルが管に沿う／閉＝管を横切る**。
    //     色も足す（開＝緑・閉＝赤）が、色だけに頼らない（向きでも分かるようにする）。
    //   ★下限は画面 px で持つ（倍率 0.4 のデモでも読める大きさにする。実測：下限を
    //     11/9px にしていたら、装置全体の中では管の膨らみにしか見えなかった）
    const r  = Math.max(18, 26 * cam.zoom);          // ハンドルの長さの半分
    const bw = Math.max(14, 20 * cam.zoom);          // 弁体の半分の大きさ
    const nx = -ty, ny = tx;                         // 管に垂直な向き（tx,ty は上で求めた）
    ctx.fillStyle = 'rgba(69,90,100,0.95)';
    ctx.strokeStyle = 'rgba(207,216,220,0.9)';
    ctx.lineWidth = Math.max(1, 2 * cam.zoom);
    ctx.beginPath();
    ctx.moveTo(mx + tx*bw + nx*bw, my + ty*bw + ny*bw);
    ctx.lineTo(mx - tx*bw + nx*bw, my - ty*bw + ny*bw);
    ctx.lineTo(mx - tx*bw - nx*bw, my - ty*bw - ny*bw);
    ctx.lineTo(mx + tx*bw - nx*bw, my + ty*bw - ny*bw);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    //   ★ハンドルには**握りの玉**を付ける。線だけだと、開（管に沿う向き）のときに
    //     管そのものと重なって向きが読めない（実測：縦の管で開にすると管の一部に見えた）。
    //     玉が管の外に出るので、どちらを向いているかが一目で分かる。
    const hx = open ? tx : nx, hy = open ? ty : ny;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';               // 下敷き（管の上でも輪郭が立つ）
    ctx.lineWidth = Math.max(6, 10 * cam.zoom);
    ctx.beginPath();
    ctx.moveTo(mx - hx*r, my - hy*r); ctx.lineTo(mx + hx*r, my + hy*r); ctx.stroke();
    ctx.strokeStyle = open ? '#81c784' : '#ef5350';
    ctx.lineWidth = Math.max(3, 6 * cam.zoom);
    ctx.beginPath();
    ctx.moveTo(mx - hx*r, my - hy*r); ctx.lineTo(mx + hx*r, my + hy*r); ctx.stroke();
    ctx.fillStyle = open ? '#81c784' : '#ef5350';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = Math.max(1, 2 * cam.zoom);
    ctx.beginPath(); ctx.arc(mx + hx*r, my + hy*r, Math.max(6, 9 * cam.zoom), 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
function drawGasChambers() {
  prunePistonVessels();      // ★部品を個別に消された容器を先に畳む（気体室もここで一緒に消える）
  pruneGasChambers();        // ★ピストンが消えた気体室はここで畳む（velgraph と同じ流儀）
  if (!gasChambers.length) return;
  drawGasLinks();            // ★管は気体の領域より先に（＝下に）描く
  for (const ch of gasChambers) {
    const p = ch.piston();
    if (!p) continue;
    const cs = ch.corners().map(c => worldToScreen(c.x, c.y));
    // ── 気体の領域 ──
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cs[0].x, cs[0].y);
    for (let i = 1; i < cs.length; i++) ctx.lineTo(cs[i].x, cs[i].y);
    ctx.closePath();
    // 温度で色をつける表示が入っていればそれに合わせる。ふつうは淡い水色
    // ★通気の室は塗らない。中は閉じ込めた気体ではなく外気そのもので、色を塗ると
    //   「ここに気体が入っている＝押し返してくる」と読まれる。塗らない筒＋動く蓋が、
    //   そのまま「ばねを持たない制動器」の絵になる。
    ctx.fillStyle = ch.vent ? 'rgba(0,0,0,0)'
      : (world.thermalOn && world.thermalViz)
        ? tempToColor(ch.T, 0.35) : 'rgba(38,198,218,0.13)';
    ctx.fill();
    // ★選択中の気体は枠を強調する。気体は objects に居ないので、物体の選択枠を描く
    //   仕組み（drawBody）には乗らない。押せるものだと分かるようここで描く。
    const picked = (selectedElement && selectedElement.kind === 'gas'
                    && selectedElement.chamber === ch);
    // ★通気の室は枠も描かない（選択中は別）。中身が無いので「気体の領域」を示す破線が
    //   指すものが無く、装置の絵に線が増えるだけになる。
    ctx.strokeStyle = picked ? '#4fc3f7' : 'rgba(38,198,218,0.45)';
    ctx.setLineDash([4, 3]); ctx.lineWidth = picked ? 2 : 1;
    if (picked || !ch.vent) ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // ★止め金は装置の一部なので、力の矢印のスイッチ（showForces）より先に描く。
    //   「いま定積か」は状態そのもので、力を出すかどうかとは関係がない。
    if (ch.pistonLocked && !ch.broken) _pistonLockMark(ch, p);

    if (!p.showForces) { _gasReadout(ch, cs); continue; }   // ★他の力と同じスイッチで出す

    // ── 面の幾何（画面座標）──
    const a = ch.axis(), nrm = { x: -a.y, y: a.x };
    const hw = ch.width / 2;
    const hPx = Math.max(ch.heightPx(), 0);
    const faceCx = ch.cx + a.x*hPx, faceCy = ch.cy + a.y*hPx;     // ピストン内側の面の中心
    const f0 = worldToScreen(faceCx - nrm.x*hw, faceCy - nrm.y*hw);
    const f1 = worldToScreen(faceCx + nrm.x*hw, faceCy + nrm.y*hw);
    const faceLen = Math.hypot(f1.x-f0.x, f1.y-f0.y);
    if (faceLen < 6) { _gasReadout(ch, cs); continue; }
    const ax = (f1.x-f0.x)/faceLen, ay = (f1.y-f0.y)/faceLen;      // 面に沿う向き（画面）
    const ux = a.x, uy = a.y;                                      // 軸の向きは回転しないので流用
    const sc = worldToScreen(faceCx + a.x*10, faceCy + a.y*10);
    const sc0 = worldToScreen(faceCx, faceCy);
    const dl = Math.hypot(sc.x-sc0.x, sc.y-sc0.y) || 1;
    const oax = (sc.x-sc0.x)/dl, oay = (sc.y-sc0.y)/dl;            // 画面上の軸の向き（単位）

    const lenOf = P => Math.max(GAS_ARROW_MIN,
                        Math.min(GAS_ARROW_MAX, P / 101325 * GAS_ARROW_PX_PER_ATM));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // ② 気体の圧力：内側の面から外向き（＝ピストンを押し出す向き）
    _gasFaceArrows(f0.x, f0.y, ax, ay, faceLen, oax, oay, lenOf(ch.P), GAS_COL_IN);
    // ② 大気圧：ピストンの外側の面から内向き
    const outCx = faceCx + a.x * _pistonThicknessPx(ch, p);
    const outCy = faceCy + a.y * _pistonThicknessPx(ch, p);
    const g0 = worldToScreen(outCx - nrm.x*hw, outCy - nrm.y*hw);
    _gasFaceArrows(g0.x, g0.y, ax, ay, faceLen, -oax, -oay, lenOf(world.atmPressure), GAS_COL_OUT);
    // ③ 大気はどこにでもある（薄い内向き矢印）。これらは打ち消し合う
    if (world.atmPressure > 0) _gasOutsideArrows(ch, hPx, lenOf(world.atmPressure) * 0.55);
    ctx.restore();
    _gasReadout(ch, cs);
  }
}
// ── ピストンを固定していることを示す止め金（定積変化）──────────────────
//   ★**物理には一切参加しない絵**。固定そのものは軸方向の1自由度を閉じることで
//     できていて（vessel.js ③ の solveVesselConstraint）、ここは状態の見た目だけを足す。
//     物体として置くと器の質量も当たり判定も変わってしまうので、描画だけで持つ。
//   ★**何に対して固定なのかが読める形**にする＝蓋の縁と器の壁にまたがる板を両脇に1枚ずつ、
//     ボルトを蓋側と器側に1本ずつ。世界に打った杭ではない（setGasPistonLocked の★と
//     同じ線引き：定積は「蓋を器に留める」であって「蓋を静的にする」ではない）。
//     以前は絵が無く、定積かどうかは右パネルのチェックを開くまで分からなかった。
//   ★寸法はワールドの px で持ち、4隅を worldToScreen に通す。画面 px で描くと、
//     倍率を下げたときに器より止め金のほうが大きくなる。
const GAS_LOCK_FILL = '#b0bec5';   // 止め金（明るい金属色。器の壁より明るくして手前に見せる）
const GAS_LOCK_LINE = '#37474f';   // 縁とボルト
function _pistonLockMark(ch, p) {
  const a = ch.axis(), n = { x: -a.y, y: a.x };
  const hw = ch.width / 2, t = _pistonThicknessPx(ch, p), hPx = Math.max(ch.heightPx(), 0);
  let d0 = hPx - 12, d1 = hPx + t + 44;              // 蓋の内側の面の手前 → 蓋を越えて器の壁へ渡す
  // ★器の口からはみ出させない。蓋が奥まで出ているときは、板ごと閉端側へずらす
  //   （はみ出したままだと、器の外に金具が浮いている絵になる）。
  const ves = (typeof pistonVesselOfChamber === 'function') ? pistonVesselOfChamber(ch.id) : null;
  const inner = ves ? ves.innerLen : d1;
  if (d1 > inner) { const over = d1 - inner; d0 -= over; d1 -= over; }
  const r0 = hw - 9, r1 = hw + VESSEL_WALL_PX + 8;   // 内径のすこし内側 → 壁の外側
  const P = (d, r, s) => worldToScreen(ch.cx + a.x*d + n.x*r*s, ch.cy + a.y*d + n.y*r*s);
  // ボルトの半径：ワールドの 5px が画面で何 px になるかを測って使う
  const c0 = worldToScreen(ch.cx, ch.cy), c1 = worldToScreen(ch.cx + n.x*5, ch.cy + n.y*5);
  const br = Math.max(1.2, Math.hypot(c1.x - c0.x, c1.y - c0.y));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const s of [1, -1]) {
    const q = [P(d0, r0, s), P(d1, r0, s), P(d1, r1, s), P(d0, r1, s)];
    ctx.beginPath();
    ctx.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y);
    ctx.closePath();
    ctx.fillStyle = GAS_LOCK_FILL; ctx.fill();
    ctx.strokeStyle = GAS_LOCK_LINE; ctx.lineWidth = 1; ctx.stroke();
    const rm = (r0 + r1) / 2;
    // 蓋側と器側に1本ずつ（板をずらしたときは板の中に収める）
    for (const d of [Math.min(Math.max(hPx + t/2, d0 + 10), d1 - 10), d1 - 12]) {
      const b = P(d, rm, s);
      ctx.beginPath(); ctx.arc(b.x, b.y, br, 0, Math.PI * 2);
      ctx.fillStyle = GAS_LOCK_LINE; ctx.fill();
    }
  }
  ctx.restore();
}
// ピストンの軸方向の厚み [px]
function _pistonThicknessPx(ch, p) {
  const a = ch.axis();
  if (p.type === 'circle') return p.radius * 2;
  let lo = Infinity, hi = -Infinity;
  for (const v of p._worldVerts()) {
    const d = (v.x - p.x)*a.x + (v.y - p.y)*a.y;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return hi - lo;
}
// シリンダーの側面と閉端の外側に、薄い内向き矢印を並べる
function _gasOutsideArrows(ch, hPx, alen) {
  const a = ch.axis(), n = { x: -a.y, y: a.x };
  const hw = ch.width / 2;
  const col = 'rgba(255,167,38,0.32)';
  const side = (sgn) => {
    const s0 = worldToScreen(ch.cx + n.x*hw*sgn, ch.cy + n.y*hw*sgn);
    const s1 = worldToScreen(ch.cx + a.x*hPx + n.x*hw*sgn, ch.cy + a.y*hPx + n.y*hw*sgn);
    const L = Math.hypot(s1.x-s0.x, s1.y-s0.y);
    if (L < 10) return;
    const dx = (s1.x-s0.x)/L, dy = (s1.y-s0.y)/L;
    const inx = -(-dy) * sgn, iny = -(dx) * sgn;        // 面から内側へ向かう向き（画面）
    _gasFaceArrows(s0.x, s0.y, dx, dy, L, inx, iny, alen, col);
  };
  side(1); side(-1);
  // 閉端
  const e0 = worldToScreen(ch.cx - n.x*hw, ch.cy - n.y*hw);
  const e1 = worldToScreen(ch.cx + n.x*hw, ch.cy + n.y*hw);
  const L = Math.hypot(e1.x-e0.x, e1.y-e0.y);
  if (L >= 10) {
    const dx = (e1.x-e0.x)/L, dy = (e1.y-e0.y)/L;
    const sc0 = worldToScreen(ch.cx, ch.cy);
    const sc1 = worldToScreen(ch.cx + a.x*10, ch.cy + a.y*10);
    const dl = Math.hypot(sc1.x-sc0.x, sc1.y-sc0.y) || 1;
    _gasFaceArrows(e0.x, e0.y, dx, dy, L, (sc1.x-sc0.x)/dl, (sc1.y-sc0.y)/dl, alen, col);
  }
}
// P・V・T の読み取り（気体領域の中央へ）
function _gasReadout(ch, cs) {
  let mx = 0, my = 0;
  for (const c of cs) { mx += c.x; my += c.y; }
  mx /= cs.length; my /= cs.length;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // 密閉が破れているときは、黙って止まるのではなく理由を出す
  // ★通気のときは何も出さない。中は外気そのもの（常に大気圧・外気温）で読み取る量が
  //   無いうえ、この状態の容器は「気体の器」ではなく制動器として置かれている。
  //   実測：天秤に2本置いたら、札が2枚ともさおの上に重なって本文より目立った。
  //   通気であることは、蓋を選んだときのチェックと、下の口の描き方で分かる。
  if (ch.vent && !ch.broken) { ctx.restore(); return; }
  const txt = ch.broken
    ? 'ピストンがシリンダーから外れています'
    : `${(ch.P/1000).toFixed(1)} kPa   ${(ch.V*1000).toFixed(1)} L   ${K2C(ch.T).toFixed(1)}℃`;
  const w = ctx.measureText(txt).width + 10;
  ctx.fillStyle = ch.broken ? 'rgba(60,30,20,0.85)' : 'rgba(20,24,32,0.72)';
  ctx.fillRect(mx - w/2, my - 9, w, 18);
  ctx.fillStyle = ch.broken ? '#ffab91' : '#b2ebf2';
  ctx.fillText(txt, mx, my);
  if (ch.label) {
    ctx.fillStyle = 'rgba(178,235,242,0.7)';
    ctx.fillText(ch.label, mx, my - 26);
  }
  ctx.restore();
}
