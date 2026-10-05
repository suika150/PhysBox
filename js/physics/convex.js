function getLocalAnchor(body, wx, wy) {
  if (!body) return { x: wx, y: wy };
  const cos = Math.cos(-body.angle), sin = Math.sin(-body.angle);
  const dx = wx - body.x, dy = wy - body.y;
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos
  };
}
function getWorldAnchor(body, localX, localY) {
  if (!body) return { x: localX, y: localY };
  const cos = Math.cos(body.angle), sin = Math.sin(body.angle);
  return {
    x: body.x + localX * cos - localY * sin,
    y: body.y + localX * sin + localY * cos
  };
}
// ─── SAT Collision Detection ─────────
function projectVertsOnAxis(verts, ax) {
  let min=Infinity, max=-Infinity;
  for (const v of verts) {
    const d = v.x*ax.x + v.y*ax.y;
    if (d<min) min=d; if (d>max) max=d;
  }
  return {min, max};
}
function projectCircleOnAxis(body, ax) {
  const d = body.x*ax.x + body.y*ax.y;
  return {min: d-body.radius, max: d+body.radius};
}
function overlapOnAxis(a, b) {
  if (a.min > b.max || b.min > a.max) return 0;
  return Math.min(a.max-b.min, b.max-a.min);
}
// ─── 凹ポリゴンを凸パーツへ分解（SATは凸専用のため必須） ───
function _sArea(v){ let a=0; for(let i=0;i<v.length;i++){const p=v[i],q=v[(i+1)%v.length]; a+=p.x*q.y-q.x*p.y;} return a*0.5; }
function _turn(a,b,c){ return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x); }
function _sameVert(a,b){ return a.x===b.x && a.y===b.y; }
function isConvexPoly(v){
  const n=v.length; if(n<3) return false;
  let sign=0;
  for(let i=0;i<n;i++){
    const c=_turn(v[i], v[(i+1)%n], v[(i+2)%n]);
    if(Math.abs(c)<1e-9) continue;
    const s=c>0?1:-1;
    if(sign===0) sign=s; else if(s!==sign) return false;
  }
  return true;
}
// ── 輪郭から「同じ位置の頂点」を取り除く ────────────────────────────
//   多角形ツールはクリックのたびに点を足すだけなので、確定のダブルクリックで
//   最後の1点が二重に入る。長さ0の辺ができると耳刈りがその頂点を永久に刈れず
//   （_turn が 0 で耳と判定されない）、分割が途中で打ち切られて図形の一部が
//   当たり判定から丸ごと抜け落ちる（見た目はあるのにすり抜ける）。
function dedupePolyLoop(loop){
  if(!loop || loop.length<3) return loop || [];
  const same=(a,b)=>Math.abs(a.x-b.x)<1e-6 && Math.abs(a.y-b.y)<1e-6;
  const out=[];
  for(const p of loop){ if(out.length && same(out[out.length-1], p)) continue; out.push(p); }
  while(out.length>=2 && same(out[0], out[out.length-1])) out.pop();
  return out.length>=3 ? out : loop;
}
// 耳刈り三角形分割（凸三角形を必ず生成・無限ループ回避のガード付き）
function triangulate(verts){
  if(!verts || verts.length<3) return [];
  let v=dedupePolyLoop(verts).map(p=>({x:p.x,y:p.y}));
  if(v.length<3) return [];
  if(_sArea(v)<0) v.reverse();
  const idx=[]; for(let i=0;i<v.length;i++) idx.push(i);
  const tris=[];
  const inTri=(p,a,b,c)=>{
    const d1=_turn(a,b,p), d2=_turn(b,c,p), d3=_turn(c,a,p);
    const neg=(d1<0)||(d2<0)||(d3<0), pos=(d1>0)||(d2>0)||(d3>0);
    return !(neg&&pos);
  };
  let guard=0;
  while(idx.length>3 && guard++<20000){
    let clipped=false; const m=idx.length;
    for(let k=0;k<m;k++){
      const ia=idx[(k-1+m)%m], ib=idx[k], ic=idx[(k+1)%m];
      const a=v[ia], b=v[ib], c=v[ic];
      if(_turn(a,b,c)<=0) continue;              // reflex/collinear は耳ではない
      let ear=true;
      for(let t=0;t<m;t++){
        const it=idx[t];
        if(it===ia||it===ib||it===ic) continue;
        if(inTri(v[it],a,b,c)){ ear=false; break; }
      }
      if(ear){ tris.push([a,b,c]); idx.splice(k,1); clipped=true; break; }
    }
    if(!clipped){
      // ★耳が1つも見つからない＝退化した頂点で詰まっている。ここで打ち切ると
      //   残りの面積がまるごと当たり判定から消える（すり抜けの原因）。
      //   面積を変えない頂点（重複・共線＝三角形の面積が0）を1つ落として続行する。
      let drop=-1, best=Infinity;
      for(let k=0;k<m;k++){
        const ar=Math.abs(_turn(v[idx[(k-1+m)%m]], v[idx[k]], v[idx[(k+1)%m]]));
        if(ar<best){ best=ar; drop=k; }
      }
      if(drop>=0 && best<1e-6){ idx.splice(drop,1); continue; }
      break;                                     // 落とせる頂点が無い＝本当に退化
    }
  }
  if(idx.length===3) tris.push([v[idx[0]],v[idx[1]],v[idx[2]]]);
  return tris;
}
// 隣接凸を「凸を保てる限り」貪欲に結合（内部エッジを減らし引っ掛かりを軽減）
function _tryMerge(P,Q){
  const np=P.length, nq=Q.length;
  for(let i=0;i<np;i++){
    const p1=P[i], p2=P[(i+1)%np];
    for(let j=0;j<nq;j++){
      const q1=Q[j], q2=Q[(j+1)%nq];
      if(_sameVert(p1,q2) && _sameVert(p2,q1)){   // 共有エッジ（逆向き）を検出
        const merged=[];
        for(let k=0;k<np;k++) merged.push(P[(i+1+k)%np]); // p2..p1
        let idx=(j+2)%nq; while(idx!==j){ merged.push(Q[idx]); idx=(idx+1)%nq; }
        if(merged.length>=3 && isConvexPoly(merged)) return merged;
        return null;
      }
    }
  }
  return null;
}
// ★Hertel–Mehlhorn：三角形どうしの共有辺（対角線）を長い順に1本ずつ消し、凸が保てれば結合する。
//   以前は「最初に見つかった結合できる対」を結合しては先頭から探し直す形で、上限 500 回で
//   打ち切っていた。三角形が 500 を超える形は結合しきれずに残っていた
//   （80枚の歯車：三角形 958 個 → 458 個で打ち切り。分解に 27 秒）。
//   共有辺を辺の表で引くので一回り（80枚の歯車で 0.07 秒）。長い対角線から消すのは、
//   形の中を横切る辺ほど先に消えて、パーツが輪郭に沿った小さな凸にまとまるため。
function mergeConvex(polys){
  const list=polys.map(p=>p.slice()), alive=list.map(()=>true);
  const key=(p,q)=>p.x+','+p.y+'>'+q.x+','+q.y;
  const owner=new Map();
  const reg=k=>{ const P=list[k]; for(let i=0;i<P.length;i++) owner.set(key(P[i],P[(i+1)%P.length]),k); };
  for(let k=0;k<list.length;k++) reg(k);
  const diags=[];
  for(let k=0;k<list.length;k++){ const P=list[k]; for(let i=0;i<P.length;i++){ const p=P[i],q=P[(i+1)%P.length];
    const o=owner.get(key(q,p)); if(o!==undefined && o>k) diags.push({p,q,len:Math.hypot(q.x-p.x,q.y-p.y)}); } }
  diags.sort((a,b)=>b.len-a.len);
  for(const d of diags){
    const a=owner.get(key(d.p,d.q)), b=owner.get(key(d.q,d.p));
    if(a===undefined||b===undefined||a===b||!alive[a]||!alive[b]) continue;
    const m=_tryMerge(list[a],list[b]); if(!m) continue;
    alive[a]=alive[b]=false; list.push(m); alive.push(true); reg(list.length-1);
  }
  return list.filter((_,k)=>alive[k]);
}
// 分割した破片が元の面積をちゃんと覆えているか。覆えていなければ、その差分は
// 「見た目はあるのに当たらない」領域になる＝すり抜ける。
function _coversArea(parts, target){
  let a=0;
  for(const p of parts) a+=Math.abs(_sArea(p));
  return a >= Math.abs(target)-Math.max(1, Math.abs(target)*1e-4);
}
// earcut で三角形に分ける。向きは耳刈りと同じ正の面積に揃える（_tryMerge は共有辺を逆向きで探す）
function _earcutTris(coords, holeIdx, pts){
  if(typeof earcut === 'undefined') return [];
  const t=earcut(coords, holeIdx, 2), out=[];
  for(let i=0;i<t.length;i+=3){
    const tri=[pts[t[i]], pts[t[i+1]], pts[t[i+2]]];
    if(_sArea(tri)<0) tri.reverse();
    out.push(tri);
  }
  return out;
}
function decomposeConvex(verts){
  if(!verts || verts.length<3) return verts?[verts]:[];
  if(isConvexPoly(verts)) return [verts];        // 凸ならそのまま（多角形ツール等は無変更）
  const clean=dedupePolyLoop(verts);
  // ★三角形分割は earcut を先に使う。自前の耳刈りは添字の若い耳から順に刈るので、
  //   歯車のように小さな凸が輪に並ぶ形では、中を横切る細長い三角形ができて結合しても
  //   パーツが減らない（80枚の歯車：耳刈り 208 個・earcut 84 個＝歯80＋歯元4）。
  //   耳刈りは earcut が無いとき・覆いきれないときの控え。
  const coords=[]; for(const v of clean) coords.push(v.x, v.y);
  let tris=_earcutTris(coords, null, clean);
  if(!tris.length || !_coversArea(tris, _sArea(clean))) tris=triangulate(clean);
  if(!tris.length) return [verts];               // 失敗時は従来どおり単一凸扱い
  if(!_coversArea(tris, _sArea(clean))){         // ★分割しきれていない
    console.warn('PhysBox: 凸分解が形を覆いきれませんでした。単一の凸として扱います');
    return [clean];                              //   すり抜けるより、余分に当たるほうがまし
  }
  return mergeConvex(tris);
}
function _signedArea2(loop){
  let a=0;
  for(let i=0;i<loop.length;i++){ const p=loop[i], q=loop[(i+1)%loop.length]; a += p.x*q.y - q.x*p.y; }
  return a;
}
// 穴あき多角形を凸パーツへ分解（earcut で穴対応三角分割 → 貪欲マージ）
function decomposeConvexWithHoles(verts, holes){
  if(!verts || verts.length < 3) return verts ? [verts] : [];
  if(typeof earcut === 'undefined') return decomposeConvex(verts);   // 未ロード時は穴無視で従来動作
  const outer = verts.slice();
  if(_signedArea2(outer) < 0) outer.reverse();                        // 外周と穴を逆向きに正規化
  const normHoles = (holes||[]).filter(h=>h&&h.length>=3).map(h=>{
    const hh = h.slice();
    if(_signedArea2(hh) > 0) hh.reverse();
    return hh;
  });
  const coords = [], holeIdx = [];
  for(const v of outer) coords.push(v.x, v.y);
  for(const h of normHoles){ holeIdx.push(coords.length/2); for(const v of h) coords.push(v.x, v.y); }
  const tris = earcut(coords, holeIdx, 2);
  if(!tris || !tris.length) return decomposeConvex(verts);
  const pts = [];
  for(let i=0;i<coords.length;i+=2) pts.push({x:coords[i], y:coords[i+1]});
  const triangles = [];
  for(let i=0;i<tris.length;i+=3) triangles.push([pts[tris[i]], pts[tris[i+1]], pts[tris[i+2]]]);
  // ★穴の面積を引いた正味の面積を覆えているか（覆えていなければすり抜ける）
  let net = Math.abs(_signedArea2(outer)) / 2;
  for(const h of normHoles) net -= Math.abs(_signedArea2(h)) / 2;
  if(!_coversArea(triangles, net)){
    console.warn('PhysBox: 穴あき形状の凸分解が形を覆いきれませんでした');
    return decomposeConvex(verts);
  }
  return mergeConvex(triangles);
}
// ═══ 凸分解で生じた「内部エッジ」の判定 ═══
//   凹ポリゴンを凸パーツへ分けると、元の輪郭に無い切断線が生まれる。
//   SAT はこの法線も接触方向の候補にしてしまうため、パーツ境目に載った物体が
//   「見えない斜めの壁」から押され、見当違いの抗力・摩擦（＝回転）を受ける。
//   元の輪郭・穴に実在するエッジだけを法線候補として許可する。
function _edgeKey(p, q) {
  const a = p.x + ',' + p.y, b = q.x + ',' + q.y;
  return a < b ? a + '|' + b : b + '|' + a;      // 向きに依らない無向キー
}
function _boundaryEdgeSet(verts, holes) {
  const s = new Set();
  const add = loop => {
    if (!loop || loop.length < 2) return;
    for (let i = 0; i < loop.length; i++) s.add(_edgeKey(loop[i], loop[(i+1)%loop.length]));
  };
  add(verts);
  if (holes) for (const h of holes) add(h);
  return s;
}
// 戻り値 f[k][i] === true なら parts[k][i]→parts[k][i+1] は内部エッジ
function markInternalEdges(parts, verts, holes) {
  const S = _boundaryEdgeSet(verts, holes);
  return parts.map(p => {
    const f = new Array(p.length);
    for (let i = 0; i < p.length; i++) f[i] = !S.has(_edgeKey(p[i], p[(i+1)%p.length]));
    return f;
  });
}
function _mergeCollinearPart(part, flags) {
  const n = part.length;
  if (n < 4) return { pts: part, flags };
  const keep = new Array(n).fill(true);
  for (let i = 0; i < n; i++) {
    const p = part[(i-1+n)%n], q = part[i], r = part[(i+1)%n];
    const ax = q.x-p.x, ay = q.y-p.y, bx = r.x-q.x, by = r.y-q.y;
    const la = Math.hypot(ax,ay), lb = Math.hypot(bx,by);
    if (la < 1e-9 || lb < 1e-9) { keep[i] = false; continue; }   // 重複頂点
    const sin = (ax*by - ay*bx) / (la*lb);                       // 正規化した外積＝sinθ
    if (Math.abs(sin) < 1e-6 && (ax*bx + ay*by) > 0) keep[i] = false;   // 共線かつ同方向
  }
  const pts = [], nf = flags ? [] : null;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    pts.push(part[i]);
    if (nf) {
      // 削除した頂点をまたぐ区間に実在エッジが1本でもあれば「実在」とみなす
      let internal = true, j = i;
      for (;;) {
        if (!flags[j]) internal = false;
        const k = (j+1) % n;
        if (keep[k]) break;
        j = k;
      }
      nf.push(internal);
    }
  }
  return pts.length >= 3 ? { pts, flags: nf } : { pts: part, flags };
}
function buildConvexParts(verts, holes) {
  const raw = (holes && holes.length) ? decomposeConvexWithHoles(verts, holes) : decomposeConvex(verts);
  const rawFlags = markInternalEdges(raw, verts, holes);
  const parts = [], internal = [];
  for (let k = 0; k < raw.length; k++) {
    const m = _mergeCollinearPart(raw[k], rawFlags[k]);
    parts.push(m.pts);
    internal.push(m.flags);
  }
  return { parts, internal };
}
