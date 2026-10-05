function _centroid(v){ let x=0,y=0; for(const p of v){x+=p.x;y+=p.y;} return {x:x/v.length,y:y/v.length}; }
function _axesOf(verts, internal){
  const axes=[];
  for(let i=0;i<verts.length;i++){
    const v1=verts[i], v2=verts[(i+1)%verts.length];
    const ex=v2.x-v1.x, ey=v2.y-v1.y, el=len(ex,ey)||1e-9;   // ★変数名を el へ（ヘルパー len と衝突するため）
    axes.push({x:-ey/el, y:ex/el, internal: !!(internal && internal[i])});
  }
  return axes;
}
function _polyContactPointVerts(va, vb, nx, ny){
  let bestB=vb[0], db=-Infinity;
  for(const v of vb){ const d=-(v.x*nx+v.y*ny); if(d>db){db=d;bestB=v;} }
  let bestA=va[0], da=-Infinity;
  for(const v of va){ const d=(v.x*nx+v.y*ny); if(d>da){da=d;bestA=v;} }
  return { x:(bestA.x+bestB.x)/2, y:(bestA.y+bestB.y)/2 };
}
function _deepestPoints(verts, nx, ny) {
  let best = Infinity;
  for (const v of verts) { const d = v.x*nx + v.y*ny; if (d < best) best = d; }
  const out = [];
  for (const v of verts) {
    if (v.x*nx + v.y*ny <= best + 1.0) out.push({ x:v.x, y:v.y });
    if (out.length === 2) break;
  }
  return out.length ? out : [{ x: verts[0].x, y: verts[0].y }];
}
// 半平面 n·p ≥ offset で線分（2点）をクリップ
function _clipSeg(seg, nx, ny, offset) {
  const out = [];
  const d0 = seg[0].x*nx + seg[0].y*ny - offset;
  const d1 = seg[1].x*nx + seg[1].y*ny - offset;
  if (d0 >= 0) out.push(seg[0]);
  if (d1 >= 0) out.push(seg[1]);
  if (d0*d1 < 0) {
    const t = d0 / (d0 - d1);
    out.push({ x: seg[0].x + t*(seg[1].x-seg[0].x), y: seg[0].y + t*(seg[1].y-seg[0].y) });
  }
  return out;
}
// 1枚の参照面に対して入射面をクリップし、接触点を作る（従来の _polyManifold の本体）
function _clipAgainstFace(refV, refI, refC, incV, incC, incFlags) {
  const rn = refV.length;
  const r1 = refV[refI], r2 = refV[(refI+1)%rn];
  const ex = r2.x-r1.x, ey = r2.y-r1.y;
  const el = len(ex,ey) || 1e-9;
  const tx = ex/el, ty = ey/el;
  let rnx = ty, rny = -tx;
  if (((r1.x+r2.x)/2-refC.x)*rnx + ((r1.y+r2.y)/2-refC.y)*rny < 0) { rnx=-rnx; rny=-rny; }
  // 入射面＝参照法線に最も反平行な面（内部エッジは避ける）
  const inN = incV.length;
  let incI = -1, minDot = Infinity;
  for (let i = 0; i < inN; i++) {
    if (incFlags && incFlags[i]) continue;
    const a = incV[i], b = incV[(i+1)%inN];
    const fx = b.x-a.x, fy = b.y-a.y;
    const fl = len(fx,fy); if (fl < 1e-9) continue;
    let ux = fy/fl, uy = -fx/fl;
    if (((a.x+b.x)/2-incC.x)*ux + ((a.y+b.y)/2-incC.y)*uy < 0) { ux=-ux; uy=-uy; }
    const d = ux*rnx + uy*rny;
    if (d < minDot) { minDot = d; incI = i; }
  }
  if (incI < 0) return null;
  let cp = [ { x:incV[incI].x, y:incV[incI].y },
             { x:incV[(incI+1)%inN].x, y:incV[(incI+1)%inN].y } ];
  cp = _clipSeg(cp,  tx,  ty,  (r1.x*tx + r1.y*ty));
  if (cp.length < 2) return null;
  cp = _clipSeg(cp, -tx, -ty, -(r2.x*tx + r2.y*ty));
  if (cp.length < 2) return null;
  const refOff = r1.x*rnx + r1.y*rny;
  const out = [];
  for (const p of cp) {
    const sep = (p.x*rnx + p.y*rny) - refOff;
    // ★sep をそのまま持たせる（従来は depth へ 0 で潰していた）。まだ 1.5px 浮いて
    //   いる点を「接している点」と同列に扱うと、その点が空中で物体を支えてしまう。
    //   ソルバは sep > 0 の点を投機的接触として扱い、隙間ぶんの接近は許す。
    if (sep <= 1.5) out.push({ x:p.x, y:p.y, depth: Math.max(-sep, 0), sep });
  }
  return out.length ? out : null;
}
function _polyManifold(A, B, va, vb, nx, ny, iea, ieb) {
  const ca = _centroid(va), cb = _centroid(vb);
  const cands = [];
  const collect = (verts, cen, dx, dy, flags, isA) => {
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      if (flags && flags[i]) continue;
      const a = verts[i], b = verts[(i+1)%n];
      const ex = b.x-a.x, ey = b.y-a.y;
      const el = len(ex,ey); if (el < 1e-9) continue;
      let fx = ey/el, fy = -ex/el;
      if (((a.x+b.x)/2-cen.x)*fx + ((a.y+b.y)/2-cen.y)*fy < 0) { fx=-fx; fy=-fy; }
      cands.push({ isA, i, align: fx*dx + fy*dy });
    }
  };
  collect(va, ca,  nx,  ny, iea, true);
  collect(vb, cb, -nx, -ny, ieb, false);
  if (!cands.length) return null;
  cands.sort((p, q) => q.align - p.align);   // 安定ソート：同点なら A 側を優先（従来と同じ）
  const LIM = Math.min(cands.length, 6);
  for (let k = 0; k < LIM; k++) {
    const c = cands[k];
    const out = c.isA
      ? _clipAgainstFace(va, c.i, ca, vb, cb, ieb)
      : _clipAgainstFace(vb, c.i, cb, va, ca, iea);
    if (out) return out;
  }
  return null;
}
function _satConvexConvex(A, B, va, vb, iea, ieb){          // ★引数追加
  let minDepth=Infinity, nx=0, ny=0, found=false;
  let fbDepth=Infinity, fbx=0, fby=0;                       // 退化時のフォールバック
  const axes=[..._axesOf(va, iea), ..._axesOf(vb, ieb)];    // ★
  for(const ax of axes){
    const pa=projectVertsOnAxis(va,ax), pb=projectVertsOnAxis(vb,ax);
    const ov=overlapOnAxis(pa,pb);
    if(ov<=0) return null;                                  // 分離判定は内部エッジでも必ず行う
    if(ov<fbDepth){ fbDepth=ov; fbx=ax.x; fby=ax.y; }
    if(ax.internal) continue;                               // ★接触方向としては採用しない
    if(ov<minDepth){ minDepth=ov; nx=ax.x; ny=ax.y; found=true; }
  }
  if(!found){ minDepth=fbDepth; nx=fbx; ny=fby; }           // 全軸が内部エッジ（起こらないはず）
  const ca=_centroid(va), cb=_centroid(vb);
  if((cb.x-ca.x)*nx+(cb.y-ca.y)*ny<0){ nx=-nx; ny=-ny; }
  const man = _polyManifold(A, B, va, vb, nx, ny, iea, ieb);   // ★フラグを渡す
  if (man) return man.map(p => ({ A, B, nx, ny, depth: p.depth, sep: p.sep, cx: p.x, cy: p.y }));
  return _deepestPoints(vb, nx, ny)
  .map(p => ({ A, B, nx, ny, depth: minDepth, sep: -minDepth, cx: p.x, cy: p.y }));
}
function _satCirclePoly(circ, poly, verts, internal){        // ★引数追加
  let minDepth=Infinity, nx=0, ny=0, found=false;
  let fbDepth=Infinity, fbx=0, fby=0;
  const isB = i => !internal || !internal[i];                // 元の輪郭に実在するエッジか
  // ★分解でできた細いパーツでは、実在するエッジが「向こう側の面」しか無いことがある
  //   （厚さ 10px の仕切りの上下両面を丸めると、下の丸みの点と上の丸みの点を結ぶ三角形が
  //   でき、実在するのは上の面の1辺だけになる）。下から少しめり込んだ円にこのパーツが
  //   接触を作ると、法線は上の面の向き・貫入量は仕切りの厚みぶん＝**反対側へ押し抜く**。
  //   実測：平行板コンデンサーモデルの仕切りの角で、電子が 1tick に 10px 後ろへ飛び、
  //   速さが 0 になっていた（貫入量 7.4〜25.9px。正しい隣のパーツは 0.2〜0.5px）。
  //   本当にその面から入ってきた円なら、中心は面の外か、裏へ入っていても半径までのはず。
  //   それより深い面は法線の候補にしない。分解していない凸形（internal なし）は対象外
  //   （深くめり込んだ円を押し出す役目がそのまま要る）。
  const cut = internal && internal.some(f => f);
  const cen = cut ? _centroid(verts) : null;
  let farReal = false;
  for(let i=0;i<verts.length;i++){
    const v1=verts[i], v2=verts[(i+1)%verts.length];
    const ex=v2.x-v1.x, ey=v2.y-v1.y, el=len(ex,ey)+0.001;   // ★変数名を el へ
    const ax=-ey/el, ay=ex/el;
    const pv=projectVertsOnAxis(verts,{x:ax,y:ay});
    const pc=projectCircleOnAxis(circ,{x:ax,y:ay});
    const ov=overlapOnAxis(pv,pc);
    if(ov<=0) return null;
    if(ov<fbDepth){ fbDepth=ov; fbx=ax; fby=ay; }
    if(!isB(i)) continue;                                    // ★内部エッジは法線候補にしない
    if (cut) {                                               // ★面の外向きに測った円の中心の高さ
      const sgn = ((cen.x-v1.x)*ax + (cen.y-v1.y)*ay) > 0 ? -1 : 1;
      if (sgn*((circ.x-v1.x)*ax + (circ.y-v1.y)*ay) < -circ.radius) { farReal = true; continue; }
    }
    if(ov<minDepth){ minDepth=ov; nx=ax; ny=ay; found=true; }
  }
  // 頂点軸：分離判定は従来どおり最近接頂点で行う（誤検出を増やさないため）
  let closest=Infinity, ci=0;
  for(let i=0;i<verts.length;i++){
    const v=verts[i]; const d=(v.x-circ.x)**2+(v.y-circ.y)**2;
    if(d<closest){closest=d;ci=i;}
  }
  const cv=verts[ci];
  const dd=Math.sqrt(closest)+0.001;
  const ax2=(cv.x-circ.x)/dd, ay2=(cv.y-circ.y)/dd;
  const pv2=projectVertsOnAxis(verts,{x:ax2,y:ay2});
  const pc2=projectCircleOnAxis(circ,{x:ax2,y:ay2});
  const ov2=overlapOnAxis(pv2,pc2);
  if(ov2<=0) return null;
  const prev=(ci-1+verts.length)%verts.length;
  const realCorner = isB(prev) && isB(ci);                   // ★切断で生まれた見かけの角は使わない
  if(realCorner && ov2<minDepth){ minDepth=ov2; nx=ax2; ny=ay2; found=true; }
  // ★実在する面が向こう側のものだけだったパーツは、接触を作らない（正しい面は隣のパーツが持つ）
  if(!found && farReal) return null;
  if(!found){ minDepth=fbDepth; nx=fbx; ny=fby; }
  const c=_centroid(verts);
  if((c.x-circ.x)*nx+(c.y-circ.y)*ny<0){ nx=-nx; ny=-ny; }
  return { A:circ, B:poly, nx, ny, depth:minDepth, sep:-minDepth,
           cx:circ.x+nx*circ.radius, cy:circ.y+ny*circ.radius };
}
// 「動かせない物体」＝静的、または編集ツールでドラッグ中（held）。
//   held はカーソルが位置を直接与えているので、接触で押し戻されるとカーソルとずれ、
//   マウスを止めている間は誰も戻さない。静的物体と同じ扱いに統一する。
const _pinned = b => b.isStatic || b.held;
// 「物理から見えない物体」＝ゴースト（レイヤーを全部外したもの）と生成口。
//   ★この2つは意味が違う（ゴーストは世界にある透明な物、生成口は物体の型）が、
//     当たらない・光も水も透過する、という一点で扱いがまったく同じなので、
//     判定を1か所にまとめる。各モジュールはこれだけを見ればよい。
const _ghostBody = b => b.layers === 0 || b.isSpawner;
function detectCollision(A, B, pk) {
  if (A.isSpawner || B.isSpawner) return null;   // ★生成口は誰とも当たらない
  if ((A.layers & B.layers) === 0) return null;
  // ★片方が〈手で動かす〉で動いているときは、固定どうしでも接触を探す（blockHandAgainstFixed）
  if (A.isStatic && B.isStatic && !A._remoteDrive && !B._remoteDrive) return null;
  const aa=A._aabb, ba=B._aabb;
  if (aa.maxX < ba.minX || ba.maxX < aa.minX || aa.maxY < ba.minY || ba.maxY < aa.minY) return null;
  if (pk === undefined) pk = A.id < B.id ? A.id + '_' + B.id : B.id + '_' + A.id;   // 単体呼び出し用の保険
  if (connectedPairs.has(pk)) return null;
  if (A.type==='circle' && B.type==='circle') {
    const c = collideCircleCircle(A, B);
    return c ? [c] : null;
  }
  const out = [];
  const poly = [];
  if (A.type==='circle') {                                  // 円 vs 凹ポリ（パーツ毎）
    const parts=B._worldParts(), fB=B.partEdgeInternal;     // ★
    for (let bi=0; bi<parts.length; bi++){
      const c=_satCirclePoly(A, B, parts[bi], fB?fB[bi]:null);   // ★
      if(c){ c.partA=-1; c.partB=bi; poly.push(c); }
    }
  } else if (B.type==='circle') {
    const parts=A._worldParts(), fA=A.partEdgeInternal;     // ★
    for (let ai=0; ai<parts.length; ai++){
      const c=_satCirclePoly(B, A, parts[ai], fA?fA[ai]:null);   // ★
      if(c){ c.partA=-1; c.partB=ai; poly.push(c); }
    }
  } else {                                                  // ポリ vs ポリ（パーツ総当たり）
    const pa=A._worldParts(), pb=B._worldParts();
    const fA=A.partEdgeInternal, fB=B.partEdgeInternal;     // ★
    // ★パーツごとの AABB で先にふるう。歯車のように凸パーツが多い形どうしは総当たりが
    //   積で効く（実測：歯数20と10の歯車＝53×25対で 9.2ms/tick）。SAT は重なりが正の
    //   ときしか接触を返さないので、AABB が離れている対を飛ばしても結果は1ビットも変わらない。
    //   ★外接円が離れている対も同じ理由で飛ばす。斜めに長いパーツは AABB が大きくなりすぎて
    //   ふるいを抜ける（時計デモの 80枚の歯車と 8枚の歯車：AABB だけでは1回に SAT 64回）。
    const bbB = pb.length > 1 ? B._worldPartBoxes() : null;
    const bbA = bbB ? A._worldPartBoxes() : null;
    for (let ai=0; ai<pa.length; ai++) {
     const bba = bbA ? bbA[ai] : null;
     if (bba && (bba.maxX < ba.minX || ba.maxX < bba.minX || bba.maxY < ba.minY || ba.maxY < bba.minY)) continue;
     for (let bi=0; bi<pb.length; bi++){
     if (bbB) { const q = bbB[bi];
       if (bba.maxX < q.minX || q.maxX < bba.minX || bba.maxY < q.minY || q.maxY < bba.minY) continue;
       const dx = q.cx - bba.cx, dy = q.cy - bba.cy, rr = q.r + bba.r;   // ★外接円でもふるう（下の★）
       if (dx*dx + dy*dy > rr*rr) continue; }
     const cs=_satConvexConvex(A, B, pa[ai], pb[bi],
                               fA?fA[ai]:null, fB?fB[bi]:null);  // ★
     if(cs) for(const c of cs){ c.partA=ai; c.partB=bi; poly.push(c); }
     }
    }
  }
  // ★円弧が受け持つ面にできた多角形の接触は、真円で作り直す。
  //   48角形の折れ線で解くと、面の継ぎ目ごとに法線が 7.5° 飛び、滑るたびに
  //   エネルギーが削られるため。判定は「接触点が円弧の面の上にあるか」で行う
  //   （SATの最小重なり軸では判定できない。お椀の底では外周の平らな面が円弧の面と
  //     平行で重なり量もほぼ同じになり、そちらが勝ってしまう）。
  //   多角形が重なりを検出した円弧だけを対象にするのが要点：円弧側だけで判定すると、
  //   へこみの円弧は「円の外の物体はすべてめり込み」と見てしまい、板の反対側に
  //   載っているだけの物体まで穴へ引き込む。
  let actA = null, actB = null;
  for (const c of poly) {
    const kA = A.arcs ? arcIndexOwning(A, c) : -1;
    if (kA >= 0) { (actA || (actA = new Set())).add(kA); continue; }
    const kB = B.arcs ? arcIndexOwning(B, c) : -1;
    if (kB >= 0) { (actB || (actB = new Set())).add(kB); continue; }
    out.push(c);
  }
  if (actA) collectArcContacts(out, B, A, actA);
  if (actB) collectArcContacts(out, A, B, actB);
  if (!out.length) return null;
  // ★ウォームスタート用の識別子。「どの物体対の・どの凸パーツ対の・何番目の接触点か」で
  //   決まる。物体が載っているあいだ同じ点は同じ id を保つので、前サブステップの
  //   力積をそのまま引き継げる。
  const seen = {};
  for (const c of out) {
    const key = (c.partA ?? -1) + '_' + (c.partB ?? -1);
    const n = (seen[key] = (seen[key] | 0) + 1) - 1;
    c.cid = c.A.id + '_' + c.B.id + '|' + key + '|' + n;
  }
  return out;
}
function collideCircleCircle(A, B) {
  const dx=B.x-A.x, dy=B.y-A.y;
  const dist2 = dx*dx+dy*dy;
  const radSum = A.radius+B.radius;
  if (dist2 >= radSum*radSum) return null;
  const dist = Math.sqrt(dist2) || 0.001;
  return { A, B, nx: dx/dist, ny: dy/dist, depth: radSum-dist, sep: dist-radSum,
    cx: A.x+A.radius*(dx/dist), cy: A.y+A.radius*(dy/dist) };
}
// ─── 手で動かしている物体 × 固定した物体 ──────────────────────────
//   ★リモコンの〈手で動かす〉で動いている物体（D）は、押している間は逆質量0の等速物体
//     （remote.js の★）。固定した物体（F）も逆質量0なので、無限質量どうしは力積では
//     押し合えない＝以前はそのまま素通りしていた（ブロック崩しのパドルが壁を抜ける・
//     クレーンの台車がレールの端を越える）。
//   ★規則：**固定した物は手の命令より強い**。F は本当に動かない物、D の速度は「この速さで
//     動け」という手の希望。両立しないときは希望のほうが譲る＝D の速度から「F へ
//     めり込む向きの成分」だけを取り除く。壁に沿って滑る向きは残す。動く物体を押すのは
//     今までどおり（こちらは力積で解ける）。2026-09-27、ユーザーの指摘で入れた。
//   ★位置は「このサブステップで入り込んだぶん」だけ戻す。重なりの深さで押し出すと、
//     はじめから固定の壁と重ねて置いてある板（自由膨張の右の壁と上下の壁）が、
//     押していない向きへ弾き出される。
//   ★速度は毎 tick の頭で applyRemoteDrives が書き直すので、ここで削っても次の tick には
//     また希望の速さに戻る＝押し続ければ毎 tick 当たり直して止まり続ける。
function blockHandAgainstFixed(cs, D, dt) {
  // 法線は A→B。D から F へ向かう向きにそろえる
  for (const c of cs) { const s = (c.A === D) ? 1 : -1; _blockHand(D, c.nx * s, c.ny * s, dt); }
}
// 地面も固定した物（地面の法線は外向き＝D から地面へは逆向き）
function blockHandAgainstGround(gcs, D, dt) {
  for (const g of gcs) _blockHand(D, -g.nx, -g.ny, dt);
}
// (nx, ny)＝D から固定した相手へ向かう向き
function _blockHand(D, nx, ny, dt) {
  const vIn = D.vx * nx + D.vy * ny;
  if (vIn <= 0) return;                  // 離れる向き・沿う向き＝何もしない
  D.vx -= vIn * nx; D.vy -= vIn * ny;
  D.x  -= vIn * nx * dt; D.y -= vIn * ny * dt;   // このサブステップで入り込んだぶんを戻す
  D._updateAABB();
}
// ─── 速度ソルブ（位置補正はしない）──────────────────────────────
//   使い方は3段階。geometry.js「接触ソルバの共通部」の解説も参照。
//     prepareContact          … サブステップの頭で1回。実効質量・vn0 を作る
//     applyContactWarm        … 全接触の prepare のあとで1回。前回の力積を打つ（★はその関数に）
//     solveContactNormal      … 反復。非貫入を、力積を積算しながら解く（反発は入れない）
//     solveContactFriction    … 反復。法線をブロックで解き終えたあとに、まとめて解く
//     applyContactRestitution … 最後。vn0 を種に反発をまとめて与える
//     finishContact           … 出した力積を次サブステップへ残す
// 接触点での相対速度（B から見た A ではなく、従来どおり A から見た B）を軸 (dx,dy) へ射影
function _relVelOn(c, dx, dy) {
  const { A, B } = c;
  const vAx = A.vx - A.av * c._rAy, vAy = A.vy + A.av * c._rAx;
  const vBx = B.vx - B.av * c._rBy, vBy = B.vy + B.av * c._rBx;
  return (vBx - vAx) * dx + (vBy - vAy) * dy;
}
function _contactApplyN(c, dJ) {
  if (!dJ) return;
  const { A, B, nx, ny, cx, cy } = c;
  A.applyImpulse(-dJ * nx, -dJ * ny, cx, cy);
  B.applyImpulse( dJ * nx,  dJ * ny, cx, cy);
  if (c._rec) {   // ★力積の「差分」を記録する。合計すると積算した力積そのものになる
    A.recordForce('normal', -dJ * nx, -dJ * ny, cx, cy, c._fkA);
    B.recordForce('normal',  dJ * nx,  dJ * ny, cx, cy, c._fkB);
  }
}
function _contactApplyT(c, dJ) {
  if (!dJ) return;
  const { A, B, cx, cy } = c;
  const tx = c._tdx, ty = c._tdy;
  A.applyImpulse(-dJ * tx, -dJ * ty, cx, cy);
  B.applyImpulse( dJ * tx,  dJ * ty, cx, cy);
  if (c._rec) {
    A.recordForce('friction', -dJ * tx, -dJ * ty, cx, cy, c._fkA);
    B.recordForce('friction',  dJ * tx,  dJ * ty, cx, cy, c._fkB);
  }
}
function prepareContact(c, dt) {
  const { A, B, nx, ny, cx, cy, partA, partB } = c;
  // ★見つけた時点の姿勢を控える（押し戻しを当てる点を選ぶのに使う。_contactDepthEstimate）
  c._poseA = [A.x, A.y, A.angle]; c._poseB = [B.x, B.y, B.angle];
  c._skip = true;
  if (A.sleeping && B.sleeping) return;
  // ★held（編集ツールでドラッグ中）は静的と同じく「動かせない」。相手が正しく
  //   跳ね返るよう、逆質量を0として解く（applyImpulse 側でも受け付けない）。
  const imA = _pinned(A) ? 0 : A.invMass, imB = _pinned(B) ? 0 : B.invMass;
  const iiA = _pinned(A) ? 0 : A.invInertia, iiB = _pinned(B) ? 0 : B.invInertia;
  const rAx = cx - A.x, rAy = cy - A.y;
  const rBx = cx - B.x, rBy = cy - B.y;
  const kn = imA + imB
           + (rAx*ny - rAy*nx) * (rAx*ny - rAy*nx) * iiA
           + (rBx*ny - rBy*nx) * (rBx*ny - rBy*nx) * iiB;
  if (!(kn > 0)) return;                               // 両方とも動かせない
  c._rAx = rAx; c._rAy = rAy; c._rBx = rBx; c._rBy = rBy;
  c._kn = kn;
  // ★逆質量を控えておく（面をまとめて解くとき、相互項 K12 を作るのに要る。
  //   prepareManifold は _pinned をもう一度見なくて済む）
  c._imA = imA; c._imB = imB; c._iiA = iiA; c._iiB = iiB;
  // 2次元では接線は法線に直交する向きで一意。向きを固定しておくと符号つきで
  // 力積を積算でき、静止摩擦が「前の反復と逆向きに打ち消し合う」ことがなくなる。
  const tdx = -ny, tdy = nx;
  c._tdx = tdx; c._tdy = tdy;
  c._kt = imA + imB
        + (rAx*tdy - rAy*tdx) * (rAx*tdy - rAy*tdx) * iiA
        + (rBx*tdy - rBy*tdx) * (rBx*tdy - rBy*tdx) * iiB;
  // サブステップ開始時の接近速度。反発はこの値だけを種にする（反復中の速度は使わない）
  const vAx = A.vx - A.av * rAy, vAy = A.vy + A.av * rAx;
  const vBx = B.vx - B.av * rBy, vBy = B.vy + B.av * rBx;
  const relVx = vBx - vAx, relVy = vBy - vAy;
  const vn0 = relVx * nx + relVy * ny;
  c._vn0  = vn0;
  c._vnPre = contactPreVel(A, B, rAx, rAy, rBx, rBy, nx, ny, dt);   // ★熱（impactHeatOf の★）
  c._vt0  = relVx * tdx + relVy * tdy;   // ★摩擦熱：サブステップ開始時のすべり速度
  // ★この一歩で位置を実際に進めた相対速度の接線成分（下の接線ずれの補正の★）。
  //   integrate は位置を「重力の半分だけ手前の速度」で進めるので、vt0 とはその半分だけ違う
  c._vtPos = c._vt0 - (((B._gHx || 0) - (A._gHx || 0)) * tdx + ((B._gHy || 0) - (A._gHy || 0)) * tdy);
  c._dt = dt;                            // ★接線ずれの補正で使う（下の★）
  c._drift = 0;
  c._bias = specBias(c.sep, dt);       // まだ触れていない点は隙間ぶんだけ近づいてよい
  const grabbed = A._grabbed || B._grabbed;
  // ★sep ≤ 0＝実際に触れている点だけが跳ね返る。1.5px 浮いたままの点は
  //   「まだぶつかっていない」ので反発を持たない（次のサブステップで本当に触れる）。
  // ★速度の下限は反発係数に応じて薄める（restitutionVelTh。units.js の★に実測）。
  //   e=1 の対には下限が掛からない＝「完全弾性は止まらない」が指定どおり守られる。
  const eAB = combineRestitution(A.restitution, B.restitution);
  c._e = (!grabbed && c.sep <= 0 && vn0 < -restitutionVelTh(eAB)) ? eAB : 0;
  c._rec = A.showForces || B.showForces;               // ★どちらも非表示ならキーを作らない
  if (c._rec) {
    const pk = (partA ?? -1) + '_' + (partB ?? -1);    // ★パーツ対のキー
    c._fkA = B.id + ':' + pk;
    c._fkB = A.id + ':' + pk;
  }
  // ★非弾性衝突の熱の門番。「本当にぶつかった」かどうかはここで決め、熱の量そのものは
  //   ソルバのあと（finishContact）に、実際に打った力積から出す（thermal.js の★）。
  c._hit = vn0 < -restitutionVelTh(c._e > 0 ? c._e : 0);   // ★門番は反発とまったく同じ式
  c._skip = false;
  // ★曲面に沿って滑るぶんは、速さを落とさず向きだけ変える（曲率が分かる円弧のみ）。
  //   1サブステップの間、物体は円弧ではなく弦の上を直進するので、その終わりには必ず
  //   壁へ向かう法線速度 ≒ v_t²·dt/r を持つ。これは離散化の副産物であって衝突ではない。
  //   非貫入で法線成分を消すと速さが hypot(v_t,v_n) → v_t に落ちるため、摩擦0でも
  //   毎サブステップぶんのエネルギーが熱に変わり、振り子が止まってしまう。
  //   消えるぶんを接線方向へ先回りして戻す＝連続時間なら曲面を滑るだけで速さが
  //   変わらない、という当たり前の挙動に一致させる。
  //   ★サブステップに1回だけ効かせる（反復のたびに効かせると増速する）。
  if (c.arcK !== undefined && c.arcR > 0 && vn0 < 0) {
    const stx = relVx - vn0 * nx, sty = relVy - vn0 * ny;
    const vt0 = len(stx, sty);
    if (vt0 > 1e-6) {
      // 曲面を追うために生じる見かけの法線速度は v_t²·dt/r。戻すのはこの分だけに限る。
      //   ・重力で壁へ押しつけられるぶんの法線速度は「本来存在しないもの」なので、
      //     消すのが正しい（戻すとエネルギーを増やしてしまう）。
      //   ・本当にぶつかった場合も、戻るのはこの微小量だけなので実質そのまま吸収される。
      const vCurv = vt0 * vt0 * dt / c.arcR;
      const vRes = Math.min(-vn0, vCurv);
      const want = Math.sqrt(vt0 * vt0 + vRes * vRes) - vt0;     // 接線へ戻すぶん
      // ★重心に加える（接触点に加えない）。曲率追従で失われたのは進む速さ＝並進の
      //   エネルギーだけで、スピンは何も損なわれていない。接触点に加えると腕の長さの
      //   ぶんだけ回転に配られてしまい（球なら 2/3 がスピン行き）、摩擦0では二度と
      //   並進に戻らないので、結局エネルギーが減り続ける。
      const km = imA + imB;
      if (want > 0 && km > 1e-12) {
        const js = want / km, tdirX = stx / vt0, tdirY = sty / vt0;
        A.applyImpulse(-js * tdirX, -js * tdirY);
        B.applyImpulse( js * tdirX,  js * tdirY);
      }
    }
  }
  c._jv = 0;                             // ★反発のあとの確認パス用（verifyContactNormal）
  // ★ウォームスタートはここでは打たない。全接触の vn0 を控え終えてから、
  //   step.js が applyContactWarm でまとめて打つ（下の★）。
  c._jn = 0; c._jt = 0; c._jnMax = 0;
}
// ── ウォームスタート：前サブステップの力積を初期値にして、そのぶんを先に打っておく ──
//   ★離れつつある接触には打たない（geometry.js の warmStartAllowed の★）
//   ★**全接触（地面も）の prepare が済んでから打つ。** 以前は prepareContact の末尾で
//     1点ずつ打っていたので、あとから準備される接触の vn0（＝熱の門番 _hit・反発・
//     熱の式の「ソルバの前の速さ」）に、先に準備された接触の打ち直しが混ざっていた。
//     重い物が押し合っていると打ち直しの力積が大きく、止まっている粒が「ぶつかった」
//     と判定されて、ソルバが同じサブステップで打ち消すぶんが熱として計上される。
//     実測（ジュールの実験の袋を板16枚＋蝶番の輪に組み替え、鉛の粒27個・h=2.14m）：
//                          失った力学的E   計上した熱（旧）   （新）
//         落ちて 0〜3秒       21.5 kJ        35.2 kJ(163%)    20.1 kJ(93%)
//         着地後 10〜30秒      0 J            1,034 J          0 J
//     ＝着地後に湧き続けていた熱は全部これ（袋は動いていない）。力学は変わらない。
//     全デモ 300tick の突き合わせ：110本中 96本は1ビットも同じ。熱だけ変わったのは
//     ピストンのつりあい（熱−力学的Eの減り +10.8kJ → +0.4kJ）・エレベーターの中の
//     体重計（何も動かないのに 1,924 J → 0 J）・袋を振る（落とすだけで 116% → 97%）。
//     動きが変わったのは はしご（旧は 1〜4m の窪みでも 50秒で 60°→57.3° と這い
//     滑っていた → 変位 0.0px に戻り、5m・6m だけ滑る＝そちらの★どおり）ほか、
//     オームの法則モデル（電流 123→121）・浮力（揺らぎの範囲）。
function applyContactWarm(c, dt) {
  if (c._skip) return;
  const w = warmStartAllowed(c._vn0, dt) ? warmOf(c.cid) : null;
  c._jn = w ? w.jn : 0;
  c._jt = w ? w.jt : 0;
  c._jnMax = c._jn;
  _contactApplyN(c, c._jn);
  _contactApplyT(c, c._jt);
}
// ── 非貫入：目標は vn ≥ bias（bias は投機的接触ぶん。触れている点では 0）──
//   力積の「合計」を 0 以上に保つのが要点。押す力しか出せないという条件を
//   合計に課すことで、この反復は同時解へ収束する（＝解く順序が答えを変えない）。
function solveContactNormal(c) {
  if (c._skip) return;
  let dJn = -(_relVelOn(c, c.nx, c.ny) - c._bias) / c._kn;
  const jn = Math.max(c._jn + dJn, 0);
  dJn = jn - c._jn; c._jn = jn;
  if (jn > c._jnMax) c._jnMax = jn;      // 反発パスの「本当にぶつかったか」判定に使う
  _contactApplyN(c, dJn);
}
// ── 摩擦：合計を μ·jn で頭打ち（クーロン）──
function solveContactFriction(c) {
  if (c._skip || !(c._kt > 0)) return;
  let dJt = -_relVelOn(c, c._tdx, c._tdy) / c._kt;
  const want = c._jt + dJt;
  // ★μ はサブステップ開始時のすべり速度で決める（geometry.js の frictionCoef の★）
  const lim = frictionCoef(c.A, c.B, c._vt0) * c._jn;
  const jt = Math.max(-lim, Math.min(lim, want));
  dJt = jt - c._jt; c._jt = jt;
  _contactApplyT(c, dJt);
}
// ── 接線方向の位置ずれを戻す（静止摩擦の位置拘束）──────────────────
//   ★なぜ要るか。integrate は「v += a·dt」と「x += v·dt」を続けて行い、接触ソルバは
//     そのあとで**速度だけ**を消す。だから重力が1サブステップぶん進めた位置 a·dt² は
//     誰も戻さず、その斜面方向の成分が毎サブステップ積み上がる。
//     ＝ 静止摩擦が足りていても、斜面に置いた物体がじわじわずり落ちる。
//     実測（μs=0.5・眠りOFF・60秒）：10°で 42.6px、20°で 83.9px。ずれの速さは
//     g·sinθ·dt にぴったり一致し（予測 0.710 / 1.398 px/s、実測 0.710 / 1.398）、
//     substeps を 4→8→16 と倍にすると 0.710→0.355→0.177 と半減した。
//   ★substeps を上げるのは対症療法。実際、以前あった斜面のデモは substeps=16 にして
//     「斜面の上で止めておくため」と書いてあったが、それでも 10.6px/分 残る。
//   ★戻す量は「ソルバが実際に消した速度 × dt」＝ (vt0 − vt1)·dt にする。
//     ☆2026-09-27 から integrate は位置を「重力の半分だけ手前の速度」で進める（body.js の★）。
//       位置が実際に進んだのは vt0 ではなくその速度（_vtPos）なので、戻す量も (vtPos − vt1)·dt。
//       vt0 のままだと戻しすぎて、10°の斜面に置いた箱が 60秒で 21px 上へ這い上がった。
//     これは**位置を、拘束を解いたあとの速度で進めたことにする**操作で、半陰的
//     オイラーを一貫させているだけ（x は v_after·dt だけ進むのが本来）。
//     ・止まっている接触：vt1≈0 なので vt0·dt を丸ごと戻す ＝ ずり落ちが消える
//     ・すべっている接触：vt0≈vt1 なので戻す量はほぼ 0 ＝ 滑走を邪魔しない
//     ☆最初は「摩擦円錐の縁に張り付いたか」で場合分けしていたが、それだと
//       境目のすべりを掴んで離さず、**静止摩擦の閾値が μs·N から 16% 上がった**
//       （実測：引いて動き出す力が 49.52N → 56.88N。理論は 49.03N）。
//       消した速度ぶんだけ戻す形にすると 49.52N のまま変わらない。場合分けも要らない。
//   ★1サブステップに一度だけ効かせる（step.js が貫入の補正とは別に1回呼ぶ）。
const CONTACT_DRIFT_MAX = 2;      // [px] 1サブステップで戻す上限（物理量は 0.003px 程度）
// 戻す量 [px]。★実際に進んだ距離 vtPos·dt のうち、ソルバが消した割合 (vt0−vt1)/vt0 だけ戻す。
//   ☆2026-09-27 まで (vtPos − vt1)·dt だった。止まっている接触（vt1≈0）では同じだが、
//     すべっている接触（vt1≈vt0）で 0 にならず、vt0 − vtPos（重力・ばねの後ろ半分）が
//     残って「位置を丸ごとの速度で進めたこと」にしてしまう＝速度ベルレを接触のあいだだけ
//     崩していた。重力（斜面方向の成分）では害が小さく見えなかったが、理想ばねを半分ずつに
//     したとき（slinky.js の applyIdealSprings の★）に表に出た。実測（2本のばねのデモ・
//     摩擦0の床の上の台車・振幅 150px）：旧の式では振幅が 30秒で 150.0 → 140.1px に減る。
//     この式にすると 150.0px のまま。
//   割合は 0〜1 に丸める（摩擦は速度を 0 へ寄せるだけなので、はみ出すのは丸めの誤差）。
//   vt0 がほぼ 0 のときは割合が決まらないので、旧の式（止まっている接触と同じ）へ落とす。
function contactDrift(vt0, vtPos, vt1, dt) {
  if (Math.abs(vt0) < 1e-9) return (vtPos - vt1) * dt;
  let f = (vt0 - vt1) / vt0;
  if (f < 0) f = 0; else if (f > 1) f = 1;
  return f * vtPos * dt;
}
function correctContactTangentialDrift(c) {
  if (c._skip || !(c._jn > 0)) return;
  const { A, B } = c;
  if (A.sleeping && B.sleeping) return;
  const imA = _pinned(A) ? 0 : A.invMass, imB = _pinned(B) ? 0 : B.invMass;
  const totalInv = imA + imB;
  if (totalInv === 0) return;
  let d = c._drift;                                   // ＝ B が A に対してずれた量 [px]
  if (!(d === d) || d === 0) return;
  if (d >  CONTACT_DRIFT_MAX) d =  CONTACT_DRIFT_MAX;
  else if (d < -CONTACT_DRIFT_MAX) d = -CONTACT_DRIFT_MAX;
  const s = d / totalInv, tx = c._tdx, ty = c._tdy;
  if (imA) { A.x += tx * s * imA; A.y += ty * s * imA; A._updateAABB(); }
  if (imB) { B.x -= tx * s * imB; B.y -= ty * s * imB; B._updateAABB(); }
}
// 反発を最後にまとめて与える。種はサブステップ開始時の接近速度 vn0 だけなので、
//   ・反復の途中で膨らんだ接近速度が混ざらない＝跳ね返りでエネルギーが増えない
//   ・複数の接触点が同じ vn0 を見るので、平らに落ちた長方形は左右対称に跳ねる
// jn ≤ 0（結局は押していない点）は、そもそもぶつかっていないので跳ねない。
function applyContactRestitution(c) {
  if (c._skip || c._e <= 0 || c._jnMax <= 0) return;
  const target = -c._e * c._vn0;                 // 出ていってほしい法線速度（正）
  // ★ここで「もう target を満たしているから何もしない」と早期に抜けてはいけない。
  //   複数点マニフォールドでは、先に解いた点の力積があとの点を持ち上げ、その反作用で
  //   先の点が target を超える。抜けてしまうとその行き過ぎを誰も戻せず、反復しても
  //   左右非対称なまま止まる（＝平らに落ちた長方形が回る）。負の差分もそのまま打ち、
  //   合計を 0 以上に丸める射影 Gauss-Seidel にすれば対称解へ収束する。
  let dJn = -(_relVelOn(c, c.nx, c.ny) - target) / c._kn;
  const jn = Math.max(c._jn + dJn, 0);
  dJn = jn - c._jn; c._jn = jn;
  _contactApplyN(c, dJn);
}
// ── 反発のあとの確認：すでにそこにある壁へ向かっては跳ね返れない ──────────────
//   ★向かい合う2面に挟まれた物体では、片側が「+δ で跳ね返れ」と与えた速度が、そのまま
//     反対側の面への接近速度になる。反発は vn0 だけを種にする＝相手側の要求を見ないので、
//     両者が要求し合ったまま解かれ、力学的エネルギーが際限なく増える（step.js の★）。
//     反発を配り終えたあとに、非貫入だけをもう一度確かめて打ち消す。
//   ★積算は `_jv` に分ける（`_jn` を使い回さない）。ここが要点で、共通の積算に足すと
//     射影の下限 0 が「非貫入ぶん＋反発ぶん」の合計に掛かり、**反発の力積そのものを
//     削れてしまう**。実測（自由膨張デモの仕切りを解き放ち、820px/s で右の壁へ
//     激突させて 20秒）：
//         積算を共有   E/E0 0.5655（−43%）・気体が 20→−108.8℃ まで冷える
//         積算を分ける E/E0 1.0088 ＝ 確認パス無しと 1ビットも変わらない
//     ここは「押す向きの力積を足すだけ」でなければならず、下限 0 はその足したぶんに
//     だけ掛ける。この取り違えが、以前この案を見送った理由（激突1回で 21% 落ちる）だった。
function verifyContactNormal(c) {
  if (c._skip) return;
  let dJ = -(_relVelOn(c, c.nx, c.ny) - c._bias) / c._kn;
  const jv = Math.max(c._jv + dJ, 0);
  dJ = jv - c._jv; c._jv = jv;
  _contactApplyN(c, dJ);
}
// ════════════════════════════════════════
//  面（同じ法線を共有する2接点）をまとめて解く
//
//  ★なぜ要るか。上の (1) は「実効質量行列は対称正定値なので Gauss-Seidel は同時解へ
//    収束する」と書いているが、これは反復を無限に回したときの話である。平らな面の接触は
//    2点が同じ法線を共有していて、行列が悪条件になる（長方形なら K12/K11 = 1 − 2a²·(1/I)/kn
//    で、幅 20px・高さ 370px の板では 0.991）。既定の world.iterations=8 では
//    力積の配分が一意解に届かず、残差が回転として残る。
//    実測（すきま0の溝に挟まった 20×370px の板・反発1）：法線パスの jn は
//      110.0 / 1.9 → 8反復後 98.2 / 13.5（一意解は 55.5 / 55.5）。
//    残差の乗った速度に (2) の反発パスが -e·vn0 を各点へ独立に積むので、出ていく速さが
//    入ってきた速さを 1バウンドあたり約2%上回り、離れられない配置では際限なく溜まる
//    （600tick で運動エネルギーが 2.04倍。溝に 2px の隙間があるか e<1 なら起きない）。
//    反復を 200 まで上げると 1.000倍に戻るので、欠けているのは規則ではなく解の精度である。
//
//  ★直しかた。2点なら 2×2 の相補性問題なので、反復せずに閉じた形で解ける。
//    Box2D の block solver と同じ4通りの場合分け（両方が押す／片方だけ／どちらも押さない）
//    で、x ≥ 0 かつ vn ≥ 目標 を満たす組を選ぶ。
//  ★接触点が1つの物体（円）や、e=0 の接触（積み上げ・斜面・摩擦）では、この式は
//    いままでの逐次解と厳密に一致する。動くのは「面で当たって跳ね返る接触」だけ。
//  ★面と認めるのは法線がそろっている2点だけ。角と面のように法線が違う2点は独立な
//    拘束なので、まとめて解くと嘘になる（そのまま逐次へ落とす）。
//    ★判定は「近い」ではなく**完全一致**にする。面接触の2点は同じクリップから出るので、
//      法線は同じ値がそのまま2つに複製される。許容幅つきの閾値を置くと、根拠の無い
//      数値を1つ増やすだけで何も拾わない（実測：積み上げ・自由膨張・回る板・斜面の
//      4シーン 600tick で 2点マニフォールドは 12,522 例、**全部が完全一致**。
//      内積が 1 未満のものは 1 件も無かった）。
// ════════════════════════════════════════
function prepareManifold(cs) {
  cs._block = false;
  if (cs.length !== 2) return;
  const [a, b] = cs;
  if (a._skip || b._skip) return;
  if (a.nx !== b.nx || a.ny !== b.ny) return;
  const nx = a.nx, ny = a.ny;
  const raA = a._rAx * ny - a._rAy * nx, rbA = a._rBx * ny - a._rBy * nx;
  const raB = b._rAx * ny - b._rAy * nx, rbB = b._rBx * ny - b._rBy * nx;
  const k12 = a._imA + a._imB + raA * raB * a._iiA + rbA * rbB * a._iiB;
  const det = a._kn * b._kn - k12 * k12;
  // 2点が重なっている＝1点と同じ。ゼロ除算になるので逐次に任せる（物理は同じ）。
  //   ★実測：3シーン 600tick で 2点マニフォールド 13,026 例のうち、ここへ落ちたのは 1 例だけ。
  //   ★det/(k11·k22) がそのまま条件数で、逐次 Gauss-Seidel が効くかどうかを表す：
  //       積み上げた箱          0.96      ← 素直。逐次でも 8反復で足りていた
  //       自由膨張の仕切り      0.034
  //       すきま0の溝の板       0.000015  ← ここが逐次では解けなかった場所
  if (!(det > 1e-12)) return;
  cs._k12 = k12; cs._det = det; cs._block = true;
}
// 目標 t1,t2 に対して 2×2 を直接解き、力積の差分を打つ。
function _solveManifold(cs, t1, t2) {
  const [a, b] = cs;
  const k11 = a._kn, k22 = b._kn, k12 = cs._k12, det = cs._det;
  const x1 = a._jn, x2 = b._jn;
  // いまの相対速度から、積んである力積のぶんを取り除いた「素の接近速度」
  const w1 = _relVelOn(a, a.nx, a.ny) - (k11 * x1 + k12 * x2);
  const w2 = _relVelOn(b, b.nx, b.ny) - (k12 * x1 + k22 * x2);
  const c1 = w1 - t1, c2 = w2 - t2;
  let y1, y2;
  // ① 2点とも押す
  y1 = (-c1 * k22 + c2 * k12) / det;
  y2 = (-c2 * k11 + c1 * k12) / det;
  if (y1 < 0 || y2 < 0) {
    // ② 1点目だけ押す
    y1 = -c1 / k11; y2 = 0;
    if (!(y1 >= 0 && k12 * y1 + c2 >= 0)) {
      // ③ 2点目だけ押す
      y1 = 0; y2 = -c2 / k22;
      if (!(y2 >= 0 && k12 * y2 + c1 >= 0)) {
        // ④ どちらも押さない
        y1 = 0; y2 = 0;
        if (!(c1 >= 0 && c2 >= 0)) return false;   // どれも成り立たない＝逐次へ逃がす
      }
    }
  }
  a._jn = y1; if (y1 > a._jnMax) a._jnMax = y1;
  b._jn = y2; if (y2 > b._jnMax) b._jnMax = y2;
  _contactApplyN(a, y1 - x1);
  _contactApplyN(b, y2 - x2);
  return true;
}
function solveManifoldNormal(cs) {
  if (cs._block && _solveManifold(cs, cs[0]._bias, cs[1]._bias)) return;
  for (const c of cs) solveContactNormal(c);
}
// 反発も同じ形で解く。跳ねない点（e=0・結局押していない点）の目標は非貫入のまま＝
//   跳ねる点の力積で押し戻されて食い込む、ということが起きない。
function applyManifoldRestitution(cs) {
  if (cs._block) {
    const t = [0, 0];
    let any = false;
    for (let i = 0; i < 2; i++) {
      const c = cs[i];
      if (c._e > 0 && c._jnMax > 0) { t[i] = -c._e * c._vn0; any = true; }
      else                          { t[i] = c._bias; }
    }
    if (!any) return;
    if (_solveManifold(cs, t[0], t[1])) return;
  }
  for (const c of cs) applyContactRestitution(c);
}
function finishContact(c) {
  if (c._skip) return;
  storeWarm(c.cid, c._jnWarm !== undefined ? c._jnWarm : c._jn, c._jt);   // ★反発ぶんは残さない
  // ★すべった距離ぶんの摩擦仕事を熱にする。_jt はこのサブステップで積んだ
  //   接線力積の合計、すべり速度は開始時と終了時の平均を使う。
  const vt1 = _relVelOn(c, c._tdx, c._tdy);
  addFrictionHeat(c.A, c.B, c._jt, c._vt0, vt1);
  // ★ソルバが消した接線速度ぶんの位置ずれ（correctContactTangentialDrift の★）
  c._drift = contactDrift(c._vt0, c._vtPos, vt1, c._dt);
  // ★跳ね返りきらなかったぶんは熱。摩擦とまったく同じ形（力積 × 前後の速度の平均）で、
  //   法線について書いたもの。**力積は `_jn` と `_jv` の合計**：確認パスは積算を分けて
  //   持つので（verifyContactNormal の★）、片方だけ見ると打った力積を取りこぼす。
  addDissipatedHeat(c.A, c.B,
    impactHeatOf(c._jn + c._jv, c._vn0, _relVelOn(c, c.nx, c.ny), c._hit, c._vnPre));
}
function _projectShapeOnAxis(body, partIndex, axis){
  if (body.type==='circle') return projectCircleOnAxis(body, axis);
  const parts=body.convexParts;
  if (!parts || partIndex==null || partIndex<0 || !parts[partIndex])
    return projectVertsOnAxis(body._worldVerts(), axis);   // フォールバック
  return projectVertsOnAxis(body._worldPartAt(partIndex), axis);
}
// ── 位置の押し戻し（めり込みを戻す）─────────────────────────────
//   ★押し戻しは接触点に当てる擬似力積として解き、並進だけでなく向きも直す（2026-09-27）。
//     実効質量には回転の項 (r×n)²/I を入れる（速度側の prepareContact と同じ）。
//   ★以前は並進だけで押し戻していた。ふつうの物体ならそれで抜けるが、軸（ヒンジ・モーター）で
//     留めた物体は並進を軸がすぐ元へ戻すので、押し戻しが正味 0 になっていた（実測：腕の角度を
//     段ごとに積算すると、押し戻しの寄与はちょうど 0°）。めり込みは毎サブステップ積もる：
//     integrate が力で速度を足してから位置を進めるので、接触を解く前にもう a·dt² ぶん入り込んで
//     いる。速度はソルバが 0 にするが（実測：反復の終わりで法線速度 0.0・角速度 0.000）、
//     入り込んだ位置を戻せるのはここだけだった。
//     実測（背景の軸に留めた 6kg の腕の先を、固定の留め具が上から押さえる。2秒／10秒）：
//         吊りおもり 80kg     旧 153.5° 回って抜けた（めり込み 11.9px）→ 新 0.43°（1.2px）
//         同じトルクを動力で   旧 359° → 3242°                          → 新 0.05°（0px）
//         吊りおもり 20kg     旧 2.7°（止まってはいたが 10.8px めり込んでいた）→ 新 0.25°（0.5px）
//     おもりの重さがヒンジ → 軽い腕 と伝わる形の問題に見えたが、動力で同じトルクをかけても
//     同じように抜けたので、質量比ではなく「軸で留めた物体」の問題だった。
//     地面も同じ形だった（ground.js の correctGroundPosition の★）。
//   ★押し戻しは「面ごとに1回」、いちばん深いところに当てる（correctManifoldPosition）。
//     深さはいまの形で測り直す（凸パーツを法線へ投影。これまでと同じ測り方）。当てる点は
//     点ごとの深さの見積もりが最大から 0.5px 以内の点の平均＝平らに載った面なら2点の中点で
//     腕の長さ r×n が 0 ＝ これまでとまったく同じ並進だけの押し戻しになる。
//     ☆試して捨てた形が2つある：
//       ・点ごとに、面全体の深さで押す … 平らに載った箱の2つの角が互いに「相手の角の深さ」で
//         押し合って揺れた（実測：投石機の城の積み木が 10秒で 23.3px 崩れた。いまは 1.95px。
//         並進だけのころは 2.5px）。
//       ・点ごとに、その点の深さの見積もりで押す … 見積もりは「見つけたときの sep ＋ その点が
//         動いたぶん」なので、角を乗り越えるときのように本当にめり込んでいる所が見つけた点と
//         違うと、回しても見積もりが減らず回し続けた（実測：ジュールの実験（斜面）で鉛の
//         ブロックが斜面の下の角で −65° まではね、ΔT が 0.2179℃＝理論の 133% に。いまは
//         0.1630℃、並進だけのころは 0.1634℃、理論 0.164℃）。
//   ★全デモ 300 tick の突き合わせで変わったものは、各デモの★の読みで確かめた（はしご・
//     物体が傾く条件・ジュールの実験2本・エレベーター・電気振動・オームの法則モデル・
//     よろよろ走り・浮力・投石機）。電子の模型と浮力の「水と同じ」は、旧のままでも 0.001px
//     ずらすだけで同じ幅に散る（オームの電流 118〜129・水と同じの高さ 173↔186px）。
function _pushApart(A, B, nx, ny, px, py, depth) {
  const imA = _pinned(A) ? 0 : A.invMass, imB = _pinned(B) ? 0 : B.invMass;
  const iiA = _pinned(A) ? 0 : A.invInertia, iiB = _pinned(B) ? 0 : B.invInertia;
  const rnA = (px - A.x) * ny - (py - A.y) * nx, rnB = (px - B.x) * ny - (py - B.y) * nx;
  const K = imA + imB + iiA * rnA * rnA + iiB * rnB * rnB;
  if (!(K > 0)) return;
  const slop = 0.5, percent = 0.8;
  const lam = Math.max(depth - slop, 0) * percent / K;
  if (!(lam > 0)) return;
  if (imA || iiA) { A.x -= nx * lam * imA; A.y -= ny * lam * imA; A.angle -= iiA * rnA * lam; A._updateAABB(); }
  if (imB || iiB) { B.x += nx * lam * imB; B.y += ny * lam * imB; B.angle += iiB * rnB * lam; B._updateAABB(); }
}
// 点ごとの深さの見積もり：見つけたときの sep に、その点が A・B それぞれにくっついて
//   動いたぶんの差（法線方向）を足す。★当てる点を選ぶためだけに使う（深さそのものは
//   形から測り直す。上の☆）。円は中心だけを追う（接点はいつも中心から法線の逆へ半径）。
function _contactDepthEstimate(c) {
  if (!c._poseA) return -c.sep;
  const moved = (b, pose) => {
    if (b.type === 'circle') return { x: b.x - pose[0], y: b.y - pose[1] };
    const da = b.angle - pose[2], rx = c.cx - pose[0], ry = c.cy - pose[1];
    const co = Math.cos(da), si = Math.sin(da);
    return { x: b.x + rx*co - ry*si - c.cx, y: b.y + rx*si + ry*co - c.cy };
  };
  const dA = moved(c.A, c._poseA), dB = moved(c.B, c._poseB);
  return -(c.sep + (dB.x - dA.x) * c.nx + (dB.y - dA.y) * c.ny);
}
function correctManifoldPosition(cs) {
  // 同じ凸パーツの組・同じ法線の点を1つの面にまとめる（円弧の接触は1点ずつ）
  const faces = new Map();
  for (const c of cs) {
    if (c.arcK !== undefined) { correctContactPosition(c); continue; }
    const k = c.partA + '_' + c.partB + '_' + c.nx + '_' + c.ny;
    (faces.get(k) || (faces.set(k, []), faces.get(k))).push(c);
  }
  for (const f of faces.values()) {
    const c0 = f[0], A = c0.A, B = c0.B;
    if (A.sleeping && B.sleeping) continue;
    if (_pinned(A) && _pinned(B)) continue;
    const axis = { x: c0.nx, y: c0.ny };
    // ★本体全体ではなく、接触した凸パーツで貫入量を測る
    const pa = _projectShapeOnAxis(A, c0.partA, axis), pb = _projectShapeOnAxis(B, c0.partB, axis);
    const depth = pa.max - pb.min;
    if (!(depth > 0)) continue;
    const d = f.map(_contactDepthEstimate), dMax = Math.max(...d);
    let px = 0, py = 0, k = 0;
    f.forEach((c, i) => { if (d[i] >= dMax - 0.5) { px += c.cx; py += c.cy; k++; } });
    _pushApart(A, B, c0.nx, c0.ny, px / k, py / k, depth);
  }
}
// 1点ぶん（円弧の接触はここ。真円の法線と深さをその場で測り直す）
function correctContactPosition(c) {
  const { A, B } = c;
  if (A.sleeping && B.sleeping) return;
  if (_pinned(A) && _pinned(B)) return;
  let nx = c.nx, ny = c.ny, depth;
  if (c.arcK !== undefined) {
    // ★円弧の接触：多角形の面に投影すると折れ線の貫入量に戻ってしまうので、
    //   毎回この場で真円の法線と貫入量を測り直す。
    const g = arcContactGeom(c);
    if (!g) return;
    nx = g.nx; ny = g.ny; depth = g.depth;
  } else {
    const axis = { x: nx, y: ny };
    const pa = _projectShapeOnAxis(A, c.partA, axis);
    const pb = _projectShapeOnAxis(B, c.partB, axis);
    depth = pa.max - pb.min;
  }
  if (depth <= 0) return;
  _pushApart(A, B, nx, ny, c.cx, c.cy, depth);
}
// ─── Joint (Spring / Hinge / Rope) ───
