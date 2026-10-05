// ════════════════════════════════════════
//  左ツールバーのツール設定ウィンドウ
// ════════════════════════════════════════
//  ★同時に開くのは1つだけ。以前は各ウィンドウが自分の id しか見ていなかったので、
//    ツールを次々に選ぶと窓が積み重なり、キャンバスが隠れていた。
//  ★id の一覧は js/input/keyboard.js の TOOL_POPUP_IDS が持つ（あちらはイベント貫通の
//    制御にも同じ一覧を使うので、定義を2つに分けない）。窓を増やすときはそちらへ足す。
//  ★対象は「左ツールバーのボタンから開く窓」だけ。上部メニューの設定ウィンドウ
//    （#sim-popover）、カラーピッカー、グラフの窓は別系統なので触らない。
// 開いているツール設定ウィンドウを畳む。
//   except  「これから開こうとしている窓」／「今のツールの窓」の id
//   keep    true なら except の窓は残す（ツール切替時。今のツールの窓まで畳まないため）
//   戻り値  true ＝ except の窓が開いていた（＝同じツールをもう一度押した。閉じるだけで戻る）
function closeToolPopups(except, keep) {
  let wasOpen = false;
  for (const id of TOOL_POPUP_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (id === except) { wasOpen = true; if (keep) continue; }
    el.remove();
  }
  return wasOpen;
}
// そのツールが使う設定ウィンドウの id（持たないツールは null）。
//   ★「図形和」はツールを切り替えないので、ここには現れない＝どのツールへ移っても畳まれる。
function toolPopupIdFor(t) {
  if (SHAPE_TOOLS.indexOf(t) >= 0) return 'shape-popup';
  if (t === 'circuit' || CIRCUIT_TOOLS.indexOf(t) >= 0) return 'circuit-popup';
  return ({
    pan:'grab-popup',      velocity:'velocity-popup', fixjoint:'fixjoint-popup', hinge:'hinge-popup',
    rope:'rope-popup',     axle:'axle-popup',
    slinky:'slinky-popup',
    thruster:'thruster-popup', laser:'laser-popup',   tracer:'tracer-popup',
    wave:'wave-popup',     fluid:'particle-popup',    gas:'particle-popup',
    optic:'optics-popup',  efield:'emfield-popup',    bfield:'emfield-popup',
    heater:'heatfield-popup',
    flowfield:'flowfield-popup',
    text:'annot-popup',    draw:'draw-popup',
    gearcoat:'gearcoat-popup',
    counter:'measure-popup', spdmeter:'measure-popup', waveprobe:'measure-popup',
  })[t] || null;
}
function fillWaveFieldControls(prefix) {
  const set = (name, v) => {
    const e = document.getElementById(prefix + name);
    if (e && document.activeElement !== e) e.value = v;   // 入力中の欄は上書きしない
  };
  set('wavespeed',  world.waveSpeed);
  set('waveabsorb', world.waveAbsorb);
  set('waveview',   world.waveViewMode);
  set('wavethr',    Math.round(world.waveCrestWidth * 100));
  set('wavegain',   world.waveViewGain);
  set('wavebudget', world.waveBudget.toFixed(1));
}
function syncWaveUI() {           // 全体設定タブを開いたときの同期
  fillWaveFieldControls('w-');
  syncSliders();
  refreshWaveInfo();
}
// つかむツール設定：最大力のスライダー窓（もう一度ボタンを押すと閉じる）
function toggleGrabMenu(e) {
  if (closeToolPopups('grab-popup')) return;   // 開いていれば閉じるだけ（トグル）
  setTool('pan');
  const menu = document.createElement('div');
  menu.id = 'grab-popup';
  const top = Math.min(e.clientY, window.innerHeight - 150);
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:' + top + 'px; width:340px; box-shadow:var(--shadow);';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">つかむツール設定</span>
      <span id="grab-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <div style="font-size:10px;color:var(--text2);margin-bottom:4px">
      力の最大値 [N]: <span id="grab-force-val" style="color:var(--accent)">${grabMaxForce}</span>
    </div>
    <input type="range" id="grab-force-slider" min="500" max="25000" step="250" value="${grabMaxForce}" style="width:100%">
    <div style="font-size:10px;color:var(--text2);margin-top:6px">
      大きいほど重い物体を強く引けます。<br>小さいと手応え（重さ）が出ます。
    </div>
    <div style="font-size:10px;color:var(--text2);margin:10px 0 4px">
      回転の減衰 [1/s]: <span id="grab-angd-val" style="color:var(--accent)">${grabAngDamp}</span>
    </div>
    <input type="range" id="grab-angd-slider" min="0" max="40" step="1" value="${grabAngDamp}" style="width:100%">
    <div style="font-size:10px;color:var(--text2);margin-top:6px">
      <b>小さいほど、掴んだ点を軸にヒンジのように自由に回ります</b>（0＝減衰なし）。<br>
      大きいと回転が抑えられ、向きを保ったまま運びやすくなります。<br>
      <span style="color:var(--text2)">実測：3m の棒の端を掴んで吊り下がるまで、
      ヒンジ 0.80 秒／減衰 6 で 1.03 秒／減衰 39 で 5.53 秒。</span>
    </div>
    <div style="font-size:10px;color:var(--accent);margin-top:8px;line-height:1.5">
      ★<b>Shift を押しながら</b>動かすと、押した瞬間の向きのまま運べます
      （接触や衝突でも傾きません。離すと元の物理へ戻ります）。
    </div>
  `;
  document.body.appendChild(menu);
  const slider = menu.querySelector('#grab-force-slider');
  const val = menu.querySelector('#grab-force-val');
  attachSigFig(slider, 100, 25000, {}, v => {
    grabMaxForce = v;
    val.textContent = v;
    if (activeMouseJoint) activeMouseJoint.maxForce = v;   // つかみ中も即反映
  });
  slider.setSig(grabMaxForce);
  const angd = menu.querySelector('#grab-angd-slider'), angdVal = menu.querySelector('#grab-angd-val');
  angd.addEventListener('input', () => {
    grabAngDamp = parseFloat(angd.value) || 0;
    angdVal.textContent = grabAngDamp;
    if (activeMouseJoint) activeMouseJoint.angDampRate = grabAngDamp;   // つかみ中も即反映
  });
  menu.querySelector('#grab-close').addEventListener('click', () => menu.remove());
  // 窓内クリックがキャンバスへ伝わらないよう保険
  menu.addEventListener('mousedown', ev => ev.stopPropagation());
  menu.addEventListener('click', ev => ev.stopPropagation());
}
// 速度ツール設定の窓（もう一度ボタンを押すと閉じる）。
//   ★設定は「予想軌跡を表示」だけ。ほかの2つは切り替えを持たせない：
//     ・選択中すべてに適用 … 常時ON。単独選択なら結果は同じで、複数選んでいるときに
//       1つだけ飛ぶほうが事故になる
//     ・カーソルの向きへ打ち出す … Alt を押している間だけ。押し方の説明で足りる
//   （どちらも「切り替えを覚えて使い分ける」ほどの違いが無いので、説明だけを残す）
function toggleVelocityMenu(e) {
  if (closeToolPopups('velocity-popup')) return;
  setTool('velocity');
  const menu = document.createElement('div');
  menu.id = 'velocity-popup';
  const top = Math.min(e.clientY, window.innerHeight - 260);
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:' + Math.max(8, top) + 'px; width:230px; box-shadow:var(--shadow);';
  // ★予測が出ない条件（多体力の個数）は、窓を短く保つためチェックボックスの
  //   ツールチップへ逃がす。長い注意書きは本文ではなく hover で読ませる。
  const predTitle = '万有引力・静電気力は総当たり計算（O(N²)）なので、働く物体が約50個を超えると'
    + '予測は打ち切られ、軌跡は表示されません（両方が同時にONなら約37個）。'
    + '軌跡が短すぎるときも、誤読を避けるため表示しません。';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">速度ツール設定</span>
      <span id="vt-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <div style="font-size:10px;color:var(--text2);line-height:1.5">
      <b style="color:var(--accent)">引き方</b>：物体を掴んでドラッグし、離すと<b>引いた向きの逆</b>へ飛びます
      （パチンコと同じ）。速さは<b>掴んだ点からカーソルまでの距離</b>で決まります。
      <b>Shift</b> で角度がスナップします。<br><br>
      <b style="color:var(--accent)">Alt＝カーソルの向きへ打ち出す</b>：押している間だけ、逆向きではなく
      <b>カーソルの向きへ</b>飛びます。<br><br>
      もっと速い初速が要るときは、<b>ズームアウトしてから引く</b>（速さは画面上の距離ではなく
      ワールド上の距離で決まるため）か、右パネルの<b>「速さ [m/s]」に直接入力</b>してください。<br><br>
      与えた速度を<b>ずっと保たせたい</b>ときは、右パネル「動きの制限」の
      <b>「一定の速度で動かし続ける」</b>をONにしてください（ベルトコンベア・動く床など、
      外から駆動されているものを作る設定です）。
    </div>
    <div style="border-top:1px solid var(--border);margin:8px 0"></div>
    <label class="checkbox-row" title="${predTitle}">
      <input type="checkbox" id="vt-predict" ${velocityShowPrediction ? 'checked' : ''}>
      <span>予想軌跡を表示</span>
    </label>
    <div style="font-size:10px;color:var(--text2);margin-top:6px;line-height:1.5">
      ドラッグ中に、その初速で飛んだときの軌跡を先に描きます。重力・万有引力・静電気力・
      ローレンツ力（＋空気抵抗・動力・ガイド）を本番と同じ刻みで積分しているので、
      これら以外の力が働かないかぎり<b>本番の軌道と一致</b>します。
    </div>
  `;
  document.body.appendChild(menu);
  menu.querySelector('#vt-predict').addEventListener('change', ev => {
    velocityShowPrediction = ev.target.checked;
    refreshToolHint();                       // OFFであることを画面下部にも出す
  });
  menu.querySelector('#vt-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());
  menu.addEventListener('click', ev => ev.stopPropagation());
}
// 設定窓を画面の中へ収める。★窓の縦位置はボタンの高さから決めていて、中身を足すと下端が
//   画面の外へ出る（2026-10-02：留め先の欄を足したモーター・溶接・ヒンジの窓で、欄が画面の
//   下に隠れて「無くなった」ように見えた）。開いたあとで実寸を測って持ち上げ、それでも
//   入らない高さなら窓の中をスクロールさせる。
function fitToolPopup(menu) {
  const margin = 8;
  const r = menu.getBoundingClientRect();
  const room = window.innerHeight - 2 * margin;
  if (r.height > room) { menu.style.maxHeight = room + 'px'; menu.style.overflowY = 'auto'; }
  const h = Math.min(r.height, room);
  if (r.top + h > window.innerHeight - margin) menu.style.top = Math.max(margin, window.innerHeight - margin - h) + 'px';
}
// ── 留め先の切り替え（ヒンジ・モーター・溶接の3つの窓で共通）──────────────
//   ★3つのツールで1つの設定（pinMode）を共有する。どれも「重なったものを1点で留める画鋲」
//     で、留め先の決め方だけが違う（selection.js の pinJointsAt の★）。窓ごとに別の値を
//     持たせると、溶接では綴じたのにモーターでは板まで刺さった、が起きて読めなくなる。
function pinModeRowHtml() {
  const r = (v, label, note) => `
    <label style="display:flex;align-items:flex-start;gap:6px;font-size:11px;margin:3px 0;cursor:pointer">
      <input type="radio" name="pin-mode" value="${v}" ${pinMode === v ? 'checked' : ''} style="margin-top:2px">
      <span>${label}<br><span style="font-size:10px;color:var(--text2)">${note}</span></span>
    </label>`;
  return `
    <div style="font-size:10px;color:var(--text2);margin-bottom:2px">留め先</div>` +
    r('pair',  '重なった2つをつなぐ', '上の2つどうしを留める。重なりが1つなら背景に留める') +
    r('board', '重なったものを全部、背景に留める', 'どれも背景に刺した軸で回る（同じ点に何枚も重ねるとき）');
}
// 右クリックメニューから（ツールを持っているとき）。開いている設定窓のラジオも合わせる
function setToolPinMode(m) {
  pinMode = m === 'board' ? 'board' : 'pair';
  for (const el of document.querySelectorAll('input[name="pin-mode"]')) el.checked = el.value === pinMode;
  refreshToolHint();
}
function bindPinModeRow(menu) {
  for (const el of menu.querySelectorAll('input[name="pin-mode"]'))
    el.addEventListener('change', ev => { if (ev.target.checked) { pinMode = ev.target.value; refreshToolHint(); } });
}
// ヒンジツール設定：留め先の窓（もう一度ボタンを押すと閉じる）
function toggleHingeMenu(e) {
  if (closeToolPopups('hinge-popup')) return;
  setTool('hinge');
  const menu = document.createElement('div');
  menu.id = 'hinge-popup';
  const top = Math.min(e.clientY, window.innerHeight - 190);
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:' + top + 'px; width:230px; box-shadow:var(--shadow);';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">ヒンジツール設定</span>
      <span id="hg-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    ${pinModeRowHtml()}
    <div style="font-size:10px;color:var(--text2);margin-top:6px;line-height:1.5">
      ヒンジは画鋲です。クリックした点に重なっているものを、その1点で留めます。
      重なっていないものどうしは留められません（離れた2点はロープ・連結棒・ばねでつなぎます）。<br>
      モーター・溶接ツールと同じ設定です。
    </div>
  `;
  document.body.appendChild(menu);
  fitToolPopup(menu);
  bindPinModeRow(menu);
  menu.querySelector('#hg-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());
  menu.addEventListener('click', ev => ev.stopPropagation());
}
// 溶接ツール設定：解放モードの窓（もう一度ボタンを押すと閉じる）
function toggleFixjointMenu(e) {
  if (closeToolPopups('fixjoint-popup')) return;
  setTool('fixjoint');
  const menu = document.createElement('div');
  menu.id = 'fixjoint-popup';
  const top = Math.min(e.clientY, window.innerHeight - 190);
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:' + top + 'px; width:200px; box-shadow:var(--shadow);';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">溶接ツール設定</span>
      <span id="fj-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <label class="checkbox-row">
      <input type="checkbox" id="fj-rel" ${fixjointReleasable ? 'checked' : ''}>
      <span>速度ツールで解放する</span>
    </label>
    <div style="margin-top:8px">${pinModeRowHtml()}</div>
    <div style="font-size:10px;color:var(--text2);margin-top:6px;line-height:1.5">
      ONで置いた溶接は<b style="color:#66bb6a">緑のナット</b>で表示され、速度ツールで初速を与えた瞬間に
      自動で外れます。<b>保持 → 合図で解放</b>を1操作でできるので、斜方投射や衝突実験の初速指定に使えます。<br><br>
      外れるのはこのフラグが付いた溶接だけです。通常の溶接（赤）は残ります。<br>
      設置後は右パネルで個別に切り替えられます。
    </div>
  `;
  document.body.appendChild(menu);
  menu.querySelector('#fj-rel').addEventListener('change', ev => {
    fixjointReleasable = ev.target.checked;
    refreshToolHint();
  });
  bindPinModeRow(menu);
  fitToolPopup(menu);
  menu.querySelector('#fj-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());
  menu.addEventListener('click', ev => ev.stopPropagation());
}
// ロープツール設定：背景に落とした端に「先端おもり」を付けるか。
//   ロープは滑車にかけて端を引く使い方が多いが、背景に固定した端は動かせず、
//   つかむツールは物体しか掴めない。ここをONにしておくと、置いた時点で
//   端が掴める状態になる（ばね・棒には無い設定。あちらは端を持って振り回さないため）。
function toggleRopeMenu(e) {
  if (closeToolPopups('rope-popup')) return;   // 開いていれば閉じるだけ（トグル）
  setTool('rope');
  const menu = document.createElement('div');
  menu.id = 'rope-popup';
  const top = Math.min(e.clientY, window.innerHeight - 200);
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:' + top + 'px; width:230px; box-shadow:var(--shadow);';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">ロープツール設定</span>
      <span id="rope-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <div class="checkbox-row">
      <input type="checkbox" id="rope-tip-on" ${ropeTipOnFree ? 'checked' : ''}>
      <label for="rope-tip-on">接続点が物体でない場合、端に先端おもりを付ける</label>
    </div>
    <div style="font-size:10px;color:var(--text2);margin:2px 0 8px 2px">
      何もない所で離した端は、そのままだと<b>背景に固定</b>されて動かせません。
      おもりを付けると、その端を<b>つかむツールで引っ張れます</b>（滑車にかけたロープの端など）。
    </div>
    <div style="font-size:10px;color:var(--text2);margin-bottom:4px">
      おもりの質量 [kg]: <span id="rope-tip-m-val" style="color:var(--accent)">${ropeTipMass}</span>
    </div>
    <input type="range" id="rope-tip-m" min="0.01" max="5" step="0.01" value="${ropeTipMass}" style="width:100%">
    <div style="font-size:10px;color:var(--text2);margin-top:6px">
      おもりは<b>回転しません</b>（取っ手が回ると掴んだ手応えが分かりにくいため）。
      ロープを削除すると一緒に消えます。あとから付けるときは、ロープを選んで
      プロパティの「先端おもり」か、端を右クリックしてください。
    </div>
  `;
  document.body.appendChild(menu);
  const cb = menu.querySelector('#rope-tip-on');
  cb.addEventListener('change', () => ropeTipOnFree = cb.checked);
  const ms = menu.querySelector('#rope-tip-m'), mv = menu.querySelector('#rope-tip-m-val');
  ms.addEventListener('input', () => { ropeTipMass = parseFloat(ms.value); mv.textContent = ropeTipMass; });
  menu.querySelector('#rope-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());   // キャンバスへの伝播を防ぐ
  menu.addEventListener('click', ev => ev.stopPropagation());
}
function toggleAxleMenu(e) {
  if (closeToolPopups('axle-popup')) return;   // 開いていれば閉じるだけ（トグル）
  setTool('axle');
  const menu = document.createElement('div');
  menu.id = 'axle-popup';
  const top = Math.min(e.clientY, window.innerHeight - 230);
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:' + top + 'px; width:190px; box-shadow:var(--shadow);';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">モーターツール設定</span>
      <span id="ax-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <div style="font-size:10px;color:var(--text2);margin-bottom:4px">
      回転速度 ω [rad/s]: <span id="ax-w-val" style="color:var(--accent)">${axleMotorSpeed.toFixed(1)}</span>
      <span id="ax-rpm" style="color:var(--text2)"></span>
    </div>
    <input type="range" id="ax-w-slider" min="-50" max="50" step="0.5" value="${axleMotorSpeed}" style="width:100%">
    <div style="font-size:10px;color:var(--text2);margin:8px 0 4px">
      最大トルク τ [N·m]: <span id="ax-t-val" style="color:var(--accent)">${axleMotorTorque}</span>
    </div>
    <input type="range" id="ax-t-slider" min="0" max="5000" step="10" value="${axleMotorTorque}" style="width:100%">
    <label style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--text2);margin-top:8px">
      <input type="checkbox" id="ax-brake" ${axleMotorBrake ? 'checked' : ''}>
      リモコンを放したら止める
    </label>
    <div style="margin-top:8px">${pinModeRowHtml()}</div>
    <div style="font-size:10px;color:var(--text2);margin-top:6px">
      負の値で逆回転。トルクが足りないと目標の回転速度を保てません（＝負荷で減速する）。<br>
      0 にすると自由回転（ただのヒンジ）になります。<br>
      「放したら止める」を切ると、放したとき軸は自由になります（車輪はこちら）。<br>
      設置後は右パネルで個別に変更できます。
    </div>
  `;
  document.body.appendChild(menu);
  const wS = menu.querySelector('#ax-w-slider'), wV = menu.querySelector('#ax-w-val');
  const tS = menu.querySelector('#ax-t-slider'), tV = menu.querySelector('#ax-t-val');
  const rpm = menu.querySelector('#ax-rpm');
  const syncRpm = () => rpm.textContent = '（' + (axleMotorSpeed * 60 / (2*Math.PI)).toFixed(0) + ' rpm）';
  wS.addEventListener('input', () => { axleMotorSpeed = parseFloat(wS.value); wV.textContent = axleMotorSpeed.toFixed(1); syncRpm(); });
  attachSigFig(tS, 1, 5000, {zero:true}, v => { axleMotorTorque = v; tV.textContent = axleMotorTorque; });
  wS.value = axleMotorSpeed; tS.setSig(axleMotorTorque);
  menu.querySelector('#ax-brake').addEventListener('change',
    e => { axleMotorBrake = e.target.checked; });
  syncRpm();
  bindPinModeRow(menu);
  fitToolPopup(menu);
  menu.querySelector('#ax-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());   // キャンバスへの伝播を防ぐ
  menu.addEventListener('click', ev => ev.stopPropagation());
}
// ばねツール設定：ばね定数と、理想ばねにするかの窓（もう一度ボタンを押すと閉じる）
//   ★この2つを置く場所として、ここがいちばん早い。ばねは「引いた2点で1本できる」ので、
//     置いたあとに右パネルで直すには、置く→選ぶ→直す の3手が要る。
//   ★理想ばね化は見た目の設定ではなく、解き方そのものが変わる（節点を積分するのをやめて
//     両端を1本の拘束として解く）。切り替えると使える設定も変わるので、注記で明示する。
function toggleSlinkyMenu(e) {
  if (closeToolPopups('slinky-popup')) return;   // 開いていれば閉じるだけ（トグル）
  setTool('slinky');
  const menu = document.createElement('div');
  menu.id = 'slinky-popup';
  const top = Math.min(e.clientY, window.innerHeight - 250);
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:' + top + 'px; width:200px; box-shadow:var(--shadow);';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">ばねツール設定</span>
      <span id="slk-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <div style="font-size:10px;color:var(--text2);margin-bottom:4px">
      ばね定数 k [N/m]: <span id="slk-k-val" style="color:var(--accent)">${slinkySpringK}</span>
    </div>
    <input type="range" id="slk-k-slider" style="width:100%">
    <div id="slk-k-note" style="font-size:9px;color:var(--text2);line-height:1.4;margin-top:4px"></div>
    <label class="checkbox-row" style="margin-top:9px">
      <input type="checkbox" id="slk-ideal-cb" ${slinkyIdeal ? 'checked' : ''}>
      <span>理想ばねにする（質量を無視）</span>
    </label>
    <div id="slk-ideal-note" style="font-size:9px;line-height:1.45;margin-top:5px"></div>
    <div style="font-size:10px;color:var(--text2);margin-top:7px">
      設置後は右パネルで個別に変更できます。
    </div>
  `;
  document.body.appendChild(menu);
  const kS = menu.querySelector('#slk-k-slider'), kV = menu.querySelector('#slk-k-val');
  const kN = menu.querySelector('#slk-k-note');
  const cb = menu.querySelector('#slk-ideal-cb'), iN = menu.querySelector('#slk-ideal-note');
  // ★手応えを「1kg を吊るしたときの伸び」で添える。k の数字だけでは、置いてみるまで
  //   ふにゃふにゃなのか硬いのか分からない（旧既定 EA=20 で 0.49m 伸びていた反省）。
  const syncK = () => {
    kV.textContent = slinkySpringK;
    // ★0 は「ふにゃふにゃのばね」ではなく別の部品（ダンパー）になるので、手応えではなく
    //   何になるかを書く。伸びの式も k=0 では発散して意味を持たない。
    kN.innerHTML = slinkySpringK > 0
      ? `1 kg を吊るすと ${(9.8 / slinkySpringK * 100).toFixed(1)} cm 伸びます`
      : '<span style="color:var(--accent3)">k = 0 ＝ ダンパー</span>：復元力を持たず、'
        + '縮み伸びの速さに比例する力 F = −c·v だけを返します（c は設置後に右パネルで）';
    refreshToolHint();
  };
  const syncIdeal = () => {
    iN.innerHTML = slinkyIdeal
      ? '<span style="color:var(--accent3)">▶ 教科書のばね</span>'
        + '<span style="color:var(--text2)">：質量が無いので T = 2π√(m/k) が厳密に出ます。'
        + '単振動・つり合いはこちら</span>'
      : '<span style="color:#ffa726">▶ 実体のスリンキー</span>'
        + '<span style="color:var(--text2)">：節点に質量があるので、ばね自体を波が伝わり、'
        + '他の物体ともぶつかります。線密度・内部減衰が効きます</span>';
    refreshToolHint();
  };
  attachSigFig(kS, 1, 100000, { zero: true }, v => { slinkySpringK = v; syncK(); });
  kS.setSig(slinkySpringK);
  cb.addEventListener('change', () => { slinkyIdeal = cb.checked; syncIdeal(); });
  syncK(); syncIdeal();
  menu.querySelector('#slk-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());   // キャンバスへの伝播を防ぐ
  menu.addEventListener('click', ev => ev.stopPropagation());
}
// 動力ツール設定：推力のスライダー窓（もう一度ボタンを押すと閉じる）
function toggleThrusterMenu(e) {
  if (closeToolPopups('thruster-popup')) return;   // 開いていれば閉じるだけ（トグル）
  setTool('thruster');
  const menu = document.createElement('div');
  menu.id = 'thruster-popup';
  const top = Math.min(e.clientY, window.innerHeight - 200);
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:' + top + 'px; width:190px; box-shadow:var(--shadow);';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">動力ツール設定</span>
      <span id="thr-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <label class="checkbox-row" style="margin-bottom:6px">
      <input type="checkbox" id="thr-auto" ${thrusterAutoForce ? 'checked' : ''}>
      <span>自動（自重の1.5倍）</span>
    </label>
    <div style="font-size:10px;color:var(--text2);margin-bottom:4px">
      推力 [N]: <span id="thr-force-val" style="color:var(--accent)">${thrusterForce}</span>
    </div>
    <input type="range" id="thr-force-slider" min="0" max="20000" step="10" value="${thrusterForce}" style="width:100%">
    <div style="font-size:10px;color:var(--text2);margin-top:6px">
      自重（mg）を超える推力で浮上します。<br>設置後は右パネルで個別に変更できます。<br>
      1つの物体に何本でも付けられます（1本ずつ別のリモコンで操れます）。
    </div>
  `;
  document.body.appendChild(menu);
  const chk = menu.querySelector('#thr-auto');
  const sld = menu.querySelector('#thr-force-slider');
  const val = menu.querySelector('#thr-force-val');
  const sync = () => { sld.disabled = chk.checked; sld.style.opacity = chk.checked ? 0.4 : 1; };
  sync();
  chk.addEventListener('change', () => { thrusterAutoForce = chk.checked; sync(); });
  attachSigFig(sld, 1, 5000, {zero:true}, v => { thrusterForce = v; val.textContent = v; });
  sld.setSig(thrusterForce);
  menu.querySelector('#thr-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());   // キャンバスへの伝播を防ぐ
  menu.addEventListener('click', ev => ev.stopPropagation());
}
// レーザーツール設定：波長のスライダー窓（もう一度ボタンを押すと閉じる）
//   色は波長から一意に決まるので、ここで指定できるのは「波長」だけにしてある。
function toggleLaserMenu(e) {
  if (closeToolPopups('laser-popup')) return;   // 開いていれば閉じるだけ（トグル）
  setTool('laser');
  const menu = document.createElement('div');
  menu.id = 'laser-popup';
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:8px; width:190px; box-shadow:var(--shadow);' +
    'max-height:calc(100vh - 16px); overflow-y:auto;';   // ★画面に収まらない分はこの窓の中でスクロール
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">レーザーツール設定</span>
      <span id="lz-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <div class="color-swatch" id="lz-swatch"></div>
      <span style="font-size:10px;color:var(--text2)">
        波長 λ [nm]: <span id="lz-wl-val" style="color:var(--accent)"></span>
        <span id="lz-wl-name"></span>
      </span>
    </div>
    <input type="range" id="lz-wl-slider" min="380" max="780" step="1" value="${laserWavelength}" style="width:100%">
    <label class="checkbox-row" style="margin-top:8px" title="1本のレーザーが波長プリセットの全色（${LASER_PRESETS.length}色）を同時に出します。水滴やプリズムに当てると分散して虹に分かれます。移動・回転・削除は1回の操作で済みます"><input type="checkbox" id="lz-white"><span>白色光（プリセット全色）</span></label>
    <label class="checkbox-row" style="margin-top:6px"><input type="checkbox" id="lz-host"><span>取り付けた物体と干渉させる</span></label>
    <div class="rpanel-title" style="margin-top:8px">波長プリセット</div>
    <div class="material-grid" id="lz-preset"></div>
    <div style="font-size:10px;color:var(--text2);margin-top:6px">
      新しく置くレーザーの波長です。<br>
      表示色は波長から計算されます。<br>
      物体の「波長により屈折率を変える」をONにすると分散（虹）が出ます。<br>
      虹は「白色光＋『水』の円」で作れます。円を選んで<b>「フレネルの式で反射率を自動計算」をON</b>にすると、水滴の中で一部反射・一部屈折します。<br>
      「取り付けた物体と干渉させる」をONにすると、水中の光源が水面で屈折・全反射する様子を見せられます（透明な物体に載せたときのみ有効）。
    </div>
  `;
  document.body.appendChild(menu);
  const sld = menu.querySelector('#lz-wl-slider');
  const val = menu.querySelector('#lz-wl-val');
  const sw  = menu.querySelector('#lz-swatch');
  const nm  = menu.querySelector('#lz-wl-name');
  const white = menu.querySelector('#lz-white');
  const sync = () => {
    sld.value = laserWavelength;
    val.textContent = laserWavelength.toFixed(1);
    sw.style.background = laserWhiteLight ? '#ffffff' : wavelengthToHex(laserWavelength);
    nm.textContent = laserWhiteLight ? '（白色光：全色を同時に出す）'
                                     : '（' + wavelengthName(laserWavelength) + '）';
    sld.disabled = laserWhiteLight;                 // 白色光では単一波長の指定は効かない
    sld.style.opacity = laserWhiteLight ? 0.4 : 1;
  };
  sld.addEventListener('input', () => { laserWavelength = parseFloat(sld.value); sync(); });
  white.checked = laserWhiteLight;
  white.addEventListener('change', () => { laserWhiteLight = white.checked; sync(); });
  const host = menu.querySelector('#lz-host');
  host.checked = laserInteractHost;
  host.addEventListener('change', () => { laserInteractHost = host.checked; });
  const grid = menu.querySelector('#lz-preset');
  for (const p of LASER_PRESETS) {
    const b = document.createElement('button');
    b.className = 'mat-btn';
    b.textContent = p.label;
    b.title = p.wl + ' nm';
    b.style.borderLeft = '4px solid ' + wavelengthToHex(p.wl);
    b.onclick = () => {                       // 単色を選んだら白色光モードは解除
      laserWhiteLight = false; white.checked = false;
      laserWavelength = p.wl; sync();
    };
    grid.appendChild(b);
  }
  sync();
  // ★中身を全部作り終えてから実際の高さを測り、画面内へ収める（下の説明文が切れないように）。
  //   高さが画面より大きいときは max-height で頭打ちになり、この窓の中がスクロールする。
  const h = menu.offsetHeight;
  menu.style.top = Math.max(8, Math.min(e.clientY, window.innerHeight - h - 8)) + 'px';
  menu.querySelector('#lz-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());   // キャンバスへの伝播を防ぐ
  menu.addEventListener('click', ev => ev.stopPropagation());
}
// 軌跡ツール設定：色・残す時間の窓（もう一度ボタンを押すと閉じる）
function toggleTracerMenu(e) {
  if (closeToolPopups('tracer-popup')) return;
  setTool('tracer');
  const menu = document.createElement('div');
  menu.id = 'tracer-popup';
  const top = Math.min(e.clientY, window.innerHeight - 200);
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:' + top + 'px; width:190px; box-shadow:var(--shadow);';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">軌跡ツール設定</span>
      <span id="tr-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <div class="color-swatch" id="tr-swatch" style="background:${tracerColor}"></div>
      <span style="font-size:10px;color:var(--text2)">軌跡の色（クリックで変更）</span>
    </div>
    <div style="font-size:10px;color:var(--text2);margin-bottom:4px">
      残す時間 [s]: <span id="tr-dur-val" style="color:var(--accent)">${tracerDuration.toFixed(1)}</span>
    </div>
    <input type="range" id="tr-dur-slider" min="0.5" max="60" step="0.5" value="${tracerDuration}" style="width:100%">
    <div style="font-size:10px;color:var(--text2);margin-top:6px">
      物体をクリックすると、その点を記録点として軌跡が始まります（もう一度クリックでOFF）。<br>
      設置後は右パネルで個別に変更できます。
    </div>
  `;
  document.body.appendChild(menu);
  const sld = menu.querySelector('#tr-dur-slider');
  const val = menu.querySelector('#tr-dur-val');
  sld.addEventListener('input', () => {
    tracerDuration = parseFloat(sld.value);
    val.textContent = tracerDuration.toFixed(1);
  });
  menu.querySelector('#tr-swatch').addEventListener('click', ev => {
    ev.stopPropagation();
    openColorPicker(ev.currentTarget, 'tracerNew');
  });
  menu.querySelector('#tr-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());   // キャンバスへの伝播を防ぐ
  menu.addEventListener('click', ev => ev.stopPropagation());
}
// テキストツール設定：色・文字の大きさ・重ね順の窓（もう一度ボタンを押すと閉じる）
//   ★大きさはワールド単位（m）で持つ。ズームすると文字も一緒に大きくなる＝図に
//     貼り付いた注釈として振る舞い、回転させたときの見え方とも辻褄が合う。
function toggleTextMenu(e) {
  if (closeToolPopups('annot-popup')) return;
  setTool('text');
  const menu = document.createElement('div');
  menu.id = 'annot-popup';
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:8px; width:236px; box-shadow:var(--shadow);';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">テキストツール設定</span>
      <span id="an-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <div class="color-swatch" id="an-swatch" style="background:${annotColor}"></div>
      <span style="font-size:10px;color:var(--text2)">文字の色（クリックで変更）</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <span style="font-size:10px;color:var(--text2);white-space:nowrap">フォント</span>
      <select class="prop-select" id="an-font" style="flex:1"></select>
    </div>
    <div class="checkbox-row" style="margin-bottom:8px">
      <input type="checkbox" id="an-bold"><label for="an-bold">太字</label>
    </div>
    <div style="font-size:10px;color:var(--text2);margin-bottom:4px">
      文字の大きさ [m]: <span id="an-size-val" style="color:var(--accent)">${(annotTextSize*PX2M).toFixed(2)}</span>
    </div>
    <input type="range" id="an-size" min="0.05" max="2" step="0.05" value="${(annotTextSize*PX2M).toFixed(2)}" style="width:100%">
    <div class="checkbox-row" style="margin-top:8px">
      <input type="checkbox" id="an-front"><label for="an-front">選択中の文字を物体より手前に出す</label>
    </div>
    <div style="font-size:10px;color:var(--text2);margin-top:6px;line-height:1.5">
      クリックした点が<b>文字の左うえ</b>になり、打つほど右と下へ伸びます。
      確定は <b>Ctrl+Enter</b>／外をクリック（Enterは改行）。<br>
      置いた文字は<b>1回目のクリックで選択</b>（ドラッグで移動・上の○で回転。Shiftで15°刻み）、
      <b>もう一度クリックで書き直し</b>。<br>
      <b style="color:var(--accent)">物理には影響しません</b>。編集ツールでは掴めないので、
      触るときはこのツールに戻ってください。
    </div>
  `;
  document.body.appendChild(menu);
  // ★高さを実測してから縦位置を決める。中身が増えるたびに定数を直す作りだと必ず
  //   ずれて、窓の下が画面の外へはみ出す（フォント欄を足したときに実際に起きた）。
  const h = menu.getBoundingClientRect().height;
  menu.style.top = Math.max(8, Math.min(e.clientY, window.innerHeight - h - 8)) + 'px';
  const sld = menu.querySelector('#an-size');
  const val = menu.querySelector('#an-size-val');
  sld.addEventListener('input', () => {
    const m = parseFloat(sld.value);
    val.textContent = m.toFixed(2);
    applyAnnotSize(m * M2PX);
  });
  const fnt = menu.querySelector('#an-font');
  fillAnnotFontSelect(fnt);
  fnt.addEventListener('change', () => applyAnnotFont(fnt.value));
  const bold = menu.querySelector('#an-bold');
  bold.addEventListener('change', () => applyAnnotBold(bold.checked));
  const fr = menu.querySelector('#an-front');
  fr.addEventListener('change', () => applyAnnotFront(fr.checked));
  syncAnnotPopup();                     // 選択中のものがあれば、その値を映す
  menu.querySelector('#an-swatch').addEventListener('click', ev => {
    ev.stopPropagation();
    openColorPicker(ev.currentTarget, 'annotNew');
  });
  menu.querySelector('#an-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());   // キャンバスへの伝播を防ぐ
  menu.addEventListener('click', ev => ev.stopPropagation());
}
// お絵描きツール設定：モード・色・線の太さの窓（もう一度ボタンを押すと閉じる）
//   ★モードを切り替えてもツールは 'draw' のまま。窓が閉じないので、ペン→直線→消しゴムを
//     続けて使える（回路ツールの素子選びと同じ流儀）。
function toggleDrawMenu(e) {
  if (closeToolPopups('draw-popup')) return;
  setTool('draw');
  const menu = document.createElement('div');
  menu.id = 'draw-popup';
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:8px; width:236px; box-shadow:var(--shadow);';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">お絵描きツール設定</span>
      <span id="dr-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <div class="material-grid" id="dr-modes" style="margin-bottom:8px"></div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <div class="color-swatch" id="dr-swatch" style="background:${annotColor}"></div>
      <span style="font-size:10px;color:var(--text2)">線の色（クリックで変更）</span>
    </div>
    <div style="font-size:10px;color:var(--text2);margin-bottom:4px">
      線の太さ [m]: <span id="dr-w-val" style="color:var(--accent)">${(annotLineWidth*PX2M).toFixed(3)}</span>
    </div>
    <input type="range" id="dr-w" min="0.01" max="0.3" step="0.005" value="${(annotLineWidth*PX2M).toFixed(3)}" style="width:100%">
    <div id="dr-note" style="font-size:10px;color:var(--text2);margin-top:8px;line-height:1.5"></div>
  `;
  document.body.appendChild(menu);
  const notes = {
    select:   '描いた線・図形を<b>クリックで選択</b>。ドラッグで移動、四隅で拡大縮小、上の○で回転、' +
              'Delete で削除。<b>文字はテキストツール</b>のほうで扱います。',
    pen:      'ドラッグでなぞった通りに線を引きます。押しただけなら点を打ちます。',
    line:     'ドラッグで直線を引きます。<b>Shift</b> で角度がスナップします。',
    rect:     'ドラッグで四角。始点が<b>角</b>になり、<b>Shift</b> で正方形。',
    triangle: 'ドラッグで三角。始点が<b>直角の頂点</b>で、<b>Shift</b> で直角二等辺。',
    ellipse:  'ドラッグで丸。始点が<b>中心</b>になり、<b>Shift</b> で正円。',
    poly:     'クリックで頂点を打ちます。<b>始点へ戻る</b>か<b>ダブルクリック</b>で閉じて確定、' +
              '<b>Esc</b> で取り消し。',
    eraser:   'なぞった線を<b>1本まるごと</b>消します（途中だけは削りません）。' +
              '<b style="color:var(--accent)">文字は消えません</b>——文字はテキストツールで選んで Delete。',
  };
  const grid = menu.querySelector('#dr-modes');
  const paint = () => {
    for (const b of grid.children) b.classList.toggle('active', b.dataset.mode === annotDrawMode);
    menu.querySelector('#dr-note').innerHTML = (notes[annotDrawMode] || '') +
      (annotDrawMode === 'select' ? '' : '<br>図形は<b>枠線のみ</b>で、中は塗りません。') +
      '<br><b style="color:var(--accent)">物理には影響しません</b>。';
    annotStroke = null;             // モードを変えたら描きかけは捨てる（型が変わるため）
    syncAnnotSelectionToTool();     // 描くモードへ移ったら、掴んでいたものの選択は外す
    refreshToolHint();
  };
  for (const m of ANNOT_DRAW_MODES) {
    const btn = document.createElement('button');
    btn.className = 'mat-btn';
    btn.dataset.mode = m.v;
    btn.textContent = m.label;
    btn.addEventListener('click', ev => { ev.stopPropagation(); annotDrawMode = m.v; paint(); });
    grid.appendChild(btn);
  }
  paint();
  // 高さを実測してから縦位置を決める（定数で見積もると中身が増えたときに必ずはみ出す）
  const h = menu.getBoundingClientRect().height;
  menu.style.top = Math.max(8, Math.min(e.clientY, window.innerHeight - h - 8)) + 'px';
  const sld = menu.querySelector('#dr-w');
  const val = menu.querySelector('#dr-w-val');
  sld.addEventListener('input', () => {
    const m = parseFloat(sld.value);
    val.textContent = m.toFixed(3);
    applyAnnotLineWidth(m * M2PX);
  });
  menu.querySelector('#dr-swatch').addEventListener('click', ev => {
    ev.stopPropagation();
    openColorPicker(ev.currentTarget, 'annotNew');
  });
  menu.querySelector('#dr-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());   // キャンバスへの伝播を防ぐ
  menu.addEventListener('click', ev => ev.stopPropagation());
}
// 波源ツール設定：波速・振動数・波長・吸収の窓（もう一度ボタンを押すと閉じる）
//   波長スライダーは表示層の都合で置いてある。動かすと振動数のほうが書き換わり、
//   内部状態は v と f だけを持つ（λ を状態にすると必ず整合が崩れる）。
function toggleWaveMenu(e) {
  if (closeToolPopups('wave-popup')) return;
  setTool('wave');
  const menu = document.createElement('div');
  menu.id = 'wave-popup';
  const top = Math.min(e.clientY, window.innerHeight - 330);
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:' + top + 'px; width:340px; box-shadow:var(--shadow);';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">波源ツール設定</span>
      <span id="wv-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <div style="font-size:10px;color:var(--text2);margin-bottom:4px">
      波速 v [m/s]: <span id="wv-v-val" style="color:var(--accent)"></span>
      <span style="color:var(--text2)">（媒質の性質）</span>
    </div>
    <input type="range" id="wv-v" min="0.1" max="8" step="0.1" style="width:100%">
    <div style="font-size:10px;color:var(--text2);margin:8px 0 4px">
      振動数 f [Hz]: <span id="wv-f-val" style="color:var(--accent)"></span>
    </div>
    <input type="range" id="wv-f" min="0.05" max="5" step="0.05" style="width:100%">
    <div style="font-size:10px;color:var(--text2);margin:8px 0 4px">
      波長 λ [m]: <span id="wv-l-val" style="color:var(--accent)"></span>
      <span style="color:var(--text2)">＝ v/f</span>
    </div>
    <input type="range" id="wv-l" min="0.02" max="20" step="0.01" style="width:100%">
    <div style="font-size:10px;color:var(--text2);margin:8px 0 4px">
      振幅 A: <span id="wv-a-val" style="color:var(--accent)"></span>
    </div>
    <input type="range" id="wv-a" min="0" max="3" step="0.05" style="width:100%">
    <div style="font-size:10px;color:var(--text2);margin:8px 0 4px">
      媒質の吸収 α [1/m]: <span id="wv-ab-val" style="color:var(--accent)"></span>
    </div>
    <input type="range" id="wv-ab" min="0.02" max="3" step="0.01" style="width:100%">
    <div id="wv-note" style="font-size:10px;color:var(--text2);margin-top:6px;line-height:1.5"></div>
  `;
  document.body.appendChild(menu);
  const $ = id => menu.querySelector('#' + id);
  const sync = () => {
    $('wv-v').value  = world.waveSpeed;  $('wv-v-val').textContent  = world.waveSpeed.toFixed(2);
    $('wv-f').value  = waveFreq;         $('wv-f-val').textContent  = waveFreq.toFixed(2);
    const lam = world.waveSpeed / Math.max(1e-6, waveFreq);
    $('wv-l').value  = lam;              $('wv-l-val').textContent  = lam.toFixed(3);
    $('wv-a').value  = waveAmp;          $('wv-a-val').textContent  = waveAmp.toFixed(2);
    $('wv-ab').value = world.waveAbsorb; $('wv-ab-val').textContent = world.waveAbsorb.toFixed(2);
    // ★動く波源のときの表示の選び方を書いておく。「山だけ／両方」は包絡線を通して帯を出す
    //   仕組みで、その計算が波源の振動数を当てにしているため、ドップラーでずれた場所ほど
    //   帯が点々に割れる（js/waves/field.js の★）。ここに書かないと、道具の側の不調に見える。
    $('wv-note').innerHTML =
      '波が届く範囲は吸収から自動で決まります。<br>物体をクリックすると、その物体に載って一緒に動く波源になります（ドップラー効果）。'
      + '<br>動く波源では、表示を「変位そのもの」にすると波面がなめらかに出ます'
      + '（「山だけ」「両方」は止まっている波源向けです）。';
    syncWaveUI();
  };
  $('wv-v').addEventListener('input',  () => { setWaveSpeed($('wv-v').value); sync(); });
  $('wv-f').addEventListener('input',  () => { waveFreq = parseFloat($('wv-f').value); sync(); });
  $('wv-l').addEventListener('input',  () => { waveFreq = world.waveSpeed / Math.max(0.01, parseFloat($('wv-l').value)); sync(); });
  $('wv-a').addEventListener('input',  () => { waveAmp = parseFloat($('wv-a').value); sync(); });
  $('wv-ab').addEventListener('input', () => { setWaveAbsorb($('wv-ab').value); sync(); });
  sync();
  $('wv-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());
  menu.addEventListener('click', ev => ev.stopPropagation());
}
// ── 加熱／冷却ツール設定：これから置く領域の出力 [W]（符号つき） ────────────────
//   ★加熱と冷却は符号違いの同じ仕組み（HeatField.power の符号だけの違い。heat-field.js の★）
//     なので、左ツールバーのボタンは1つ、この窓のつまみも1本で、0 をまたいで選ばせる。
//     電場・磁場を2つに割ってあるのとは事情が違う（あちらは働く相手も単位も別物）。
//   ★つまみは 0 に吸着する（heatPowerTicks。右パネル・リモコンと同じ目盛り）。
//   置いたあとは選択して右パネルで変えられる（電場・磁場の窓と同じ流儀）。
function toggleHeatFieldMenu(e) {
  const same = !!document.getElementById('heatfield-popup') && currentTool === 'heater';
  closeToolPopups();                 // 他のツールの窓は畳む（同時に開くのは1つだけ）
  if (same) return;                  // 同じツールを再クリック＝閉じる
  setTool('heater');
  const ticks = heatPowerTicks(10);
  const menu = document.createElement('div');
  menu.id = 'heatfield-popup';
  const top = Math.min(e ? e.clientY : 8, window.innerHeight - 300);
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:' + Math.max(8, top) + 'px; width:200px; box-shadow:var(--shadow);';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">加熱・冷却の領域</span>
      <span id="hf-pop-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <div class="prop-row"><span class="prop-label">出力 [W]</span>
      <input class="prop-input" id="hf-pop-power" type="number" step="10"
             title="正で加熱（熱を与える）、負で冷却（熱を奪う）、0 で止まります"></div>
    <input type="range" id="hf-pop-slider" min="0" max="${ticks.length - 1}" step="1" style="width:100%">
    <div style="display:flex;justify-content:space-between;font-size:10px;margin-top:-2px">
      <span style="color:${HEATFIELD_COLOR.cool}">❄ 冷却 −</span><span style="color:var(--text2)">0</span>
      <span style="color:${HEATFIELD_COLOR.heat}">＋ 加熱 ♨</span></div>
    <div id="hf-pop-note" style="font-size:10px;color:var(--text2);margin-top:8px;line-height:1.5"></div>
  `;
  document.body.appendChild(menu);
  const inp = menu.querySelector('#hf-pop-power'), rng = menu.querySelector('#hf-pop-slider');
  const paint = () => {
    const k = heatKindOf(heaterPower);
    menu.querySelector('#hf-pop-note').innerHTML =
      (k === 'heat' ? 'ドラッグした矩形の内側にあるものへ、熱を与え続けます。'
     : k === 'cool' ? 'ドラッグした矩形の内側にあるものから、熱を奪い続けます。'
     :                '出力 0 のまま置くと、何もしない枠になります（あとで右パネルやリモコンで回せます）。')
     + `<br>この値は<b>領域全体</b>が1秒あたりに出し入れする熱量で、1つあたりではありません
        （中にあるものへ、浸かっている体積の比で配られます）。<br>
        <b>断熱</b>に設定したもの（比熱か熱伝導率が0）には効きません。<br>
        全体設定の「熱のやりとりを計算する」がOFFだと効きません。`;
    syncHeatFieldToolButton();       // 左ツールバーのアイコン（♨／❄）
    refreshToolHint();               // ヒント行の【加熱 ＋200 W】
  };
  const set = (v, fromSlider) => {
    heaterPower = parseFloat(v) || 0;
    if (document.activeElement !== inp) inp.value = heaterPower;
    if (!fromSlider) rng.value = _nearestTickIndex(ticks, heaterPower);
    paint();
  };
  set(heaterPower);
  inp.value = heaterPower;
  rng.addEventListener('input',  () => set(ticks[+rng.value], true));
  inp.addEventListener('change', () => set(inp.value));
  menu.querySelector('#hf-pop-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());
  menu.addEventListener('click', ev => ev.stopPropagation());
}
// ★出力の符号を左ツールバーのアイコンに出す。窓を閉じてもモードは残るので、
//   ボタンが「加熱」のままだと冷却の枠を置いてしまう（お絵描きのモードと同じ事故）。
function syncHeatFieldToolButton() {
  const el = document.getElementById('t-heater-icon');
  const use = el && el.querySelector('use');   // アイコンは SVG スプライト（physBox.html 冒頭）
  if (use) use.setAttribute('href', heaterPower < 0 ? '#ti-cool' : '#ti-heat');
}
// ★選んでいる種類を左ツールバーのアイコンに出す（加熱・冷却と同じ理由：窓を閉じてもモードは残る）
function syncParticleToolButton() {
  const el = document.getElementById('t-particle-icon');
  const use = el && el.querySelector('use');
  if (use) use.setAttribute('href', particleToolKind === 'gas' ? '#ti-gas' : '#ti-fluid');
}
// ── 流れの場ツール設定：これから置く領域の流速・向き・媒質 ──────────────
//   置いたあとは選択して右パネルで変えられる（加熱・冷却の窓と同じ流儀）。
function toggleFlowFieldMenu(e) {
  const same = !!document.getElementById('flowfield-popup') && currentTool === 'flowfield';
  closeToolPopups();                 // 他のツールの窓は畳む（同時に開くのは1つだけ）
  if (same) return;                  // 同じツールを再クリック＝閉じる
  setTool('flowfield');
  const menu = document.createElement('div');
  menu.id = 'flowfield-popup';
  const top = Math.min(e ? e.clientY : 8, window.innerHeight - 300);
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:' + Math.max(8, top) + 'px; width:210px; box-shadow:var(--shadow);';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">流れの場（風・水流）</span>
      <span id="ff-pop-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <div class="prop-row"><span class="prop-label">効かせ方</span>
      <select class="prop-input" id="ff-pop-mode">
        <option value="advect">速度の合成</option>
        <option value="drag">流体の抗力</option>
      </select></div>
    <div class="prop-row"><span class="prop-label">流速 [m/s]</span>
      <input class="prop-input" id="ff-pop-speed" type="number" step="0.5" min="0"></div>
    <input type="range" id="ff-pop-speed-r" min="0" max="${FLOWFIELD_SPEED_MAX}" step="0.5" style="width:100%">
    <div class="prop-row"><span class="prop-label">向き [°]</span>
      <input class="prop-input" id="ff-pop-angle" type="number" step="1"></div>
    <input type="range" id="ff-pop-angle-r" min="-180" max="180" step="1" style="width:100%">
    <div class="prop-row" id="ff-pop-medium-row"><span class="prop-label">媒質</span>
      <select class="prop-input" id="ff-pop-medium">
        ${FLOW_MEDIUM.map(m => `<option value="${m.density}">${m.label}（${m.density}）</option>`).join('')}
      </select></div>
    <div id="ff-pop-note" style="font-size:10px;color:var(--text2);margin-top:8px;line-height:1.5"></div>
  `;
  document.body.appendChild(menu);
  const sp = menu.querySelector('#ff-pop-speed'), spR = menu.querySelector('#ff-pop-speed-r');
  const an = menu.querySelector('#ff-pop-angle'), anR = menu.querySelector('#ff-pop-angle-r');
  const md = menu.querySelector('#ff-pop-medium'), mo = menu.querySelector('#ff-pop-mode');
  // ★媒質（＝密度 ρ）は抗力の式にしか出てこない。速度の合成のときは窓からも消す
  const setMode = v => {
    flowMode = v === 'drag' ? 'drag' : 'advect';
    mo.value = flowMode;
    menu.querySelector('#ff-pop-medium-row').style.display = flowMode === 'drag' ? '' : 'none';
    menu.querySelector('#ff-pop-note').innerHTML = flowMode === 'drag'
      ? 'ドラッグした矩形の内側を、この速度で媒質が流れます。中の物体は相対速度に応じた抗力'
        + ' <b>F = ½ρC<sub>d</sub>A|u−v|(u−v)</b> を受け、<b>流速に漸近</b>します（終端速度＝流速）。<br>'
        + '★<b>抗力係数 C<sub>d</sub> が 0 の物体は流れを受けません</b>（既定が 0 です）。<br>'
        + '★力なので<b>重さと摩擦に負けます</b>。空気だと地面に置いた物体はまず動きません'
        + '（80×80cm の箱で 8m/s の力 1.2N 対 摩擦 113N）。'
      : 'ドラッグした矩形の内側で、媒質ごと物体を運びます。地面から見た速度が'
        + ' <b>v + u</b>（速度の合成）になります。<br>'
        + '川を渡る船・動く歩道・風の中の飛行機の題材です。<b>抗力係数にも重さにも依りません</b>。<br>'
        + '★地面に接している物体は運ばれたあと摩擦で減速します。川渡りは'
        + '<b>真上から見た配置</b>（重力 0）で組んでください。';
  };
  const setSpeed = v => {
    flowSpeed = Math.max(0, parseFloat(v) || 0);
    if (document.activeElement !== sp) sp.value = flowSpeed;
    spR.value = Math.min(FLOWFIELD_SPEED_MAX, flowSpeed);
  };
  // ★向きは欄が上向き正、内部は y 下向き正。両方向で yUI を通す（右パネルと同じ約束）
  const setAngle = v => {
    const deg = parseFloat(v) || 0;
    flowAngle = yUI(deg * Math.PI / 180);
    if (document.activeElement !== an) an.value = Math.round(deg);
    anR.value = Math.round(deg);
  };
  setMode(flowMode);
  setSpeed(flowSpeed);
  setAngle(Math.round(yUI(flowAngle) * 180 / Math.PI));
  md.value = String(flowDensity);
  mo.addEventListener('change', () => setMode(mo.value));
  spR.addEventListener('input',  () => setSpeed(spR.value));
  sp.addEventListener('change',  () => setSpeed(sp.value));
  anR.addEventListener('input',  () => setAngle(anR.value));
  an.addEventListener('change',  () => setAngle(an.value));
  md.addEventListener('change',  () => { flowDensity = parseFloat(md.value) || 1.2; });
  menu.querySelector('#ff-pop-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());
  menu.addEventListener('click', ev => ev.stopPropagation());
}
// 流体（液体・気体）ツール設定：種類・1度に置く数・配置上限の窓（もう一度ボタンを押すと閉じる）
//   ★ボタンは1つで、液体か気体かは窓の先頭で選ぶ（加熱・冷却と同じ形）。
//     ただし加熱・冷却と違い「同じ仕組みだから」ではなく「置き方と設定が同じだから」まとめている。
//     中身は別のソルバなので、ツール名は 'fluid'／'gas' のまま（mouse.js の置き方もそのまま）。
//   ★種類を変えても窓は作り直さない（動かした窓の位置が戻るため。加熱・冷却の窓と同じ）。
function toggleParticleMenu(e) {
  const same = !!document.getElementById('particle-popup') &&
               (currentTool === 'fluid' || currentTool === 'gas');
  closeToolPopups();                                           // 他のツールの窓は畳む
  if (same) return;                                            // 同じボタンを再クリック＝閉じる
  setTool(particleToolKind);
  const menu = document.createElement('div');
  menu.id = 'particle-popup';
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:8px; width:200px; box-shadow:var(--shadow);' +
    'max-height:calc(100vh - 16px); overflow-y:auto;';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">流体ツール設定</span>
      <span id="pt-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <div class="material-grid" id="pt-kinds" style="margin-bottom:4px"></div>
    <div id="pt-kind-note" style="font-size:10px;color:var(--text2);margin-bottom:8px;line-height:1.5"></div>
    <div style="font-size:10px;color:var(--text2);margin-bottom:4px">
      1度に置く数: <span id="pt-spawn-val" style="color:var(--accent)">${particleSpawnPerEvent}</span> 個
    </div>
    <input type="range" id="pt-spawn" min="1" max="30" step="1" value="${particleSpawnPerEvent}" style="width:100%">
    <div style="font-size:10px;color:var(--text2);margin:8px 0 4px">
      配置上限: <span id="pt-max-val" style="color:var(--accent)">${particleMaxCount}</span> 個
      <span id="pt-now" style="color:var(--text2)"></span>
    </div>
    <input type="range" id="pt-max" min="100" max="20000" step="100" style="width:100%">
    <div style="display:flex;align-items:center;gap:6px;margin-top:10px">
      <div class="color-swatch" id="pt-swatch" style="background:${particleColor || PARTICLE_TYPES[particleToolKind].color}"></div>
      <span style="font-size:10px;color:var(--text2)">印の色</span>
      <button class="btn-small" id="pt-nocolor" style="margin-left:auto" title="これから置く粒子を、型の色（液体は水色・気体は薄い水色）に戻します">既定</button>
    </div>
    <div style="font-size:10px;color:var(--text2);margin-top:4px;line-height:1.5">
      色は目印で、物理には効きません（赤い水と青い水は同じ水。質量も比熱も同じです）。
      「どの水がどこへ行くか」「混ざって元に戻らないこと」を追うのに使います。<br>
      ※印を付けた粒子は、全体設定の「温度で色をつける」が ON でも印の色のままです。
    </div>
    <button class="btn-small" id="pt-clear" style="width:100%;margin-top:8px">粒子をすべて消去</button>
    <div style="font-size:10px;color:var(--text2);margin-top:6px;line-height:1.5">
      上限は液体・気体を合わせた総数です。上限を下げても既にある粒子は消えません
      （減らすときは編集ツールで囲んで削除するか、下のボタンで消してください）。<br>
      粒子数に比例して1フレームの計算量が増えます。重くなったら上限を下げてください。
    </div>
  `;
  document.body.appendChild(menu);
  const sp = menu.querySelector('#pt-spawn'), spV = menu.querySelector('#pt-spawn-val');
  const mx = menu.querySelector('#pt-max'),   mxV = menu.querySelector('#pt-max-val');
  sp.addEventListener('input', () => { particleSpawnPerEvent = parseInt(sp.value); spV.textContent = particleSpawnPerEvent; });
  mx.addEventListener('input', () => { particleMaxCount = parseInt(mx.value); mxV.textContent = particleMaxCount; });   // 個数なので線形
  mx.value = particleMaxCount;
  menu.querySelector('#pt-clear').addEventListener('click', () => { particles = []; });
  menu.querySelector('#pt-swatch').addEventListener('click', ev => {
    ev.stopPropagation();
    openColorPicker(ev.currentTarget, 'particleNew');
  });
  menu.querySelector('#pt-nocolor').addEventListener('click', () => resetParticleColor());
  // 種類（液体／気体）。加熱・冷却の窓と同じ mat-btn の2択。
  const grid = menu.querySelector('#pt-kinds');
  const paint = () => {
    grid.innerHTML = '';
    for (const o of [{ v:'fluid', label:'液体' }, { v:'gas', label:'気体' }]) {
      const b = document.createElement('button');
      b.className = 'mat-btn' + (o.v === particleToolKind ? ' active' : '');
      b.textContent = o.label;
      b.onclick = () => { particleToolKind = o.v; setTool(o.v); paint(); };
      grid.appendChild(b);
    }
    // ★2つは別の計算で動く（混ぜられない）ことを、選んだ側の言葉で1行だけ書く
    menu.querySelector('#pt-kind-note').textContent = particleToolKind === 'fluid'
      ? '水の粒。下にたまって水面ができ、物体を浮かべます。'
      : '気体の分子。減速せずに飛び回り、壁にぶつかり続けます。';
    if (!particleColor) showParticleSwatch(PARTICLE_TYPES[particleToolKind].color);
    syncParticleToolButton();        // 左ツールバーのアイコン
  };
  paint();
  // 現在数の表示。窓が消えたら自分で止まる（インターバルの取り残しを防ぐ）
  const tick = setInterval(() => {
    const el = document.getElementById('pt-now');
    if (!el) { clearInterval(tick); return; }
    el.textContent = '（現在 ' + particles.length + ' 個）';
  }, 400);
  // ★高さは中身で決まるので、置いてから測って画面内に収める（測定の窓と同じ）
  const h = menu.offsetHeight;
  menu.style.top = Math.max(8, Math.min(e ? e.clientY : 8, window.innerHeight - h - 8)) + 'px';
  menu.querySelector('#pt-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());
  menu.addEventListener('click', ev => ev.stopPropagation());
}
function toggleShapeMenu(e, tool) {
  const same = !!document.getElementById('shape-popup') && currentTool === tool;
  closeToolPopups();                                           // 他のツールの窓は畳む
  if (same) return;                                            // 同じツールを再クリック＝閉じる
                                                               // 図形ツールを跨ぐときは窓を作り直す
  setTool(tool);
  const menu = document.createElement('div');
  menu.id = 'shape-popup';
  const top = Math.min(e.clientY, window.innerHeight - 280);
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:' + top + 'px; width:200px; box-shadow:var(--shadow);';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">${SHAPE_TOOL_NAMES[tool]}ツール設定</span>
      <span id="sh-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    ${tool === 'gear' ? gearModeSwitchHTML('gear') + `
    <div style="padding:0 7px 8px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <span style="font-size:10px;color:var(--text2)">歯の大きさ（モジュール）[cm]</span>
        <span id="sh-gm-val" style="font-size:11px;font-weight:600;color:var(--accent)"></span>
      </div>
      <input type="range" id="sh-gm" min="2" max="30" step="1" style="width:100%">
      <div style="font-size:9px;line-height:1.4;margin-top:4px;color:var(--text2)">
        かみ合うのは同じ大きさの歯どうしだけ。歯数はドラッグの長さで決まります
      </div>
    </div>` : ''}
    <div id="sh-mass-box" style="border-radius:5px;padding:6px 7px;transition:border-color .15s">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <span id="sh-mass-label" style="font-size:10px">質量 m [kg]</span>
        <span id="sh-mass-val" style="font-size:11px;font-weight:600"></span>
      </div>
      <input type="range" id="sh-mass" style="width:100%">
      <div id="sh-mass-note" style="font-size:9px;line-height:1.4;margin-top:4px"></div>
    </div>
    <label class="checkbox-row" style="margin-top:10px">
      <input type="checkbox" id="sh-autofix" ${shapeAutoFix ? 'checked' : ''}>
      <span>描いたらその場に固定</span>
    </label>
    <div style="font-size:10px;color:var(--text2);margin-top:6px;line-height:1.5">
      <b style="color:#66bb6a">緑のナット</b>で留まり、速度ツールで初速を与えると外れます。
      設置後は右パネルで個別に変更できます。
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-top:10px">
      <div class="color-swatch" id="sh-swatch" style="background:${drawProps.fillColor}"></div>
      <span style="font-size:10px;color:var(--text2)">塗りつぶしの色（クリックで変更）</span>
    </div>
    <div class="rpanel-title" style="margin:10px 0 4px">素材プリセット</div>
    <div class="material-grid" id="sh-preset"></div>
    <div id="sh-preset-note" style="font-size:9px;line-height:1.4;margin-top:5px"></div>
  `;
  document.body.appendChild(menu);
  const box   = menu.querySelector('#sh-mass-box');
  const label = menu.querySelector('#sh-mass-label');
  const sld   = menu.querySelector('#sh-mass');
  const val   = menu.querySelector('#sh-mass-val');
  const mNote = menu.querySelector('#sh-mass-note');
  const pNote = menu.querySelector('#sh-preset-note');
  const grid  = menu.querySelector('#sh-preset');
  const fix   = menu.querySelector('#sh-autofix');
  const sw    = menu.querySelector('#sh-swatch');
  const sync = () => {
    const byMass = (shapeMassSource === 'mass');
    box.style.border     = byMass ? '1px solid var(--accent)' : '1px solid var(--border)';
    box.style.background = byMass ? 'rgba(79,195,247,.08)' : 'transparent';
    label.style.color    = byMass ? 'var(--accent)' : 'var(--text2)';
    val.textContent      = shapeMass;
    val.style.color      = byMass ? 'var(--accent)' : 'var(--text2)';
    sld.style.opacity    = byMass ? 1 : 0.4;
    mNote.innerHTML = byMass
      ? '<span style="color:var(--accent3)">▶ 大きさによらず、この値で質量が決まります</span>'
      : '<span style="color:#ffa726">未使用。バーを動かすと質量指定に切り替わります</span>';
    // 密度モードの見出しは「素材あり／なし」で言い分ける（素材なしのときは shapeMaterial が null）。
    // ★面密度［kg/m²］も出す。密度だけでは描いた図形が何kgになるか見当が付かないので、
    //   「1m×1mなら何kg」を読める形にしておく（奥行きは world.depth なのでここで掛けておく）。
    const dens = shapeMaterial ? MATERIALS[shapeMaterial].density : drawProps.density;
    const per  = dens * world.depth;                    // [kg/m²]
    pNote.innerHTML = byMass
      ? '<span style="color:var(--text2)">素材を選ぶと密度から質量が決まります</span>'
      : `<span style="color:var(--accent3)">▶ ${shapeMaterial || '素材なし'} ${dens} kg/m³ ×面積×奥行き` +
        `</span><br><span style="color:var(--text2)">1 m² あたり ${per.toFixed(per < 10 ? 1 : 0)} kg</span>`;
    grid.querySelectorAll('.mat-btn').forEach(x =>
      x.classList.toggle('active', !byMass && x.dataset.mat === shapeMaterial));
    sw.style.background = drawProps.fillColor;   // ★素材の選択・解除で色が変わるので見本も追従
    refreshToolHint();
  };
  sld.min = 1; sld.max = 200; sld.step = 1;           // 1〜200 kg を 1 kg 刻み（200段）
  sld.addEventListener('input', () => {
    shapeMass = parseInt(sld.value);
    if (shapeMassSource !== 'mass') {
      Object.assign(drawProps, MATERIAL_DEFAULT);     // ★素材で変わった色・係数・密度を既定へ戻す
      shapeMaterial = null;                           // 素材の強調表示も外す
      shapeMassSource = 'mass';                       // ★動かしたら質量指定へ切り替え
    }
    sync();
  });
  sld.value = Math.round(Math.min(200, Math.max(1, shapeMass)));
  for (const [name, props] of Object.entries(MATERIALS)) {
    const b = document.createElement('button');
    b.className = 'mat-btn';
    b.textContent = name;
    b.dataset.mat = name;
    b.title = `密度 ${props.density} kg/m³`;
    b.onclick = () => {
      // ★同じ素材をもう一度 → 解除。密度モードのまま「素材なし（既定の密度）」へ戻す。
      //   以前はここで質量指定へ落としていたが、解除した拍子に質量の決め方まで変わるのは
      //   分かりにくい（質量指定に移りたいときはバーを動かせばよい）。
      if (shapeMassSource === 'density' && shapeMaterial === name) {
        Object.assign(drawProps, MATERIAL_DEFAULT);     // 色・係数・密度を既定へ戻す
        shapeMaterial = null;
        sync();
        return;
      }
      Object.assign(drawProps, props);
      drawProps.ior  = props.ior  !== undefined ? props.ior  : 0;   // ガラス→木材で残らないように
      drawProps.abbe = props.abbe !== undefined ? props.abbe : ABBE_DEFAULT;
      drawProps.dispersion = !!props.dispersion;
      drawProps.reflectance = props.reflectance !== undefined ? props.reflectance : 0;
      shapeMaterial = name;
      shapeMassSource = 'density';
      sync();                                          // 右パネルには触らない（あちらは選択中の物体のもの）
    };
    grid.appendChild(b);
  }
  sync();
  if (tool === 'gear') wireGearModeSwitch(menu);
  const gm = menu.querySelector('#sh-gm');
  if (gm) {                                            // 歯車ツールだけ：モジュール [cm]（内部は px）
    const gmv = menu.querySelector('#sh-gm-val');
    const show = () => { gmv.textContent = Math.round(gearModule * PX2M * 100); };
    gm.value = Math.round(gearModule * PX2M * 100);
    gm.addEventListener('input', () => { gearModule = parseFloat(gm.value) / 100 * M2PX; show(); refreshToolHint(); });
    show();
  }
  fix.addEventListener('change', () => { shapeAutoFix = fix.checked; refreshToolHint(); });
  sw.addEventListener('click', ev => {
    ev.stopPropagation();
    openColorPicker(ev.currentTarget, 'shapeNew');
  });
  menu.querySelector('#sh-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());   // キャンバスへの伝播を防ぐ
  menu.addEventListener('click', ev => ev.stopPropagation());
}

// ── 測定の道具のウィンドウ（左ツールバー「測定」ボタン）─────────
//   ★通過カウンタと速さの分布計は1つのボタンにまとめ、窓から選ぶ（回路素子の窓と同じ流儀）。
//     どちらも見る側の道具（物理に参加しない）で、ツールバーに1つずつ並べるほど頻繁には使わない。
//     道具を選んでも窓は閉じない。測定の道具を足すときはこの一覧に1行足し、
//     TOOL_BUTTON_OF（keyboard.js）で「測定」ボタンを点けるようにする。
const MEASURE_TOOLS = [
  { tool:'counter',  icon:'ti-counter',  name:'通過カウンタ',
    tip:'線を引くと、横切った物体・粒子の数と毎秒の個数を数える' },
  { tool:'spdmeter', icon:'ti-spdmeter', name:'速さの分布計',
    tip:'矩形を置くと、その中の気体分子・水・物体を速さで仕分けて個数を数える' },
  { tool:'waveprobe', icon:'ti-waveprobe', name:'波の受信器',
    tip:'クリックした場所の波の変位（y-t）と振動数を測る。\n'
      + '物体の上に置くとその物体に付いて動き（動く観測者）、ばねの上に置くとその点を測る' },
];
function highlightMeasureTool() {
  const menu = document.getElementById('measure-popup');
  if (!menu) return;
  menu.querySelectorAll('button[data-tool]').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === currentTool));
}
function toggleMeasureMenu(e) {
  if (closeToolPopups('measure-popup')) return;
  const menu = document.createElement('div');
  menu.id = 'measure-popup';
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:6px; z-index:1000; left:58px; top:8px; width:186px; box-shadow:var(--shadow);' +
    'max-height:calc(100vh - 16px); overflow-y:auto;';
  menu.innerHTML =
    '<div id="measure-pop-head" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;cursor:move">' +
      '<span style="font-size:11px;font-weight:700;color:var(--accent)">測定</span>' +
      '<span class="popup-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>' +
    '</div>';
  for (const m of MEASURE_TOOLS) {
    const b = document.createElement('button');
    b.className = 'btn-small'; b.dataset.tool = m.tool;
    b.title = m.tip;
    b.style.cssText = 'display:flex;align-items:center;gap:6px;width:100%;margin-bottom:3px;text-align:left;padding:3px 6px';
    b.innerHTML = '<svg class="ti" style="display:block;width:20px;height:20px;flex:none"><use href="#' + m.icon + '"/></svg>' +
                  '<span>' + m.name + '</span>';
    b.onclick = () => { setTool(m.tool); highlightMeasureTool(); };   // ★閉じない
    menu.appendChild(b);
  }
  const note = document.createElement('div');
  note.style.cssText = 'font-size:10px;color:var(--text2);margin-top:6px';
  note.innerHTML = 'どれも測るだけで、物理には影響しません。置いたあとは<b>編集ツール</b>で端・枠・印を掴んで動かせます。';
  menu.appendChild(note);
  document.body.appendChild(menu);
  const h = menu.offsetHeight;
  menu.style.top = Math.max(8, Math.min(e.clientY, window.innerHeight - h - 8)) + 'px';
  makeDraggable(menu, menu.querySelector('#measure-pop-head'));
  menu.querySelector('.popup-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());
  menu.addEventListener('click', ev => ev.stopPropagation());
  highlightMeasureTool();
}
