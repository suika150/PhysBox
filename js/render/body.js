// ループ1周をパスに引く。円弧を持つ区間は本物の弧で描く（当たり判定と見た目を一致させる）。
//   loopIdx: -1 = 外周 / 0.. = holes[k]
function tracePolyLoop(ctx, pts, b, loopIdx) {
  const n = pts.length;
  const arcs = (b && b.arcs) ? b.arcs.filter(a => a.loop === loopIdx) : [];
  if (!arcs.length) {                       // 円弧なし＝従来どおりの折れ線
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    return;
  }
  const arcAt = new Array(n).fill(null);    // 頂点 i から始まる円弧
  for (const a of arcs) arcAt[a.i0] = a;
  // ★描き始める頂点を選ぶ。円弧の「途中」の頂点から描き始めてはいけない。
  //   Clipper が返す頂点の並びは 0 番がどこから始まるか決まっておらず、円弧の
  //   まん中で始まることがよくある（円どうしの結合ではほぼ必ずそうなる）。
  //   その場合、頂点0から円弧の始点までを折れ線で描いたあと、同じ区間を円弧でも
  //   もう一度なぞることになり、輪郭が自分自身と重なる。even-odd 塗りでは二重に
  //   覆われた部分が抜けるので、結合したはずの円がえぐれた形で表示されていた。
  const midArc = new Array(n).fill(false);  // 円弧の途中（両端は含まない）
  for (const a of arcs) {
    if (a.full) { for (let k = 0; k < n; k++) if (k !== a.i0) midArc[k] = true; continue; }
    for (let i = (a.i0 + 1) % n; i !== a.i1; i = (i + 1) % n) midArc[i] = true;
  }
  let s = 0;
  while (s < n && midArc[s]) s++;
  if (s >= n) s = arcs[0].i0;               // 全周が円弧＝その始点から
  ctx.moveTo(pts[s].x, pts[s].y);
  let i = s;
  for (let guard = 0; guard <= n; guard++) {   // 1周で必ず戻る（毎回1頂点以上進む）
    const a = arcAt[i];
    if (a) {
      const th0 = Math.atan2(pts[a.i0].y - a.cy, pts[a.i0].x - a.cx);
      const th1 = a.full ? th0 + (a.ccw ? _TWO_PI : -_TWO_PI)
                         : Math.atan2(pts[a.i1].y - a.cy, pts[a.i1].x - a.cx);
      ctx.arc(a.cx, a.cy, a.r, th0, th1, !a.ccw);
      if (a.full) break;
      i = a.i1;
    } else {
      i = (i + 1) % n;
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    if (i === s) break;
  }
  ctx.closePath();
}
// 生成口の中身の濃さ。★べた塗りにすると世界に置いた物と見分けがつかず、破線の枠も
//   塗りに埋もれる。「これから出てくる物体を薄くした姿」にしておくと、何が出るのか
//   （形・大きさ・色）は読めるまま、そこに物が無いことが一目で分かる。
//   0.5 では実体に見え、0.1 では暗い背景で形が読めなくなった。
const SPAWNER_ALPHA = 0.25;
// 固定した物体がゴースト（layers 0）になったときの濃さ。★理由は SPAWNER_ALPHA と同じで、
//   べた塗りのままだと破線の枠が塗りに埋もれ、「そこに物が無い」が読めない。実測：
//   オームの法則モデルのスイッチの板は、すり抜けと実体で画面がまったく同じに見えた
//   （板自身の縁取り 1.5px が、あとから描く 2px の破線を下から押し出していた）。
//   ★**動く物体は薄めない。** そちらの layers:0 は「ぶつからないだけで世界に居る」
//     という使い方で（重なって飛ばす比較用の球、レーザーを透過させる腕）、主役のことも
//     ある。動かないゴーストは、動かないうえに何とも当たらない＝絵でしかないので薄める。
const GHOST_ALPHA = 0.3;
function drawBody(b, isSelected) {
  if (b.tracePoints.length === 0 && !bodyInView(b)) return;   // 軌跡は画面外へ伸びるので対象外
  ctx.save();
  ctx.globalAlpha = b.alpha * (b.isSpawner ? SPAWNER_ALPHA
                             : (b.layers === 0 && b.isStatic) ? GHOST_ALPHA : 1);
  // ★温度で色をつける表示（物理は変えない）。塗り色だけを置き換える。
  //   熱容量を持たない物体（比熱0＝熱のやりとりをしない背景や壁）は元の色のまま。
  //   温度が動かないものまで塗ると、画面がその色で埋まって主役が見えなくなる。
  const _fill = (world.thermalOn && world.thermalViz && b.heatCap > 0)
    ? tempToColor(b.temp) : b.fillColor;
  const sc = worldToScreen(b.x, b.y);
  ctx.translate(sc.x, sc.y);
  ctx.rotate(b.angle + cam.angle);   // ★カメラの回転ぶんを足す（worldToScreen と揃える）
  ctx.scale(cam.zoom, cam.zoom);
  if (b.type === 'circle') {
    ctx.beginPath();
    ctx.arc(0, 0, b.radius, 0, Math.PI*2);
    ctx.closePath();
    ctx.fillStyle = _fill;
    ctx.fill();
    if (b.strokeWidth > 0) {
      ctx.strokeStyle = b.strokeColor;
      ctx.lineWidth = b.strokeWidth;
      ctx.stroke();
    }
    // 向きを示す基準線
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(b.radius*0.8, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
} else if (b.type === 'box') {
    const hw=b.w/2, hh=b.h/2;
    ctx.beginPath();
    ctx.rect(-hw, -hh, b.w, b.h);
    ctx.fillStyle = _fill;
    ctx.fill();
    if (b.strokeWidth > 0) {
      ctx.strokeStyle = b.strokeColor;
      ctx.lineWidth = b.strokeWidth;
      ctx.stroke();
    }
  } else if (b.type === 'polygon') {
    if (b.verts.length < 2) { ctx.restore(); return; }
    ctx.beginPath();
    tracePolyLoop(ctx, b.verts, b, -1);
    if (b.holes) for (let k=0;k<b.holes.length;k++) {   // ★穴のサブパス
      if (b.holes[k].length < 3) continue;
      tracePolyLoop(ctx, b.holes[k], b, k);
    }
    ctx.fillStyle = _fill;
    ctx.fill('evenodd');                             // ★even-odd で穴をくり抜く
    if (b.strokeWidth > 0) {
      ctx.strokeStyle = b.strokeColor;
      ctx.lineWidth = b.strokeWidth;
      ctx.stroke();                                  // 穴の縁も一緒に描かれる
    }
  }
  // ★回折格子のスリット。当たり判定は板のままなので（穴にすると光が回折せず素通りする）、
  //   開口はここで「抜けている」ように描く。光が通る場所が目で分かるようにするため。
  if (b.opticKind === 'grating' && b.slitN > 0) {
    const T = opticPlateT('grating', b.opticH);
    ctx.fillStyle = '#ffe082';
    for (let j = 0; j < b.slitN; j++) {
      const yc = (j - (b.slitN - 1) / 2) * b.slitD;
      ctx.fillRect(-T/2, yc - b.slitA/2, T, b.slitA);
    }
  }
  // ★ゴースト（旧センサー／旧「衝突なし」）は黄色の破線、生成口は白（既定）の破線。
  //   色を分けてあるのは、意味が違うものを同じ見た目にしないため（ゴーストは世界にある
  //   透明な物、生成口は「ここから物体が出てくる入口」）。生成口の枠線色は変更できる。
  if (b.layers === 0 || b.isSpawner) {
    ctx.globalAlpha = b.alpha;     // ★破線の枠だけは薄めない（ここが「入口」の目印なので）
    ctx.setLineDash([4/cam.zoom, 4/cam.zoom]);
    ctx.strokeStyle = b.isSpawner ? (b.strokeColor || '#ffffff') : 'rgba(255,255,100,0.7)';
    ctx.lineWidth = 2/cam.zoom;
    ctx.beginPath();
    if (b.type === 'circle') {
      ctx.arc(0, 0, b.radius, 0, Math.PI*2);
    } else if (b.type === 'box') {
      ctx.rect(-b.w/2, -b.h/2, b.w, b.h);
    } else if (b.type === 'polygon' && b.verts.length >= 3) {
      ctx.moveTo(b.verts[0].x, b.verts[0].y);
      for (let i = 1; i < b.verts.length; i++) ctx.lineTo(b.verts[i].x, b.verts[i].y);
      ctx.closePath();
    }
    ctx.stroke();          // ★従来は円のときしか描かれていなかった
    ctx.setLineDash([]);
  }
  if (b.isStatic) {
    // 固定物：地面/固定支持を表す斜線ハッチ。形状でクリップして内側にだけ描く
    ctx.save();
    ctx.beginPath();
    if (b.type === 'circle') {
      ctx.arc(0, 0, b.radius, 0, Math.PI*2);
    } else if (b.type === 'box') {
      ctx.rect(-b.w/2, -b.h/2, b.w, b.h);
    } else if (b.type === 'polygon' && b.verts.length) {
      ctx.moveTo(b.verts[0].x, b.verts[0].y);
      for (let i=1;i<b.verts.length;i++) ctx.lineTo(b.verts[i].x, b.verts[i].y);
      ctx.closePath();
      if (b.holes) for (const h of b.holes) {
        if (h.length < 3) continue;
        ctx.moveTo(h[0].x, h[0].y);
        for (let i=1;i<h.length;i++) ctx.lineTo(h[i].x, h[i].y);
        ctx.closePath();
      }
    }
    ctx.clip('evenodd');
    // 図形を覆う範囲を求めて 45° 線で埋める（余りはクリップで切られる）
    let br;
    if (b.type === 'circle') br = b.radius;
    else if (b.type === 'box') br = Math.hypot(b.w, b.h) / 2;
    else { br = 0; for (const v of b.verts) br = Math.max(br, Math.hypot(v.x, v.y)); }
    ctx.strokeStyle = darkenColor(_fill, 0.6);  // 塗り色より少し濃い斜線（0.6=6割の明るさ）
    ctx.lineWidth = 1;
    // 45°線なので線上では x-y が一定。その定数 c を図形が占める [-2br, 2br] 全体で
    // 動かす（従来は [0, 6br] を動かしていたため、半分しか塗られなかった）
    for (let c = -2*br; c <= 2*br; c += 10) {
      ctx.beginPath();
      ctx.moveTo(c - 2*br, -2*br);
      ctx.lineTo(c + 2*br,  2*br);
      ctx.stroke();
    }
    ctx.restore();
  }
  for (const th of b.thrusters) {
    ctx.save();
    ctx.translate(th.localX, th.localY);
    ctx.rotate(th.dir);          // +X=推力方向 / -X=噴射方向
    // ノズル（-X 側へ広がる台形）
    ctx.beginPath();
    ctx.moveTo(-4, -3); ctx.lineTo(-4, 3);
    ctx.lineTo(-11, 6); ctx.lineTo(-11, -6);
    ctx.closePath();
    ctx.fillStyle = '#78909c';
    ctx.fill();
    ctx.strokeStyle = '#cfd8dc';
    ctx.lineWidth = 1;
    ctx.stroke();
    // 取り付けマウント（力点＝アンカーを示すアイコン。停止中も常に表示）
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI*2);
    ctx.fillStyle = '#ff7043';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
    // 炎（実行中・いま実際に押しているときだけ）。
    //   ★リモコンを放している動力と、推力 0 の動力からは出さない。1つの物体に何個も
    //     付くようになったので、「いまどれが噴いているか」が見て分かる必要がある
    //     （左右の噴射を別のキーで操って曲がる、がこの道具の要）。
    //   ★噴射口は推力と逆側。推力が負（引く向き）なら反対から出る。
    const tg = th._remoteHold === undefined ? 1 : th._remoteHold;
    const push = th.force * tg;
    if (running && push) {
      const sgn = push > 0 ? 1 : -1;
      const fl = 15 + Math.random()*10;
      const grad = ctx.createLinearGradient(-11*sgn, 0, (-11 - fl)*sgn, 0);
      grad.addColorStop(0, 'rgba(255,200,0,0.9)');
      grad.addColorStop(0.5, 'rgba(255,100,0,0.6)');
      grad.addColorStop(1, 'rgba(255,50,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-11*sgn, -6); ctx.lineTo((-11 - fl)*sgn, 0); ctx.lineTo(-11*sgn, 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
if (isSelected) {
    ctx.save();
    ctx.translate(sc.x, sc.y);
    ctx.rotate(b.angle + cam.angle);   // ★同上
    ctx.scale(cam.zoom, cam.zoom);
    if (b.type==='circle') {
      ctx.beginPath(); ctx.arc(0,0,b.radius+3/cam.zoom,0,Math.PI*2);
    } else if (b.type==='box') {
      const p=3/cam.zoom;
      ctx.beginPath(); ctx.rect(-b.w/2-p,-b.h/2-p,b.w+p*2,b.h+p*2);
    } else {
      // ★多角形（図形和の結果を含む）：各辺を法線方向へオフセットして輪郭に沿った枠を描く
      ctx.beginPath();
      if (b.verts.length > 0) {
        const margin = 3 / cam.zoom;
        const outline = offsetLoopOutward(b.verts, margin);
        if (outline.length > 0) {
          ctx.moveTo(outline[0].x, outline[0].y);
          for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i].x, outline[i].y);
          ctx.closePath();
        }
      }
    }
    ctx.strokeStyle = '#4fc3f7';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();
  }
  if (b.tracePoints.length > 1) {
    ctx.save();
    ctx.strokeStyle = b.tracerColor || '#ff7043';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // ★カメラを向きごと固定しているときは、記録時の姿勢を使って「その物体から見た
    //   道すじ」へ直しながら描く（camera.js の★）。外していればワールドのまま描く＝
    //   同じ記録が地面から見た道すじになる。どちらでも点は捨てない。
    const f = tracerFrameBody();
    const poseAt = framePoseCursor(f);
    let started = false;
    for (let i=0;i<b.tracePoints.length;i++) {
      const q = b.tracePoints[i];
      let w = q;
      if (f) {
        const pose = poseAt(q.t);
        if (!pose) { started = false; continue; }   // 姿勢の記録より前の点は直せない
        w = traceWorldFor(f, pose, q.x, q.y);
      }
      const s = worldToScreen(w.x, w.y);
      if (started) ctx.lineTo(s.x, s.y); else { ctx.moveTo(s.x, s.y); started = true; }
    }
    ctx.stroke();
    ctx.restore();
  }
  if (b.tracerEnabled) {
    const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
    const tx = b.x + b.tracerAnchorX * cos - b.tracerAnchorY * sin;
    const ty = b.y + b.tracerAnchorX * sin + b.tracerAnchorY * cos;
    const s = worldToScreen(tx, ty);
    ctx.save();
    ctx.beginPath();                       // 記録点マーカー
    ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = b.tracerColor || '#ff7043';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = '#fff';              // 中央の十字
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.x - 3, s.y); ctx.lineTo(s.x + 3, s.y);
    ctx.moveTo(s.x, s.y - 3); ctx.lineTo(s.x, s.y + 3);
    ctx.stroke();
    ctx.restore();
  }
  drawLayerBadge(b);   // ★既定(レイヤー1のみ)以外は色ドットで示す
}
// レイヤーは画面上で見えない属性なので「なぜ当たらないのか」が分からなくなる。
// 既定（レイヤー1のみ）とゴースト（破線で表示済み）以外は、AABBの右上に色ドットを描く。
function drawLayerBadge(b) {
  if (!world.showLayerBadges) return;
  if (b.layers === LAYER_DEFAULT || b.layers === 0) return;
  const a = b._aabb;
  const s = worldToScreen(a.maxX, a.minY);
  ctx.save();
  ctx.setLineDash([]);
  let k = 0;
  for (let i = 0; i < LAYER_COUNT; i++) {
    if (!(b.layers & (1 << i))) continue;
    const x = s.x + 5 + k*9, y = s.y - 5;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI*2);
    ctx.fillStyle = LAYER_COLORS[i];
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 1;
    ctx.stroke();
    k++;
  }
  ctx.restore();
}

