function selectNewBody(b) {
  selectedIds.clear(); selectedElemIds.clear(); selectedJointEnds.clear();
  selectedJointId = null;
  selectedElement = null;   // ★地面など要素の選択枠が残るのを防ぐ
  selectedIds.add(b.id);
  updatePropsPanel(b);
  document.getElementById('st-sel').textContent = '1個';
}
// ★新規：配置したジョイントを選択状態にする（ヒンジ/溶接/ばね/ロープ/連結棒/モーター）
function selectNewJoint(j) {
  clearAllSelections();
  selectedJointId = j.id;
  updateJointPanel(j);
  document.getElementById('st-sel').textContent = 'ジョイント';
}
// ★新規：配置した要素（レーザー/動力/軌跡）を選択状態にする
function selectNewElement(el) {
  clearAllSelections();
  selectedElement = el;
  if (el.kind === 'laser')         { updateLaserPanel(el.laser);   document.getElementById('st-sel').textContent = 'レーザー'; }
  else if (el.kind === 'thruster') { updateThrusterPanel(el.thr); document.getElementById('st-sel').textContent = '動力'; }
  else if (el.kind === 'tracer')   { updateTracerPanel(el.body);   document.getElementById('st-sel').textContent = '軌跡'; }
  else if (el.kind === 'wave')     { updateWavePanel(el.source);   document.getElementById('st-sel').textContent = '波源'; }
  else if (el.kind === 'slinky')   { updateSlinkyPanel(el.slinky); document.getElementById('st-sel').textContent = 'ばね'; }
  else if (el.kind === 'emfield')  { updateEMFieldPanel(el.field);
    document.getElementById('st-sel').textContent = el.field.kind === 'E' ? '電場' : '磁場'; }
  else if (el.kind === 'heatfield') { updateHeatFieldPanel(el.field);
    document.getElementById('st-sel').textContent = el.field.kindName(); }
  else if (el.kind === 'flowfield') { updateFlowFieldPanel(el.field);
    document.getElementById('st-sel').textContent = '流れの場'; }
  else if (el.kind === 'arcoat')   { updateArCoatPanel(el);
    document.getElementById('st-sel').textContent = '反射防止コート'; }
}
// ════════════════════════════════════════
//  速度ツール：解放固定と複数適用
// ════════════════════════════════════════
// 解放フラグが立った溶接のうち、対象物体に繋がっているものだけを削除する。
// フラグの無い固定は残す（機構が予告なく分解するのを防ぐため）。
function releaseFixjointsFor(bodySet) {
  let n = 0;
  for (let i = joints.length - 1; i >= 0; i--) {
    const j = joints[i];
    if (j.type !== 'fixjoint' || !j.releasable) continue;
    if (!bodySet.has(j.bodyA) && !bodySet.has(j.bodyB)) continue;
    joints.splice(i, 1);
    _wake(j.bodyA); _wake(j.bodyB);
    n++;
  }
  if (n) {
    if (selectedJointId != null && !joints.some(x => x.id === selectedJointId)) selectedJointId = null;
    if (selectedElement && selectedElement.kind === 'joint' && !joints.includes(selectedElement.joint))
      selectedElement = null;
  }
  return n;
}
// 初速を与える対象＝選択中の可動物体すべて（矩形選択やCtrl+クリックで組める）＋掴んだ物体。
//   ★以前は「選択中すべてに適用」を設定で切り替えていたが、常時ONにした。単独で選んで
//     いれば結果はどちらでも同じで、複数選んでいるときに1つだけ飛ぶほうが事故だからである
//     （質量の違う球を並べて同じ初速で比べる、が速度ツールの主な使い道）。
function velocityTargets(primary) {
  const out = [];
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (b && !b.isStatic) out.push(b);
  }
  if (primary && !primary.isStatic && !out.includes(primary)) out.push(primary);
  return out;
}
// 右クリック時：カーソル下の物体／要素／ジョイントを選択し、右パネルへ反映する
//   判定の順番は左クリック（mouse.js の pointer 分岐）と必ず同じにすること。
//   以前はここだけ物体を先に見ていたため、物体の上に載ったレーザー・動力・軌跡は
//   左クリックでは選べるのに右クリックでは物体が選ばれる、という食い違いがあった。
function selectUnderCursorForCtx(wp) {
  // ⓪ 注釈（テキスト・お絵描き）。注釈ツール中だけ拾う＝ほかのツールでは背景のまま。
  //   ここで拾わないと、右クリックの時点で選択が外れ、メニューの「削除」が注釈に効かない。
  if (isAnnotToolActive()) {
    const an = annotationAtPoint(wp.x, wp.y, undefined, annotSelectFilter());
    if (an) { selectAnnotation(an); return true; }
  }
  // ① 要素（レーザー／動力／軌跡／波源／ばねの端／ジョイント端の●）。物体より優先＝物体の上でも拾える
  const el = pickElement(wp.x, wp.y);
  if (el) {
    if (bulkContainsElement(el)) return true;   // ★一括選択の一員なら選択を壊さない
    // ★範囲選択の一員なら、そちらも壊さない（物体の②と同じ規約）。
    //   まとめて操作するために右クリックするので、押した瞬間に1つへ絞られてしまうと
    //   「複数選択 → 右クリック → 操作」の流れがレーザー・波源だけ成立しなかった。
    if (boxSelectionHasElement(el)) { refreshSelCount(); return true; }
    // ★ジョイントの端も同じ。まとめて操作するために右クリックするので、押した瞬間に
    //   1つへ絞られると「範囲選択 → 右クリック → 端をまとめて操作」が成立しない。
    //   持ち主のジョイントだけは差し替える（右パネルとメニューの見出しを、いま指した端に合わせる）。
    if (el.kind === 'joint' && el.end && isJointEndSelected(el.joint, el.end)
        && selectedJointEnds.size > 1) {
      selectedElement = el;
      selectedJointId = el.joint.id;
      updateJointPanel(el.joint);
      refreshSelCount();
      return true;
    }
    if (el.kind === 'slinky' && el.end && isSlinkyEndSelected(el.slinky, el.end)
        && selectedSlinkyEnds.size > 1) {
      selectedElement = el;
      updateSlinkyPanel(el.slinky);
      refreshSelCount();
      return true;
    }
    clearAllSelections();
    selectedElement = el;
    if (el.kind === 'joint')         { selectedJointId = el.joint.id; updateJointPanel(el.joint); document.getElementById('st-sel').textContent = 'ジョイント'; }
    else if (el.kind === 'laser')    { updateLaserPanel(el.laser);   document.getElementById('st-sel').textContent = 'レーザー'; }
    else if (el.kind === 'thruster') { updateThrusterPanel(el.thr); document.getElementById('st-sel').textContent = '動力'; }
    else if (el.kind === 'tracer')   { updateTracerPanel(el.body);   document.getElementById('st-sel').textContent = '軌跡'; }
    else if (el.kind === 'wave')     { updateWavePanel(el.source);   document.getElementById('st-sel').textContent = '波源'; }
    else if (el.kind === 'slinky')   { updateSlinkyPanel(el.slinky); document.getElementById('st-sel').textContent = 'ばね'; }
    else if (el.kind === 'arcoat')   { updateArCoatPanel(el);        document.getElementById('st-sel').textContent = '反射防止コート'; }
    return true;
  }
  // ①-b 気体（ピストン容器の中身）。左クリック（mouse.js の gasChamberAtPoint）と同じ順で、
  //   物体より先に見る。★器と蓋は普通の物体なので②に落ちるが、気体は objects に居ないので、
  //   ここで拾わないと右クリックでは永久に選べない（メニューが「操作対象が存在しません」になる）。
  //   判定は描いてあるのと同じ多角形なので、見えている気体の領域を指せば選べる。
  const chHit = gasChamberAtPoint(wp.x, wp.y);
  if (chHit) {
    if (bulkContains('gas', chHit)) return true;   // ★一括選択の一員なら選択を壊さない
    clearAllSelections();
    selectedElement = { kind: 'gas', chamber: chHit };
    updateGasPanel(chHit);
    document.getElementById('st-sel').textContent = '気体';
    return true;
  }
  // ② 物体（最前面。★生成口は上に積もった物体より先＝左クリックと同じ順）。
  //   既に複数選択に含まれていればその選択を保つ
  const bHit = frontmostBodyAtPoint(wp.x, wp.y);
  if (bHit) {
    if (!selectedIds.has(bHit.id)) {
      clearAllSelections();
      selectedIds.add(bHit.id);
      updatePropsPanel(bHit);
    }
    document.getElementById('st-sel').textContent = selectedIds.size > 1 ? `${selectedIds.size}個` : '1個';
    return true;
  }
  // ③ ジョイントの線（ばね／ロープ／棒など）
  const jHit = jointAtPoint(wp.x, wp.y);
  if (jHit) {
    if (bulkContains('joint', jHit)) return true;   // ★一括選択の一員なら選択を壊さない
    // ★端をまとめて選んでいるロープ・棒の線を指した場合も壊さない（端の●は小さいので、
    //   まとめて操作したいときに線のほうを指すことが多い）
    if (selectedJointEnds.size > 1 &&
        (isJointEndSelected(jHit, 'A') || isJointEndSelected(jHit, 'B'))) {
      selectedJointId = jHit.id;
      updateJointPanel(jHit);
      refreshSelCount();
      return true;
    }
    clearAllSelections();
    selectedJointId = jHit.id;
    updateJointPanel(jHit);
    document.getElementById('st-sel').textContent = 'ジョイント';
    return true;
  }
  // ④ 回路素子（同上）
  const cHit = circuitAtPoint(wp.x, wp.y);
  if (cHit) {
    if (!bulkContains('circuit', cHit)) selectCircuitElement(cHit);   // ★一括選択の一員なら壊さない
    return true;
  }
  // ⑤ 電場・磁場の領域（面なので、他に何も当たらなかったときだけ。地面より手前）
  const fHit = emFieldAtPoint(wp.x, wp.y);
  if (fHit) {
    if (bulkContains('emfield', fHit)) return true;   // ★一括選択の一員なら選択を壊さない
    clearAllSelections();
    selectedElement = { kind: 'emfield', field: fHit };
    updateEMFieldPanel(fHit);
    document.getElementById('st-sel').textContent = fHit.kind === 'E' ? '電場' : '磁場';
    return true;
  }
  // ⑤-b 加熱・冷却の領域（電場・磁場と同じ扱い。面なので最後の方に置く）
  const hHit = heatFieldAtPoint(wp.x, wp.y);
  if (hHit) {
    if (bulkContains('heatfield', hHit)) return true;   // ★一括選択の一員なら選択を壊さない
    clearAllSelections();
    selectedElement = { kind: 'heatfield', field: hHit };
    updateHeatFieldPanel(hHit);
    document.getElementById('st-sel').textContent = hHit.kindName();
    return true;
  }
  // ⑤-c 流れの場（同上）。★左クリック（mouse.js の flowFieldEdgeAtPoint）と同じ順に置くこと
  const flHit = flowFieldAtPoint(wp.x, wp.y);
  if (flHit) {
    if (bulkContains('flowfield', flHit)) return true;   // ★一括選択の一員なら選択を壊さない
    clearAllSelections();
    selectedElement = { kind: 'flowfield', field: flHit };
    updateFlowFieldPanel(flHit);
    document.getElementById('st-sel').textContent = '流れの場';
    return true;
  }
  // ⑥ 地面（左クリック選択と同じ条件）
  if (world.terrain && signedDistToGround(wp.x, wp.y) <= 4 / cam.zoom) {
    clearAllSelections();
    selectedElement = { kind: 'ground' };
    updateGroundPanel();
    document.getElementById('st-sel').textContent = '地面';
    return true;
  }
  return false;
}
function applyMaterialToSelection(props) {
  if (selectedIds.size === 0) return;
  pushUndo();
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (!b) continue;
    if (props.density !== undefined) {                 // ★ mass → density
      b.density = props.density;
      b.setMass(b.massFromDensity());                  // 質量 = 密度 × 面積 × 奥行き
    }
    if (props.restitution !== undefined) b.restitution = props.restitution;
    if (props.friction    !== undefined) b.friction    = props.friction;
    b.frictionStatic = props.frictionStatic !== undefined
      ? Math.max(props.frictionStatic, b.friction) : b.friction;
    if (props.fillColor   !== undefined) b.fillColor   = props.fillColor;
    b.ior  = props.ior  !== undefined ? props.ior  : 0;
    b.abbe = props.abbe !== undefined ? props.abbe : ABBE_DEFAULT;   // ★分散も素材とともに切り替わる
    b.dispersion = !!props.dispersion;                    // ガラス→木材で分散が残らないように
    if (!b.reflective) b.reflectance = props.reflectance !== undefined ? props.reflectance : 0;
    // ↑ ガラス→木材で反射率が残らないように（鏡は素材で反射をなくされると困るので除外）
    if (opticHasFocal(b.opticKind)) {                     // ★レンズなら曲率を作り直す
      b.focal = Math.max(minOpticFocal(b.opticKind, b.opticH, b.ior, b.opticIdeal), Math.abs(b.focal));
      rebuildOpticGeometry(b);
    }
    b.sleeping = false; b.sleepTimer = 0;
  }
  const first = objects.find(o => selectedIds.has(o.id));
  if (first) updatePropsPanel(first);
}
// 物体の値から素材名を逆に引く。素材プリセットの強調表示はこれで決める。
//   ★「押した素材」を物体に覚えさせない。覚えさせると、あとから質量・色・摩擦を手で
//     変えたときに名前だけが残り、実際の値と食い違ったものを選択中の物体の情報として
//     出すことになる（以前は押した記録すら持たず、別の物体を選んでも前の強調が残っていた）。
//     値から毎回引き直せば、表示は必ずいまの物体そのものを指す。
//   MATERIALS は密度がすべて異なるうえ全項目で照合するので、名前は一意に決まる。
//   手で1つでも変えれば、どれとも一致しなくなって強調が外れる（＝素材から離れた、が正しく出る）。
function bodyMaterialName(b) {
  if (!b) return null;
  for (const [name, p] of Object.entries(MATERIALS))
    if (_bodyMatchesMaterial(b, p)) return name;
  return null;
}
// 照合の規則は applyMaterialToSelection の代入と1対1に対応させる（無指定時の既定の埋め方も同じ）
function _bodyMatchesMaterial(b, p) {
  const eq = (x, y) => Math.abs(x - y) < 1e-6;
  const fr = p.friction !== undefined ? p.friction : b.friction;
  const fs = p.frictionStatic !== undefined ? Math.max(p.frictionStatic, fr) : fr;
  if (p.density    !== undefined && !eq(b.density,    p.density))    return false;
  if (p.restitution!== undefined && !eq(b.restitution,p.restitution))return false;
  if (!eq(b.friction, fr) || !eq(b.frictionStatic, fs))              return false;
  if (p.fillColor  !== undefined && b.fillColor !== p.fillColor)     return false;
  if (!eq(b.ior,  p.ior  !== undefined ? p.ior  : 0))                return false;
  if (!eq(b.abbe, p.abbe !== undefined ? p.abbe : ABBE_DEFAULT))     return false;
  if (!!b.dispersion !== !!p.dispersion)                             return false;
  // 反射率は鏡（reflective）には素材から入れていないので、照合からも同じように外す
  if (!b.reflective && !eq(b.reflectance, p.reflectance !== undefined ? p.reflectance : 0)) return false;
  return true;
}
// ════════════════════════════════════════
//  プロパティのコピー／貼り付け
//   「複製」が形と位置ごと写すのに対し、こちらは材質・光学・見た目の設定だけを配る。
//   ひとつの物体を丁寧に作り込んでから、同じ設定の物体を並べるための道具。
// ════════════════════════════════════════
// ★質量ではなく密度を写す。質量は大きさに依存する量なので、そのまま配ると
//   大きい物体ほど密度が下がり、浮沈・慣性・衝突後の速度が意図と違ってしまう。
//   密度は物質固有の量なので、貼り付け先の面積で 質量 = ρ×面積×奥行き を計算し直せばよい。
// ★位置・角度・速度・角速度は「状態」であって性質ではないので写さない。
//   形（半径・幅高さ・頂点）も写さない――それは「複製」の仕事。
//   ラベルは一意であるべきなので写さない。
// ★動力・軌跡・ガイドレールも写さない。前2つは力点・記録点がローカル座標なので
//   形の違う物体では見当違いの位置に付き、ガイドレールは通す直線が絶対座標のため。
const PROP_COPY_KEYS = [
  'density',                                             // ★質量ではなく密度（上の理由）
  'restitution', 'friction', 'frictionStatic', 'drag',   // 力学
  'ior', 'abbe', 'dispersion', 'reflectance', 'fresnel', // 光学
  'waveMode', 'waveIor',                                 // 波動場での扱い
  'fillColor', 'strokeColor', 'strokeWidth', 'alpha',    // 見た目
  'hasGravity', 'isStatic', 'fixedRotation', 'layers',   // 動きの制限
  'charge',                                              // 電荷[C]は絶対量。大きさが違っても同じ値を写す
];
// 貼り付けの可否を決める「種類」。丸ツール等で作った物体と、光学素子（レンズ・鏡）は別扱い。
// 光学素子は屈折率で曲率＝形そのものが決まるので、不透明な物体の設定（ior=0）を
// 流し込むと、レンズの形をした不透明な板になってしまう。
const bodyPropKind = b => (b.opticKind ? 'optic' : 'body');
const PROP_KIND_LABEL = { body:'物体', optic:'光学素子' };
// 選択中で、コピー元と同じ種類のものだけを集める
function propPasteTargets() {
  if (!propClipboard) return [];
  const out = [];
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (b && bodyPropKind(b) === propClipboard.kind) out.push(b);
  }
  return out;
}
// メニューに出す「いま何を持っているか」の要約。
// 授業中に取り違えないよう、材質名（分かれば）と主要な3つの数値を出す。
function propClipSummary() {
  if (!propClipboard) return '';
  const p = propClipboard.props;
  const kind = PROP_KIND_LABEL[propClipboard.kind] || '物体';
  const mat = Object.keys(MATERIALS).find(n => {
    const m = MATERIALS[n];
    return m.density === p.density && m.restitution === p.restitution && m.friction === p.friction;
  });
  const detail = mat
    ? `${mat}・密度${Math.round(p.density)}`
    : `密度${Math.round(p.density)}・反発${p.restitution}・摩擦${p.friction}`;
  return `${kind}／${detail}` + (p.ior > 1 ? `・屈折率${p.ior}` : '');
}
// 上部メニューと右クリックメニューで同じ表記を使うための見出し。
// 「何をコピー済みか」「なぜ押せないか」がその場で分かるようにする。
function propCopyLabel() {
  return selectedIds.size === 1 ? 'プロパティをコピー'
       : selectedIds.size === 0 ? 'プロパティをコピー（未選択）'
       : 'プロパティをコピー（1個だけ選んでください）';
}
function propPasteLabel() {
  if (!propClipboard) return 'プロパティを貼り付け（コピーなし）';
  const n = propPasteTargets().length;
  if (!n) return `プロパティを貼り付け（${PROP_KIND_LABEL[propClipboard.kind]}を選んでください）`;
  return `プロパティを貼り付け（${propClipSummary()}）→ ${n}個`;
}
function propPasteTitle() {
  if (!propClipboard) return 'まず1個だけ選んで「プロパティをコピー」を実行してください';
  const k = PROP_KIND_LABEL[propClipboard.kind];
  return `コピー済み：${propClipSummary()}\n`
       + `密度・反発・摩擦・空気抵抗・光学・波動・色・動きの制限・電荷を写します。\n`
       + `質量ではなく密度を写すので、大きさの違う物体でも同じ材質になります。\n`
       + `位置・角度・速度・形・ラベル・動力・軌跡・ガイドレールは写しません。\n`
       + `貼り付け先は「${k}」だけです（物体と光学素子は別の種類として扱います）。`;
}
function copyBodyProps() {
  // ★コピー元は1個のときだけ。複数選んでいると「どれの設定か」が決まらない
  if (selectedIds.size !== 1) return;
  const b = objects.find(o => selectedIds.has(o.id));
  if (!b) return;
  const props = {};
  for (const k of PROP_COPY_KEYS) props[k] = b[k];
  // 質量を直接指定して作られた物体は density が null のことがある。
  // 今の面積から逆算して、貼り付け側が必ず密度を使えるようにしておく。
  if (props.density == null)
    props.density = b.mass / Math.max(b.areaM2() * world.depth, 1e-9);
  propClipboard = { kind: bodyPropKind(b), props };
}
function pasteBodyProps() {
  const targets = propPasteTargets();
  if (!targets.length) return;
  pushUndo();
  const p = propClipboard.props;
  for (const b of targets) {
    for (const k of PROP_COPY_KEYS) {
      if (k === 'density' || k === 'charge') continue;   // ↓で個別に扱う
      b[k] = p[k];
    }
    b.frictionStatic = Math.max(b.frictionStatic, b.friction);   // 静摩擦 ≥ 動摩擦
    if (b.fixedRotation) b.av = 0;                               // setFixedRotation と同じ後始末
    b.density = p.density;
    // ★導体棒は電荷を持てない（回路用の素子として扱っている。右パネルと同じ規則）
    if (!b.conductor) b.charge = p.charge;
    // ★レンズは屈折率と焦点距離で曲率＝頂点が決まる。屈折率を写したら形を作り直す。
    //   面積が変わるので、下の質量の計算より必ず先に行う。
    //   下限に渡す屈折率は opticGeometry と同じ規則（n≤1 は鏡＝未使用なので 1.5 とみなす）で
    //   揃える。生の ior=0 を渡すと下限が H/(2×10⁻³)=500H に跳ね上がり、
    //   曲面鏡からレンズへ貼り付けた瞬間にレンズが平板まで潰れてしまう。
    if (opticHasFocal(b.opticKind)) {
      const nL = b.ior > 1 ? b.ior : 1.5;
      b.focal = Math.max(minOpticFocal(b.opticKind, b.opticH, nL, b.opticIdeal), Math.abs(b.focal));
      rebuildOpticGeometry(b);
    }
    b.setMass(b.massFromDensity());   // 質量 = 密度 × 面積 × 奥行き（invMass・慣性もここで揃う）
    b.sleeping = false; b.sleepTimer = 0;
  }
  refreshPropsForSelection();   // 右パネル（代表の値）を書き換えた内容に合わせ直す
}
// ════════════════════════════════════════
//  プロパティ用語のヘルプ（ラベルにカーソルを合わせると説明を表示）
//   キーはラベル文字列の前方一致。単位と定義式を必ず入れる。
// ════════════════════════════════════════
