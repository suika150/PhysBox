// 場の描画は js/em/field.js の drawEMFields()（領域ごと）に移動した。
// 世界全体の一様場は持たない（有限の領域でないと高校物理の定番問題が作れないため）。
// 帯電した物体の重心に ⊕／⊖ を置く。
//   ★大きさは**物体の見かけの大きさに合わせる**（12〜30px）。14px の決め打ちだったが、
//     決め打ちだと小さい物体では記号が物体からはみ出し、大きい物体では点にしか見えない。
//     それだけなら見栄えの話だが、**重心から生える矢印に負ける**のが効く：力の矢印は
//     黒い縁 5px ＋ 芯 2px で重心から出るので、14px の「＋」は縦棒と横棒を
//     ちょうど塗りつぶされる（実測：帯電した小球のつりあいで、電気力＝水平と重力＝鉛直の
//     2本が重心で交わり、＋ の2画が両方とも消えていた）。記号を物体の大きさまで
//     伸ばすと、矢印の線幅より外に画が残る。
function chargeSymbolSize(b) {
  const r = (b.type === 'circle') ? b.radius
          : (b._aabb ? Math.max(b._aabb.maxX - b._aabb.minX, b._aabb.maxY - b._aabb.minY) / 2 : 12);
  return Math.max(12, Math.min(30, r * cam.zoom * 1.8));
}
function drawCharges() {
  for (const b of objects) {
    if (!b.charge) continue;
    const s = worldToScreen(b.x, b.y);
    ctx.save();
    ctx.font = 'bold ' + chargeSymbolSize(b).toFixed(1) + 'px sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle = b.charge>0 ? '#ef5350' : '#42a5f5';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth=3;
    const sym = b.charge>0 ? '+' : '−';
    ctx.strokeText(sym, s.x, s.y); ctx.fillText(sym, s.x, s.y);
    ctx.restore();
  }
}

