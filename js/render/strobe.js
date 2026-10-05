// ════════════════════════════════════════
//  ストロボ表示（多重露光）
//   一定のシミュレーション時間ごとに、物体の形をその場に残す。ストロボ写真そのもの。
//   等速なら間隔が一定、等加速度なら等差数列で開き、放物運動なら「水平は等間隔・
//   鉛直だけ開く」が一目で読める＝運動の分解がそのまま見える。
//
//  ★物理には一切参加しない。残像は座標と角度だけの記録で、objects にも入らないので
//    衝突・レーザー・熱・回路のどこからも見えない（注釈と同じ立場）。
//
//  ★露光の時刻は全物体で共有する（strobeNextT はグローバル）。物体ごとにタイマーを
//    持つと、置いた時刻の違いだけで像がずれ、「2つの落下を並べて比べる」という
//    いちばん使う実験が成立しなくなる（同じ瞬間の位置どうしを見比べられるのが要点）。
//
//  ★粒子（水・気体分子）は対象にしない。数が多く、1粒ずつの残像に意味が無いうえ、
//    画面が埋まって主役が見えなくなる。ロープの節点も同じ理由で対象外。

// この物体をストロボの対象にするか
function strobeTargets(b) {
  if (b.isStatic || b.frozen) return false;      // 動かないものは残像を出しても重なるだけ
  if (strobeTarget === 'selected') return selectedIds.has(b.id);
  return true;                                   // 'all'：動いている物体すべて
}
// 1 tick に一度呼ぶ。露光の時刻を跨いでいたら、対象の物体すべてを同時に写す。
function recordStrobe() {
  if (!strobeEnabled) return;
  // ★時刻が巻き戻ったら（やり直し・リセット・シーン読み込み）タイマーを取り直す。
  //   放っておくと simTime が strobeNextT に追いつくまで何も写らない。
  // ★半tickの余裕を持たせて「いちばん近いtick」で写す。simTime は dt を足し込んで作るので、
  //   例えば 0.1 秒後は 0.09999999999999999 になり、素直に < で比べると毎回1tick遅れる。
  //   さらに遅れは累積しないので最初の1枚だけ間隔が広くなり（実測：50px のところ 58.33px）、
  //   等間隔性を読むというこの機能の目的が最初の1区間で崩れていた。
  const EPS = SIM_DT * 0.5;
  if (world.simTime < strobeNextT - strobeInterval) strobeNextT = world.simTime;   // 時刻が巻き戻った
  if (world.simTime + EPS < strobeNextT) return;
  // 次の露光時刻へ進める。1フレームで何tickも進んだときに像が飛ばないよう、
  // 追いつくまで足す（ただし1回ぶんだけ写す＝同じ位置を重ねて描かない）
  while (strobeNextT <= world.simTime + EPS) strobeNextT += strobeInterval;
  // ★残像も軌跡と同じで、貯めるのはワールドの位置と角だけ。どの系で見せるかは
  //   描くときに決める（js/app/camera.js の姿勢の記録の★）。時刻も控える。
  for (const b of objects) {
    if (!strobeTargets(b)) continue;
    b.strobePoints.push({ x: b.x, y: b.y, angle: b.angle, t: world.simTime });
    if (b.strobePoints.length > STROBE_MAX) b.strobePoints.shift();
  }
}
// 残像を消す（リセット・新規作成・表示OFF から）
function clearStrobe() {
  for (const b of objects) if (b.strobePoints.length) b.strobePoints = [];
  strobeNextT = world.simTime;
}

// ─── 描画（物体より下。実物の物体が残像に隠れないように）───────────────
//   ★輪郭だけを描く。塗ると重なった残像で下が見えなくなり、間隔が読めなくなる。
//     色は物体の塗り色を使う（どの物体の残像かが分かる）。
const STROBE_ALPHA = 0.55;      // 残像の濃さ。★古い像でも下げない（先頭の★を参照）

