// 反射率欄のツールチップ（setSliderDisabled が title を書き換えるので、ここで持っておく）
const P_REFL_TITLE = '界面で反射する光の割合。残りは、透明な物体（光屈折率>1）なら屈折して進み、'
  + '不透明なら吸収されます。鏡100＝全反射／鏡50＝ハーフミラー';
const P_REFL_AUTO_MSG = 'フレネルの式で自動計算中です。手で指定するには下のチェックを外してください';
const P_CHARGE_TITLE = '正負の電荷。電場の領域の中で F = qE を受け、磁場の中でローレンツ力を受けます。'
  + '電荷同士のクーロン力 F = kq₁q₂/r² は既定でONです（同符号は反発し、異符号は引き合います）。'
  + '下の行から切り替えられます';
const P_CHARGE_ROD_MSG = '導体棒には電荷を与えられません（回路用の素子として扱っています）';
const P_ABBE_TITLE = '分散の小ささを表す値。V_d＝(n_d−1)/(n_F−n_C) なので、大きいほど波長による屈折率差が'
  + '小さく虹が開きません。クラウン≈64／フリント≈36／重フリント≈26';
const P_ABBE_OFF_MSG = '「波長により屈折率を変える」がOFFのため使われません（全波長で n_d のまま進みます）';
function updatePropsPanel(b) {
  _hideAllPropForms(!b);    // 選択解除ならタブは動かさない
  // ★素材プリセット・外観は「選択中の物体を編集する欄」なので、選択が無いときは出さない。
  //   未選択でも出していた頃は、素材・色・枠幅のどれもが selectedIds を回すだけの
  //   何も起きない欄だった（applyMaterialToSelection は選択0で即 return、updateColor と
  //   updateProp は空のループ）。新しく描く物体の既定は図形ツールのポップアップ側が持つ。
  setStyleSections(!!b);
  if (!b) {
    syncMaterialGrid(null);
    document.getElementById('prop-none').style.display='';
    return;
  }
  document.getElementById('prop-form').style.display='';
  document.getElementById('p-mass').value=fmtMassKg(b.mass);
  document.getElementById('p-density').value = b.density != null
    ? Math.round(b.density)
    : Math.round(b.mass / Math.max(b.areaM2()*world.depth, 1e-9));
  document.getElementById('p-angle').value = _dispDeg(b.angle).toFixed(1);
  setSliderDisabled('p-angle', currentTool !== 'pointer', '回転は編集ツールでのみ行えます');
  document.getElementById('p-restitution').value=b.restitution;
  document.getElementById('p-friction').value=b.friction;
  document.getElementById('p-friction-s').value=b.frictionStatic;
  document.getElementById('p-drag').value=b.drag;
  // ★熱。世界の熱スイッチがOFFなら丸ごと隠す（_hideEmptyPropGroups が見出しごと消す）
  const _thG = document.getElementById('p-thermal-group');
  for (const id of ['p-temp','p-heatcap','p-conduct','p-emissivity','p-heatcap-total'])
    document.getElementById(id).closest('.prop-row').style.display = world.thermalOn ? '' : 'none';
  const _tfr = document.getElementById('p-tempfixed-row');
  if (_tfr) _tfr.style.display = world.thermalOn ? '' : 'none';
  document.getElementById('p-tempfixed').checked = !!b.tempFixed;
  if (world.thermalOn) {
    document.getElementById('p-temp').value    = K2C(b.temp).toFixed(1);
    document.getElementById('p-heatcap').value = b.heatCap;
    document.getElementById('p-conduct').value = b.conduct;
    document.getElementById('p-emissivity').value = b.emissivity;
    document.getElementById('p-heatcap-total').value = Math.round(b.heatCap * b.mass);
  }
  if (_thG) _thG.style.display = world.thermalOn ? '' : 'none';
  refreshTempGraphButton();
  // ── 気体分子から受ける力・圧力 ────────────────────────────────────
  //   ★分子気体が当たっている物体にだけ出す。当たっていない物体にも並べると
  //     0 が3行居座るだけで、「圧力は物体の属性」という誤解を与える
  //     （右パネルの流儀＝読んで意味のあるものだけ出す）。
  const mg = document.getElementById('p-molgas-group');
  if (mg) {
    const on = !!(b._molP > 0 || b._molF > 0);
    mg.style.display = on ? '' : 'none';
    if (on) {
      const f = b._molPf || [0, 0, 0, 0];
      document.getElementById('p-mol-force').value = (b._molF || 0).toFixed(1);
      document.getElementById('p-mol-press').value = Math.round(b._molP);
      // 並びは jf の詰め方（ローカル +x / −x / +y / −y）＝右／左／下／上
      document.getElementById('p-mol-faces').value =
        `左${Math.round(f[1])} 右${Math.round(f[0])} 上${Math.round(f[3])} 下${Math.round(f[2])}`;
    }
  }
  document.getElementById('p-ior').value=b.ior;
  document.getElementById('p-abbe').value=b.abbe;
  _syncDispersionRows(b);
  document.getElementById('p-charge').value = b.charge || 0;
  // ★導体棒は電荷を持てない（回路用の素子）。持てると、遮蔽を扱わないこの app では
  //   「導体に電荷があるのに表面が等電位でない」という不整合が見えてしまう。
  setSliderDisabled('p-charge', !!b.conductor, P_CHARGE_ROD_MSG);
  if (!b.conductor) document.getElementById('p-charge').title = P_CHARGE_TITLE;
  // ★電荷を入れたときだけ、クーロン力のON/OFFを「その場で」出す。
  //   以前はOFFのときに「全体設定タブ→電磁気へ行ってください」と案内するだけだったが、
  //   電荷を入れる場所とスイッチの場所が離れているのが誤解の元だった（既定ONにした今も、
  //   試験電荷の理想化のために切りたい場面は残るので、ここから直に切り替えられるようにする）。
  const cn = document.getElementById('p-charge-note');
  if (b.charge) {
    cn.style.display = '';
    cn.innerHTML = _chargeNoteHTML();
  } else cn.style.display = 'none';
  // ★導体棒であることは読み取り専用の表示にする（一般の物体を導体に指定する入口は無い。
  //   任意形状を「導体」と宣言できると静電遮蔽を期待させてしまうため）
  const cd = document.getElementById('p-conductor-note');
  cd.style.display = b.conductor ? '' : 'none';
  if (b.conductor) cd.textContent = '導体棒：回路のレールに重ねると起電力（BLv）を生みます（電荷は与えられません）';
  document.getElementById('p-static').checked=b.isStatic;
  document.getElementById('p-constvel').checked=b.constVel;
  document.getElementById('p-hasgravity').checked = b.hasGravity !== false;
  // ★名前は1つの物体を指すものなので、複数を選んでいるときは出さない（プロパティのコピーも名前は写さない）
  document.getElementById('p-label-row').style.display = selectedIds.size > 1 ? 'none' : '';
  const _lb = document.getElementById('p-label');
  if (document.activeElement !== _lb) _lb.value = b.label || '';
  document.getElementById('p-fixrot').checked=b.fixedRotation;
  setSliderDisabled('p-av', b.fixedRotation);
  document.getElementById('p-guide').checked = b.guideEnabled;
  document.getElementById('p-guide-row').style.display     = b.guideEnabled ? '' : 'none';
  document.getElementById('guide-preset-grid').style.display = b.guideEnabled ? '' : 'none';
  document.getElementById('p-guideangle').value = _dispDeg(b.guideAngle).toFixed(1);
  for (let i = 1; i <= LAYER_COUNT; i++)
    document.getElementById('p-layer'+i).checked = !!(b.layers & (1 << (i-1)));
  // ★「電気力線の源にする」は電荷を持つ物体だけに出す（q=0 の物体は場を作らないので、
  //   出しても切り替える意味がない）。既定は源に含める。
  const fs = document.getElementById('p-fieldsrc-row');
  fs.style.display = b.charge ? '' : 'none';
  document.getElementById('p-fieldsrc').checked = b.fieldSource !== false;
  document.getElementById('p-showforces').checked=b.showForces;
  document.getElementById('p-showvelocity').checked=b.showVelocity;
  document.getElementById('p-fviz').value=world.forceVizScale;   // ★全体設定（ここに置くと見つけやすい）
  document.getElementById('p-vviz').value=world.velVizScale;
  document.getElementById('p-av').value=b.av.toFixed(2);
  refreshVelocityFields();      // ★速さ・運動の向き・速度X・速度Y をまとめて書く
  document.getElementById('p-sw').value=b.strokeWidth;
  document.getElementById('fill-swatch').style.background=b.fillColor;
  document.getElementById('stroke-swatch').style.background=b.strokeColor;
  syncMaterialGrid(b);      // ★素材の強調表示も、いま選んでいる物体の値から出し直す
  const showFocal = opticHasFocal(b.opticKind);
  const ideal = isIdealOptic(b);
  document.getElementById('optic-focal-row').style.display    = showFocal ? '' : 'none';
  document.getElementById('p-optic-ideal-row').style.display  = showFocal ? '' : 'none';
  document.getElementById('p-optic-ideal').checked = !!b.opticIdeal;
  if (showFocal) {
    const neg  = (b.opticKind === 'concaveLens');
    const fmin = minOpticFocal(b.opticKind, b.opticH, b.ior, b.opticIdeal) * PX2M;
    document.getElementById('p-focal').value = ((neg ? -b.focal : b.focal) * PX2M).toFixed(3);
    setSliderTicks('p-focal', neg ? focalTicks(-FOCAL_MAX_M, -fmin) : focalTicks(fmin, FOCAL_MAX_M));
  }
  // 光学素子の長さ（開口）と、スクリーンの強度分布の表示
  document.getElementById('p-opticlen-row').style.display = b.opticKind ? '' : 'none';
  if (b.opticKind) document.getElementById('p-opticlen').value = (2 * b.opticH * PX2M).toFixed(3);
  document.getElementById('p-screenprof-row').style.display = b.opticKind === 'screen' ? '' : 'none';
  document.getElementById('p-screenprof').checked = b.showProfile !== false;
  // ★円形歯車（歯車ツールで置いたもの）だけ、歯数と歯の大きさを出す（js/app/gear-tools.js）
  const _g = gearInfoOf(b);
  document.getElementById('p-gear-z-row').style.display = _g ? '' : 'none';
  document.getElementById('p-gear-m-row').style.display = _g ? '' : 'none';
  if (_g) {
    document.getElementById('p-gear-z').value = _g.z;
    document.getElementById('p-gear-m').value = +(_g.m * PX2M * 100).toFixed(2);
  }
  _syncVesselRows(b);      // ★容器の部品なら、拘束が持っている欄を隠して注記を出す
  _syncGratingRows(b);
  // ★反射率はすべての物体に効く。透明な物体ではフレネルの式による自動計算を選べる
  const autoR = (b.ior > 1 && !b.reflective && b.fresnel);
  document.getElementById('p-refl').value = Math.round((b.reflectance || 0) * 100);
  setSliderDisabled('p-refl', autoR, P_REFL_AUTO_MSG);
  if (!autoR) document.getElementById('p-refl').title = P_REFL_TITLE;
  // ★理想素子では屈折率・反射率・フレネルは使われないので欄ごと隠す。
  //   出したままだと「n を変えても何も起きない」欄が並ぶことになる。
  document.getElementById('p-ior-row').style.display  = ideal ? 'none' : '';
  document.getElementById('p-refl-row').style.display = ideal ? 'none' : '';
  document.getElementById('p-fresnel-row').style.display = (!ideal && b.ior > 1 && !b.reflective) ? '' : 'none';
  document.getElementById('p-fresnel').checked = !!b.fresnel;
  document.getElementById('p-wavemode').value = b.waveMode || 'fixed';
  document.getElementById('p-waveior-row').style.display = (b.waveMode === 'medium') ? '' : 'none';
  document.getElementById('p-waveior').value = b.waveIor;
  refreshVelGraphButton();   // ★グラフ入口ボタンの表記を現在の表示状態に合わせる
  refreshEneGraphButton();
  refreshMomGraphButton();
  refreshWaveGraphButton();
  _hideEmptyPropGroups();
  syncSliders();
}
// 種別が混ざった複数選択のときのパネル。
//   ★値のフォームは出さない。物体の欄を出しても入るのは選択のうち物体だけで、一緒に
//     選ばれているレーザーには何も起きないのに「選択中の全部に入る」と読めてしまう。
//   ★ただし空にはしない。混ざっていても移動・削除は全員に効く＝共通の操作は存在するので、
//     それを明示したうえで、値を編集したいとき用に種別を絞る導線を出す。
function updateMixedPanel(groups) {
  _hideAllPropForms(true);   // 選択は続いているのでタブは動かさない
  setStyleSections(false);
  document.getElementById('prop-mixed').style.display = '';
  const total = groups.reduce((s, g) => s + g.n, 0);
  document.getElementById('prop-mixed-list').innerHTML =
    groups.map(g => `<div><b>${g.label}</b> ${g.n}個</div>`).join('');
  document.getElementById('prop-mixed-note').innerHTML =
    `移動・削除はこの <b>${total}個</b>すべてに効きます。<br>`
    + '値をまとめて変えるには、種別を1つに絞ってください：';
  const pick = document.getElementById('prop-mixed-pick');
  pick.innerHTML = '';
  for (const g of groups) {
    const btn = document.createElement('button');
    btn.className = 'mat-btn';
    btn.textContent = `${g.label} ${g.n}個`;
    btn.title = `${g.label}だけを選択し直して、値をまとめて編集できるようにします`;
    btn.onclick = () => narrowSelectionTo(g.kind);
    pick.appendChild(btn);
  }
}
// 回折格子の欄。★実スケール換算を必ず併記する。
//   この画面の波長は実物の 2×10⁵ 倍に拡大してあるので、d や a の画面上の値（0.4 m など）は
//   そのままでは実感と結びつかない。÷K して µm と 本/mm で出すと、実在する格子
//   （300〜1200本/mm）と直に比べられて、設定が現実的かどうかが一目で分かる。
//   あわせて、1次の回折が存在するか（d ≥ λ）もその場で判定して出す。
//   dragging … スライダーを操作している最中。欄と注記だけを直し、つまみには触れない
function _syncGratingRows(b, dragging) {
  const on = (b.opticKind === 'grating');
  for (const id of ['p-slitn-row', 'p-slitd-row', 'p-slita-row', 'p-slitm-row', 'p-slit-note'])
    document.getElementById(id).style.display = on ? '' : 'none';
  if (!on) return;
  document.getElementById('p-slitn').value = b.slitN;
  document.getElementById('p-slitd').value = (b.slitD * PX2M).toFixed(3);
  document.getElementById('p-slita').value = (b.slitA * PX2M).toFixed(3);
  document.getElementById('p-slitm').value = b.slitM;
  // スリット幅は間隔を超えられないので、つまみの可動域そのものを d に合わせる
  setSliderRange('p-slita', SLIT_A_MIN_M, Math.max(SLIT_A_MIN_M, b.slitD * PX2M), 0.005);
  if (!dragging) syncSliderById('p-slita');
  const lam = simLambdaPx(laserWavelength);
  const mMax = Math.floor(b.slitD / lam);             // sinθ ≤ 1 を満たす最大の次数
  const note = [];
  note.push(`d = ${fmtGratingPitch(b.slitD)}／a = ${fmtGratingPitch(b.slitA)}`);
  if (mMax < 1) {
    note.push(`<span style="color:#ffca28">d が波長より短いので回折光は0次だけです</span>`
            + `（λ=${laserWavelength}nm なら ${(lam*PX2M).toFixed(3)} m 以上必要）`);
  } else {
    const th1 = Math.asin(lam / b.slitD) * 180 / Math.PI;
    note.push(`λ=${laserWavelength}nm では ${mMax}次まで（1次は ${th1.toFixed(1)}°）`);
    // ★スクリーンを置く距離の目安。これを出さないと「近くに置いて模様が汚い」で詰まる。
    //   はっきりした次数（フラウンホーファー回折）が立つのは、格子の全幅 Nd に対して
    //   L ≫ (Nd)²/λ のとき。実物の格子は幅が µm なのでこの条件は自動的に満たされるが、
    //   この画面では λ を拡大しているぶん格子も大きいので、意識して離す必要がある。
    const Lf = (b.slitN * b.slitD) ** 2 / lam;
    if (b.slitN >= 3)
      note.push(`次数をはっきり分けるにはスクリーンを <b>${(2*Lf*PX2M).toFixed(0)} m 以上</b>離す`
              + `（近いとフレネル回折の複雑な模様になります）`);
    // 欠落次数：d/a が整数 m のとき、m 次は単一スリットの零点に重なって消える
    const ratio = b.slitD / b.slitA;
    if (Math.abs(ratio - Math.round(ratio)) < 0.02 && Math.round(ratio) <= mMax)
      note.push(`d/a = ${Math.round(ratio)} なので <b>${Math.round(ratio)}次は欠落</b>します`);
  }
  // 実際に使われている分割数（自動のときは何個になったか）を出す。
  //   ★ここを見せないと「自動が何をしたか」が画面から分からない。
  const M = difSubCount(b, lam);
  note.push(b.slitM > 0
    ? `1スリットを <b>${M} 個の波源</b>として計算（手動）`
    : `1スリットを ${M} 個の波源として計算（自動：a ${M > 1 ? '＞' : '≦'} λ のため）`);
  document.getElementById('p-slit-note').innerHTML = note.join('<br>');
}
// 電荷欄の下に出す一行。状態表示と切り替えを兼ねる。
//   ONのとき＝ふだんの状態なので静かに。OFFのとき＝実在する力を消している状態なので、
//   「いま無効になっている」ことが目に入るよう色を付けて知らせる。
function _chargeNoteHTML() {
  const link = (label, title) =>
    `<span onclick="toggleCoulombFromPanel()" title="${title}"` +
    ` style="cursor:pointer;text-decoration:underline;margin-left:6px">${label}</span>`;
  if (world.coulombOn)
    return '電荷間クーロン力：<span style="color:#66bb6a">ON</span>'
         + (world.showFieldLines ? '' : '／電気力線は非表示')
         + link('切る', '電荷同士の相互作用を無効にします。一様電場中の放物運動などを'
                      + '複数の試験電荷で同時に見せるとき、粒子どうしの反発で軌道が乱れるのを防げます');
  return '電荷間クーロン力：<span style="color:#ffca28">OFF</span>'
       + '（電荷同士は力を及ぼしません。電場・磁場の領域からは受けます）'
       + link('入れる', '電荷同士に F = kq₁q₂/r² を働かせます');
}
// 電荷欄からクーロン力を切り替える。全体設定タブのチェックボックスと同じ処理を通し、
// あちらの表示も合わせ直す（同じ設定が2か所に出るので、ずれたままにしない）。
function toggleCoulombFromPanel() {
  emWorldUpdate('coulombOn', !world.coulombOn);
  syncEMWorldUI();
  const cn = document.getElementById('p-charge-note');
  if (cn) cn.innerHTML = _chargeNoteHTML();
}
// 分散のON/OFFとアッベ数。分散は透明な物体でのみ意味を持つ（iorAt が n_d>1 でしか働かない）ので、
// フレネル行と同じ条件で出し入れし、OFFのあいだはアッベ数を灰色にして「効いていない」ことを示す。
// ★条件は関数1つに寄せる。リモコンの窓も「その物体が持っている量だけ」を出すのに
//   同じ判定を使うので、書き写すと「右パネルに無い欄がリモコンには出る」ことになる。
function bodyShowsDispersion(b) {
  // ★理想レンズに色収差は定義上ない（波長によらず同じ f）ので、分散の欄は出さない
  return !!b && b.ior > 1 && !b.reflective && !isIdealOptic(b);
}
function _syncDispersionRows(b) {
  const show = bodyShowsDispersion(b);
  document.getElementById('p-dispersion-row').style.display = show ? '' : 'none';
  document.getElementById('p-abbe-row').style.display       = show ? '' : 'none';
  document.getElementById('p-dispersion').checked = !!b.dispersion;
  setSliderDisabled('p-abbe', !b.dispersion, P_ABBE_OFF_MSG);
  if (b.dispersion) document.getElementById('p-abbe').title = P_ABBE_TITLE;
}
// 条件付きで出し入れする行（焦点距離・フレネル・波屈折率など）がすべて隠れたときに、
// 見出しと区切り線だけが取り残されないよう、グループごと隠す
function _hideEmptyPropGroups() {
  for (const g of document.querySelectorAll('#prop-form .prop-group')) {
    let any = false;
    for (const el of g.children) {
      if (el.classList.contains('prop-group-title')) continue;
      if (el.style.display !== 'none') { any = true; break; }
    }
    g.style.display = any ? '' : 'none';
  }
}
function updateLiveVelocityReadout() {
  if (selectedIds.size !== 1) return;
  if (document.getElementById('prop-form').style.display === 'none') return;
  const b = objects.find(o => selectedIds.has(o.id));
  if (!b) return;
  const setIfIdle = (id, val) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = val;
  };
  setIfIdle('p-av', b.fixedRotation ? '0.00' : b.av.toFixed(2));   // ★回転しない物体は常に0
  if (world.thermalOn) setIfIdle('p-temp', K2C(b.temp).toFixed(1));   // ★温度は動くので追従させる
  // ★気体の P・V・T は気体のパネル（updateLiveGasReadout）が受け持つ
  // ★スライダーを掴んでいる間は書き換えない（掴んでいる欄と奪い合いになるため）。
  //   速さ・向き・速度X・Yは互いに連動するので、4つまとめて同じ条件で扱う。
  if (!_sliderDragging) {
    const idle = id => document.activeElement !== document.getElementById(id);
    if (idle('p-speed') && idle('p-vdir') && idle('p-vx') && idle('p-vy')) {
      refreshVelocityFields();
      syncSliderById('p-speed'); syncSliderById('p-vdir');
      syncSliderById('p-vx'); syncSliderById('p-vy');
    }
    setIfIdle('p-angle', _dispDeg(b.angle).toFixed(1));            // 転がる物体の現在角を追従表示
    syncSliderById('p-angle');
    if (world.thermalOn) syncSliderById('p-temp');                 // ★温度は勝手に動くのでつまみも追わせる
  }
}