const CIRCUIT_COLOR = '#ffca28';
function drawCircuit() {
  followSlideWireTerminals();   // ★停止中に素子を動かしても、接点の端子につないだ導線がついてくる
  ctx.save();
  ctx.lineCap='round'; ctx.lineJoin='round';
  for (const e of circuitElements) {
    const a=worldToScreen(e.ax,e.ay), b=worldToScreen(e.bx,e.by);
    const sel = (selectedCircuit===e);
    const bulk = isBulkSelected('circuit', e);   // ★一括選択の仲間も強調する
    if (sel || bulk) { ctx.strokeStyle='rgba(79,195,247,0.5)'; ctx.lineWidth=8;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); }
    drawCircuitElement(e, a, b);
    if (sel) {                                   // ★端点の□ハンドルは代表だけ（掴めるのは1本ずつ）
      ctx.save(); ctx.setLineDash([]);
      ctx.fillStyle='#4fc3f7'; ctx.strokeStyle='#fff'; ctx.lineWidth=1.5;
      for (const p of [a,b]) { ctx.beginPath(); ctx.rect(p.x-4,p.y-4,8,8); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }
  }
  drawConductorRods();   // ★導体棒を「電池」として描く
  drawCircuitFlow();     // ★電流を黄色い点で表示
  ctx.restore();
}
// ── 導体棒＝電池 ─────────────────────────────────────
//   磁場を横切って動く導体棒は起電力 E = BLv の電源そのものなので、回路に置く直流電源と
//   まったく同じ記号で描く。同じ drawCircuitElement を呼ぶので、記号が食い違わない。
//   長線(＋)は必ず a 側に描かれ、開放時の端子電圧は V_a − V_b = emf なので、
//   emf の符号で渡す2点を入れ替えれば極性が合う（棒を逆に動かすと記号も反転する）。
//   dcsource の描画は中央16pxを空けてから極板を描くので、＋と−の間の隙間は自動で入る。
const ROD_EMF_MIN       = 1e-3;   // [V] これ未満は極性が定まらないので記号を出さない
const ROD_SYMBOL_MIN_PX = 44;     // [画面px] これより短いと記号が入らない
function drawConductorRods() {
  if (!world.circuitOn) return;
  const rods = conductorRodsForDisplay();
  if (!rods.length) return;
  ctx.save();
  ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const r of rods) {
    const a = worldToScreen(r.ax, r.ay), b = worldToScreen(r.bx, r.by);
    const Lpx = len(b.x - a.x, b.y - a.y);
    const emf = r.emf || 0;
    const ux = Lpx > 1e-6 ? (b.x-a.x)/Lpx : 1, uy = Lpx > 1e-6 ? (b.y-a.y)/Lpx : 0;
    const mx = (a.x+b.x)/2, my = (a.y+b.y)/2;
    // 棒の太さ（画面px）。記号がこれより小さいと極板が棒に埋もれて電池に見えない
    const halfT = ((r.body && r.body.h ? r.body.h : CONDROD_THICK) / 2) * cam.zoom;
    const s = Math.max(1, Math.min(3.5, (halfT + 7) / 10));   // 記号の拡大率
    // レールに架かっていない棒は「起電力はあるが回路に入っていない」ので控えめに描く
    ctx.globalAlpha = r._free ? 0.5 : 1;
    if (Math.abs(emf) >= ROD_EMF_MIN && Lpx >= ROD_SYMBOL_MIN_PX * s) {
      // ★極板の間で棒を暗く抜く。棒の本体（水色の板）が繋がったままだと、
      //   電池記号のいちばんの特徴である「＋と−の間が空いている」が出ない。
      ctx.save();
      ctx.translate(mx, my); ctx.rotate(Math.atan2(uy, ux));
      ctx.fillStyle = 'rgba(18,20,26,0.9)';
      ctx.fillRect(-8*s, -(halfT + 2), 16*s, (halfT + 2) * 2);
      ctx.restore();
      // 中点を中心に s 倍して描く。渡す2点を先に 1/s しておけば、拡大後は元の端点に戻る
      const p = emf > 0 ? a : b, q = emf > 0 ? b : a;
      ctx.save();
      ctx.translate(mx, my); ctx.scale(s, s); ctx.translate(-mx, -my);
      drawCircuitElement({ type:'dcsource' },
        { x: mx + (p.x-mx)/s, y: my + (p.y-my)/s },
        { x: mx + (q.x-mx)/s, y: my + (q.y-my)/s }, ctx, true);
      ctx.restore();
    } else {                                     // 静止中・画面上で短いときは線だけ
      ctx.strokeStyle = CIRCUIT_COLOR; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // 起電力の大きさ。向きは記号が示すので絶対値で出す（符号を併記すると二重になる）
    ctx.fillStyle = '#81c784';
    const off = halfT + 10*s + 11;               // 棒と極板の外側へ逃がす
    ctx.fillText(`E = ${Math.abs(emf).toFixed(3)} V`, mx - uy*off, my + ux*off);
  }
  ctx.globalAlpha = 1;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'start';
  ctx.restore();
}
// ── 電流の可視化 ─────────────────────────────────────
//   黄色い点は「一定の電荷の塊」として描く。実際の導線では自由電子密度 n と断面積 A が
//   一定なので、ドリフト速度は v = I/(nqA) ∝ I、電荷密度（＝点の間隔）は一定になる。
//   この2つを守ると「単位時間に分岐点を通過する点の数」が保存され、見た目がそのまま
//   電荷保存則になる（1.5A が 1A と 0.5A に分かれる絵が正しく出る）。
//   逆に間隔を可変にして速さを一定にすると、分流を絵で説明できなくなる。
const FLOW_SPACING  = 20;     // [px] 点の間隔（＝点1個ぶんの電荷 Δq = I·間隔/速さ）
const FLOW_PX_PER_A = 60;     // [px/s] 電流1Aあたりの速さ。既定の 10V/10Ω＝1A が 60px/s
const FLOW_V_MAX    = 400;    // [px/s] 速さの上限（短絡電流で点が消し飛ぶのを防ぐ）
// ★描くかどうかの下限 [A]。これは「その枝が電流を運んでいるか」の判定であって、
//   点の速さとは無関係（速さは _flowSpeed が電流そのものから決める）。
//   数値上の漏れだけを落とす値にする：ダイオードに並列の Gmin(1e-9 S) は 10V でも 1e-8 A、
//   電圧計の既定 1e7Ω は 10V で 1e-6 A。1e-5 A ならこれらより1桁上で、
//   「電圧計には電流が流れない」を保ったまま、実際に流れている電流は必ず描ける。
//   ここを大きく取ると、交流の振幅が小さいとき「電流が0を横切るたびに枝ごと消える」
//   ＝点滅になる（教室で見せたい「点が減速→停止→逆走」が消灯にすり替わる）。
const FLOW_I_MIN    = 1e-5;
// ★判定は瞬時値ではなく「最後に FLOW_I_MIN を超えてからの経過時間」で行う。
//   交流は1周期に2回きっかり0を通るので、瞬時値で判定するかぎり閾値をいくら下げても
//   0交差の一瞬は必ず消える。保持時間を置けば「この枝は交流を運んでいる」が0交差を
//   またいで保たれ、点は止まって逆走するだけになる（＝見せたい物理そのもの）。
//   ★ピークホールド＋指数減衰にはしない。それだと消えるまでの時間が電流の大きさに
//     依存し（大きな電流ほど長く居座る）、RC放電のあと点が止まったまま何秒も残る。
//     保持時間なら、電流が絶えてから消えるまでが常に一定になる。
const FLOW_HOLD_S   = 1.0;    // [s] 閾値を割り込んでから消灯するまで
// 速さ ∝ 電流。NaN は累積変位を永久に壊すので0に潰す
const _flowSpeed = I => isFinite(I) ? Math.max(-FLOW_V_MAX, Math.min(FLOW_V_MAX, I * FLOW_PX_PER_A)) : 0;
// ★導線の抵抗率。銅 ρ=1.68e-8 Ω·m、断面積 1mm² を仮定 → 0.0168 Ω/m。
//   抵抗ゼロの導線を並列にすると閉路の電圧則が 0·I₁ = 0·I₂ になり、分流が一意に
//   決まらない（方程式が特異）。現実の導線は必ず抵抗を持ち、分流はコンダクタンスの比
//   ＝同じ材質・断面なら長さの逆比で決まる。これを入れて初めて並列部分の点が描ける。
const WIRE_R_PER_M = 1.68e-8 / 1e-6;

