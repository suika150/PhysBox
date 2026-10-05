function _lensArcData(x0, H, bulge, n) {
  const pts = [];
  if (Math.abs(bulge) < 1e-6) {
    for (let i=0;i<=n;i++){ const y=-H+(2*H)*i/n; pts.push({x:x0,y}); }
    return { pts, circle: null };                    // 平面：法線は弦のままでよい
  }
  const u = (H*H - bulge*bulge) / (2*bulge);
  const cx = x0 - u, apexX = x0 + bulge, r = Math.hypot(u, H), s = Math.sign(apexX - cx) || 1;
  for (let i=0;i<=n;i++){ const y=-H+(2*H)*i/n; const rad2=Math.max(r*r-y*y,0); pts.push({x:cx+s*Math.sqrt(rad2),y}); }
  return { pts, circle: { cx, cy: 0, r } };
}
// ポリゴンの面積重心（回転の支点として妥当な中心）
function _areaCentroid(v) {
  let A=0, cx=0, cy=0;
  for (let i=0;i<v.length;i++){ const p=v[i], q=v[(i+1)%v.length]; const c=p.x*q.y-q.x*p.y; A+=c; cx+=(p.x+q.x)*c; cy+=(p.y+q.y)*c; }
  A *= 0.5;
  if (Math.abs(A) < 1e-9) { let mx=0,my=0; for (const p of v){mx+=p.x;my+=p.y;} return {x:mx/v.length,y:my/v.length}; }
  return { x: cx/(6*A), y: cy/(6*A) };
}
function focalToSagitta(kind, H, focal, n) {
  let R = kind === 'curvedMirror'
    ? 2 * Math.abs(focal)
    : 2 * Math.max(n - 1, 1e-3) * Math.abs(focal);
  R = Math.max(R, H);                     // R<H は円弧が閉じない幾何学的下限
  return R - Math.sqrt(R*R - H*H);
}
// レンズの幾何学的下限 R≥H を焦点距離に翻訳した最小値 [px]
//   ★理想化した素子には球面が無いので、この下限は効かない（短い f こそ使いたい設定なので、
//     ガラスの曲率半径から来る制限をそのまま残すと理想化した意味が半分無くなる）。
//     完全に自由にすると f→0 で発散するため、開口半径の 1 割だけ床を残す。
function minOpticFocal(kind, H, n, ideal) {
  if (ideal && opticHasFocal(kind)) return Math.max(1, H * 0.1);
  return kind === 'curvedMirror' ? H/2 : H / (2 * Math.max(n - 1, 1e-3));
}
// 従来の固定矢高（0.35H/0.22H/0.38H）を再現する既定焦点距離
//   n=1.5 のとき 2(n−1)=1 なので、従来値と完全に一致する（後方互換を数値検証済み）
function defaultOpticFocal(kind, H, n) {
  const RofB = b => (H*H + b*b) / (2*b);              // 矢高 → 曲率半径
  const fOfR = R => R / (2 * Math.max(n - 1, 1e-3));  // 曲率半径 → 焦点距離（レンズ）
  if (kind === 'convexLens')   return fOfR(RofB(0.35*H));
  if (kind === 'concaveLens')  return fOfR(RofB(0.22*H));
  if (kind === 'curvedMirror') return RofB(0.38*H) / 2;
  return 0;
}
// 板状の素子（回折格子・スクリーン）の厚み [px]。
//   格子は薄いほうが「面に開いた開口」らしく見えるので鏡より薄くする。
//   ★厚みは物理にも効く：スリットから出た波は板の裏面から出発するものとして扱うので、
//     ここを変えると光路長がそのぶん変わる（干渉の結果まで一貫して動く）。
const opticPlateT = (kind, H) => kind === 'screen' ? Math.max(4, H*0.05) : Math.max(3, H*0.035);
// 格子の板が持つべき最小の長さ（半分）[px]。
//   スリット列 N·d が板からはみ出すと「中央にスリットがある板」ではなくなるので、
//   はみ出す設定になったら板のほうを伸ばす（設定値のほうを削らない）。
const gratingMinH = (n, d) => n * d / 2 + Math.max(10, d);
// 焦点距離を持つ光学素子か。平らな板（平面鏡・回折格子・スクリーン）は持たない。
//   ★ここを通さないと、板にも minOpticFocal（レンズ用の式）が適用されて、
//     ior=0 の板で f = H/(2×1e-3) という桁違いの値がプロパティ欄に出てしまう。
const opticHasFocal = k => !!k && k !== 'planeMirror' && k !== 'grating' && k !== 'screen';
// 理想化として振る舞っている素子か。焦点距離を持つ素子だけが理想化できる
//   （平面鏡・回折格子・スクリーンには焦点が無いので、チェックがあっても無視する）。
const isIdealOptic = b => !!b && !!b.opticIdeal && opticHasFocal(b.opticKind) && b.focal > 0;
// 理想素子の符号付き焦点距離 [px]。b.focal は大きさしか持たないので、ここで向きを与える。
//   凸レンズ … 集光 f>0 ／ 凹レンズ … 発散 f<0
//   曲面鏡は1つの物体の表裏が凹面鏡・凸面鏡なので、どちら側から当たったかで決まる。
//   uxLocal … 入射方向の光軸（ローカルx）成分。+ なら −x 側から来た＝凹面（集光）側。
function idealFocalSigned(b, uxLocal) {
  const f = Math.abs(b.focal);
  if (b.opticKind === 'concaveLens') return -f;
  if (b.opticKind === 'curvedMirror') return uxLocal > 0 ? f : -f;
  return f;                                            // convexLens
}
// 理想素子の見た目：教科書の記号（両端に矢羽根を付けた薄い棒）。
//   ★理想化したら形も薄板にする。球面のままだと「曲げる面」をどこに置いても破綻する：
//     面の位置で曲げれば矢高のぶん焦点がばらけて理想でなくなり、主平面で曲げれば
//     光線が素子の中へ数十px めり込んで見える（既定の矢高は 0.38H もある）。
//     薄板なら面＝主平面なので、どちらの問題も起きない。
//   矢羽根の向きが集光（外向き）と発散（内向き）を区別する。これが無いと、
//   理想化した凸レンズと凹レンズが同じ灰色の板になって見分けられない。
function _idealSymbolVerts(H, converging) {
  const t  = Math.max(2, H * 0.02);                    // 板の半分の厚み
  const aL = Math.min(Math.max(6, H * 0.16), H * 0.4); // 矢羽根の長さ
  const aW = Math.max(4, H * 0.06);                    // 矢羽根の半分の幅
  if (converging)                                      // 外向き矢印 ▲▼：集光
    return [{x:-t,y:-H+aL},{x:-aW,y:-H+aL},{x:0,y:-H},{x:aW,y:-H+aL},{x:t,y:-H+aL},
            {x: t,y: H-aL},{x: aW,y: H-aL},{x:0,y: H},{x:-aW,y: H-aL},{x:-t,y: H-aL}];
  return [{x:-aW,y:-H},{x:aW,y:-H},{x:t,y:-H+aL},                       // 末広がり：発散
          {x: t,y: H-aL},{x:aW,y: H},{x:-aW,y: H},{x:-t,y: H-aL},{x:-t,y:-H+aL}];
}
function _mkArc(circle, out, e0, e1) {
  return circle ? { cx: circle.cx, cy: circle.cy, r: circle.r, out, e0, e1 } : null;
}
// 種類と開口半径Hから、原点中心のローカル頂点列＋円弧対応表を生成
//   ideal … 理想化された素子（球面を持たない薄板の記号にする）
function opticGeometry(kind, H, focal, ior, ideal) {
  const n = 18;                                        // 円弧の分割数（従来どおり）
  const nL = (ior > 1) ? ior : 1.5;                    // ★レンズ材質の屈折率（鏡では未使用）
  if (!focal) focal = defaultOpticFocal(kind, H, nL);
  let verts = [], arcs = [];
  if (ideal && opticHasFocal(kind)) {
    // 曲面鏡は表裏で凹面鏡・凸面鏡が入れ替わるので、記号としてはどちらでもない中立な
    // 「外向き矢羽根」で描く（発散側から使うことも普通にあるため）
    verts = _idealSymbolVerts(H, kind !== 'concaveLens');
  } else if (kind === 'convexLens') {
    const B = focalToSagitta(kind, H, focal, nL);
    const right = _lensArcData(0, H, +B, n), left = _lensArcData(0, H, -B, n);
    for (let i=0;i<right.pts.length;i++) verts.push(right.pts[i]);
    for (let i=left.pts.length-2;i>=1;i--) verts.push(left.pts[i]);
    arcs = [ _mkArc(right.circle, +1, 0, n-1), _mkArc(left.circle, +1, n, 2*n-1) ];
  } else if (kind === 'concaveLens') {  // 凹レンズ：両凹（発散）。縁に厚みを持たせる
    const depth = focalToSagitta(kind, H, focal, nL);
    const W = depth + Math.max(4, H*0.08);   // 縁の厚み：中心厚 2(W-depth)>0 を常に保証
    const right = _lensArcData(+W, H, -depth, n), left = _lensArcData(-W, H, +depth, n);
    for (let i=0;i<right.pts.length;i++) verts.push(right.pts[i]);
    for (let i=left.pts.length-1;i>=0;i--) verts.push(left.pts[i]);
    arcs = [ _mkArc(right.circle, -1, 0, n-1), _mkArc(left.circle, -1, n+1, 2*n) ];
  } else if (kind === 'curvedMirror') {   // 曲面鏡：向き次第で凹(集光)にも凸(発散)にもなる
    const B = focalToSagitta(kind, H, focal, nL);
    const T = Math.max(6, H*0.14);
    const front = _lensArcData(0, H, B, n);
    const back = front.pts.map(p => ({ x: p.x - T, y: p.y }));
    for (let i=0;i<front.pts.length;i++) verts.push(front.pts[i]);
    for (let i=back.length-1;i>=0;i--) verts.push(back[i]);
    const bc = front.circle ? { cx: front.circle.cx - T, cy: front.circle.cy, r: front.circle.r } : null;
    arcs = [ _mkArc(front.circle, +1, 0, n-1), _mkArc(bc, -1, n+1, 2*n) ];
  } else if (kind === 'planeMirror') {    // 平面鏡：薄い長方形（両面が反射面。円弧なし）
    const T = Math.max(6, H*0.12);
    verts = [{x:-T/2,y:-H},{x:T/2,y:-H},{x:T/2,y:H},{x:-T/2,y:H}];
  } else if (kind === 'grating' || kind === 'screen') {
    // ★どちらも薄い長方形。長手方向は局所 y、面の法線は局所 x。
    //   スリットは「板に開いた穴」ではなく、当たり判定はふさがったままにする（下の理由）。
    //   光がスリットを通るのは traceLaser の側で判定する：幾何的な穴として作ってしまうと
    //   通った光はまっすぐ進むだけで、回折＝波面の再放射が起きない（縞が出ない）。
    //   物体としては1枚の板でいてもらったほうが、置く・回す・落とすの扱いも素直になる。
    const T = opticPlateT(kind, H);
    verts = [{x:-T/2,y:-H},{x:T/2,y:-H},{x:T/2,y:H},{x:-T/2,y:H}];
  } else return null;
  arcs = arcs.filter(Boolean);
  const c = _areaCentroid(verts);
  for (const A of arcs) { A.cx -= c.x; A.cy -= c.y; }   // 円の中心も重心基準へ揃える
  return { verts: verts.map(p => ({ x: p.x - c.x, y: p.y - c.y })), arcs };
}
// プレビュー等で頂点だけ欲しい場合の従来インターフェース
function opticLocalVerts(kind, H, focal, ior, ideal) {
  const g = opticGeometry(kind, H, focal, ior, ideal);
  return g ? g.verts : null;
}
// 光学素子ボディを生成（レンズ=ガラス屈折 ior1.5 / 鏡=反射 reflective）
function createOptic(kind, x, y, H, angle, focal) {
  const isMirror = (kind === 'curvedMirror' || kind === 'planeMirror');
  const isPlate  = (kind === 'grating' || kind === 'screen');
  const nL = 1.52, VL = 64;                              // ★クラウンガラス（分散あり）
  // 格子はスリット列が収まる長さを確保する（ドラッグが短くても板のほうを伸ばす）
  if (kind === 'grating') H = Math.max(H, gratingMinH(gratingSlitN, gratingSlitD));
  if (focal === undefined) focal = defaultOpticFocal(kind, H, nL);
  const g = opticGeometry(kind, H, focal, nL);
  if (!g) return null;
  const verts = g.verts;
  let opts;
  if (kind === 'grating')
    // 遮光部は吸収（反射率0）。ior=0＝不透明なので、スリット以外に当たった光はそこで終わる。
    opts = { ior: 0, reflectance: 0, abbe: ABBE_DEFAULT, dispersion: false,
             fillColor: '#37474f', strokeColor: '#b0bec5',
             slitN: gratingSlitN, slitD: gratingSlitD, slitA: gratingSlitA };
  else if (kind === 'screen')
    // 受光面。つや消しの白い板で、当たった光を吸収して強度分布だけを残す。
    opts = { ior: 0, reflectance: 0, abbe: ABBE_DEFAULT, dispersion: false,
             fillColor: '#e0e0e0', strokeColor: '#fafafa' };
  else if (isMirror)
    opts = { reflective: true, ior: 0, abbe: ABBE_DEFAULT, dispersion: false, fillColor: '#90a4ae', strokeColor: '#eceff1' };
  else
    opts = { ior: nL, abbe: VL, dispersion: true, fillColor: 'rgba(130,200,255,0.32)', strokeColor: '#bbdefb' };
  const mass = Math.max(1, H*0.06);
  return new Body({ type: 'polygon', x, y, angle: angle || 0, verts, opticArcs: g.arcs, mass, restitution: 0.2, friction: 0.4, drag: 0.01, strokeWidth: 1.5, opticKind: kind, opticH: H, focal: isPlate ? 0 : focal, ...opts });
}
// スリットの設定を変えたあと、板の長さと当たり判定を作り直す。
//   ★スリット列がはみ出すときだけ板を伸ばす。縮めはしない（一度広げた板が
//     スリットを減らした拍子に勝手に縮むと、置いた位置関係が崩れるため）。
function rebuildGrating(b) {
  if (!b || b.opticKind !== 'grating') return;
  b.slitN = Math.max(1, Math.round(b.slitN));
  b.slitD = Math.max(1, b.slitD);
  b.slitA = Math.max(0.5, Math.min(b.slitA, b.slitD));    // a ≤ d（隣のスリットと重なれない）
  const need = gratingMinH(b.slitN, b.slitD);
  if (b.opticH >= need) return;
  b.opticH = need;
  rebuildOpticGeometry(b);       // verts / convexParts / AABB をまとめて作り直す
}
// 左ツールバー「光学」ポップアップ
function toggleOpticsMenu(e) {
  if (closeToolPopups('optics-popup')) return;
  const menu = document.createElement('div');
  menu.id = 'optics-popup';
  const top = Math.min(e.clientY, window.innerHeight - 240);
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:' + top + 'px; width:180px; box-shadow:var(--shadow);';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">光学ツール設定</span>
      <span id="opt-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <div id="opt-kinds"></div>
    <label class="checkbox-row" style="margin-top:10px">
      <input type="checkbox" id="opt-static" ${opticAutoStatic ? 'checked' : ''}>
      <span>置いたら固定する</span>
    </label>
    <div style="font-size:10px;color:var(--text2);margin-top:6px;line-height:1.5">
      光路に据え付けるため既定でONです。OFFにすると<b>重力で落下します</b>。
      設置後は右パネルの「背景に固定」で個別に変更できます。
    </div>
  `;
  document.body.appendChild(menu);
  const kinds = menu.querySelector('#opt-kinds');
  // ★最後の「反射防止コート」だけは新しい物体を置くツールではなく、既存の物体の面に
  //   付ける部品（動力・軌跡と同じ取り外しできる要素）。だから pendingOptic を使わない。
  const items = [['凸レンズ','convexLens'],['凹レンズ','concaveLens'],['曲面鏡','curvedMirror'],['平面鏡','planeMirror'],
                 ['回折格子','grating'],['スクリーン','screen'],['反射防止コート','arcoat']];
  const sync = () => {                       // 選択中の種類を強調（他のツールメニューと同じ流儀）
    for (const b of kinds.querySelectorAll('button')) {
      const on = b.dataset.kind === 'arcoat'
        ? currentTool === 'arcoat'
        : currentTool === 'optic' && pendingOptic && pendingOptic.kind === b.dataset.kind;
      b.style.background = on ? 'var(--tool-active)' : '';
      b.style.color      = on ? '#fff' : '';
    }
  };
  for (const [label, kind] of items) {
    const b = document.createElement('button');
    b.textContent = label; b.className = 'btn-small';
    b.dataset.kind = kind;
    b.style.cssText = 'display:block; width:100%; margin-bottom:3px; text-align:left'
                    + (kind === 'arcoat' ? '; margin-top:8px' : '');
    b.onclick = () => { kind === 'arcoat' ? setTool('arcoat') : chooseOptic(kind); sync(); };
    kinds.appendChild(b);
  }
  sync();
  menu.querySelector('#opt-static').addEventListener('change', ev => { opticAutoStatic = ev.currentTarget.checked; });
  menu.querySelector('#opt-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());   // キャンバスへの伝播を防ぐ
  menu.addEventListener('click', ev => ev.stopPropagation());
}
// 光学素子の種類名。設置の案内と、右クリックの「同じ種類を選択」の見出しで使う
const OPTIC_KIND_NAMES = { convexLens:'凸レンズ', concaveLens:'凹レンズ', curvedMirror:'曲面鏡',
                           planeMirror:'平面鏡', grating:'回折格子', screen:'スクリーン' };
// 種類選択 → サイズ入力 → 設置ツールへ
function chooseOptic(kind) {
  setTool('optic');
  pendingOptic = { kind };
  drawStart = null;
  const names = OPTIC_KIND_NAMES;
  const extra = kind === 'grating'
    ? '：ドラッグで向きを決定（スリット列が収まる長さまで自動で伸びます）'
    : '：ドラッグでサイズと向きを決定（Shift=角度スナップ）';
  document.getElementById('hint-text').textContent = names[kind] + extra;
}
// 左ツールバーの「図形和」。編集メニュー・右クリックと同じ BOOLEAN_OPS を並べる。
//   ★以前は色を直書き（#222 / #4fc3f7）していてテーマの変数から外れていた。
//     もう一度押すと閉じない（同じ窓が積み重なる）不具合もここで直す。
function toggleBooleanMenu(e) {
  if (closeToolPopups('boolean-popup')) return;
  const menu = document.createElement('div');
  menu.id = 'boolean-popup';
  menu.style.cssText =
    'position:fixed; background:var(--panel); border:1px solid var(--border); border-radius:6px;' +
    'padding:4px 0; z-index:9999; box-shadow:var(--shadow); min-width:170px; left:58px;' +
    'top:' + Math.min(e.clientY, window.innerHeight - 130) + 'px;';
  const few = selectedIds.size < 2;
  if (few) {
    const note = document.createElement('div');
    note.className = 'ctx-label';
    note.textContent = '図形を2つ以上選んでください';
    menu.appendChild(note);
  }
  for (const [key, label, title] of BOOLEAN_OPS) {
    const it = document.createElement('div');
    it.className = 'ctx-item';
    it.textContent = label;
    it.title = title;
    if (few) { it.style.opacity = 0.4; it.style.cursor = 'default'; }
    else it.onclick = () => { menu.remove(); applyClipper(key); };
    menu.appendChild(it);
  }
  document.body.appendChild(menu);
  menu.addEventListener('mousedown', ev => ev.stopPropagation());
  setTimeout(() => {
    document.addEventListener('mousedown', function close(ev) {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); }
    });
  }, 0);
}
