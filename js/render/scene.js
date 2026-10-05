// ─── 見えているワールドの範囲 ───────────────────────────────
//   画面の四隅をワールドへ戻して外接箱をとる。カメラを回すと見える範囲は「傾いた長方形」に
//   なるので、その外接箱で数えれば、どんな角度でも線が画面の端まで届く。
//   ★未回転のときは四隅がそのまま長方形になるので、値は従来の halfW/halfH と一致する。
function visibleWorldBounds(pad) {
  const W = canvas.width, H = canvas.height;
  const c = [screenToWorld(0, 0), screenToWorld(W, 0), screenToWorld(0, H), screenToWorld(W, H)];
  const m = (pad || 0) / cam.zoom;
  return { x0: Math.min(...c.map(p => p.x)) - m, x1: Math.max(...c.map(p => p.x)) + m,
           y0: Math.min(...c.map(p => p.y)) - m, y1: Math.max(...c.map(p => p.y)) + m };
}
// ─── グリッド ────────────────────────────────────────────
//   ★線はワールドの x=一定 / y=一定 で引く（画面の縦横ではない）。カメラを回すと
//     方眼も一緒に傾く＝方眼はワールドに貼り付いた紙、という扱いで統一する。
//   ★1px にきっちり載せる丸め（+0.5）は、線が画面の縦横に沿っているときだけ意味がある。
//     斜めの線に効かせても効果がないので、回っているときは丸めない。
function drawGrid() {
  const gsW = gridStep();                 // [px] ワールド単位の間隔
  const gs  = gsW * cam.zoom;             // 画面上の間隔
  if (gs < 3) return;                     // 細かすぎるときは描かない（線で埋まるだけ）
  const emph  = gridSnapActiveNow() ? 1.7 : 1;    // スナップ中は少し濃くして格子点を見やすく
  const b = visibleWorldBounds();
  const crisp = cam.angle ? (v => v) : (v => Math.round(v) + 0.5);
  ctx.save();
  ctx.lineWidth = 1;
  const drawSet = (step, alpha) => {
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    for (let k = Math.ceil(b.x0/step); k*step <= b.x1; k++) {
      const p0 = worldToScreen(k*step, b.y0), p1 = worldToScreen(k*step, b.y1);
      ctx.beginPath(); ctx.moveTo(crisp(p0.x), p0.y); ctx.lineTo(crisp(p1.x), p1.y); ctx.stroke();
    }
    for (let k = Math.ceil(b.y0/step); k*step <= b.y1; k++) {
      const p0 = worldToScreen(b.x0, k*step), p1 = worldToScreen(b.x1, k*step);
      ctx.beginPath(); ctx.moveTo(p0.x, crisp(p0.y)); ctx.lineTo(p1.x, crisp(p1.y)); ctx.stroke();
    }
  };
  drawSet(gsW, Math.min(0.04*emph, 0.12));
  if (gs*5 >= 6) drawSet(gsW*5, Math.min(0.07*emph, 0.2));
  ctx.restore();
}
// ─── グリッドの目盛り（縦軸・横軸に「何 m か」を書く）──────────────────
//   ・置き場所は座標軸（x=0 / y=0）に沿わせ、軸が画面の外へ出たら画面端に貼り付ける。
//     こうしておくと、どこまでスクロールしても目盛りが読める（グラフソフトと同じ振る舞い）。
//   ・刻みはグリッド間隔の 1→2→5→10→… 倍のはしごで、隣の数字と GRID_LABEL_MIN_PX 以上
//     離れる最初の値を選ぶ。ズームしても数字の密度がほぼ一定になり、どの倍率でも
//     必ずグリッド線の上に数字が乗る（間隔がグリッド間隔の整数倍なので）。
//     ちょうど5倍のときは太線と一致する（既定の 0.3 m 刻み・等倍では 1.5 m ごと）。
//   ・単位は数字ごとに付ける。凡例を1か所に出す方式だと、投影した画面を離れて見たときに
//     「この数字は m か cm か」が分からなくなるため。
//   ★物体より上に描く（呼び出しは描画列の後ろ）。地面の塗りや大きな物体の下に潜ると
//     肝心の目盛りが読めなくなるので、ものさしとして常に手前に出す。
const GRID_LABEL_MIN_PX = 64;      // ラベル同士の最小間隔[画面px]（"−12.5m" が並んでも詰まらない）
function _gridLabelStep(base) {    // base[px] を、画面で十分離れる刻みまで 1-2-5 で広げる
  const need = GRID_LABEL_MIN_PX / cam.zoom;             // [px] 必要なワールド間隔
  for (let d = 0; d < 9; d++)
    for (const m of [1, 2, 5]) {
      const s = base * m * Math.pow(10, d);
      if (s >= need) return s;
    }
  return base * 1e9;
}
function _fmtGridM(v) {            // 0.15 → "0.15m" / 3 → "3m"（余分な0を出さない）
  return (+v.toFixed(3)) + 'm';
}
//   ★数字そのものは回さず、置き場所だけ軸に沿わせる。斜めの字は読みにくいうえ、
//     カメラが逆さ向きのときに数字が上下逆になる。
//   ★「軸が画面の外なら画面端に貼り付ける」は、点を画面の矩形へ丸めるだけで表せる。
//     未回転ならこれは従来の ax/ay のクランプとまったく同じ値になる。
//     ただし丸めが「軸に沿う向き」へ効いたときは、隣の数字と同じ場所へ寄って重なるので出さない
//     （未回転では軸に沿う向きへは丸まらないので、この枝に入らない＝従来どおり）。
function drawGridLabels() {
  const gsW = gridStep();
  if (gsW * cam.zoom < 3) return;                        // グリッド線が出ない条件と揃える
  const step = _gridLabelStep(gsW);
  const W = canvas.width, H = canvas.height;
  const b = visibleWorldBounds();
  const clampX = v => Math.max(0, Math.min(v, W));
  const clampY = v => Math.max(0, Math.min(v, H));
  ctx.save();
  ctx.font = '10px sans-serif';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';                   // 縁取り：地面や物体の上でも読めるように
  ctx.lineWidth = 3;
  const put = (s, x, y) => { ctx.strokeText(s, x, y); ctx.fillText(s, x, y); };
  const tickAt = (x0, y0, x1, y1) => {                   // 軸の上の短い目盛り線
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.restore();
  };
  // 軸の向きと、それに垂直な向き（目盛り線と数字のオフセットに使う）
  const along = (dx, dy) => worldToScreenDir(dx, dy);
  // ── 横軸（x座標）──
  const aX = along(1, 0), pX = along(0, 1);              // 軸に沿う向き／垂直な向き
  ctx.fillStyle = 'rgba(224,230,240,0.8)';
  ctx.textAlign = 'center';
  for (let k = Math.ceil(b.x0/step - 1e-9); k*step <= b.x1; k++) {
    const q = worldToScreen(k*step, 0);
    const cx = clampX(q.x), cy = clampY(q.y);
    if (Math.abs((cx - q.x)*aX.x + (cy - q.y)*aX.y) > 0.5) continue;   // 軸に沿ってずれた＝隣と重なる
    // ★目盛り線を 1px にきっちり載せる丸めは、軸が画面の縦横に沿っているときだけ効く
    const sx = cam.angle ? cx : Math.round(cx) + 0.5, sy = cy;
    tickAt(sx - pX.x*3, sy - pX.y*3, sx + pX.x*3, sy + pX.y*3);
    const below = sy < H - 18;                           // 軸の下に数字を置けるか
    ctx.textBaseline = below ? 'top' : 'bottom';
    put(_fmtGridM(k * step * PX2M), sx + pX.x*5*(below?1:-1), sy + pX.y*5*(below?1:-1));
  }
  // ── 縦軸（y座標。画面の上向きが正）──
  const aY = along(0, 1), pY = along(1, 0);
  ctx.textBaseline = 'middle';
  for (let k = Math.ceil(b.y0/step - 1e-9); k*step <= b.y1; k++) {
    if (k === 0) continue;                               // 原点の "0m" は横軸側に1つだけ出す
    const q = worldToScreen(0, k*step);
    const cx = clampX(q.x), cy = clampY(q.y);
    if (Math.abs((cx - q.x)*aY.x + (cy - q.y)*aY.y) > 0.5) continue;
    const sx = cx, sy = cam.angle ? cy : Math.round(cy) + 0.5;   // ★同上
    tickAt(sx - pY.x*3, sy - pY.y*3, sx + pY.x*3, sy + pY.y*3);
    const right = sx < W - 52;                           // 軸の右に数字を置けるか
    ctx.textAlign = right ? 'left' : 'right';
    put(_fmtGridM(yUI(k * step * PX2M)), sx + pY.x*6*(right?1:-1), sy + pY.y*6*(right?1:-1));
  }
  ctx.restore();
}
// ─── 原点と座標軸（x=0 / y=0）。数値パネルの位置・速度を画面上で読み解く基準 ───
//   ★軸もグリッドと同じくワールドの線として引く（カメラを回すと一緒に傾く）。
//     「画面内にあるか」は、見えているワールドの範囲に 0 が入るかで判定する。
//     未回転ならこれは従来の「原点の画面座標が 0〜W/H に入るか」と同じ条件になる。
function drawAxes() {
  const o = worldToScreen(0, 0);
  const W = canvas.width, H = canvas.height;
  const b = visibleWorldBounds();
  const onX = b.y0 <= 0 && 0 <= b.y1;    // y=0 の横軸が画面内にあるか
  const onY = b.x0 <= 0 && 0 <= b.x1;    // x=0 の縦軸が画面内にあるか
  if (!onX && !onY) return;
  const crisp = cam.angle ? (v => v) : (v => Math.round(v) + 0.5);
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';   // グリッド(0.04〜0.2)より濃く、物体より薄く
  if (onX) { const p0 = worldToScreen(b.x0, 0), p1 = worldToScreen(b.x1, 0);
             ctx.beginPath(); ctx.moveTo(p0.x, crisp(p0.y)); ctx.lineTo(p1.x, crisp(p1.y)); ctx.stroke(); }
  if (onY) { const p0 = worldToScreen(0, b.y0), p1 = worldToScreen(0, b.y1);
             ctx.beginPath(); ctx.moveTo(crisp(p0.x), p0.y); ctx.lineTo(crisp(p1.x), p1.y); ctx.stroke(); }
  if (onX && onY) {                       // 原点が見えているときだけ印と座標を出す
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(o.x, o.y, 4, 0, Math.PI*2); ctx.stroke();
    ctx.font = '11px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('O (0, 0)', o.x + 7, o.y - 7);
  }
  ctx.restore();
}
// ─── 重力に垂直な線（見かけの水平）───────────────────────────
//   重力X・Yを合成した向きに垂直で、原点を通る破線。重力を傾けたときに
//   「見かけの水平がどこか」を示す。原点から重力の向きへ短い矢印も出すので、
//   どちら側が下かも読める（線だけでは上下が決まらないため）。
//   ★重力が0のときは向きが定義できないので何も描かない。直前の向きを覚えて
//     出し続けると、無重力なのに地面の向きがあるように見えてしまう。
//     背景摩擦モード（真上から見下ろした水平面）は重力X・Yを0にして使うので、
//     そこで自動的に消えるのも都合が良い。
//   ★内部の y は下向きが正で、画面座標も下向きが正。よってワールドの向き
//     (dx, dy) は画面上でも同じ符号の向きになる（符号の反転は要らない）。
const GRAV_ARROW_PX = 64;      // 重力の向きを示す矢印の長さ[画面px]（拡大率によらず一定）
function drawGravityLine() {
  const g = Math.hypot(world.gravX, world.gravY);
  if (g < 1e-9) return;
  const u = worldToScreenDir(world.gravX / g, world.gravY / g);   // 見かけの鉛直（下向き）
  const ux = u.x, uy = u.y;
  const px = -uy, py = ux;                            // それに垂直＝見かけの水平
  const o = worldToScreen(0, 0);
  const L = Math.hypot(canvas.width, canvas.height);  // 画面を必ず横切る長さ（対角線ぶん）
  ctx.save();
  ctx.setLineDash([7, 5]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(239,83,80,0.55)';           // 重力の力ベクトルと同系色
  ctx.beginPath();
  ctx.moveTo(o.x - px*L, o.y - py*L);
  ctx.lineTo(o.x + px*L, o.y + py*L);
  ctx.stroke();
  ctx.setLineDash([]);                                // 矢印は実線で描く
  drawArrow(ctx, o.x, o.y, o.x + ux*GRAV_ARROW_PX, o.y + uy*GRAV_ARROW_PX, 'rgba(239,83,80,0.85)', 2);
  ctx.restore();
}
function drawInfiniteGround() {
  if (!world.terrain) return;
  const gcos = Math.cos(ground.angle), gsin = Math.sin(ground.angle);
  const margin = canvas.width / cam.zoom + 200;
  const wxLeft  = cam.x - margin;
  const wxRight = cam.x + margin;
  const wyLeft  = groundYAt(wxLeft);
  const wyRight = groundYAt(wxRight);
  const sLeft  = worldToScreen(wxLeft,  wyLeft);
  const sRight = worldToScreen(wxRight, wyRight);
  ctx.save();
  const sDeep = canvas.height + 200;
  ctx.beginPath();
  ctx.moveTo(sLeft.x,  sLeft.y);
  ctx.lineTo(sRight.x, sRight.y);
  ctx.lineTo(sRight.x, sDeep);
  ctx.lineTo(sLeft.x,  sDeep);
  ctx.closePath();
  ctx.fillStyle = ground.fillColor;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(sLeft.x,  sLeft.y);
  ctx.lineTo(sRight.x, sRight.y);
  ctx.strokeStyle = ground.strokeColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  const hatchStep = 30;
  const hatchLen  = 16;
  const screenDist = sRight.x - sLeft.x;
  const steps = Math.ceil(screenDist / hatchStep) + 2;
  for (let i = 0; i <= steps; i++) {
    const sx = sLeft.x + i * hatchStep;
    const t = (sx - sLeft.x) / (sRight.x - sLeft.x + 0.001);
    const sy = sLeft.y + t * (sRight.y - sLeft.y);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - hatchLen * gsin * 0.5 + hatchLen * gcos * 0.5,
               sy + hatchLen * gcos * 0.5 + hatchLen * gsin * 0.5);
    ctx.stroke();
  }
  ctx.restore();
}
// ─── ワールド ⇄ 画面 ────────────────────────────────────────
//   ★点の変換はこの2つだけが持つ。描画も入力もほぼ全部ここを通るので、
//     カメラの回転（cam.angle）もここへ入れれば大半は自動で追随する。
//   ★cam.angle が 0 のときは回転の計算に入らない。既定はこちらで、43デモすべてが
//     この経路を通る＝回転を足したことで既存の見た目が変わらないことを保証する。
function worldToScreen(x, y) {
  const dx = (x - cam.x)*cam.zoom, dy = (y - cam.y)*cam.zoom;
  if (!cam.angle) return { x: dx + canvas.width/2, y: dy + canvas.height/2 };
  const c = Math.cos(cam.angle), s = Math.sin(cam.angle);
  return { x: dx*c - dy*s + canvas.width/2, y: dx*s + dy*c + canvas.height/2 };
}
// カメラの回転だけを掛けずにワールド→画面。
//   ★「カメラの回転で回さない」注釈（説明文の札）のためにある。回転カメラで注釈まで回すと、
//     デモの本文が世界と一緒に回って読めなくなる。位置・拡大率は普通に効く＝パンやズームには
//     ちゃんと付いてくる。cam.angle が 0 のときは worldToScreen と同じ値を返す。
function worldToScreenFlat(x, y) {
  return { x: (x - cam.x)*cam.zoom + canvas.width/2, y: (y - cam.y)*cam.zoom + canvas.height/2 };
}
function screenToWorld(sx, sy) {
  const ux = (sx - canvas.width/2)/cam.zoom, uy = (sy - canvas.height/2)/cam.zoom;
  if (!cam.angle) return { x: ux + cam.x, y: uy + cam.y };
  const c = Math.cos(cam.angle), s = Math.sin(cam.angle);   // 逆回転（-angle）＝ s の符号だけ反転
  return { x: ux*c + uy*s + cam.x, y: -ux*s + uy*c + cam.y };
}
// ワールドの「向き」を画面の向きへ。点ではなくベクトル（矢印の向き・破線の方向）に使う。
//   ★worldToScreen は点の変換なので、「始点＋成分×長さ」で矢印を描いている所は必ずこちらを
//     通すこと。通し忘れると、カメラを回したときに矢印だけが回らない
//     （実際、最初は重力の矢印が画面の真下を指したままだった）。
function worldToScreenDir(vx, vy) {
  if (!cam.angle) return { x: vx, y: vy };
  const c = Math.cos(cam.angle), s = Math.sin(cam.angle);
  return { x: vx*c - vy*s, y: vx*s + vy*c };
}
// ワールドの軸に沿った矩形（中心 cx,cy・幅 w・高さ h）を画面のパスにする。
//   ★領域（電場・磁場／加熱冷却／流れの場／気体室）はどれも「ワールドで軸に沿った矩形」。
//     画面の矩形（fillRect）で描くと、カメラを回したとき枠だけ傾かず、中の物体と食い違う。
//     4つの角を1つずつ worldToScreen に通せば、回しても中身と枠がずれない。
//   ★未回転なら結果は fillRect と同じ矩形になる。
//   戻り値は4隅の画面座標（左上→右上→右下→左下）。ラベルの置き場所に使う。
function worldRectPath(ctx, cx, cy, w, h) {
  const hw = w/2, hh = h/2;
  const q = [worldToScreen(cx-hw, cy-hh), worldToScreen(cx+hw, cy-hh),
             worldToScreen(cx+hw, cy+hh), worldToScreen(cx-hw, cy+hh)];
  ctx.beginPath();
  ctx.moveTo(q[0].x, q[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y);
  ctx.closePath();
  return q;
}
function drawArrow(ctx, startX, startY, endX, endY, color, width = 2) {
  const headlen = 10;  
  const dx = endX - startX;
  const dy = endY - startY;
  const angle = Math.atan2(dy, dx);
  
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.lineTo(endX - headlen * Math.cos(angle - Math.PI / 6), endY - headlen * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - headlen * Math.cos(angle + Math.PI / 6), endY - headlen * Math.sin(angle + Math.PI / 6));
  
  ctx.strokeStyle = color;
  ctx.lineWidth = width;   // ← 2 固定から変更
  ctx.stroke();
}
// 多角形ループを法線方向へ delta だけ外側オフセット（凹凸に沿う正しい膨張）
function offsetLoopOutward(loop, delta) {
  if (typeof ClipperLib === 'undefined' || !loop || loop.length < 3) return loop;
  const S = 100;
  const path = loop.map(p => ({ X: Math.round(p.x * S), Y: Math.round(p.y * S) }));
  const co = new ClipperLib.ClipperOffset(2.0, 0.25); // miterLimit=2.0
  co.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const sol = new ClipperLib.Paths();
  co.Execute(sol, delta * S);
  if (!sol.length) return loop;
  // 最大面積のリングを採用（自己交差形状で複数出た場合の保険）
  let best = sol[0], bestA = -1;
  for (const p of sol) {
    let a = 0;
    for (let i = 0; i < p.length; i++) { const u = p[i], v = p[(i+1)%p.length]; a += u.X*v.Y - v.X*u.Y; }
    a = Math.abs(a);
    if (a > bestA) { bestA = a; best = p; }
  }
  return best.map(q => ({ x: q.X / S, y: q.Y / S }));
}
// AABB が画面外の物体は描かない（マージンは噴射炎・バッジ・選択枠のはみ出しぶん）
function bodyInView(b) {
  const m = 40 + 60 / cam.zoom;
  const hw = canvas.width / (2 * cam.zoom), hh = canvas.height / (2 * cam.zoom);
  const a = b._aabb;
  return !(a.maxX < cam.x - hw - m || a.minX > cam.x + hw + m ||
           a.maxY < cam.y - hh - m || a.minY > cam.y + hh + m);
}