// 残像1枚ずつに対して fn(b, w, ang) を呼ぶ（w はいま見ている系でのワールド位置）。
//   ★補助線と輪郭で2回まわすので共通化してある。カーソル（framePoseCursor）は
//     前へ進むだけの状態を持つので、1周ごとに作り直すこと。
function forEachStrobeGhost(fn) {
  const f = tracerFrameBody();   // ★向きごと固定したカメラがあれば、その物体から見た像を描く
  for (const b of objects) {
    const pts = b.strobePoints;
    if (!pts.length) continue;
    const poseAt = framePoseCursor(f);
    for (const p of pts) {
      let w = p, ang = p.angle;
      if (f) {
        const pose = poseAt(p.t);
        if (!pose) continue;                      // 姿勢の記録より前の像は直せない
        w = traceWorldFor(f, pose, p.x, p.y);
        // 向きも同じだけ回して見せる。★平行移動だけの系では回さない（記録した向きのまま）。
        //   ここで f.angle を足すと、回らない画面で残像だけが基準の物体の角ぶん傾く。
        ang = tracerFrameSpins() ? f.angle + (p.angle - pose.angle) : p.angle;
      }
      fn(b, w, ang);
    }
  }
}

// ─── 露光の位置に引く補助線（横線・縦線）──────────────────────────
//   ★線は物体の**中心**を通す（strobePoints が控えているのも中心）。輪郭のどこかに
//     合わせると、回っている物体では線の間隔が形の向きで揺れ、読み取りが歪む。
//   ★ワールドの軸に沿って引く（画面の縦横ではない）。回転カメラでも「横線＝重力に垂直」
//     が保たれる。矢印と同じで worldToScreenDir を必ず通す。
//   ★残像より薄く、輪郭より下に敷く。同じ濃さだと線が主役になって、肝心の像が読めない。
const STROBE_LINE_ALPHA = 0.28;
function drawStrobeLines() {
  if (!strobeHLine && !strobeVLine) return;
  const L = canvas.width + canvas.height;          // 画面を必ず跨ぐ長さ（画面外はcanvasが切る）
  const hd = worldToScreenDir(1, 0), vd = worldToScreenDir(0, 1);
  ctx.save();
  ctx.globalAlpha = STROBE_LINE_ALPHA;
  ctx.lineWidth = 1;                               // ★ズームに依らず1px。間隔を読む物差しなので細く
  forEachStrobeGhost((b, w) => {
    const sc = worldToScreen(w.x, w.y);
    ctx.strokeStyle = b.fillColor;
    ctx.beginPath();
    if (strobeHLine) { ctx.moveTo(sc.x - hd.x*L, sc.y - hd.y*L); ctx.lineTo(sc.x + hd.x*L, sc.y + hd.y*L); }
    if (strobeVLine) { ctx.moveTo(sc.x - vd.x*L, sc.y - vd.y*L); ctx.lineTo(sc.x + vd.x*L, sc.y + vd.y*L); }
    ctx.stroke();
  });
  ctx.restore();
}

function drawStrobeGhosts() {
  if (!strobeEnabled) return;
  drawStrobeLines();             // 補助線を先に敷く（輪郭が線に埋もれないように）
  ctx.save();
  ctx.globalAlpha = STROBE_ALPHA;
  forEachStrobeGhost((b, w, ang) => {
    ctx.strokeStyle = b.fillColor;
    const sc = worldToScreen(w.x, w.y);
    // 画面の外は描かない（残像は軌跡と同じく画面外へ伸びる）
    if (sc.x < -400 || sc.y < -400 || sc.x > canvas.width + 400 || sc.y > canvas.height + 400) return;
    ctx.save();
    ctx.translate(sc.x, sc.y);
    ctx.rotate(ang + cam.angle);   // ★カメラの回転ぶんを足す
    ctx.scale(cam.zoom, cam.zoom);
    ctx.lineWidth = 1.5 / cam.zoom;           // 拡大しても線の太さを一定に見せる
    ctx.beginPath();
    if (b.type === 'circle') {
      ctx.arc(0, 0, b.radius, 0, Math.PI*2);
      ctx.closePath();
    } else if (b.type === 'box') {
      ctx.rect(-b.w/2, -b.h/2, b.w, b.h);
    } else {
      // ★多角形は本物の輪郭を引く（円弧も弧のまま）。drawBody と同じ tracePolyLoop を通すので、
      //   図形和で作った形や光学素子でも見た目が実物と食い違わない。
      tracePolyLoop(ctx, b.verts, b, -1);
      if (b.holes) b.holes.forEach((h, k) => tracePolyLoop(ctx, h, b, k));
    }
    ctx.stroke();
    ctx.restore();
  });
  ctx.restore();
}
