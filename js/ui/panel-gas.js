// ════════════════════════════════════════
//  閉じ込めた気体のプロパティ
// ════════════════════════════════════════
//  ★熱力学的性質は「気体」のものであって、蓋（ピストン）や器のものではない。
//    ここに出すのは P・V・T・n・自由度・比熱・状態変化・第一法則の帳簿だけで、
//    寸法・質量・素材・熱容量・色は器と蓋を選んだときの物体のパネルに出る
//    （器と蓋は気体の付属品だが、それ自身は普通の物体としてふるまう）。
//    唯一「普通でない」のは蓋が軸から傾かず外れないことで、これは操作できない
//    仕様なので、欄ではなく注記として物体のパネルに出す（_syncVesselRows）。
// いま選択している気体
function selectedGasChamber() {
  if (selectedElement && selectedElement.kind === 'gas') return selectedElement.chamber;
  return null;
}
// その気体を閉じ込めている容器（器・蓋の寸法を読むときに要る）
function selectedGasVessel() {
  const ch = selectedGasChamber();
  return ch ? pistonVesselOfChamber(ch.id) : null;
}
function updateGasPanel(ch) {
  if (!ch) { updatePropsPanel(null); return; }
  _hideAllPropForms();
  document.getElementById('gas-form').style.display = '';
  syncGasRows(ch);
  refreshPvGraphButton();
  syncSliders();
}
// 値は動くので、毎フレームの更新（updateLiveGasReadout）からも呼ぶ
function syncGasRows(ch) {
  if (!ch) return;
  const set = (id, val) => { const e = document.getElementById(id);
                             if (e && document.activeElement !== e) e.value = val; };
  set('p-gas-pnow', (ch.P / 1000).toFixed(2));
  set('p-gas-vnow', (ch.V * 1000).toFixed(2));
  set('p-gas-tnow', K2C(ch.T).toFixed(1));
  set('p-gas-nnow', (ch.n || 0).toFixed(4));
  set('p-gas-dof',  ch.dof);
  // マイヤーの関係： Cp − Cv = R。自由度から Cv が決まり、γ = Cp/Cv が断熱を決める
  set('p-gas-cv',    ((ch.dof / 2) * R_GAS).toFixed(2));
  set('p-gas-cp',    ((ch.dof / 2 + 1) * R_GAS).toFixed(2));
  set('p-gas-gamma', ch.gamma().toFixed(4));
  _syncGasLedger(ch, set);
  const p = ch.piston();
  // いま効いている変化のボタンを押した見た目にする（定積/定圧 と 等温/断熱 は独立）。
  //   定積＝蓋を器に固定する（世界に固定するのではない。setGasPistonLocked の★）。
  //   この2つは同じ状態の別表現ではなく排他の設定なので、控えをそのまま読んでよい。
  const locked = !!ch.pistonLocked;
  const act = (id, on) => { const e = document.getElementById(id); if (e) e.classList.toggle('active', !!on); };
  act('p-gas-iso-v', locked);
  act('p-gas-iso-p', !locked);
  act('p-gas-iso-t', ch.thermostat != null);
  act('p-gas-adia',  ch.thermostat == null && ch.wallId == null);
  // 熱をやりとりする壁の候補（熱容量を持つ物体）。
  //   ★器はいちばん自然な候補なので入れる。linkGasHeat は接触面を「シリンダーの内側の面
  //     （断面 + 側面）」として計算していて、もともと器を想定した式になっている。器が普通の
  //     物体になった＝比熱と熱伝導率をそこで指定できるようになったので、選べないほうが不自然。
  //   ★蓋は外す。蓋は動く境界で、その位置が気体の高さそのもの＝伝導の厚み（ch.h/2）を
  //     決めている側なので、同じ物を熱抵抗の相手にも据えると意味が二重になる。
  //     減衰の摩擦熱は既に蓋へ入る（gasAddHeat）ので、蓋が温まる経路は別にある。
  const v = pistonVesselOfChamber(ch.id);
  const sel = document.getElementById('p-gas-wall');
  if (sel && document.activeElement !== sel) {
    const opts = ['<option value="">なし（断熱）</option>'];
    for (const o of objects) {
      if (v && o.id === v.pistonId) continue;
      if (!(o.heatCap > 0)) continue;
      const isCyl = !!(v && o.id === v.cylinderId);
      opts.push('<option value="' + o.id + '">'
              + (isCyl ? 'この気体の器' : (o.label || ('物体 ' + o.id))) + '</option>');
    }
    sel.innerHTML = opts.join('');
    sel.value = ch.wallId != null ? String(ch.wallId) : '';
  }
  // ★「管でつなぐ相手」の欄はここには無い。**つなぐのは一度きりの操作**なので
  //   右クリックのメニューへ移した（ctxGasLinkSub。右パネルは値、右クリックは操作）。
  //   値を書く口は uiGasLink のまま1つで、あちらから呼ばれる。
  // コックはつないでいるときだけ出す（つないでいない管のコックは意味がない）
  const crow = document.getElementById('p-gas-cock-row');
  if (crow) crow.style.display = ch.linkId != null ? '' : 'none';
  const cchk = document.getElementById('p-gas-cock');
  if (cchk && document.activeElement !== cchk) cchk.checked = !!ch.linkOpen;
  // 断面積と釣り合いの圧力を添える。あわせて、ここに無い欄がどこにあるかを書く。
  //   ★移した先を書かないと「内径やピストンの質量が消えた」ように見える。
  const note = document.getElementById('p-gas-note');
  if (note) {
    const A = ch.areaM2();
    const bal = (world.atmPressure + (p ? p.mass * 9.8 / A : 0)) / 1000;
    note.innerHTML = `断面積 A = ${A.toFixed(4)} m²（内径 × 奥行き ${world.depth} m）<br>`
      + `重りを載せなければ P = 大気圧 + mg/A = <b>${bal.toFixed(2)} kPa</b> で釣り合います<br>`
      + '<span style="color:var(--text2)">内径・全長は器を、質量・摩擦・熱容量は蓋を'
      + 'クリックして選ぶとそちらのプロパティに出ます</span>';
  }
}
// 動く値だけを追従させる（updateLiveVelocityReadout と同じ流儀）
function updateLiveGasReadout() {
  const ch = selectedGasChamber();
  if (!ch) return;
  if (document.getElementById('gas-form').style.display === 'none') return;
  syncGasRows(ch);
  // ★温度は圧縮や熱の出入りで勝手に動くので、つまみも数値に追わせる（物体の p-temp と同じ扱い）。
  //   自由度は自分で変えたときしか動かないので、ここでは追わせない。
  syncSliderById('p-gas-tnow');
}
// ── 気体の設定 ────────────────────────────────────────────────
//   damp は蓋のプロパティとして出しているが、実装上の置き場所は気体室のまま
//   （applyGasChambers が蓋の軸方向の速度に掛ける）。どちらの経路から呼ばれても
//   同じ気体室を指せるよう、選択が気体でも蓋でも拾えるようにする。
function _gasForEdit() {
  return selectedGasChamber() || gasChamberOfSelectedBody();
}
// 選択中の物体が容器の部品なら、その気体室
function gasChamberOfSelectedBody() {
  const b = objects.find(o => selectedIds.has(o.id));
  const v = b ? pistonVesselOfBody(b.id) : null;
  return v ? v.chamber() : null;
}
function uiGasProp(prop, val) {
  const ch = _gasForEdit();
  if (!ch) return;
  if (prop === 'T') {
    const t = parseFloat(val);
    ch.T = Number.isFinite(t) ? Math.max(1e-3, t) : ROOM_K;
    // 温度を打ち替えたら圧力も作り直す。停止中は applyGasChambers が回らないので、
    // ここで書かないと P の欄が古いままになる（帳簿には載せない＝初期条件の設定）。
    if (ch.V > 0 && ch.n > 0) ch.P = ch.n * R_GAS * ch.T / ch.V;
  } else if (prop === 'dof') {
    // 自由度を変えると γ が変わる。n は据え置き（気体の量は変わらないので）
    ch.dof = Math.max(3, Math.min(7, Math.round(parseFloat(val) || 5)));
  } else if (prop === 'damp') {
    ch.damp = Math.max(0, parseFloat(val) || 0);
  }
}
// 通気（外気に開放）。★切り替えたら断熱変化の基準を捨てる。通気の間に変わった体積は
//   外の空気と入れ替わっているので、閉じ直したときにその分の仕事を計上してはいけない
//   （密閉が破れたときに _Vprev を捨てるのと同じ理由）。
function uiGasVent(on) {
  const ch = _gasForEdit();
  if (!ch) return;
  pushUndo();
  ch.vent = !!on;
  ch._Vprev = null;
  if (ch.vent) ch.P = world.atmPressure;
  updatePropsPanel(objects.find(o => selectedIds.has(o.id)) || null);
}
function uiGasWall(val) {
  const ch = _gasForEdit();
  if (!ch) return;
  ch.wallId = val === '' ? null : (parseInt(val, 10) || null);
}
// コック。★両側に書き込む（管は1本なので、片側だけ開いている状態はあり得ない）
function uiGasCock(on) {
  const ch = _gasForEdit();
  if (!ch) return;
  pushUndo();
  setGasCock(ch, !!on);
}
// 管でつなぐ相手。★両側に書き込む（上の★）。前につないでいた相手は外す。
function uiGasLink(val) {
  const ch = _gasForEdit();
  if (!ch) return;
  pushUndo();
  const old = ch.linkId != null ? gasChambers.find(c => c.id === ch.linkId) : null;
  if (old) old.linkId = null;
  const id = val === '' ? null : (parseInt(val, 10) || null);
  const to = id != null ? gasChambers.find(c => c.id === id) : null;
  if (to) {
    // 相手が別の相手とつながっていたら、そちらも外す（1対1に保つ）
    const to2 = to.linkId != null ? gasChambers.find(c => c.id === to.linkId) : null;
    if (to2 && to2.id !== ch.id) to2.linkId = null;
    ch.linkId = to.id; to.linkId = ch.id;
  } else {
    ch.linkId = null;
  }
}
// ── 第一法則の帳簿を欄へ書く（値は動くので毎フレームも呼ぶ）──────────────
function _syncGasLedger(ch, set) {
  const dU = ch.deltaU();
  set('p-gas-w',    ch.W.toFixed(1));
  set('p-gas-qin',  ch.Qin.toFixed(1));
  set('p-gas-qout', ch.Qout.toFixed(1));
  set('p-gas-du',   dU.toFixed(1));
  // 第一法則の残差 ΔU − (Q − W)。構造上ゼロになるはずなので、崩れたら実装の異常
  set('p-gas-flcheck', (dU - (ch.Q - ch.W)).toFixed(3));
  set('p-gas-eta',  (ch.efficiency() * 100).toFixed(1));
}
// ── 状態変化のプリセット ────────────────────────────────────────
//   「定積か定圧か」と「等温か断熱か」は独立した設定なので、片方だけ切り替える。
function uiGasProcess(mode) {
  const ch = selectedGasChamber();
  if (!ch) return;
  pushUndo();
  if (mode === 'isochoric')      setGasPistonLocked(ch, true);
  else if (mode === 'isobaric')  setGasPistonLocked(ch, false);
  else                            setGasThermal(ch, mode);
  // ★ここで帳簿をリセットしてはいけない。1サイクルは「定圧→定積→定圧→定積」のように
  //   変化を何度も切り替えて作るので、切り替えのたびに0に戻すと W も Q も積み上がらず、
  //   熱効率が出せない（実測で Qin が常に0になっていた）。起点はボタンで明示的に決める。
  updateGasPanel(ch);
}
function uiGasResetLedger() {
  const ch = selectedGasChamber();
  if (!ch) return;
  ch.resetLedger();
  const g = pvGraphOf(ch.id);
  if (g) resetPvGraphOne(g);      // P-V図の線も引き直す（囲む面積の起点を合わせる）
  updateGasPanel(ch);
}
// 器の寸法。内径は気体の断面積 A を、全長は蓋の可動域を決めるので、必ず
// vesselGeomUpdate を通す（器の頂点だけ書き換えると気体室の width が置き去りになる）。
function uiVesselGeom(key, val) {
  const b = objects.find(o => selectedIds.has(o.id));
  const v = b ? pistonVesselOfBody(b.id) : null;
  if (!v || v.cylinderId !== b.id) return;
  pushUndo();
  vesselGeomUpdate(v, key, val);
  gasManualVolumeChange(v.chamber());   // 断面積・可動域が変わった＝体積も変わる
  updatePropsPanel(b);
}
function uiDeleteGas() {
  const v = selectedGasVessel();
  if (!v) return;
  pushUndo();
  deletePistonVessel(v);
  clearAllSelections();
  document.getElementById('st-sel').textContent = 'なし';
  updatePropsPanel(null);
}
// ════════════════════════════════════════
//  容器の部品（器・蓋）を物体として選んだときの欄
// ════════════════════════════════════════
//  updatePropsPanel から呼ぶ。部品でなければ丸ごと隠す。
//  ★ここで隠す欄は「拘束が毎サブステップ上書きするので、動かしても戻る欄」。
//    出したままにすると、効かないのか壊れているのか操作した本人に区別が付かない。
function _syncVesselRows(b) {
  const grp = document.getElementById('p-vessel-group');
  const role = vesselRoleOf(b);
  if (grp) grp.style.display = role ? '' : 'none';
  const show = (id, on) => { const e = document.getElementById(id);
                             if (e) e.style.display = on ? '' : 'none'; };
  // 拘束が持っている欄。器は向きを変えられる（容器ごと回る）ので角度だけは残す
  const lockRot = (role === 'piston');
  const rowOf = id => { const e = document.getElementById(id); return e ? e.closest('.prop-row') : null; };
  const setRow = (id, on) => { const r = rowOf(id); if (r) r.style.display = on ? '' : 'none'; };
  setRow('p-angle', !lockRot);
  setRow('p-av',    !lockRot);
  const cbRow = id => { const e = document.getElementById(id); return e ? e.closest('.checkbox-row') : null; };
  const setCb = (id, on) => { const r = cbRow(id); if (r) r.style.display = on ? '' : 'none'; };
  // ★隠すのは「拘束が毎サブステップ上書きするので、動かしても戻る欄」だけ。
  //   蓋の向き・回転・運動方向は器が決めるので隠す。器のほうは何も奪われていない
  //   （回転しない／運動方向固定はふつうに効く。器を倒したくないときに使える）。
  setCb('p-fixrot', role !== 'piston');
  setCb('p-guide',  role !== 'piston');
  // ★「背景に固定」は器には出す（普通の物体と同じで、動かしたくないときに使う）。
  //   蓋には出さない。蓋を世界へ釘付けにすると、動く器がそこからぶら下がって宙に浮く。
  //   蓋を止めたい＝定積変化は「蓋を器に固定する」ことなので、気体のパネル側にある。
  setCb('p-static', role !== 'piston');
  if (role === 'piston') {
    show('p-guide-row', false);
    show('guide-preset-grid', false);
  }
  // ★中の行も必ず出し入れする。グループを隠すだけでは足りない：後から走る
  //   _hideEmptyPropGroups が「中に表示中の行が1つでもあれば見せる」で上書きするので、
  //   行を出したままにしておくと、普通の物体を選んでも容器の欄が居座る（実測）。
  const note = document.getElementById('p-vessel-note');
  show('p-vessel-bore-row', role === 'cylinder');
  show('p-vessel-len-row',  role === 'cylinder');
  show('p-vessel-wall-row', role === 'cylinder');
  show('p-vessel-damp-row', role === 'piston');
  setCb('p-gas-vent', role === 'piston');
  if (note) note.style.display = role ? '' : 'none';
  if (!role) return;
  const v = pistonVesselOfBody(b.id), ch = v && v.chamber();
  const set = (id, val) => { const e = document.getElementById(id);
                             if (e && document.activeElement !== e) e.value = val; };
  if (role === 'cylinder') {
    set('v-bore', (v.bore * PX2M).toFixed(3));
    set('v-len',  (v.innerLen * PX2M).toFixed(3));
    set('v-wall', (v.wall * PX2M).toFixed(3));
  } else if (ch) {
    set('p-gas-damp', ch.damp);
    const vent = document.getElementById('p-gas-vent');
    if (vent) vent.checked = !!ch.vent;
  }
  if (!note) return;
  // ★「外れない」は特徴なので、隠さずここに書く。欄として出せないぶん、文字で出す。
  note.innerHTML = role === 'cylinder'
    ? '中の気体を閉じ込めている<b>器</b>です。ふつうの物体なので落ちるし、'
      + '押せば動き、端に重りを載せれば倒れます。掴んで動かすと蓋と気体も付いてきます。'
    : '気体に<b>蓋</b>をしている物体です。器の軸の上だけを動き、器に対して傾かず、外れません。<br>'
      + 'そのため向き・角速度・回転や運動方向の固定は指定できません。'
      + '蓋を止めて体積を一定にしたいときは、気体を選んで<b>「定積」</b>を押してください'
      + '（世界に釘付けにするのではなく、器に固定します）。';
}