// 表示用の電流を線分ごとに求める（a→b を正）。導線は既知素子の電流から葉狩り(KCL)で伝播し、
// それでも残る未知（＝導線どうしが閉路をつくる部分）は導線自身の抵抗網として解く。
//   ★導体棒が触れている導線は、接点で分割してから扱う。分割しないと接点がノードにならず、
//     棒が回路から切り離される（レールが行き止まりの枝に見えて、KCLが「電流0」と確定して
//     しまう）。分割すれば、棒より先のレールに電流が流れないことも正しく描ける。
function computeCircuitFlow(rods) {
  rods = rods || [];
  const segs = [];   // {ax,ay,bx,by, I(null=未知), key}
  for (const e of circuitElements) {
    const type = e.type || 'wire';
    let I;
    if (type === 'wire')        I = null;                  // 0Ω＝電流はKCLと導線抵抗で決める
    // 開スイッチだけ0で確定。★押しボタン・リレー接点も同じ扱い（ソルバでは閉じた接点は
    //   導線と同じく 0Ω で縮約され、電流を書かない＝e.I は 0 のまま）。以前は 'switch' だけを
    //   見ていたので、閉じた接点が「0A で確定」になり、KCL がその先の電流を別の導線へ回した
    //   （自己保持のデモで、停止中のランプへ行く左の縦線とb接点に点が出ず、
    //     流れていない一周に点が流れた）
    else if (type === 'switch' || type === 'pushswitch' || type === 'relayswitch') I = e.closed ? null : 0;
    else if (type === 'slidewire') {                        // ★3本に割る：a→P・P→b・c→P（接点のリード線）
      const P = slideWireP(e), C = slideWireC(e);
      segs.push({ ax:e.ax, ay:e.ay, bx:P.x, by:P.y, I: e.I  || 0, key:'e'+e.id+'a' });
      segs.push({ ax:P.x, ay:P.y, bx:e.bx, by:e.by, I: e.I2 || 0, key:'e'+e.id+'b', cutA: true });   // 点は材料の端 b から測る（接点に引きずられない）
      segs.push({ ax:C.x, ay:C.y, bx:P.x, by:P.y, I: e.Ic || 0, key:'e'+e.id+'c' });
      continue;
    }
    else                        I = e.I || 0;               // ソルバが出した値
    const dx = e.bx - e.ax, dy = e.by - e.ay, L2 = dx*dx + dy*dy || 1e-9;
    const ts = [];
    if (type === 'wire') for (const r of rods) {            // 棒の接点で切る
      if (r.wireA === e) ts.push(((r.ax-e.ax)*dx + (r.ay-e.ay)*dy) / L2);
      if (r.wireB === e) ts.push(((r.bx-e.ax)*dx + (r.by-e.ay)*dy) / L2);
    }
    const cuts = ts.filter(t => t > 0.002 && t < 0.998).sort((p,q) => p-q);
    if (!cuts.length) { segs.push({ ax:e.ax, ay:e.ay, bx:e.bx, by:e.by, I, key:'e'+e.id }); continue; }
    // ★cutA・cutB＝その端が導体棒の接点で切った点（導線の材料の端ではない）。接点は棒と一緒に
    //   すべるので、点の位相をそこから測ると点が接点に引きずられる（drawCircuitFlow の★）
    let px = e.ax, py = e.ay, ki = 0;
    for (const t of cuts) {
      const qx = e.ax + dx*t, qy = e.ay + dy*t;
      segs.push({ ax:px, ay:py, bx:qx, by:qy, I, key:'e'+e.id+':'+ki, cutA: ki > 0, cutB: true });
      ki++;
      px = qx; py = qy;
    }
    segs.push({ ax:px, ay:py, bx:e.bx, by:e.by, I, key:'e'+e.id+':'+ki, cutA: true });
  }
  for (const r of rods) segs.push({ ax:r.ax, ay:r.ay, bx:r.bx, by:r.by, I: r.I || 0,
                                    key:'r'+(r.body ? r.body.id : 0) });
  if (!segs.length) { _flowDisp.clear(); _flowDispBase.clear(); _flowLastT = world.simTime; return segs; }
  // ノード割り当て（位置マージのみ。線分ごとの電流を出したいので0Ω縮約はしない）
  const pts = [];
  for (const s of segs) {
    s._ia = pts.length; pts.push({ x:s.ax, y:s.ay });
    s._ib = pts.length; pts.push({ x:s.bx, y:s.by });
  }
  const n = pts.length, parent = pts.map((_,i)=>i), m2 = NODE_MERGE_PX*NODE_MERGE_PX;
  for (let i=0;i<n;i++) for (let j=i+1;j<n;j++){
    const dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y;
    if (dx*dx+dy*dy <= m2) _ufUnion(parent,i,j);
  }
  const root2n = new Map(); let next = 0;
  const nodeAt = i => { const r=_ufFind(parent,i); if(!root2n.has(r)) root2n.set(r,next++); return root2n.get(r); };
  for (const s of segs) { s.na = nodeAt(s._ia); s.nb = nodeAt(s._ib); }
  let changed=true, guard=0;
  while (changed && guard++<2000){
    changed=false;
    const inc=new Map();
    for (const s of segs){ if(s.na===s.nb) continue;
      (inc.get(s.na)||inc.set(s.na,[]).get(s.na)).push(s);
      (inc.get(s.nb)||inc.set(s.nb,[]).get(s.nb)).push(s); }
    for (const [nd,list] of inc){
      const unknown=list.filter(s=>s.I===null);
      if (unknown.length!==1) continue;
      let sum=0;
      for (const s of list){ if(s.I===null) continue; sum += (s.nb===nd ? s.I : -s.I); }
      const u=unknown[0];
      u.I = (u.nb===nd) ? -sum : sum;   // KCL：残り1本で釣り合わせる
      changed=true;
    }
  }
  _solveWireCurrents(segs);             // 葉狩りで解けなかった閉路を導線抵抗で解く
  for (const s of segs) if (s.I === null) s.I = 0;
  _advanceFlowCharge(segs);
  return segs;
}
// 残った未知＝導線どうしが閉路をつくっている部分。葉狩りKCLは木構造しか解けないので、
// 抵抗ゼロの導線を並列にすると必ずここに残る（従来はまとめて0にしていたため、
// 並列部分だけ点が消えていた）。R = ρL/A の抵抗網として節点方程式を解けば、
// 分流は長さの逆比として一意に決まる。
//   ★既知枝の電流は「ノードへの注入」として右辺に入れるだけなので、本体ソルバ
//     （0Ω縮約のまま）が出す電流計・電圧計の値は一切変わらない。導線抵抗は素子より
//     3〜4桁小さく、分流比だけを決めるのに使う。
function _solveWireCurrents(segs) {
  const unknown = segs.filter(s => s.I === null && s.na !== s.nb);
  if (!unknown.length) return;
  const idx = new Map();
  for (const s of unknown) { for (const nd of [s.na, s.nb]) if (!idx.has(nd)) idx.set(nd, idx.size); }
  const n = idx.size;
  if (n > 200) return;                  // 毎フレーム O(n³) を解くので保険（実回路では数十）
  const A = Array.from({length:n}, () => new Array(n).fill(0));
  const z = new Array(n).fill(0);
  for (const s of segs) {               // 既知枝＝ノードへの電流注入（a から出て b へ入る）
    if (s.I === null || s.na === s.nb) continue;
    const ia = idx.get(s.na), ib = idx.get(s.nb);
    if (ia !== undefined) z[ia] -= s.I;
    if (ib !== undefined) z[ib] += s.I;
  }
  const parent = Array.from({length:n}, (_,i) => i);
  for (const s of unknown) {
    const ia = idx.get(s.na), ib = idx.get(s.nb);
    const L_m = Math.max(1e-3, len(s.bx - s.ax, s.by - s.ay)) * PX2M;
    s._g = 1 / (WIRE_R_PER_M * L_m);
    A[ia][ia] += s._g; A[ib][ib] += s._g;
    A[ia][ib] -= s._g; A[ib][ia] -= s._g;
    _ufUnion(parent, ia, ib);
  }
  const grounded = new Set();           // 連結成分ごとに基準電位を1つ決める（無いと特異）
  for (let i=0;i<n;i++) {
    const r = _ufFind(parent, i);
    if (grounded.has(r)) continue;
    grounded.add(r);
    A[i].fill(0); A[i][i] = 1; z[i] = 0;
  }
  const V = _solveLinear(A, z);
  for (const s of unknown) s.I = s._g * (V[idx.get(s.na)] - V[idx.get(s.nb)]);
}
// 点の位置は「運んだ電荷 ∫I dt」で決める。速さ v=k·I をそのまま時刻に掛けると、
// 交流のように I が変わるときに点が飛ぶ。時計は world.simTime（実時間だと一時停止中も
// 点が流れ続けてしまう）。変位は枝の a→b 向きの符号つきで持つので、電流が反転すると
// 点はそのまま滑らかに逆走する。
const _flowDisp     = new Map();   // key  -> {d: a→b 向きの符号つき変位[px], t: 最後に見た時刻}
const _flowDispBase = new Map();   // 素子 -> 同上。分割・結合をまたいで位相を引き継ぐ
let _flowLastT = 0;
const FLOW_KEEP_S = 5;             // 消えた枝の位相を覚えておく時間[s]
const _flowPhase    = new Map();   // key  -> {c, sp, fromB}：つながりが変わるまで控える点の位相
let _flowPhaseSig = '';            // 控えたときの回路のつながり（枝のキーと両端のノード）
function _advanceFlowCharge(segs) {
  // 1フレームで進む sim 時間は SIM_MAX_TICKS·SIM_DT = 8/60 s が上限。それを超える飛び
  // （リセット直後・タブ復帰）は頭打ちにする。0 にすると点が止まってしまうので潰さない。
  const dt = Math.min(Math.max(0, world.simTime - _flowLastT), 0.5);
  _flowLastT = world.simTime;
  for (const s of segs) {
    const base = s.key.split(':')[0];       // 'e12:1' → 'e12'
    let rec = _flowDisp.get(s.key);
    if (!rec) {
      // ★新しく現れた枝は、同じ素子の位相を引き継いで始める。導体棒がレールに触れる／
      //   離れるたびに導線は分割・結合され、線分のキーが 'e12' ⇄ 'e12:0','e12:1' と
      //   入れ替わる。0 から始めると、そのたびに点が瞬間移動して見える。
      const b = _flowDispBase.get(base);
      rec = { d: b ? b.d : 0, lit: b ? b.lit : -1e9, t: world.simTime };
      _flowDisp.set(s.key, rec);
    }
    rec.d += _flowSpeed(s.I || 0) * dt;
    // lit＝最後に「流れている」と言えた時刻。
    //   ★ちょうど0の枝（開スイッチ、KCLで0と確定した枝）は保持せず即座に落とす。ソルバが
    //     構造的に「流れない」と決めた枝なので、スイッチを開いた瞬間に点が消えてほしい。
    const mag = Math.abs(s.I || 0);
    if (!isFinite(mag) || s.I === 0)  rec.lit = -1e9;
    else if (mag >= FLOW_I_MIN)       rec.lit = world.simTime;
    rec.t = world.simTime;
    s.disp = rec.d;
    s.lit  = (world.simTime - rec.lit) <= FLOW_HOLD_S;
    _flowDispBase.set(base, rec);
  }
  // ★消えた枝をその場で捨てない。棒を出し入れすると一瞬消えるだけなので、捨てると
  //   戻ってくるたびに位相が 0 に落ちる。しばらく現れなかったものだけを片付ける。
  if (_flowDisp.size > segs.length) {
    for (const [k, rec] of _flowDisp) if (world.simTime - rec.t > FLOW_KEEP_S) _flowDisp.delete(k);
    for (const [k, rec] of _flowDispBase) if (world.simTime - rec.t > FLOW_KEEP_S) _flowDispBase.delete(k);
  }
}
// 全域木で「累積弧長」を配り、節目で点の位相をそろえる。
//   電流が同じ（＝速さが同じ）直列区間では、点は境目を滑らかに通り抜けて一本の連続した
//   流れに見える。分岐で電流が変わる所は速さが違うので位相がずれていくが、それは物理的に
//   正しいずれ（点が詰まる／伸びるのが分流そのもの）。
//   枝の向きは電流の符号ではなく木のたどり方で決めるので、交流で電流が反転しても
//   向きが入れ替わらない（点が減速→停止→逆走する）。
//   閉路を閉じる枝には継ぎ目が1本残る。単一閉路の成分では間隔を微調整して継ぎ目を消す。
function _assignFlowPhase(live) {
  const adj = new Map();                 // node -> [{e, end}]  end:'a'|'b'
  const at = nd => { let a = adj.get(nd); if (!a) adj.set(nd, a = []); return a; };
  for (const e of live) { at(e.na).push({ e, end:'a' }); at(e.nb).push({ e, end:'b' }); }
  const inComp = new Set();
  for (const e0 of live) {
    if (inComp.has(e0)) continue;
    const comp = [], stack = [e0]; inComp.add(e0);
    while (stack.length) {
      const e = stack.pop(); comp.push(e);
      for (const nd of [e.na, e.nb]) for (const h of at(nd))
        if (!inComp.has(h.e)) { inComp.add(h.e); stack.push(h.e); }
    }
    // 単一閉路（全ノードの次数が2）なら、一周の長さが間隔の整数倍になるよう間隔を
    // 微調整する。教室で最も多い「電源＋抵抗の一周」が継ぎ目なしで循環する。
    let total = 0; const nodes = new Set();
    for (const e of comp) { total += e.L; nodes.add(e.na); nodes.add(e.nb); }
    let cycle = nodes.size === comp.length;
    if (cycle) for (const nd of nodes) if (at(nd).length !== 2) { cycle = false; break; }
    const sp = cycle ? Math.max(2, total / Math.max(1, Math.round(total / FLOW_SPACING)))
                     : FLOW_SPACING;
    for (const e of comp) e.sp = sp;
    // 全域木で位相を配る
    const theta = new Map([[comp[0].na, 0]]);
    const queue = [comp[0].na], placed = new Set();
    for (let qi = 0; qi < queue.length; qi++) {
      const nd = queue[qi];
      for (const h of at(nd)) {
        const e = h.e;
        if (placed.has(e)) continue;
        placed.add(e);
        e.flip = (h.end === 'b');        // いま居るノードを入口にする
        e.alpha = theta.get(nd);
        const out = e.flip ? e.na : e.nb;
        if (!theta.has(out)) { theta.set(out, e.alpha + e.L / sp); queue.push(out); }
      }
    }
  }
}
// 電流が流れている素子・導線に、電流の向きへ動く黄色い点を描く
function drawCircuitFlow() {
  if (!world.circuitOn) return;
  const flow = computeCircuitFlow(world._rods || []);
  const live = [];
  for (const s of flow) {
    if (!s.lit) continue;                                    // ほぼ無電流は描かない（保持時間つき判定）
    const L = len(s.bx - s.ax, s.by - s.ay);
    if (L < 1) continue;
    live.push({ s, L, na:s.na, nb:s.nb, flip:false, alpha:0, sp:FLOW_SPACING });
  }
  if (!live.length) return;
  // ★位相は回路のつながりが変わったときだけ配り直し、あいだは枝ごとに控えた値を使う。
  //   毎フレーム木で配り直すと、長さが変わる枝（導体棒がすべるレール）より先の点が、
  //   伸びたぶんだけまとめてずらされる。実測（導体棒に生じる誘導起電力・⊙で右へ 0.48 m/s、
  //   電流 0.485 A＝点の速さ 29 px/s）：上のレール 右へ29・抵抗 上へ28 は正しいのに、
  //   棒は下へ 29 のはずが**上へ 16**（レールが 48 px/s 伸びるぶん逆走）、下のレールは 左へ21。
  //   ★控える位相は「材料の端」から測る。導線を棒の接点で切った端（cutA/cutB）から測ると、
  //     接点といっしょに点が流される。棒の枝は両端とも棒の上の点なので a から測る
  //     （棒の点は棒に乗って運ばれる＝電荷キャリアが導体といっしょに動くのと同じ）。
  //   代償：すべる接点には点の継ぎ目が出る（一周が間隔の整数倍でなくなる）。そこは実際に
  //   2つの導体がこすれ合っている場所なので、継ぎ目が出てよい。
  const sig = live.map(e => e.s.key + '/' + e.na + '/' + e.nb).join('|');
  if (sig !== _flowPhaseSig) {
    _flowPhaseSig = sig;
    _flowPhase.clear();
    _assignFlowPhase(live);
    for (const e of live) {
      const s = e.s;
      // a 端から測った点の位置 d_a ≡ disp + c（mod sp）。木の入口が b のときは測り直す
      let c = e.flip ? e.L + e.sp * e.alpha : -e.sp * e.alpha;
      const fromB = !!s.cutA && !s.cutB;                 // a が接点・b が材料の端
      if (fromB) c = e.L - c;                            // d_b = L − d_a ≡ −disp + (L − c)
      _flowPhase.set(s.key, { c, sp: e.sp, fromB });
    }
  }
  ctx.save();
  ctx.setLineDash([]);
  ctx.shadowColor = 'rgba(255,238,88,0.9)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#ffee58';
  const rad = Math.max(1.2, Math.min(2.6, FLOW_SPACING * cam.zoom * 0.18));
  for (const e of live) {
    const s = e.s;
    const ph = _flowPhase.get(s.key);
    if (!ph) continue;
    // 測る端（材料の端）。弧長 d はそこから測り、変位も同じ向きへ符号を合わせる
    const ix = ph.fromB ? s.bx : s.ax, iy = ph.fromB ? s.by : s.ay;
    const ox = ph.fromB ? s.ax : s.bx, oy = ph.fromB ? s.ay : s.by;
    const ux = (ox - ix) / e.L, uy = (oy - iy) / e.L;
    const disp = ph.fromB ? -s.disp : s.disp;
    let d = (disp + ph.c) % ph.sp; if (d < 0) d += ph.sp;
    for (let g = 0; d <= e.L && g < 512; d += ph.sp, g++) {
      const p = worldToScreen(ix + ux*d, iy + uy*d);
      if (p.x < -8 || p.y < -8 || p.x > canvas.width + 8 || p.y > canvas.height + 8) continue;
      ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI*2); ctx.fill();
    }
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}
function _drawTerm(a,b,g){ g.fillStyle='#37474f'; g.strokeStyle='#eceff1'; g.lineWidth=1.2;
  for (const p of [a,b]){ g.beginPath(); g.arc(p.x,p.y,4,0,Math.PI*2); g.fill(); g.stroke(); } }