// ★表示だけのスイッチ（world.showGuideRails）。ここで返しても拘束は効いたまま——
//   projectGuideVelocity / applyGuideProjection は step.js の側で回っていて、この
//   関数は1本も線を引かないだけ。レールに乗った物体が何十個も並ぶ題材で使う。
//   ★ばね（実体のスリンキー）のレールも同じ線で描く。乗っているのが物体か媒質かの違いで、
//     拘束そのものは同じものなので、見た目を変える理由がない。
function drawGuideRails() {
  if (!world.showGuideRails) return;
  let any = false;
  for (const b of objects)  if (b.guideEnabled) { any = true; break; }
  if (!any) for (const S of slinkies) if (S.guideEnabled && !S.idealSpring) { any = true; break; }
  if (!any) return;
  const L = (canvas.width + canvas.height) / cam.zoom;
  ctx.save();
  for (const b of objects) {
    if (!b.guideEnabled) continue;
    _drawGuideRail(b.guideAngle, b.guidePx, b.guidePy, b.x, b.y, selectedIds.has(b.id), L);
  }
  for (const S of slinkies) {
    if (!S.guideEnabled || S.idealSpring) continue;
    // 向きの矢印は索の真ん中に置く（ばねには重心に当たる1点が無い）
    const mid = S.nodes[S.nodes.length >> 1];
    const sel = !!(selectedElement && selectedElement.kind === 'slinky' && selectedElement.slinky === S);
    _drawGuideRail(S.guideAngle, S.guidePx, S.guidePy, mid.x, mid.y, sel, L);
  }
  ctx.restore();
}
// レール1本。(gx,gy) は線が通る点、(cx,cy) は向きの矢印を置く点。
function _drawGuideRail(angle, gx, gy, cx, cy, sel, L) {
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  // ★描画の中心はレール上のアンカーではなく、カメラ中心をレールへ射影した点にする。
  //   追従で物体がアンカーから遠ざかっても、レールが画面外に取り残されない。
  const t = (cam.x - gx)*dx + (cam.y - gy)*dy;
  const mx = gx + dx*t, my = gy + dy*t;
  const p0 = worldToScreen(mx - dx*L, my - dy*L);
  const p1 = worldToScreen(mx + dx*L, my + dy*L);
  ctx.setLineDash([9, 6]);
  ctx.strokeStyle = sel ? 'rgba(255,213,79,0.85)' : 'rgba(255,213,79,0.30)';
  ctx.lineWidth = sel ? 2 : 1.2;
  ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
  ctx.setLineDash([]);
  const c = worldToScreen(cx, cy), R = 26;
  const col = sel ? '#ffd54f' : 'rgba(255,213,79,0.5)';
  const sd = worldToScreenDir(dx, dy);   // ★向きはカメラの回転を通す
  drawArrow(ctx, c.x, c.y, c.x + sd.x*R, c.y + sd.y*R, col, sel ? 2 : 1.5);
  drawArrow(ctx, c.x, c.y, c.x - sd.x*R, c.y - sd.y*R, col, sel ? 2 : 1.5);
  if (sel) {
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(_dispDeg(angle).toFixed(1) + '° のみ', c.x + dx*R + 8, c.y + dy*R - 6);
  }
}
function darkenColor(color, factor = 0.6) {
  let r, g, b;
  if (typeof color === 'string' && color[0] === '#') {
    r = parseInt(color.slice(1,3),16);
    g = parseInt(color.slice(3,5),16);
    b = parseInt(color.slice(5,7),16);
  } else {

    const m = /rgba?\(([^)]+)\)/.exec(color || '');
    if (m) { const p = m[1].split(',').map(s=>parseFloat(s)); r=p[0]; g=p[1]; b=p[2]; }
    else { r = 128; g = 128; b = 128; }
  }
  r = Math.max(0, Math.round(r * factor));
  g = Math.max(0, Math.round(g * factor));
  b = Math.max(0, Math.round(b * factor));
  return `rgb(${r},${g},${b})`;
}

function drawAnchorDot(sx, sy, color) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(sx, sy, 4, 0, Math.PI*2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}
