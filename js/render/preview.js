function drawParticles() {
  if (!particles.length) return;
  const hw = canvas.width/(2*cam.zoom), hh = canvas.height/(2*cam.zoom);
  const vMinX = cam.x-hw-10, vMaxX = cam.x+hw+10, vMinY = cam.y-hh-10, vMaxY = cam.y+hh+10;
  const viz = world.thermalOn && world.thermalViz;      // ★温度で色をつける
  const smooth = world.waterSmooth;      // ★塊で描く水は render() が物体より奥に先に敷いてある
  for (const p of particles) {
    if (p.x < vMinX || p.x > vMaxX || p.y < vMinY || p.y > vMaxY) continue;
    // ★塊で描くときも、印を付けた水の粒だけは点で重ねる（下の★と同じ理由：
    //   印は「この粒がどこへ行くかを見たい」という指定なので、塊に溶かさない）
    if (smooth && p.type === 'fluid' && p.color === p.prm.color) continue;
    const s = worldToScreen(p.x, p.y);
    ctx.beginPath();
    // ★分子は衝突半径（0.5px＝理想気体の「分子の大きさは無視する」）と描画の大きさが別。
    //   drawRadius を持つのは分子だけで、その意図は molecule.js の注に書いてある。
    ctx.arc(s.x, s.y, (p.prm.drawRadius || p.radius)*cam.zoom, 0, Math.PI*2);
    // ★印を付けた粒子（p.color を型の既定から変えたもの）は、温度で着色していても
    //   印の色で描く。印を付けるのは「この粒子は温度ではなく、どこへ行くかを見たい」
    //   という指定だからで、粒子1つずつどちらで描くかが決まる＝1つのシーンで
    //   両方を見せられる（不可逆変化のデモは箱の温度を色で見せながら気体を混ぜている）。
    ctx.fillStyle = (viz && p.color === p.prm.color) ? tempToColor(p.T, p.prm.vizAlpha) : p.color;
    ctx.fill();
  }
  // ★軌跡は粒子より**あと**に描く。先に描くと、あとから塗る水の粒（不透明）が
  //   線をほぼ全部隠してしまう（実測：水中を通った線は、水の中では見えなかった）。
  drawParticleTraces();
}
// ── 水をひとつながりの塊として描く（表示 ▸ 水をなめらかに描く。world.waterSmooth の★）──
//   粒から「水らしさ」の場を格子に積み、その等高線（マーチングスクエア）で囲った形を
//   1本のパスで塗る。**物理には何も触らない**（粒の位置を読むだけ）。
//   ★場は2つの和集合：
//     A＝塊の場 Σ(1−q²)²（q＝距離/R、R＝1.5間隔）。しきい値 WATER_T_SURF は、六角に詰まった
//        平らな水面で等高線が「最上の粒の中心＋半行（0.465間隔）」＝面積どおりの水面に来る値
//        （1.171。六角格子で数値的に求めた）。水の中の値は 2.42、粒が1個抜けた所でも 1.42 で
//        しきい値を割らない＝格子の空きが泡に見えない。
//     B＝粒1個ずつの円（半径 0.5間隔）。A は粒1個だと最大 1 でしきい値に届かず、しぶきが
//        消えてしまうので、離れた粒はこちらで出す。水面では円が粒の中心の 0.035間隔
//        （0.4px）上までしか出ないので、並びの凸凹は見えない。
//   ★ぼかし（ctx.filter の blur）を使わない。GPU の無い描画では浮力デモ（水630個）で
//     1フレーム 30〜38ms かかった（点で描くと 2.4ms）。格子は世界座標で切るので、
//     倍率を変えても形は（格子の細かさの範囲で）変わらない。
//   ★物体・地面より奥に敷く（render() の★）。等高線が壁に少し潜っても壁が隠す。
const WATER_R = 1.5, WATER_T_SURF = 1.171, WATER_DROP_R = 0.35, WATER_REACH = 0.6;
let _wA = new Float32Array(0), _wB = new Float32Array(0), _wT = new Float32Array(0);
let _wCv = null, _wCx = null, _wLut = null, _wLutKey = '';
// 温度の色（tempToColor）を 256 段の表にする。範囲を変えたときだけ作り直す
function _waterColorLut() {
  const lo = world.thermalVizMin, hi = world.thermalVizMax, key = lo + ':' + hi;
  if (_wLut && _wLutKey === key) return _wLut;
  _wLut = new Uint8Array(256 * 3); _wLutKey = key;
  for (let i = 0; i < 256; i++) {
    const m = tempToColor(C2K(lo + (hi - lo) * i / 255)).match(/\d+/g);
    _wLut[i*3] = +m[0]; _wLut[i*3+1] = +m[1]; _wLut[i*3+2] = +m[2];
  }
  return _wLut;
}
function drawWaterSmooth() {
  if (!particles.length) return;
  const W = canvas.width, H = canvas.height, z = cam.zoom;
  const viz = world.thermalOn && world.thermalViz;
  const sp = Math.sqrt(PARTICLE_TYPES.fluid.restArea);
  const R = WATER_R * sp, R2 = R*R;
  // 格子の間隔：画面で 4px 前後。粗すぎ（間隔の1/3）・細かすぎ（1/8）は切る
  const c = Math.max(sp/8, Math.min(sp/3, 4/z));
  // ── 1) 描く粒と範囲（見えている範囲＋R） ──
  const hw = W/(2*z), hh = H/(2*z), ext = Math.hypot(hw, hh) + R + c;   // ★回したカメラでも欠けない
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  for (const p of particles) {
    if (p.type !== 'fluid' || p.color !== p.prm.color) continue;
    if (Math.abs(p.x - cam.x) > ext || Math.abs(p.y - cam.y) > ext) continue;
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    n++;
  }
  if (!n) return;
  x0 -= R + c; y0 -= R + c; x1 += R + c; y1 += R + c;
  const nx = Math.ceil((x1 - x0)/c) + 1, ny = Math.ceil((y1 - y0)/c) + 1;
  if (nx * ny > 4e6) return;                           // 異常な広がり（飛び散った粒）では描かない
  const N = nx * ny;
  if (_wA.length < N) { _wA = new Float32Array(N); _wB = new Float32Array(N); _wT = new Float32Array(N); }
  const A = _wA, B = _wB, TT = _wT;
  A.fill(0, 0, N); B.fill(0, 0, N); if (viz) TT.fill(0, 0, N);
  // ── 2) 場を積む ──
  const rd2 = (WATER_DROP_R*sp) ** 2;
  for (const p of particles) {
    if (p.type !== 'fluid' || p.color !== p.prm.color) continue;
    if (Math.abs(p.x - cam.x) > ext || Math.abs(p.y - cam.y) > ext) continue;
    const i0 = Math.max(0, Math.ceil((p.x - R - x0)/c)), i1 = Math.min(nx-1, Math.floor((p.x + R - x0)/c));
    const j0 = Math.max(0, Math.ceil((p.y - R - y0)/c)), j1 = Math.min(ny-1, Math.floor((p.y + R - y0)/c));
    for (let j = j0; j <= j1; j++) {
      const dy = y0 + j*c - p.y, row = j*nx;
      for (let i = i0; i <= i1; i++) {
        const dx = x0 + i*c - p.x, d2 = dx*dx + dy*dy;
        if (d2 >= R2) continue;
        const u = 1 - d2/R2, k = u*u;
        A[row+i] += k;
        if (viz) TT[row+i] += k * p.T;
        // B は「円の中なら 1 以上」になるよう、円の縁で 1 になる一次式で持つ
        const v = 1 + (rd2 - d2) / rd2;
        if (v > B[row+i]) B[row+i] = v;
      }
    }
  }
  // ── 物体に接する水を物体まで届かせる ──
  //   ★粒は物体から半径（5px）離れて止まるので、等高線が物体の手前で終わり、浮いた板の下に
  //     黒い筋が出た＝水と板の間に空気の層があるように見えた。場がしきい値の半分以上あって、
  //     WATER_REACH 以内に物体がある点だけ水に数える（物体の中は物体が上に塗るので見えない）。
  //     自由な水面（近くに物体が無い）は変わらない。
  const reach = WATER_REACH * sp;
  const near = [];
  for (const o of objects) {
    if (_ghostBody(o)) continue;
    const ab = o._aabb;
    if (ab.maxX < x0 || ab.minX > x1 || ab.maxY < y0 || ab.minY > y1) continue;
    near.push(o);
  }
  if (near.length) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j*nx + i, a = A[k] / WATER_T_SURF;
    if (a < 0.5 || a >= 1 || B[k] >= 1) continue;
    const x = x0 + i*c, y = y0 + j*c;
    for (const o of near) {
      const ab = o._aabb;
      if (x < ab.minX - reach || x > ab.maxX + reach || y < ab.minY - reach || y > ab.maxY + reach) continue;
      if (o.containsPoint(x, y) || o.containsPoint(x + reach, y) || o.containsPoint(x - reach, y)
          || o.containsPoint(x, y + reach) || o.containsPoint(x, y - reach)) { B[k] = 1; break; }
    }
  }
  // 値 ≥ 1 が水。A と B の大きいほう（和集合）
  const val = (idx) => { const a = A[idx] / WATER_T_SURF, b = B[idx]; return a > b ? a : b; };
  // ── 3) 等高線で囲った形を1本のパスに ──
  //   ★全部水のセルは行ごとに長方形へまとめる（部分パスの数を抑える）。
  //   ★closePath は呼ばない（O(N²)。fill が閉じる）。向きは全部同じなので非ゼロ規則で継ぎ目が出ない
  ctx.save();
  const co = Math.cos(cam.angle || 0), si = Math.sin(cam.angle || 0);
  ctx.setTransform(z*co, z*si, -z*si, z*co,
                   W/2 - z*(co*cam.x - si*cam.y), H/2 - z*(si*cam.x + co*cam.y));
  ctx.beginPath();
  const ix = (va, vb) => { const d = vb - va; return d === 0 ? 0.5 : (1 - va) / d; };
  for (let j = 0; j < ny - 1; j++) {
    let run = -1;
    const yA = y0 + j*c, yB = yA + c;
    for (let i = 0; i < nx - 1; i++) {
      const k00 = j*nx + i, v00 = val(k00), v10 = val(k00+1), v11 = val(k00+nx+1), v01 = val(k00+nx);
      const full = v00 >= 1 && v10 >= 1 && v11 >= 1 && v01 >= 1;
      if (full) { if (run < 0) run = i; continue; }
      if (run >= 0) { ctx.rect(x0 + run*c, yA, (i - run)*c, c); run = -1; }
      if (v00 < 1 && v10 < 1 && v11 < 1 && v01 < 1) continue;
      // 角を 00→10→11→01 の順にたどり、中の角と辺の交点を順に結ぶ
      const xA = x0 + i*c, xB = xA + c;
      const cx = [xA, xB, xB, xA], cy = [yA, yA, yB, yB], cv = [v00, v10, v11, v01];
      let first = true;
      for (let q = 0; q < 4; q++) {
        const r2 = (q + 1) & 3, va = cv[q], vb = cv[r2];
        if (va >= 1) { first ? ctx.moveTo(cx[q], cy[q]) : ctx.lineTo(cx[q], cy[q]); first = false; }
        if ((va >= 1) !== (vb >= 1)) {
          const t = ix(va, vb);
          const px = cx[q] + (cx[r2] - cx[q])*t, py = cy[q] + (cy[r2] - cy[q])*t;
          first ? ctx.moveTo(px, py) : ctx.lineTo(px, py); first = false;
        }
      }
    }
    if (run >= 0) ctx.rect(x0 + run*c, yA, (nx - 1 - run)*c, c);
  }
  if (!viz) {
    ctx.fillStyle = ctx.strokeStyle = PARTICLE_TYPES.fluid.color;
    ctx.fill();
    // ★同じ色で細く縁取る。セル片どうしの継ぎ目がアンチエイリアスで細く透け、中倍率で
    //   水面に黒いギザギザが並んで見えた（塗りだけでは埋まらない）
    ctx.lineWidth = 1 / z;
    ctx.stroke();
  } else {
    // ★温度は場の重み付き平均 ΣkT/Σk で塗る（粒ごとの色の継ぎはぎにすると並びが透けて見える）。
    //   格子1点＝1画素の小さな画像に書いて、拡大して1回で貼る（補間で色もなめらかになる）。
    //   セルごとに fillRect すると対流のデモ（水779個）で 1フレーム 29ms かかった
    ctx.clip();
    if (!_wCv) { _wCv = document.createElement('canvas'); _wCx = _wCv.getContext('2d'); }
    if (_wCv.width < nx || _wCv.height < ny) {
      _wCv.width = Math.max(_wCv.width, nx); _wCv.height = Math.max(_wCv.height, ny);
    }
    const img = _wCx.createImageData(nx, ny), d = img.data;
    const lut = _waterColorLut(), lo = world.thermalVizMin, hi = world.thermalVizMax;
    for (let k = 0; k < N; k++) {
      if (A[k] <= 0) continue;
      let u = hi > lo ? (K2C(TT[k] / A[k]) - lo) / (hi - lo) : 0.5;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const q = (u * 255 + 0.5) | 0, o = k*4;
      d[o] = lut[q*3]; d[o+1] = lut[q*3+1]; d[o+2] = lut[q*3+2]; d[o+3] = 255;
    }
    _wCx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(_wCv, 0, 0, nx, ny, x0 - c/2, y0 - c/2, nx*c, ny*c);
  }
  ctx.restore();
}
// ── 粒子の軌跡 ────────────────────────────────────────────────
//   ★画面の外は端折らない。折れ線は途中を捨てると別の形になる（物体の軌跡と同じ扱い）。
//     軌跡を付けるのは数個の粒子なので、点の数は物体1つぶんと変わらない。
//   ★いまいる場所に丸を重ねる。線だけだと、どの粒子の道すじなのかが分からない。
function drawParticleTraces() {
  for (const p of particles) {
    if (!p.tracerEnabled || !p.tracePoints || p.tracePoints.length < 2) continue;
    ctx.save();
    ctx.strokeStyle = p.tracerColor || tracerColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < p.tracePoints.length; i++) {
      const q = p.tracePoints[i], s = worldToScreen(q.x, q.y);
      if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
    }
    ctx.stroke();
    const s = worldToScreen(p.x, p.y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(3, p.radius*cam.zoom + 1.5), 0, Math.PI*2);
    ctx.fillStyle = p.tracerColor || tracerColor;
    ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }
}
// ── 温度の色目盛り（画面左下）────────────────────────────────────
//   色だけでは何度か読めないので、範囲と中間の目盛りを添える。
//   範囲は世界タブの「色の下端／上端」で変えられる。
function drawThermalLegend() {
  if (!(world.thermalOn && world.thermalViz)) return;
  const W = 160, H = 12, x = 16, y = canvas.height - 46;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const lo = world.thermalVizMin, hi = world.thermalVizMax;
  for (let i = 0; i < W; i++) {                       // 色帯（1px ずつ塗る）
    ctx.fillStyle = tempToColor(C2K(lo + (hi - lo) * i / (W - 1)));
    ctx.fillRect(x + i, y, 1, H);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, W - 1, H - 1);
  ctx.fillStyle = '#ddd';
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'top';
  // ★小数の桁は範囲の広さで決める。整数固定だと、狭い範囲にしたとき3つとも同じ数字に
  //   なって目盛りの用をなさない（ジュールの実験は 20.0〜20.2℃ の幅で使う）。
  const span = Math.abs(hi - lo);
  const dec = span >= 20 ? 0 : span >= 2 ? 1 : 2;
  const f = v => v.toFixed(dec) + '℃';
  ctx.textAlign = 'left';   ctx.fillText(f(lo), x, y + H + 3);
  ctx.textAlign = 'center'; ctx.fillText(f((lo + hi) / 2), x + W / 2, y + H + 3);
  ctx.textAlign = 'right';  ctx.fillText(f(hi), x + W, y + H + 3);
  ctx.restore();
}
function drawPreview() {
  ctx.save();
  ctx.strokeStyle = '#4fc3f7';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5,4]);
  if (currentTool === 'pan') {
    if (activeMouseJoint) {
      const b = activeMouseJoint.body;
      const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
      const gx = b.x + activeMouseJoint.localX * cos - activeMouseJoint.localY * sin;  // 掴んだ点（物体に固定）
      const gy = b.y + activeMouseJoint.localX * sin + activeMouseJoint.localY * cos;
      const sg = worldToScreen(gx, gy);
      const st = worldToScreen(activeMouseJoint.targetX, activeMouseJoint.targetY);    // 目標点（マウス）
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(79,195,247,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sg.x, sg.y); ctx.lineTo(st.x, st.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(sg.x, sg.y, 4, 0, Math.PI*2);   // 掴んだ点のマーカー
      ctx.fillStyle = '#4fc3f7'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if ((currentTool==='polygon' || currentTool==='freehand') && drawPts.length > 0) {
    const mp = (currentTool === 'polygon') ? snapPlace(mouseWorld) : mouseWorld;
    const sp = worldToScreen(mp.x, mp.y);
    if (drawPts.length >= 2) {
      ctx.save();
      ctx.setLineDash([]);
      ctx.beginPath();
      const p0s = worldToScreen(drawPts[0].x, drawPts[0].y);
      ctx.moveTo(p0s.x, p0s.y);
      for (let i = 1; i < drawPts.length; i++) {
        const ps = worldToScreen(drawPts[i].x, drawPts[i].y);
        ctx.lineTo(ps.x, ps.y);
      }
      ctx.lineTo(sp.x, sp.y);
      ctx.closePath();
      ctx.fillStyle = drawProps.fillColor.startsWith('rgba')
        ? drawProps.fillColor.replace(/[\d.]+\)$/, '0.18)')
        : hexToRgba(drawProps.fillColor, 0.18);
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    const p0 = worldToScreen(drawPts[0].x, drawPts[0].y);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < drawPts.length; i++) {
      const p = worldToScreen(drawPts[i].x, drawPts[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.lineTo(sp.x, sp.y);
    ctx.stroke();
    // ★始点まで戻ると閉じて確定できる。分かるように、閉じられる状態のときは
    //   始点へ向かう線を実線＋明るい色にし、始点マーカーを大きく光らせる。
    const canClose = canCloseDrawing(mp);
    if (drawPts.length >= 2 && currentTool === 'polygon') {
      ctx.save();
      ctx.setLineDash(canClose ? [] : [3, 6]);
      ctx.strokeStyle = canClose ? 'rgba(255,213,79,0.95)' : 'rgba(79,195,247,0.4)';
      ctx.lineWidth = canClose ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(p0.x, p0.y);
      ctx.stroke();
      ctx.restore();
    }
    ctx.setLineDash([]);
    for (let i = 0; i < drawPts.length; i++) {
      const ps = worldToScreen(drawPts[i].x, drawPts[i].y);
      const hi = (i === 0 && canClose);
      const r = hi ? 9 : (i === 0 ? 6 : 4);
      if (hi) {                                   // 閉じられる合図：始点のまわりに輪
        ctx.beginPath();
        ctx.arc(ps.x, ps.y, r + 4, 0, Math.PI*2);
        ctx.strokeStyle = 'rgba(255,213,79,0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(ps.x, ps.y, r, 0, Math.PI*2);
      ctx.fillStyle = i === 0 ? '#ffd54f' : '#4fc3f7';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 3, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(79,195,247,0.7)';
    ctx.fill();
    ctx.save();
    ctx.setLineDash([]);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#4fc3f7';
    ctx.fillText(`頂点 ${drawPts.length}  ダブルクリックで確定`, sp.x + 10, sp.y - 8);
    ctx.restore();
    ctx.restore();
    return;
  }
  if (currentTool==='spring' || currentTool==='rope' || currentTool==='rod') {
    if (jointStart) {
      // ★1打目が地面の上なら localX/localY は「地面のローカル座標」（physics/joint.js）
      const wA = jointEndWorld(jointStart.body, jointStart.onGround, jointStart.localX, jointStart.localY);
      const s = worldToScreen(wA.x, wA.y);
      let mp = snapPlace(mouseWorld);                 // 確定時（placed）と同じ規則にそろえる
      if (modShift) mp = angleSnappedPoint(wA, mp);   // spring/rope/rod すべてで角度スナップ
      const sp = worldToScreen(mp.x, mp.y);
      
      if (currentTool === 'spring') {
        drawSpringLine(s, sp, 'rgba(255, 213, 79, 0.6)');
      } else if (currentTool === 'rope') {
        ctx.strokeStyle = 'rgba(141, 110, 99, 0.6)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4,4]);
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(sp.x, sp.y); ctx.stroke();
      } else if (currentTool === 'rod') {
        ctx.strokeStyle = 'rgba(96, 125, 139, 0.6)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(sp.x, sp.y); ctx.stroke();
      }
    }
    ctx.restore();
    return;
  }
  if (currentTool === 'velocity') {
    if (velStart) {
      const aim = velocityAimNow();      // ★狙う方式か（設定 ± Alt）
      const info = computeLaunchVelocity(velStart, mouseWorld, modShift, aim);
      const s = worldToScreen(velStart.x, velStart.y);
      const vTargets = velocityTargets(velStart.body);   // ★この初速が適用される物体
      if (vTargets.length > 1) {                          //   複数のときだけ対象を明示する
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = 'rgba(102,187,106,0.8)';
        ctx.lineWidth = 1.5;
        for (const tb of vTargets) {
          const a = tb._aabb;
          const p0 = worldToScreen(a.minX, a.minY), p1 = worldToScreen(a.maxX, a.maxY);
          ctx.strokeRect(p0.x - 2, p0.y - 2, (p1.x - p0.x) + 4, (p1.y - p0.y) + 4);
        }
        ctx.restore();
      }
      ctx.setLineDash([]);
      if (info.speed > 1e-6) {
        // ★予測軌道。重力・万有引力・静電気力・ローレンツ力（＋抗力・動力・ガイド）だけを
        //   本番と同じ刻みで積分した線。矢印より先に描いて下に敷く。
        //   （速度ツール設定でOFFにできる。答えを先に見せたくない授業向け）
        if (velocityShowPrediction) drawPredictedPaths(predictTrajectories(vTargets, info.vx, info.vy));
        const dl = Math.hypot(info.vx, info.vy) || 1;                  // ★内部速度[px/s]から単位ベクトルを作る
        const dirx = info.vx / dl, diry = info.vy / dl;                //   （旧 /info.speed は m/s 割りで長さが100倍だった）
        const pullPx  = (info.speed / VEL_SCALE) * cam.zoom;           // ゴム＝実際のドラッグ距離
        const arrowPx = Math.max(10, info.speed * world.velVizScale);  // 矢印＝「速度を表示」と同じ倍率
        const sd = worldToScreenDir(dirx, diry);                       // ★向きはカメラの回転を通す
        const ex = s.x + sd.x * arrowPx, ey = s.y + sd.y * arrowPx;
        drawArrow(ctx, s.x, s.y, ex, ey, '#66bb6a', 2);       // 発射方向
        // ドラッグの線（点線）。カーソルの側へ引く＝引っぱる方式では発射方向の逆、
        // 狙う方式では発射方向と同じ側になる。どちらも「線の長さ＝速さ」で読み方は同じ。
        const gs = aim ? 1 : -1;
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.setLineDash([4,4]);
        ctx.beginPath(); ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + gs*dirx*pullPx, s.y + gs*diry*pullPx); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '12px sans-serif';                         // 発射角・速度の表示
        ctx.fillStyle = '#66bb6a';
        const vTag = vTargets.length > 1 ? `  ×${vTargets.length}個` : '';
        const aimTag = aim ? '  【狙う】' : '';               // 向きが逆になる方式なので必ず明示する
        ctx.fillText(`${info.dispDeg.toFixed(1)}°  v=${info.speed.toFixed(2)} m/s${vTag}${aimTag}`,
                     ex + 10, ey - 8);
      }
      ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI*2);    // 掴み点マーカー
      ctx.fillStyle = '#66bb6a'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (currentTool === 'thruster') {
    if (thrusterStart) {
      const aw = getWorldAnchor(thrusterStart.body, thrusterStart.localX, thrusterStart.localY);
      const s = worldToScreen(aw.x, aw.y);
      const tp = modShift ? angleSnappedPoint(aw, mouseWorld) : mouseWorld;
      const sp = worldToScreen(tp.x, tp.y);
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI*2);
      ctx.fillStyle = '#ff7043'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
      drawArrow(ctx, s.x, s.y, sp.x, sp.y, '#ff7043');
      ctx.save();
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#ff7043';
      ctx.fillText('動力の向きをクリック', sp.x + 10, sp.y - 8);
      ctx.restore();
    }
    ctx.restore();
    return;
  }
  if (currentTool === 'laser') {
    if (laserStart) {
      const b = laserStart.body;
      const o = b ? getWorldAnchor(b, laserStart.localX, laserStart.localY)
                  : { x: laserStart.localX, y: laserStart.localY };
      const s = worldToScreen(o.x, o.y);
      const lp = modShift ? angleSnappedPoint(o, mouseWorld) : mouseWorld;
      const sp = worldToScreen(lp.x, lp.y);
      ctx.setLineDash([]);
      drawArrow(ctx, s.x, s.y, sp.x, sp.y, '#ff3b3b');
      ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI*2);
      ctx.fillStyle = '#ff3b3b'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#ff3b3b'; ctx.font = '11px sans-serif';
      ctx.fillText('レーザーの向きをクリック', sp.x + 10, sp.y - 8);
    }
    ctx.restore();
    return;
  }
  if (CIRCUIT_TOOLS.indexOf(currentTool) >= 0) {
    if (circuitStart) {
      const a = worldToScreen(circuitStart.x, circuitStart.y);
      let ep = snapPlace(mouseWorld);                     // ★グリッド／オブジェクトスナップ
      if (modShift) ep = angleSnappedPoint(circuitStart, ep);
      // ★カーソルが既存の回路の上なら、そこへ吸着させて実際に置かれる位置を見せる
      //   （導線はそこで終了、導線以外はそこが端点になる）
      let canClose = false, okHere = true;
      const snapNet = circuitPlacePoint(mouseWorld, ep);
      if (currentTool === 'wire') {
        if (snapNet) { ep = snapNet; canClose = true; }
      } else {
        okHere = !!snapNet;                       // 導線以外は回路の上にしか置けない
        if (snapNet) ep = snapNet;
      }
      const b = worldToScreen(ep.x, ep.y);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = okHere ? 'rgba(255,202,40,0.85)' : 'rgba(239,83,80,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = okHere ? '#ffca28' : '#ef5350';
      ctx.beginPath(); ctx.arc(a.x, a.y, 4, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI*2); ctx.fill();
      if (canClose || (okHere && currentTool !== 'wire')) {   // 吸着先を緑の輪で示す
        ctx.strokeStyle = '#66bb6a'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(b.x, b.y, 8, 0, Math.PI*2); ctx.stroke();
      }
      ctx.font = '11px sans-serif';
      ctx.fillText(currentTool === 'wire'
        ? (canClose ? 'クリックで回路につないで終了' : '次の点をクリック（回路の上をクリックで終了）')
        : (okHere ? CIRCUIT_LABELS[currentTool] + 'の終点をクリック' : '回路の上に置いてください'),
        b.x + 10, b.y - 8);
      // ★直流電源は極性があるので、置く前にどちらが＋／−になるか見せる
      //   （1点目＝−極、2点目＝＋極）
      if (currentTool === 'dcsource') {
        ctx.save();
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#42a5f5'; ctx.fillText('−', a.x - 12, a.y - 12);
        ctx.fillStyle = okHere ? '#ef5350' : 'rgba(239,83,80,0.5)';
        ctx.fillText('＋', b.x - 14, b.y - 12);
        ctx.restore();
      }
    }
    ctx.restore();
    return;
  }
  if (currentTool === 'slinky') {
    if (slinkyStart) {
      const a = worldToScreen(slinkyStart.x, slinkyStart.y);
      let e = snapPlace(mouseWorld);
      if (modShift) e = angleSnappedPoint(slinkyStart, e);
      const b = worldToScreen(e.x, e.y);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(255,213,79,0.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      const spanM = len(e.x - slinkyStart.x, e.y - slinkyStart.y) * PX2M;
      ctx.font = '11px sans-serif'; ctx.fillStyle = '#ffd54f';
      // 張り具合0（既定）では「◯倍に張る」と書いても意味がないので、自然長だけを出す。
      // ★ばね定数 0（ダンパー）には自然長が無いので、長さの話をしない（何が置かれるかを出す）
      const restM = spanM / (1 + slinkyStretch);
      ctx.fillText(slinkySpringK <= 0
        ? 'もう一方の端をクリック（ダンパー：復元力なし・速度に比例する力だけ）'
        : slinkyStretch > 1e-6
        ? `もう一方の端をクリック（自然長 ${restM.toFixed(2)} m を ${(1+slinkyStretch).toFixed(1)} 倍に張る）`
        : `もう一方の端をクリック（自然長 ${restM.toFixed(2)} m）`, b.x + 10, b.y - 8);
    }
    ctx.restore();
    return;
  }
  if (currentTool === 'optic' && pendingOptic) {
    if (drawStart) {
      const _m = snapPlace(mouseWorld);
      const cur = modShift ? angleSnappedPoint(drawStart, _m) : _m;   // Shift=角度スナップ
      const dx = cur.x - drawStart.x, dy = cur.y - drawStart.y;
      let H = Math.max(15, Math.hypot(dx, dy)/2);
      // 格子はスリット列が収まる長さまで伸びる。プレビューでもその長さで見せないと、
      // 置いた瞬間に板が伸びて「ドラッグした長さと違うものが出た」ことになる。
      if (pendingOptic.kind === 'grating') H = Math.max(H, gratingMinH(gratingSlitN, gratingSlitD));
      const cx = (drawStart.x + cur.x)/2, cy = (drawStart.y + cur.y)/2;
      const ang = Math.atan2(dy, dx) - Math.PI/2;
      const verts = opticLocalVerts(pendingOptic.kind, H);
      if (verts) {
        const cos = Math.cos(ang), sin = Math.sin(ang);
        ctx.setLineDash([]);
        ctx.beginPath();
        for (let i = 0; i < verts.length; i++) {
          const wx = cx + verts[i].x*cos - verts[i].y*sin;
          const wy = cy + verts[i].x*sin + verts[i].y*cos;
          const s = worldToScreen(wx, wy);
          if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
        }
        ctx.closePath();
        const mirror = pendingOptic.kind.indexOf('Mirror') >= 0;
        ctx.fillStyle = pendingOptic.kind === 'grating' ? 'rgba(55,71,79,0.55)'
                      : pendingOptic.kind === 'screen'  ? 'rgba(224,224,224,0.45)'
                      : mirror                          ? 'rgba(144,164,174,0.4)'
                                                        : 'rgba(130,200,255,0.25)';
        ctx.fill();
        ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 1.5; ctx.stroke();
        if (pendingOptic.kind === 'grating') {          // スリットの位置を破線で示す
          const N = gratingSlitN, d = gratingSlitD;
          ctx.strokeStyle = '#ffe082'; ctx.lineWidth = Math.max(1, gratingSlitA * cam.zoom);
          ctx.beginPath();
          for (let j = 0; j < N; j++) {
            const ly = (j - (N-1)/2) * d;
            const wx = cx - verts[0].x*Math.sin(ang) * 0 - ly*Math.sin(ang);
            const wy = cy + ly*Math.cos(ang);
            const s = worldToScreen(wx, wy);
            ctx.moveTo(s.x - Math.cos(ang)*3, s.y - Math.sin(ang)*3);
            ctx.lineTo(s.x + Math.cos(ang)*3, s.y + Math.sin(ang)*3);
          }
          ctx.stroke();
        }
      }
    }
    ctx.restore();
    return;
  }
  if (!drawStart) { ctx.restore(); return; }
  if (currentTool==='condrod') {                           // ★導体棒（細長い矩形）
    const cur = modShift ? angleSnappedPoint(drawStart, snapPt(mouseWorld)) : snapPt(mouseWorld);
    const d = condRodDesc(drawStart, cur);
    if (d) {
      const c = Math.cos(d.angle), s = Math.sin(d.angle), hw = d.w/2, hh = d.h/2;
      ctx.beginPath();
      const vs = [{x:-hw,y:-hh},{x:hw,y:-hh},{x:hw,y:hh},{x:-hw,y:hh}];
      for (let i = 0; i < 4; i++) {
        const p = worldToScreen(d.x + vs[i].x*c - vs[i].y*s, d.y + vs[i].x*s + vs[i].y*c);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.strokeStyle = '#eceff1'; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.stroke();
    }
    ctx.restore(); return;
  }
  if (currentTool==='heater') {                            // ★加熱・冷却の領域も枠だけ
    const cur = snapPt(mouseWorld);
    const a = worldToScreen(drawStart.x, drawStart.y), b = worldToScreen(cur.x, cur.y);
    ctx.strokeStyle = HEATFIELD_COLOR[heatKindOf(heaterPower)];   // 枠の色が加熱（橙）／冷却（水色）／0（灰）を示す
    ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.strokeRect(Math.min(a.x,b.x), Math.min(a.y,b.y), Math.abs(b.x-a.x), Math.abs(b.y-a.y));
    ctx.restore(); return;
  }
  if (currentTool==='flowfield') {                         // ★流れの場も枠だけ
    const cur = snapPt(mouseWorld);
    const a = worldToScreen(drawStart.x, drawStart.y), b = worldToScreen(cur.x, cur.y);
    ctx.strokeStyle = FLOWFIELD_COLOR;
    ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.strokeRect(Math.min(a.x,b.x), Math.min(a.y,b.y), Math.abs(b.x-a.x), Math.abs(b.y-a.y));
    ctx.restore(); return;
  }
  if (currentTool==='spdmeter') {                           // ★速さの分布計も枠だけ
    const cur = snapPt(mouseWorld);
    const a = worldToScreen(drawStart.x, drawStart.y), b = worldToScreen(cur.x, cur.y);
    ctx.strokeStyle = SPDM_COLOR;
    ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.strokeRect(Math.min(a.x,b.x), Math.min(a.y,b.y), Math.abs(b.x-a.x), Math.abs(b.y-a.y));
    ctx.restore(); return;
  }
  if (currentTool==='counter') {                            // ★通過カウンタは線だけ見せる
    const cur = snapPt(mouseWorld);
    const a = worldToScreen(drawStart.x, drawStart.y), b = worldToScreen(cur.x, cur.y);
    ctx.strokeStyle = COUNTER_COLOR;
    ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore(); return;
  }
  if (currentTool==='efield' || currentTool==='bfield') {   // ★場の領域は矩形の枠だけ見せる
    const cur = snapPt(mouseWorld);
    const a = worldToScreen(drawStart.x, drawStart.y), b = worldToScreen(cur.x, cur.y);
    ctx.strokeStyle = EMFIELD_COLOR[currentTool==='efield' ? 'E' : 'B'];
    ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.strokeRect(Math.min(a.x,b.x), Math.min(a.y,b.y), Math.abs(b.x-a.x), Math.abs(b.y-a.y));
    ctx.restore(); return;
  }
  // ★ピストン容器は「内側」の枠を見せる（ドラッグした矩形がそのまま気体の入る空間）
  if (currentTool==='vessel') {
    const cur = snapPt(mouseWorld);
    const a = worldToScreen(drawStart.x, drawStart.y), b = worldToScreen(cur.x, cur.y);
    ctx.strokeStyle = '#90a4ae';
    ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.strokeRect(Math.min(a.x,b.x), Math.min(a.y,b.y), Math.abs(b.x-a.x), Math.abs(b.y-a.y));
    ctx.restore(); return;
  }
  if (currentTool==='circle' || currentTool==='box' || currentTool==='triangle' || currentTool==='gear') {
    const cur = snapPt(mouseWorld);
    const desc = buildDragShape(currentTool, drawStart, cur, modShift);
    if (desc) {
      if (desc.gear) drawGearPreviewInfo(desc);
      ctx.beginPath();
      if (desc.type === 'circle') {
        const sc = worldToScreen(desc.x, desc.y);
        ctx.arc(sc.x, sc.y, desc.radius * cam.zoom, 0, Math.PI * 2);
      } else {
        let verts = desc.verts;
        if (desc.type === 'box') {
          const hw = desc.w / 2, hh = desc.h / 2;
          verts = [{x:-hw,y:-hh},{x:hw,y:-hh},{x:hw,y:hh},{x:-hw,y:hh}];
        }
        const ca = Math.cos(desc.angle || 0), sa = Math.sin(desc.angle || 0);   // 歯車は吸着で回っている
        for (let i = 0; i < verts.length; i++) {
          const v = verts[i];
          const sp = worldToScreen(desc.x + v.x*ca - v.y*sa, desc.y + v.x*sa + v.y*ca);
          if (i === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
        }
        ctx.closePath();
      }
      ctx.stroke();
      if (snapEnabled && currentTool === 'circle') {   // 円は始点＝中心。中心が乗る格子点を示す
        const gp = worldToScreen(desc.x, desc.y);
        ctx.save(); ctx.setLineDash([]);
        ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(gp.x - 6, gp.y); ctx.lineTo(gp.x + 6, gp.y);
        ctx.moveTo(gp.x, gp.y - 6); ctx.lineTo(gp.x, gp.y + 6);
        ctx.stroke(); ctx.restore();
      }
    }
  }
  ctx.restore();
}
// 歯車のプレビューの添え書き：基準円（破線）・歯数・かみ合う相手との中心線
function drawGearPreviewInfo(desc) {
  const g = desc.gear, sc = worldToScreen(desc.x, desc.y);
  ctx.save();
  ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
  ctx.strokeStyle = desc.meshWith ? '#66bb6a' : 'rgba(255,255,255,0.5)';
  ctx.beginPath(); ctx.arc(sc.x, sc.y, g.m * g.z / 2 * cam.zoom, 0, Math.PI * 2); ctx.stroke();
  if (desc.meshWith) {             // かみ合う相手の中心と結ぶ（吸い付いたことが見える）
    const o = worldToScreen(desc.meshWith.x, desc.meshWith.y);
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(sc.x, sc.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = desc.meshWith ? '#66bb6a' : '#ffffff';
  const zA = desc.meshWith && desc.meshWith.gear ? desc.meshWith.gear.z : 0;
  ctx.fillText(zA ? `歯数 ${g.z}（${zA}とかみ合う）` : desc.meshWith ? `歯数 ${g.z}（かみ合う）` : `歯数 ${g.z}`, sc.x, sc.y);
  ctx.restore();
}
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function drawSnapMarker() {
  // ★物体を運んでいる間は、吸着した相手の特徴点を示す（Alt で一時的に入れたときも出る）
  if (pointerMoveStart && pointerMoveStart.snapHit) { drawSnapMarkerAt(pointerMoveStart.snapHit); return; }
  if (!objSnapActiveNow()) return;
  if (!elementDrag && OBJ_SNAP_TOOLS.indexOf(currentTool) < 0) return;
  const p = elementDrag
    ? { x: mouseWorld.x + elementDrag.dx, y: mouseWorld.y + elementDrag.dy }
    : mouseWorld;
  const s = objSnapFind(p);
  if (s) drawSnapMarkerAt(s);
}
function drawSnapMarkerAt(s) {
  const sp = worldToScreen(s.x, s.y), R = 6;
  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#ffd54f';
  ctx.fillStyle = 'rgba(255,213,79,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (s.kind === 'vertex') ctx.rect(sp.x-R, sp.y-R, R*2, R*2);
  else if (s.kind === 'mid') {
    ctx.moveTo(sp.x, sp.y-R); ctx.lineTo(sp.x+R, sp.y+R); ctx.lineTo(sp.x-R, sp.y+R); ctx.closePath();
  } else ctx.arc(sp.x, sp.y, R, 0, Math.PI*2);
  ctx.fill(); ctx.stroke();
  if (s.kind === 'center') {
    ctx.beginPath();
    ctx.moveTo(sp.x-R-3, sp.y); ctx.lineTo(sp.x+R+3, sp.y);
    ctx.moveTo(sp.x, sp.y-R-3); ctx.lineTo(sp.x, sp.y+R+3);
    ctx.stroke();
  }
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#ffd54f';
  ctx.fillText(OBJ_SNAP_NAME[s.kind], sp.x + R + 6, sp.y - R);
  ctx.restore();
}
// ドラッグ中の枠だけを描く。離したら消す。
//   枠は lastSelRect に残していて「◯◯のみ選択」がその中を数え直すが、それは描かない
//   （選択そのものは物体側の強調表示で見えているので、枠まで残すと画面がうるさい）。
function drawSelRect() {
  if (!selRect) return;
  const a=worldToScreen(selRect.x,selRect.y), b=worldToScreen(selRect.x+selRect.w,selRect.y+selRect.h);
  ctx.save();
  ctx.strokeStyle='#4fc3f7'; ctx.lineWidth=1.5; ctx.setLineDash([5,4]);
  ctx.fillStyle='rgba(79,195,247,0.07)';
  const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(b.x-a.x),h=Math.abs(b.y-a.y);
  ctx.fillRect(x,y,w,h);
  ctx.strokeRect(x,y,w,h);
  ctx.restore();
}
// ─── 物体にはたらく力のベクトル表示（合力ではなく種類ごと） ───

// ─── 予測軌道の描画（速度ツール）───────────────────
//   実線 … 予測経路
//   点   … PREDICT_MARK_SEC ごとの位置。点の混み具合がそのまま速さになるので、
//           落下で間隔が開く・上がりきりで詰まる、といった加速のようすが見える
//   点線 … 力が何も働かなかった場合（まっすぐ進んだ場合）の道すじ。同じ時刻の点どうしを
//           見比べれば、重力などがどれだけ曲げたかが隔たりとして読める（斜方投射なら ½gt²）。
//           実線より下に、白の細い点線で敷く（あくまで比較用の補助線なので目立たせない）
//   ✕   … 最初に接触する場所。そこから先は接触やジョイントが効くので予測できない
function drawPredictedPaths(paths) {
  if (!paths || !paths.length) return;
  ctx.save();
  ctx.lineJoin = 'round';
  // ── まっすぐ進んだ場合（比較用）──
  for (const p of paths) {
    if (p.pts.length < 2 || !p.straight) continue;
    const s0 = worldToScreen(p.pts[0].x, p.pts[0].y);
    const s1 = worldToScreen(p.straight.x, p.straight.y);
    if (Math.hypot(s1.x - s0.x, s1.y - s0.y) < 4) continue;   // 短すぎる線は出さない
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (const m of p.straightMarks) {                        // 予測線の点と同じ時刻の点
      const s = worldToScreen(m.x, m.y);
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.8, 0, Math.PI*2); ctx.fill();
    }
    if (paths.length === 1) {                                 // 何の線かは1本のときだけ書く
      ctx.font = '10px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText('まっすぐ進んだ場合', s1.x + 6, s1.y - 4);
    }
  }
  ctx.setLineDash([]);
  for (const p of paths) {
    if (p.pts.length < 2) continue;
    ctx.strokeStyle = 'rgba(102,187,106,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const s0 = worldToScreen(p.pts[0].x, p.pts[0].y);
    ctx.moveTo(s0.x, s0.y);
    for (let i = 1; i < p.pts.length; i++) {
      const s = worldToScreen(p.pts[i].x, p.pts[i].y);
      ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(102,187,106,0.9)';
    for (const m of p.marks) {
      const s = worldToScreen(m.x, m.y);
      ctx.beginPath(); ctx.arc(s.x, s.y, 2.2, 0, Math.PI*2); ctx.fill();
    }
    if (p.hit) {
      const s = worldToScreen(p.hit.x, p.hit.y);
      ctx.strokeStyle = '#ffa726'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x-5, s.y-5); ctx.lineTo(s.x+5, s.y+5);
      ctx.moveTo(s.x+5, s.y-5); ctx.lineTo(s.x-5, s.y+5);
      ctx.stroke();
    }
  }
  ctx.restore();
}