// 素子1個を描く。g は描画先（省略＝メインキャンバス）、icon=true で端子とラベルを省く。
//   ★描画先を差し替えられるようにしてあるのは、ツールメニューの回路記号アイコンを
//     この同じ関数から作るため。アイコンを別に手描きすると、素子の見た目を変えたときに
//     メニューとキャンバスの絵が食い違う。
function drawCircuitElement(e, a, b, g, icon) {
  g = g || ctx;
  const dx=b.x-a.x, dy=b.y-a.y, L=Math.hypot(dx,dy)||1;
  const ux=dx/L, uy=dy/L, nx=-uy, ny=ux, mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  g.strokeStyle=CIRCUIT_COLOR; g.lineWidth=2; g.fillStyle='#1a1c23';
  const line=(p,q)=>{ g.beginPath(); g.moveTo(p.x,p.y); g.lineTo(q.x,q.y); g.stroke(); };
  const at=(d,off=0)=>({x:a.x+ux*d+nx*off, y:a.y+uy*d+ny*off});
  const label=(text,off)=>{ if (!icon) _label(mid,nx,ny,text,off,g); };
  const lead=Math.max(0,(L-34)/2);
  if (e.type==='wire') { line(a,b); }
  else if (e.type==='resistor') {
    // ★JISの長方形。日本の教科書・入試で使うのはこちらで、ギザギザは旧JIS／米国式。
    //   縦横比はおよそ 1:3（34×12px）。
    line(a, at(lead)); line(at(lead+34), b);
    const c=[at(lead,-6), at(lead+34,-6), at(lead+34,6), at(lead,6)];
    g.beginPath(); g.moveTo(c[0].x,c[0].y);
    for (let i=1;i<4;i++) g.lineTo(c[i].x,c[i].y);
    g.closePath(); g.fill(); g.stroke();
    label(`${e.R}Ω`);
  }
  else if (e.type==='slidewire') {
    // ★すべり抵抗：a〜b いっぱいの細長い長方形＝抵抗線（抵抗の JIS 記号を引き伸ばしたもの）、
    //   接点の端子 c から接点 P へ矢印。矢印の先が抵抗線に触れている所が接点。
    //   抵抗線の反対側に長さの 1/10 ごとの目盛り（電位差計で「長さ」を読むための物差し）。
    //   端子 c の位置は slideWireC と同じ式を画面で組む（アイコンは寸法が無いので固定の 10px）
    const H = icon ? 3 : 5;
    const off = icon ? 10 : (e.cOff || 0) * cam.zoom, sg = off >= 0 ? 1 : -1;
    const q=[at(0,-H), at(L,-H), at(L,H), at(0,H)];
    g.beginPath(); g.moveTo(q[0].x,q[0].y);
    for (let i=1;i<4;i++) g.lineTo(q[i].x,q[i].y);
    g.closePath(); g.fill(); g.stroke();
    if (!icon && L > 60) {
      g.save(); g.lineWidth = 1;
      for (let k = 1; k < 10; k++) {
        const t0 = at(L*k/10, -sg*H), t1 = at(L*k/10, -sg*(H + (k === 5 ? 7 : 4)));
        line(t0, t1);
      }
      g.restore();
    }
    const tp = slideWirePos(e);
    const cp = { x: mid.x + nx*off, y: mid.y + ny*off };
    const tip = at(L*tp, sg*H);                                       // 矢印は c 側から抵抗線へ
    g.save(); g.lineWidth = 1.6; line(cp, tip);
    const bx = tip.x - (tip.x - cp.x) / (Math.hypot(tip.x - cp.x, tip.y - cp.y) || 1) * 7,
          by = tip.y - (tip.y - cp.y) / (Math.hypot(tip.x - cp.x, tip.y - cp.y) || 1) * 7;
    const px = -(tip.y - by) * 0.55, py = (tip.x - bx) * 0.55;
    g.fillStyle = CIRCUIT_COLOR;
    g.beginPath(); g.moveTo(tip.x, tip.y); g.lineTo(bx + px, by + py); g.lineTo(bx - px, by - py);
    g.closePath(); g.fill();
    g.restore();
    if (!icon) {
      _label(mid, nx, ny, `${e.R}Ω`, -sg * (H + 16), g);
      _drawTerm(cp, cp, g);
    }
  }
  else if (e.type==='dcsource') {
    line(a, at(L/2-8)); line(at(L/2+8), b);
    const lp=at(L/2-8), sp=at(L/2+8);   // 長線(+)・短線(-)
    g.lineWidth=2.5; g.beginPath(); g.moveTo(lp.x+nx*10,lp.y+ny*10); g.lineTo(lp.x-nx*10,lp.y-ny*10); g.stroke();
    g.lineWidth=2; g.beginPath(); g.moveTo(sp.x+nx*6,sp.y+ny*6); g.lineTo(sp.x-nx*6,sp.y-ny*6); g.stroke();
    label(`${e.V}V`);
  }
  else if (e.type==='acsource') {
    // ★丸の中に正弦波1周期。以前はここに楕円を描いていて、記号として誤りだった。
    line(a, at(L/2-10)); line(at(L/2+10), b);
    g.beginPath(); g.arc(mid.x,mid.y,10,0,Math.PI*2); g.stroke();
    g.beginPath();
    for (let i=0;i<=24;i++){ const tt=i/24;
      const p=at(L/2-7+14*tt, -Math.sin(tt*Math.PI*2)*4);   // −側＝法線の反対＝画面上向き
      i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y); }
    g.stroke();
    label(`${e.V}V ${e.freq}Hz`);
  }
  else if (e.type==='switch') {
    line(a, at(lead)); line(at(lead+34), b);
    const hp=at(lead), tp=e.closed?at(lead+34):at(lead+30,-12);
    g.beginPath(); g.arc(hp.x,hp.y,3,0,Math.PI*2); g.stroke();
    g.beginPath(); g.arc(at(lead+34).x,at(lead+34).y,3,0,Math.PI*2); g.stroke();
    line(hp, tp);
  }
  else if (e.type==='ammeter' || e.type==='voltmeter') {
    line(a, at(L/2-11)); line(at(L/2+11), b);
    g.beginPath(); g.arc(mid.x,mid.y,11,0,Math.PI*2); g.stroke();
    g.fillStyle=CIRCUIT_COLOR; g.font='11px sans-serif'; g.textAlign='center'; g.textBaseline='middle';
    g.fillText(e.type==='ammeter'?'A':'V', mid.x, mid.y);
    g.textAlign='start'; g.textBaseline='alphabetic';
    // ★計器の読みは回路の表と同じ有効数字3桁・同じ「ほぼ0」の床。小数2桁だと 10mA 台が
    //   0.01A になり、分流器のデモ（R ≫ rA で I を変えずに測り直す）で IA が読めなかった
    const v = e.type==='ammeter' ? e.I : e.Vread, k = e.type==='ammeter' ? 'I' : 'V';
    label(cgSI(Math.abs(v) < CT_FLOOR[k] ? 0 : v, e.type==='ammeter' ? 'A' : 'V', 3), 20);
  }
  else if (e.type==='capacitor') {
    line(a, at(L/2-4)); line(at(L/2+4), b);
    const p0=at(L/2-4), p1=at(L/2+4); g.lineWidth=2.5;
    g.beginPath(); g.moveTo(p0.x+nx*9,p0.y+ny*9); g.lineTo(p0.x-nx*9,p0.y-ny*9); g.stroke();
    g.beginPath(); g.moveTo(p1.x+nx*9,p1.y+ny*9); g.lineTo(p1.x-nx*9,p1.y-ny*9); g.stroke();
    // ★接頭語は値で選ぶ（つまみは 1µF〜0.1F）。µF 固定だと 0.1F が「100000µF」になり札が回路に溢れる
    const C = e.C;
    label(C >= 1 ? `${+C.toPrecision(3)}F` : C >= 1e-3 ? `${+(C*1e3).toPrecision(3)}mF` : `${+(C*1e6).toPrecision(3)}µF`);
  }
  else if (e.type==='inductor') {
    // ★片側だけに山4つ（正弦波ではない）。以前は軸をまたぐ波線で、これは記号として誤り。
    //   山を出す側は「画面の上（真縦なら右）」に固定する。素子の a→b 向きを基準にすると、
    //   同じコイルでも右から左へ引いたときに山が下向きの鏡像になってしまう。
    line(a, at(lead)); line(at(lead+34), b);
    const up = (ny > 1e-9 || (Math.abs(ny) <= 1e-9 && nx < 0)) ? -1 : 1;
    const bw=34/4, rx=bw/2, ry=6.5;
    g.beginPath();
    for (let k=0;k<4;k++){
      const c0=lead+(k+0.5)*bw;
      for (let j=0;j<=10;j++){
        const ph=Math.PI*j/10;
        const p=at(c0-rx*Math.cos(ph), up*ry*Math.sin(ph));
        (k===0&&j===0) ? g.moveTo(p.x,p.y) : g.lineTo(p.x,p.y);
      }
    }
    g.stroke();
    label(`${e.L}H`);
  }
  // ★ダイオード：三角形＋バー。三角形の向き＝順方向（a→b に電流が流れる向き）
  else if (e.type==='diode') {
    line(a, at(lead)); line(at(lead+34), b);
    const t0=at(lead+9), t1=at(lead+25);
    g.beginPath();
    g.moveTo(t0.x+nx*9, t0.y+ny*9); g.lineTo(t0.x-nx*9, t0.y-ny*9); g.lineTo(t1.x, t1.y);
    g.closePath(); g.fill(); g.stroke();
    g.lineWidth=2.5;
    g.beginPath(); g.moveTo(t1.x+nx*9, t1.y+ny*9); g.lineTo(t1.x-nx*9, t1.y-ny*9); g.stroke();
    g.lineWidth=2;
    label(`${e.Vf}V`);
  }
  // ★豆電球：JIS のランプ記号（丸に×）。フィラメント温度から決まる明るさで光らせる
  else if (e.type==='bulb') {
    line(a, at(L/2-11)); line(at(L/2+11), b);
    const glow = e.burnt ? 0 : bulbGlow(e);
    if (glow > 0.01) {                       // 温度が上がるほど強く・白っぽく光る
      const R = 11 + 26 * Math.min(1, glow);
      const gr = g.createRadialGradient(mid.x, mid.y, 2, mid.x, mid.y, R);
      const aA = Math.min(0.95, 0.35 + 0.6*glow), aB = Math.min(0.5, 0.25*glow);
      gr.addColorStop(0,   `rgba(255,244,200,${aA})`);
      gr.addColorStop(0.5, `rgba(255,196,90,${aB})`);
      gr.addColorStop(1,   'rgba(255,170,60,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(mid.x, mid.y, R, 0, Math.PI*2); g.fill();
      g.fillStyle = '#1a1c23';
    }
    g.strokeStyle = e.burnt ? '#78909c' : CIRCUIT_COLOR;
    g.beginPath(); g.arc(mid.x,mid.y,11,0,Math.PI*2); g.fill(); g.stroke();
    const d=11*Math.SQRT1_2;                 // 丸の中の×（フィラメント）
    if (e.burnt) {                           // 切れた＝フィラメントが途切れた絵にする
      g.beginPath(); g.moveTo(mid.x-d,mid.y-d); g.lineTo(mid.x-2,mid.y-2);
      g.moveTo(mid.x+2,mid.y+2); g.lineTo(mid.x+d,mid.y+d);
      g.moveTo(mid.x+d,mid.y-d); g.lineTo(mid.x-d,mid.y+d); g.stroke();
    } else {
      g.beginPath(); g.moveTo(mid.x-d,mid.y-d); g.lineTo(mid.x+d,mid.y+d);
      g.moveTo(mid.x+d,mid.y-d); g.lineTo(mid.x-d,mid.y+d); g.stroke();
    }
    g.strokeStyle = CIRCUIT_COLOR;
    label(e.burnt ? '切れた' : `${e.Vr}V ${e.Pr}W`, 20);
  }
  // ★押しボタン：物体が乗ると閉じる。押されている状態を色で出す（原因が見えるように）
  else if (e.type==='pushswitch') {
    const r = Math.max(4, e.br || 16);
    line(a, at(lead)); line(at(lead+34), b);
    const hp=at(lead), ep=at(lead+34);
    g.beginPath(); g.arc(hp.x,hp.y,3,0,Math.PI*2); g.stroke();
    g.beginPath(); g.arc(ep.x,ep.y,3,0,Math.PI*2); g.stroke();
    line(hp, e.closed ? ep : at(lead+30,-10));           // 接点（閉じていれば繋がる）
    if (!icon) {                                          // 押される範囲を示す円
      g.save();
      g.setLineDash([4,3]);
      g.strokeStyle = e._pressed ? '#66bb6a' : 'rgba(255,255,255,0.35)';
      g.lineWidth = e._pressed ? 2 : 1;
      g.beginPath(); g.arc(mid.x, mid.y, r, 0, Math.PI*2); g.stroke();
      g.restore();
    }
    g.strokeStyle=CIRCUIT_COLOR;
    label(e.nc ? '押すと切' : '押すと入', 22);
  }
  // ★電磁石：鉄心つきコイルの記号。電流が流れている間は磁場の及ぶ範囲を示す
  else if (e.type==='electromagnet') {
    line(a, at(lead)); line(at(lead+34), b);
    const up = (ny > 1e-9 || (Math.abs(ny) <= 1e-9 && nx < 0)) ? -1 : 1;
    const bw=34/4, rx=bw/2, ry=6.5;
    g.beginPath();
    for (let k=0;k<4;k++){
      const c0=lead+(k+0.5)*bw;
      for (let j=0;j<=10;j++){
        const ph=Math.PI*j/10;
        const p=at(c0-rx*Math.cos(ph), up*ry*Math.sin(ph));
        (k===0&&j===0) ? g.moveTo(p.x,p.y) : g.lineTo(p.x,p.y);
      }
    }
    g.stroke();
    const c1=at(lead,-up*ry-3), c2=at(lead+34,-up*ry-3);   // 鉄心（コイルの外側の1本線）
    g.lineWidth=3; line(c1,c2); g.lineWidth=2;
    if (!icon) {
      const B = emagBz(e);
      if (Math.abs(B) > 1e-4) {                             // 磁場が及ぶ範囲
        const R = Math.max(10, e.fr || 120);
        g.save();
        g.setLineDash([6,5]);
        g.strokeStyle = B > 0 ? 'rgba(38,198,218,0.55)' : 'rgba(255,167,38,0.55)';
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(mid.x, mid.y, R, 0, Math.PI*2); g.stroke();
        g.restore();
        g.strokeStyle=CIRCUIT_COLOR;
      }
      label(`${emagBz(e).toFixed(3)}T`, 22);
    }
  }
  // ★リレーコイル：長方形＋チャンネル番号
  else if (e.type==='relay') {
    line(a, at(lead)); line(at(lead+34), b);
    const c=[at(lead,-8), at(lead+34,-8), at(lead+34,8), at(lead,8)];
    g.beginPath(); g.moveTo(c[0].x,c[0].y);
    for (let i=1;i<4;i++) g.lineTo(c[i].x,c[i].y);
    g.closePath(); g.fill(); g.stroke();
    line(c[0], c[2]);                                       // 斜線＝コイル
    g.fillStyle=e._on?'#66bb6a':CIRCUIT_COLOR; g.font='9px sans-serif'; g.textAlign='center'; g.textBaseline='middle';
    g.fillText('R'+(e.ch|0), mid.x+nx*14, mid.y+ny*14);
    g.textAlign='start'; g.textBaseline='alphabetic'; g.fillStyle='#1a1c23';
  }
  // ★リレー接点：スイッチ記号＋チャンネル番号（連動していることが番号で分かる）
  else if (e.type==='relayswitch') {
    line(a, at(lead)); line(at(lead+34), b);
    const hp=at(lead), ep=at(lead+34);
    g.beginPath(); g.arc(hp.x,hp.y,3,0,Math.PI*2); g.stroke();
    g.beginPath(); g.arc(ep.x,ep.y,3,0,Math.PI*2); g.stroke();
    line(hp, e.closed ? ep : at(lead+30,-12));
    g.fillStyle=CIRCUIT_COLOR; g.font='9px sans-serif'; g.textAlign='center'; g.textBaseline='middle';
    g.fillText('R'+(e.ch|0)+(e.nc?'b':'a'), mid.x+nx*16, mid.y+ny*16);
    g.textAlign='start'; g.textBaseline='alphabetic'; g.fillStyle='#1a1c23';
  }
  // ★モーター端子：丸に M
  else if (e.type==='motor') {
    line(a, at(L/2-11)); line(at(L/2+11), b);
    g.beginPath(); g.arc(mid.x,mid.y,11,0,Math.PI*2); g.fill(); g.stroke();
    g.fillStyle=CIRCUIT_COLOR; g.font='11px sans-serif'; g.textAlign='center'; g.textBaseline='middle';
    g.fillText('M', mid.x, mid.y);
    g.font='9px sans-serif';
    g.fillText('M'+(e.ch|0), mid.x+nx*17, mid.y+ny*17);
    g.textAlign='start'; g.textBaseline='alphabetic'; g.fillStyle='#1a1c23';
    label(`${(e.I||0).toFixed(2)}A`, -18);
  }
  if (!icon) _drawTerm(a,b,g);
}
function _label(mid,nx,ny,text,off=16,g){
  g = g || ctx;
  g.save(); g.fillStyle='#e0e6f0'; g.font='10px sans-serif'; g.textAlign='center';
  g.fillText(text, mid.x+nx*off, mid.y+ny*off); g.restore();
}
// ツールメニュー用の回路記号アイコン。上の drawCircuitElement をそのまま使うので、
// 素子の描き方を変えればアイコンも自動で追従する。
//   高さ26px は最も背の高い記号（電流計・電圧計の円 r=11、直流電源の長線 ±10）が
//   線幅ぶんまで収まる寸法。これより小さくすると端が切れる。
const CIRCUIT_ICON_W = 46, CIRCUIT_ICON_H = 26;
// ★画面に出す高さ。描くのは上の 26px の座標のまま、表示だけ縮める（切れずに小さくなる）。
//   測定の窓のアイコン（20px）と揃え、1行の高さを 28px にする（以前は 32px で窓が縦に長かった）
const CIRCUIT_ICON_SHOW_H = 20;
const _circuitIcons = new Map();   // type -> canvas（メニューは1つしか開かないので使い回せる）
function circuitSymbolCanvas(type) {
  let cv = _circuitIcons.get(type);
  if (cv) return cv;
  cv = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(CIRCUIT_ICON_W * dpr); cv.height = Math.round(CIRCUIT_ICON_H * dpr);
  const k = CIRCUIT_ICON_SHOW_H / CIRCUIT_ICON_H;
  cv.style.width = (CIRCUIT_ICON_W * k).toFixed(1) + 'px'; cv.style.height = CIRCUIT_ICON_SHOW_H + 'px';
  cv.style.flex = '0 0 auto';
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const y = CIRCUIT_ICON_H / 2;
  drawCircuitElement(new CircuitElement(type, 0, 0, 0, 0),
                     { x: 3, y }, { x: CIRCUIT_ICON_W - 3, y }, g, true);
  _circuitIcons.set(type, cv);
  return cv;
}

// ── 2クリック配置（ロープと同じ流儀）────────────────
