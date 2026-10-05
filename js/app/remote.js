// ════════════════════════════════════════
//  リモコン（押している間だけ動力・モーターを効かせる）
// ════════════════════════════════════════
//  画面に貼り付く小さな窓を1つ置き、割り当てたキーを押している間（または窓のボタンを
//  押している間）だけ、つないだ動力またはモーターが働く。放せば止まる。
//  つまみ（'prop'）だけは押しボタンではなく、相手の設定をその場で変える1本のスライダー。
//
//  ★つなげる相手は「設定を持っているもの」すべて：物体・モーター（軸）・ヒンジ（外す・留め直す）・レーザー・
//    波源・ばね・電場磁場／加熱冷却／流れの領域・回路素子（電源の電圧・抵抗値・容量・
//    インダクタンスのつまみと、スイッチの入り切り）。相手の型は指した時点で決まり、
//    窓のプルダウンには**その相手にできること・その相手が持つ量だけ**が出る
//    （REMOTE_TARGET_SRC ／ remoteKindOptions ／ remoteKnobs）。
//
//  ★新しい力は作らない。**その物体・その軸がもともと持っている動力／モーターを、
//    いつ効かせるかを切り替えるだけ**。だから「見かけの力をエンジンに実装しない」にも
//    「プログラムは力のやりとりに触れない」にも触れずに済む。
//    ★例外は〈手で動かす〉（'drive'）1つだけで、そこだけは速さと向きをリモコンが持つ。
//      これは装置ではなく**人の手**だから：手はどの壁にも置ける＝固定した壁にも効く、
//      という一点がこの種類の存在理由で、固定した壁は定義上どんな動力も持てない。
//      持たせる先が物体側に無いので、窓が持つ。代わりに次の2つは必ず守る——
//      (1) 動かすのは**速度**であって座標ではない（molecule.js:323 の★。座標を書き換えて
//          動かした壁は分子に仕事をしない＝押し縮めても気体が温まらない）。
//      (2) 押している間は逆質量0の等速物体そのものになる（新しい運動方程式を足さない）。
//          ただし固定した物体には入り込めない（固定した物は手の命令より強い。
//          collision.js の blockHandAgainstFixed の★）。
//  ★プログラムとは役割が違う。プログラムは〈世界が自分で動く規則〉で、▶を押せば人が
//    居なくても起きる。リモコンは〈人が今この瞬間に手を出す道具〉で、押さなければ何も
//    起きない。だからトリガーの一種として足さず、別の道具にしてある。
//    仕掛けの上でも相容れない：プログラムのきっかけは全部「瞬間」（エッジ）で、
//    「押している間ずっと」という continuous な状態を持てない。
//    ★ただし 2026-09-27、ユーザーの判断で**合図（program.js の 'signal'）でリモコンを
//      入り切りできる**ようにした（sigOn／sigOff）。エレベーター・信号機のような
//      自動の装置を組むため。線引きはこう置き直す：プログラムは相変わらずモーターにも
//      動力にも直接は触らない。触るのはリモコン1つで、リモコンは「人の指」か「合図」の
//      どちらかで押される。合図は瞬間なので、リモコンの側が「入ったまま」を持つ（_sigOn）。
//      新しい力は相変わらず作らない（冒頭の★）。受けるのはモーターと動力だけ：
//      〈手で動かす〉は人の手そのものなので自動にしない。すり抜けはプログラムの
//      〈レイヤーを変える〉で書ける。
//    ★2026-09-30、ユーザーの判断で**回路のスイッチ（〈入り切り〉）も合図で入り切り**できる
//      ようにした。論理と記憶は回路（リレー）が受け持ち、合図は回路と仕掛けを「つなぐ」
//      役だけを持つ、という分担のため（逆向き＝回路から合図は program.js の 'current'）。
//      スイッチの開閉は力を作らないので、上の線引きには触れない。
//  ★回路とも役割が違う。モーターは回路チャンネル（motorCh）でも回せるが、それは
//    「電気の題材」。力学の題材で電気を持ち出さずに手で動かすための道具がこちら。
//  ★1つのリモコン＝1つのキー＝1つの向き。逆転させたいときは〈逆向きに効かせる〉に
//    したリモコンをもう1つ置く。1つの窓に2つのボタンを置くと窓が大きくなるうえ、
//    「押している間だけ」という単純な部品が複雑になる（同じ相手に2つ付けてよい）。
//  ★〈押している間だけ止める〉がある理由。ふつうは「押していない＝切」だが、
//    もともと動いている装置を人が一時的に切る、という使い方が要る（動き続けているのが
//    最初の姿で、切ったときに何が起きるかが読みどころ、という題材）。
//    現実のスイッチの a接点／b接点と同じ区別で、この場だけの特別扱いではない。
//    ★いまデモで使っているのは 'on' と 'rev' だけ（電車の振り子は 'off' から 'on' へ
//      移した）。使い手が居なくても、3つで1つの区別なのでモードは3つのまま残す。
//    3つとも「押している間は○○」という同じ形の1文なので、欄は1つで済んでいる。

// ★同時に置ける数（画面が埋まるので上限）。8 → 12（2026-09）：よろよろ走りのデモが両脚の股・ひざに
//   加えて両肩を Q/W に相乗りさせ、12台要るようになったため。
const REMOTE_MAX  = 12;
const REMOTE_COLOR = 'rgba(77,208,225,0.65)';   // つなぎ線（水色。プログラムの黄と分ける）

let remotes = [];
let remoteSeq = 0;

class Remote {
  constructor(o) {
    o = o || {};
    this.id = o.id !== undefined ? o.id : ++remoteSeq;
    if (o.id !== undefined && o.id > remoteSeq) remoteSeq = o.id;
    // 何を操るか。★保存形式なので値の名前は変えない。
    //   'thruster' 動力（Thruster ＝ 物体に何本でも付く。1本ずつ別のリモコンで操れる）／
    //   'motor'    モーター（axle ジョイントが持つ）
    //     …この2つは「押している間だけ」の押しボタン
    //   'drive'    押している間だけ、決めた速さ・向きで物体を動かす（固定した物体も動く）
    //   'prop'     物体の物理量をスライダーで変える（＝右パネルの1行を画面へ持ち出す）
    //   'ghost'    すり抜け（衝突レイヤーを全部切る）の**切替**
    //     …こちらは押しっぱなしにできない：仕切りを開けておく・物を退けておく、という
    //       使い方は「その状態が続く」ことに意味があるので、押すたびに切り替わる。
    //       ボタンとスイッチが1つの窓に同居するが、現実の操作盤と同じで、
    //       どちらなのかは窓の見た目（押している間光る／入ったまま光り続ける）で分かる。
    this.kind = o.kind || 'thruster';
    // つなぎ先の型。★保存形式。'body'／'joint'／要素の種類（'heatfield' ほか）。
    //   ★以前は型を持たず kind から入れ物を決めていた（motor なら joints、それ以外は
    //     objects）。そのため物体につないだ窓で種類を「モーターを回す」にすると、
    //     物体の id で軸を探して相手を見失い、しかも種類のプルダウンが disabled に
    //     なって二度と戻せなかった。型は「指した時点」で決まり、あとから変わらない。
    //   ★古いシーンには無いので、そのときだけ昔の規則（motor＝軸）で補う。
    this.targetType = o.targetType || (this.kind === 'motor' ? 'joint'
                                     : this.kind === 'thruster' ? 'thruster' : 'body');
    this.prop = o.prop || 'mass';   // 'prop' のときに動かす量（remoteKnobs の鍵）
    // つまみの範囲。★空なら PROP_SLIDERS の可動域をそのまま使う。
    //   共有の表は「その量が触って意味を持つ幅」（質量 0.1〜200kg など）で、
    //   題材で試したい幅はもっと狭いことがある（フィゾーの歯は 0.2〜1.4 m/s で、
    //   ±30 m/s の幅を 90px のつまみで刻むと 0.2 と 0.3 を打ち分けられない）。
    //   ここは「表の作り直し」ではなく「その窓の拡大率」。窓から手で変えられる。
    this.lo = o.lo;
    this.hi = o.hi;
    // 〈手で動かす〉の速さ [m/s] と向き [°]（画面の向き。0＝右・90＝上）。★保存形式。
    //   ★既定は 0.5 m/s。1 m/s だと 170px の窓につないだ壁が 1秒で画面を横切ってしまい、
    //     何が起きたのか見えない。0.5 なら「押した分だけ進む」が手に付いてくる。
    this.speed = o.speed !== undefined ? o.speed : 0.5;
    this.dir   = o.dir   !== undefined ? o.dir   : 0;
    // つなぎ先。★1台のリモコンは**複数の相手**を受け持てる。持ち方は「代表1つ＋ID集合」で、
    //   この系がプロパティの一括設定（bulk-select.js の applyToBulk）やエネルギーの窓
    //   （1窓＝N個）で使っているのと同じ形。代表は targetIds[0]＝窓の見出しと
    //   つまみの初期値を決める側で、効かせるのは targets() 全部。
    //   ★なぜ要るか：「2つのモーターを同時に回す」は**操作としては1つ**で、窓が2つに
    //     割れると独立した2つの操作に見える。しかも機械で埋め合わせようとすると、
    //     連結棒（デッドポイント）や冗長な拘束（機構が固まる）へ迷い込む。
    //   ★相手の型（targetType）は全員そろっていること。型が違うと触れる量が共通でなくなる。
    this.targetIds = o.targetIds ? o.targetIds.slice()
                   : (o.targetId !== undefined && o.targetId !== null ? [o.targetId] : []);
    // ★窓の位置は画面の割合で持つ（プログラムの窓と同じ理由：px だと別の大きさの窓で
    //   開いたとき画面の外へ出る）。
    this.fx = o.fx !== undefined ? o.fx : 0.055;
    this.fy = o.fy !== undefined ? o.fy : 0.62;
    // ★既定は →。押している間だけ進む、がいちばん多い使い方なので方向キーにする。
    //   Space（つかむ）と Z（実行／停止）は予約なので初期値にしない（プログラムと同じ）。
    this.key = o.key || 'ArrowRight';
    // 押している間どうするか。★保存形式なので値の名前は変えない。
    //   'on' 効かせる（押していなければ切）／'rev' 逆向きに効かせる／
    //   'off' 止める（押していなければ、いつもどおり効いている）
    //   ★'off' の「止める」は**切ることではない**。モーターには目標角速度0を命令する
    //     ＝ブレーキがかかる（joint.js 冒頭の★）。切るだけだと軸が自由になるので、
    //     摩擦の無いはずみ車は同じ速さで回り続け、ボタンが効いていないように見える。
    this.mode = o.mode || 'on';
    // ★畳んだ窓。畳んでも「何を・どのキーで」と押すボタン（つまみならスライダー）は残す
    //   ＝畳んだまま操作できる。隠すのは設定の欄だけ（プログラムの窓の collapsed と同じ）
    this.collapsed = !!o.collapsed;
    this.savedLayers = o.savedLayers;   // 'ghost' がすり抜けにする前のレイヤー
    this.savedStrength = o.savedStrength;   // 'ghost' が電場・磁場の領域を切る前の強さ
    this._on = false;        // 押している最中か。★保存しない（実行時の状態）
    // 合図で入れる／切る番号（0＝使わない）。★同じ番号なら合図のたびに入と切が入れ替わる。
    //   受けるのはモーターと動力と回路のスイッチだけ（冒頭の★）。
    this.sigOn  = Math.max(0, o.sigOn  | 0);
    this.sigOff = Math.max(0, o.sigOff | 0);
    this._sigOn = false;     // 合図で入っているか。★保存しない（シーンは実行前の姿）
  }
  // ★古い書き方（r.targetId）をそのまま通すための入口。中身は集合の先頭＝代表。
  get targetId() { return this.targetIds.length ? this.targetIds[0] : null; }
  set targetId(v) { this.targetIds = (v == null) ? [] : [v]; }
  // 生きている相手を全部。★消えた相手は黙って落とす（窓は閉じない。残りが居れば動く）
  targets() {
    const src = REMOTE_TARGET_SRC[this.targetType];
    if (!src) return [];
    const list = src(), out = [];
    for (const id of this.targetIds) {
      const t = list.find(o => o.id === id);
      if (t) out.push(t);
    }
    return out;
  }
  // 代表（窓の見出しとつまみの初期値を決める側）
  target() { return this.targets()[0] || null; }
  hasTarget(t) { return !!t && this.targetIds.includes(t.id); }
  // 効かせる向き。0＝効かせない／1＝そのまま／−1＝逆
  gate() {
    const on = this.pressed();
    if (this.mode === 'off') return on ? 0 : 1;   // 押している間だけ止める
    if (!on) return 0;
    return this.mode === 'rev' ? -1 : 1;
  }
  // 押されているか：人の指か、合図で入ったまま（sigOn の★）
  pressed() { return this._on || this._sigOn; }
  // 合図を受けられる種類か（回路のスイッチは冒頭の★ 2026-09-30）
  usesSignal() {
    // ★波源の〈波を出す〉も受ける（2026-10-03）：「○秒ごとに1発」「当たったら鳴らす」を
    //   プログラムの合図で組むため。押しボタンなので動力と同じく _sigOn で持つ。
    return this.kind === 'motor' || this.kind === 'thruster' || this.kind === 'emit'
        || this.isStateSwitch();
  }
  isCircuitSwitch() { return this.kind === 'ghost' && this.targetType === 'circuit'; }
  // ★入り切りの状態を相手そのものが覚えている切替（回路のスイッチ・ヒンジの留め外し）。
  //   合図で入り切りできるのはこの2つ（applyRemoteSignals）。ヒンジは 2026-10-01：
  //   プログラムから支点を掛け替えるため（吊り下げ法）。
  isStateSwitch() { return this.isCircuitSwitch() || (this.kind === 'ghost' && this.targetType === 'joint'); }
  // 「止めろ」と命令している最中か。★gate() の 0 には意味の違う2つが混ざる——
  //   「切（何も命令していない）」と「止めろ」。モーターはこの2つで振る舞いが変わる
  //   （切＝軸は自由に回る／止めろ＝目標角速度0を解く＝ブレーキ）。joint.js 冒頭の★。
  stops() { return this.mode === 'off' && this.pressed(); }
  // 押しボタンか（'ghost' だけが切替スイッチ）
  isPush() { return this.kind !== 'ghost'; }
  // キーを持つか。★つまみ（'prop'）は押す操作が無いので持たない。持たせておくと、
  //   窓にキー欄が出ていないのに既定の → を握ったままになり、そのキーが黙って
  //   食われる（ほかのリモコンにも割り当てられなくなる）。
  usesKey() { return this.kind !== 'prop'; }
}

// ════════════════════════════════════════
//  つなげる相手と、相手ごとに触れる量
// ════════════════════════════════════════
//  ★ここが唯一の表。窓のプルダウン・つまみの可動域・書き込み口は全部ここから引く。
//  ★入れ物は「その都度読む」（関数で包む）。シーンを読み込むと heatFields などは
//    新しい配列に差し替わるので、配列そのものを控えると古い方を見続ける。
const REMOTE_TARGET_SRC = {
  body:      () => objects,
  joint:     () => joints,
  thruster:  () => allThrusters(),   // ★動力は1本ずつ操れる（物体ではなくこれを指す）

  heatfield: () => heatFields,
  emfield:   () => emFields,
  flowfield: () => flowFields,
  laser:     () => lasers,
  wave:      () => waveSources,
  slinky:    () => slinkies,
  circuit:   () => circuitElements,   // ★回路素子（電源の電圧・抵抗値・容量／スイッチの入り切り）
  gas:       () => gasChambers,       // ★気体（定積・等温の入り切り。_gasSwitch の★）
};
function remoteTargetName(type, t) {
  if (!t) return 'なし';
  switch (type) {
    case 'body':      return t.label || '物体 ' + t.id;
    case 'joint':     return t.type === 'hinge' ? 'ヒンジ' : 'モーター';
    // ★同じ物体に何本も付くので、2本以上あるときだけ通し番号を出す（オブジェタブと同じ形）
    case 'thruster': {
      const b = t.body;
      const n = (b && b.thrusters.length > 1) ? ' ' + (b.thrusters.indexOf(t) + 1) : '';
      return '動力' + n + (b && b.label ? '（' + b.label + '）' : '');
    }
    case 'heatfield': return '加熱冷却の領域';   // ★出力の符号でつまみの途中に名前が変わらないように
    case 'emfield':   return t.kind === 'B' ? '磁場の領域' : '電場の領域';
    case 'flowfield': return '流れの場';
    case 'laser':     return 'レーザー';
    case 'wave':      return '波源';
    case 'slinky':    return 'ばね';
    case 'circuit':   return CIRCUIT_LABELS[t.type] || '回路素子';
    case 'gas':       return '気体';
  }
  return '相手';
}
// つなぎ線を引く先（相手の代表点）
function remoteTargetPos(type, t) {
  switch (type) {
    case 'body':     return { x: t.x, y: t.y };    // 重心（動力は別の型なのでここには来ない）
    case 'thruster': return t.worldPos();          // 力点
    case 'joint':  return t.getWorldAnchorA();
    case 'laser':
    case 'wave':   return t.getOrigin();
    case 'slinky': { const n = t.nodes[Math.floor(t.nodes.length/2)]; return { x:n.x, y:n.y }; }
    case 'circuit': return { x: (t.ax + t.bx) / 2, y: (t.ay + t.by) / 2 };   // 素子の中点
    case 'gas': {                                  // 気体の領域（四隅）の中心
      const c = t.corners();
      return { x: c.reduce((a, p) => a + p.x, 0) / c.length, y: c.reduce((a, p) => a + p.y, 0) / c.length };
    }
    default:       return { x: t.x, y: t.y };     // 矩形の領域は中心
  }
}
// その相手にできること（窓のいちばん上のプルダウン）。
//   ★「その相手ができることだけ」を出す。動力の付いていない物体に〈動力を効かせる〉を
//     出しても、押しても何も起きない窓ができるだけ。
//   ★ただし**いま選んでいるものは必ず残す**。候補から外れた瞬間に別のものへ乗り換えると、
//     つまみで動力を 0 にしただけで〈動力を効かせる〉の窓が黙って〈物理量を変える〉に
//     化ける。選択肢を消すのと、選んであるものを書き換えるのは別のこと。
const REMOTE_KIND_LABEL = { thruster:'動力を効かせる', motor:'モーターを回す',
                            drive:'手で動かす', prop:'設定を変える', ghost:'すり抜けにする',
                            emit:'波を出す・止める（押しボタン）' };
function remoteKindOptions(type, t, cur) {
  let out;
  // ★ヒンジは回す力も変わる量も持たないので〈外す・留め直す〉だけ（setHingeDetached）
  if (type === 'joint') out = (t && t.type === 'hinge') ? [['ghost','外す・留め直す']]
                                                       : [['motor','モーターを回す'], ['prop','設定を変える']];
  else if (type === 'thruster') out = [['thruster','動力を効かせる'], ['prop','設定を変える']];
  else if (type === 'body') {
    out = [];
    out.push(['drive','手で動かす']);         // ★固定した物体にも出す（それがこの種類の要）
    out.push(['prop','物理量を変える']);
    out.push(['ghost','すり抜けにする']);    // レイヤーを持つのは物体だけ
  } else if (type === 'emfield') {
    // ★領域の場は〈切る〉を持つ。物体の〈すり抜け〉と同じ「物理から見えなくする」切替で、
    //   場では強さ 0 がそれにあたる。電源のスイッチ（電源を外して導線でつなぐ）がこれ
    out = [['prop','設定を変える'], ['ghost','切る（入り切り）']];
  } else if (type === 'circuit') {
    // ★スイッチは入り切りだけ（つまみで変わる量を持たない）。場の〈切る〉と同じ切替で、
    //   押すたびに開閉する。ほかの素子はつまみだけ
    out = (t && t.type === 'switch') ? [['ghost','入り切り']] : [['prop','設定を変える']];
  } else if (type === 'gas') {
    // ★気体は2つの切替だけ（_gasSwitch の★）。値は「種類:どちらの切替か」で持つ
    out = [['ghost:lock','定積（ピストンを固定）'], ['ghost:iso','等温（恒温槽に浸ける）']];
  } else if (type === 'wave') {
    // ★波源は〈押している間だけ波を出す〉（2026-10-03）。動力の〈押している間だけ効かせる〉と
    //   同じ押しボタンで、新しい力も新しい量も作らない（決めた振動数・振幅で出すか出さないか
    //   だけ）。出し方の約束は field.js の waveSourceValue の★。
    //   ★名前に向きを入れない（出すか止めるかは下の〈押すと 効く／止まる〉で決まる）
    out = [['emit','波を出す・止める（押しボタン）'], ['prop','設定を変える']];
  } else out = [['prop','設定を変える']];    // 要素はつまみだけ
  if (cur && !out.some(o => o[0] === cur)) out.push([cur, REMOTE_KIND_LABEL[cur] || cur]);
  return out;
}
// ── 気体の切替 ─────────────────────────────────────────────
//   ★気体の状態変化は「定積か定圧か」と「等温か断熱か」の**独立した2つの切替**
//     （gas.js の setGasPistonLocked の上の★）。だから窓も2つに分け、1台＝1つの切替にする
//     （1台＝1つの操作、冒頭の★）。どちらの切替かは r.prop に 'lock'／'iso' で持つ
//     （つまみの量と同じ欄。気体はつまみを持たないので取り合わない）。
//   ★切ったときの姿：定積を切る＝ピストン自由＝定圧（荷重が一定なので仕掛けは要らない）。
//     等温を切る＝恒温槽から出す＝断熱（setGasThermal 'adiabatic' が壁との熱のやりとりも切る）。
//   ★右クリックの〈ピストンを固定〉〈恒温槽に浸ける〉と同じ関数を通す（入口が増えても扱いは同じ）。
function _gasSwitch(r) { return r.prop === 'iso' ? 'iso' : 'lock'; }
// 窓のプルダウンに入れる値（気体だけ「種類:切替」の形。remoteKindOptions の値と合わせる）
function remoteKindValue(r) {
  return (r.targetType === 'gas' && r.kind === 'ghost') ? 'ghost:' + _gasSwitch(r) : r.kind;
}
// 速さのつまみ：向きを保って大きさだけ書き換える
//   ★0 にすると向きが失われるので、動いているうちに向きを _speedDir へ控えておき、
//     0 から上げ直したときはその向きへ動かす（「さっきの向きに動き出す」）。控えは物理に
//     何も効かない（止まっている物体の速度は向きに依らず 0）。一度も動いたことのない
//     物体は右向き。
function _setBodySpeed(b, v) {
  const s = Math.max(0, parseFloat(v) || 0) * M2PX;
  const cur = Math.hypot(b.vx, b.vy);
  if (cur > 1e-6) b._speedDir = { x: b.vx / cur, y: b.vy / cur };
  const d = b._speedDir || { x: 1, y: 0 };
  b.vx = d.x * s; b.vy = d.y * s;
  projectGuideVelocity(b, false);
  b.sleeping = false; b.sleepTimer = 0;
}
// UI に見せる値 ⇄ 内部の値（物体のみ。速度は px/s・y下向き正で持っている）
function _remoteBodyRaw(b, prop) {
  if (prop === 'vx') return b.vx * PX2M;
  if (prop === 'vy') return yUI(b.vy) * PX2M;
  if (prop === 'av') return b.av;
  return b[prop];
}
// ── 相手ごとの「触れる量」──────────────────────────────────
//  ★可動域は右パネル・ツール窓と同じ定数から引く（数値を書き写さない）。
//  ★書き込みは相手を引数で受け取る。右パネルの setter（updateHeatFieldProp など）は
//    「いま選んでいるもの」に書く作りなので、リモコンからは呼べない。
//  ★出し入れの条件も右パネルに合わせる（熱を計算していないなら温度は出さない、など）。
//    ここだけ別の規則にすると「右パネルに無い欄がリモコンにはある」ことになる。
function remoteKnobs(type, t) {
  if (!t) return [];
  const K = (key, label, o) => Object.assign({ key, label }, o);
  switch (type) {
    // ★動力の推力は「0 のものにも」つまみを出す。0 から上げるつまみ（＝「引く力を
    //   だんだん強くして、いつ滑り出すか」）がこの道具のいちばん多い使い方で、
    //   いま 0 だからと隠すとその題材が組めなくなる（デモ3つが実際にこれ）。
    //   ★下限を 0 に固定しない。窓の範囲（r.lo）で負まで広げると、1本のつまみで
    //     押す／引くを切り替えられる（P-V の窓がこれを使う）。
    case 'thruster':
      return [K('force', '動力 [N]', { lo:0, hi:500, step:1,
        get: th => th.force,
        set: (th, v) => { th.force = v; if (th.body) { th.body.sleeping = false; th.body.sleepTimer = 0; } } })];
    case 'body': {
      const out = [];
      for (const k in PROP_SLIDERS) {
        if (k === 'temp' && !world.thermalOn) continue;            // 熱を計算していない
        if (k === 'abbe' && !bodyShowsDispersion(t)) continue;     // 右パネルと同じ条件
        const s = PROP_SLIDERS[k];
        out.push(K(k, s.label, { lo:s.lo, hi:s.hi, step:s.step, sig:s.sig, detent:s.detent,
          get: b => s.toUI ? s.toUI(_remoteBodyRaw(b, k)) : _remoteBodyRaw(b, k),
          set: (b, v) => applyBodyProp(b, k, s.fromUI ? s.fromUI(v) : v) }));
      }
      // ★速さ：向きを保って大きさだけ変える。速度X・Y のつまみでは、曲がりながら飛ぶ物体
      //   （磁場の中の荷電粒子）の途中で速さだけを変えられない（回すと向きが変わる）。
      //   右パネルには出さない（パネルは値を読む場所で、速度X・Y がそれを兼ねている）。
      out.push(K('speed', '速さ [m/s]', { lo:0, hi:PROP_SLIDERS.vx.hi, step:0.1,
        get: b => Math.hypot(b.vx, b.vy) * PX2M, set: _setBodySpeed }));
      // 屈折率だけは段が飛び飛び（0＝不透明の次が 1.05）なので表と別に持つ
      if (!isIdealOptic(t))
        out.push(K('ior', '屈折率 n', { ticks: IOR_TICKS,
          get: b => b.ior, set: (b, v) => applyBodyProp(b, 'ior', v) }));
      // ★波屈折率（2026-10-03）。右パネルと同じ条件＝〈波に対する扱い〉が媒質のときだけ出す
      //   （固定端・無反射の物体では n は使われない）。可動域も右パネルのスライダー
      //   （slider.js の p-waveior）と同じ 0.5〜3。1 をまたいで回すと「遅い媒質」と
      //   「速い媒質」が入れ替わる。
      //   ★書き込みは代入だけで足りる：waveGeoKey が waveIor を含むので、次の tick で
      //     格子が塗り直される（field.js の waveRasterize）。
      if (t.waveMode === 'medium')
        out.push(K('waveIor', '波屈折率 n', { lo:0.5, hi:3, step:0.05,
          get: b => b.waveIor, set: (b, v) => { b.waveIor = Math.max(0.5, Math.min(3, v)); } }));
      return out;
    }
    case 'joint': {
      if (t.type !== 'axle') return [];      // 回るのは軸だけ（ヒンジ・ロープには動力が無い）
      return [
        K('motorSpeed', '回転速度 [rad/s]', { lo:-50, hi:50, step:0.5,
          get: j => j.motorSpeed, set: (j, v) => { j.motorSpeed = v; } }),
        K('motorTorque', '最大トルク [N·m]', { lo:0, hi:5000, step:10,
          get: j => j.motorTorque, set: (j, v) => { j.motorTorque = Math.max(0, v); } }),
      ];
    }
    case 'heatfield':
      // ★出力は符号つき（正＝加熱・負＝冷却。heat-field.js の★）。1本のつまみで 0 をまたいで
      //   加熱⇔冷却を回せる（P-V 図のデモがこれを使う）。0 には吸着させる（detent）。
      return [K('power', '出力 [W]（−で冷却）',
        { lo:-HEATFIELD_POWER_MAX, hi:HEATFIELD_POWER_MAX, step:10, detent:HEATFIELD_DETENT_W,
          get: f => f.power, set: (f, v) => { f.power = v; } })];
    case 'emfield': {
      const rg = EMFIELD_STRENGTH_RANGE[t.kind];
      const out = [K('strength', t.kind === 'B' ? '強さ B [T]' : '強さ E [V/m]',
        { lo:0, hi:rg.hi, step:rg.step,
          get: f => f.strength, set: (f, v) => { f.strength = Math.max(0, v); } })];
      // 磁場の向きは紙面の表裏（2択）なのでつまみにならない。電場だけ角度を出す
      if (t.kind === 'E') {
        out.push(K('angle', '向き [°]', { lo:-180, hi:180, step:1,
          get: f => _dispDeg(f.angle), set: (f, v) => { f.angle = -v * Math.PI / 180; } }));
        // ★右パネルの振動数と同じ。0 へ戻したら位相も 0 へ（updateEMFieldProp と同じ規則）
        out.push(K('freq', '振動数 [Hz]', { lo:0, hi:EMFIELD_FREQ_MAX, step:EMFIELD_FREQ_STEP,
          get: f => f.freq, set: (f, v) => { f.freq = Math.max(0, v); if (f.freq === 0) f.acPhase = 0; } }));
      }
      return out;
    }
    case 'flowfield':
      return [
        K('speed', '流速 [m/s]', { lo:0, hi:FLOWFIELD_SPEED_MAX, step:0.5,
          get: f => f.speed, set: (f, v) => { f.speed = Math.max(0, v); } }),
        K('angle', '向き [°]', { lo:-180, hi:180, step:1,
          get: f => _dispDeg(f.angle), set: (f, v) => { f.angle = yUI(v * Math.PI / 180); } }),
      ];
    case 'laser': {
      const out = [K('angle', '向き [°]', { lo:-180, hi:180, step:1,
        get: L => _dispDeg(laserWorldAngle(L)),
        set: (L, v) => setLaserWorldAngle(L, -v * Math.PI / 180) })];
      // 白色光はプリセット全色を同時に出すので波長を持たない（右パネルと同じ）
      if (!t.whiteLight)
        out.push(K('wavelength', '波長 [nm]', { lo:380, hi:780, step:1,
          get: L => L.wavelength,
          set: (L, v) => { L.wavelength = Math.max(380, Math.min(780, v));
                           L.color = wavelengthToHex(L.wavelength); } }));
      return out;
    }
    case 'wave':
      return [
        K('freq', '振動数 f [Hz]', { lo:0.05, hi:5, step:0.05,
          get: s => s.freq, set: (s, v) => { s.freq = Math.max(0.05, Math.min(5, v)); } }),
        K('amp', '振幅 A', { lo:0, hi:5, step:0.05,
          get: s => s.amp, set: (s, v) => { s.amp = Math.max(0, Math.min(5, v)); } }),
        // ★位相（2026-10-03）。内部は rad（WaveSource.phase）、窓は度。0〜360 にして
        //   180 を真ん中に置く（干渉の「同位相⇔逆位相」がつまみの両端と真ん中に来る）。
        //   ★回した瞬間、注入する値が A·sin の段差ぶん跳ぶ。1°刻みなら段差は A の 1.7% で、
        //     ふつうに回すぶんには目に見える波は立たない。
        K('phase', '位相 φ [°]', { lo:0, hi:360, step:1,
          get: s => ((s.phase * 180 / Math.PI) % 360 + 360) % 360,
          set: (s, v) => { s.phase = Math.max(0, Math.min(360, v)) * Math.PI / 180; } }),
      ];
    case 'slinky':
      return [K('springK', 'ばね定数 k [N/m]', { lo:1, hi:1000, step:1,
        get: S => S.springK(), set: (S, v) => { _setSlinkyK(S, Math.max(0.001, v)); S._sync(); } })];
    case 'circuit': {
      // ★右パネルと同じ量・同じ可動域（CIRCUIT_KNOB_RANGE）。値が飛ぶ＝不連続なので、
      //   右パネルの updateCircuitProp と同じく次の1ステップを後退オイラーで踏ませる。
      //   ★容量だけは mF で見せる。窓の数字は小数2桁なので、F のままだと 2mF が 0.00 になる。
      const KR = CIRCUIT_KNOB_RANGE;
      const put = (k, f) => (e, v) => { e[k] = f(v); markCircuitDiscontinuity(); };
      switch (t.type) {
        case 'dcsource': case 'acsource': {
          const out = [K('V', t.type === 'acsource' ? '振幅 V [V]' : '電圧 V [V]',
            { lo:KR.V.lo, hi:KR.V.hi, step:KR.V.step, detent:KR.V.detent, get: e => e.V, set: put('V', v => v) })];
          // ★交流は振動数も回せる（リアクタンス ωL・1/ωC と共振の題材の主役）。位相は
          //   acSourceTheta が引き継ぐので、回しても電圧は跳ねない。0 は回転の止まった発電機
          //   （その瞬間の電圧のまま＝直流）
          if (t.type === 'acsource')
            out.push(K('freq', '振動数 f [Hz]', { lo:0, hi:20, step:0.01,
              get: e => e.freq, set: put('freq', v => Math.max(0, v)) }));
          return out;
        }
        case 'resistor':
          return [K('R', '抵抗 R [Ω]', { lo:KR.R.lo, hi:KR.R.hi, step:KR.R.step, sig:true,
            get: e => e.R, set: put('R', v => Math.max(KR.R.lo, v)) })];
        // ★電流計の内部抵抗。右パネルの c-ar と同じ量で、0 ＝ 理想の電流計まで下げられる
        //   （抵抗の下限 KR.R.lo は掛けない）。分流器のデモで rA ≪ R の条件を回して見せる
        case 'ammeter':
          return [K('r', '内部抵抗 r [Ω]', { lo:0, hi:KR.R.hi, step:KR.R.step, sig:true,
            get: e => e.r || 0, set: put('r', v => Math.max(0, v)) })];
        // ★電圧計の内部抵抗。右パネルの c-Rv と同じ量。既定 10MΩ まで回せるよう上限は 1e7、
        //   下限は解く側の床 VOLTMETER_R_MIN。倍率器のデモで rV ≫ R の条件を回して見せる
        case 'voltmeter':
          return [K('R', '内部抵抗 R [Ω]', { lo:VOLTMETER_R_MIN, hi:1e7, step:KR.R.step, sig:true,
            get: e => _voltmeterR(e), set: put('R', v => Math.max(VOLTMETER_R_MIN, v)) })];
        // ★すべり抵抗の接点は長さ AP [cm] で回す（電位差計で読む量そのもの）。持つのは割合 pos なので
        //   上限は抵抗線の全長。全体の抵抗も回せる
        case 'slidewire': {
          const Lc = Math.max(1e-9, slideWireLen(t));
          return [
            K('pos', '接点の位置 AP [cm]', { lo:0, hi:+Lc.toFixed(1), step:0.1,
              get: e => slideWirePos(e) * slideWireLen(e),
              set: put('pos', v => Math.max(0, Math.min(1, v / Math.max(1e-9, slideWireLen(t))))) }),
            K('R', '抵抗 R [Ω]', { lo:KR.R.lo, hi:KR.R.hi, step:KR.R.step, sig:true,
              get: e => e.R, set: put('R', v => Math.max(KR.R.lo, v)) }),
          ];
        }
        case 'capacitor':
          return [K('C', '容量 C [mF]', { lo:KR.C.lo * 1e3, hi:KR.C.hi * 1e3, step:0.01, sig:true,
            get: e => e.C * 1e3, set: put('C', v => Math.max(KR.C.lo, v * 1e-3)) })];
        case 'inductor':
          return [K('L', '自己インダクタンス L [H]', { lo:KR.L.lo, hi:KR.L.hi, step:KR.L.step, sig:true,
            get: e => e.L, set: put('L', v => Math.max(KR.L.lo, v)) })];
      }
      return [];
    }
  }
  return [];
}
function remoteKnob(r) {
  const knobs = remoteKnobs(r.targetType, r.target());
  return knobs.find(k => k.key === r.prop) || knobs[0] || null;
}
// 相手に無い量を選んだままにしない（相手の状態が変わって量が消えることがある）
function ensureRemoteProp(r) {
  const knobs = remoteKnobs(r.targetType, r.target());
  if (!knobs.length) return;
  if (!knobs.some(k => k.key === r.prop)) { r.prop = knobs[0].key; r.lo = r.hi = undefined; }
}
// リモコンで書き換えた相手が右パネルに出ているなら、そちらも合わせる
//   （同じ値の2枚看板を作らない。右パネルと窓で違う数字が出ているのがいちばん困る）
const _REMOTE_PANEL_REFRESH = {
  heatfield: f => updateHeatFieldPanel(f), emfield: f => updateEMFieldPanel(f),
  flowfield: f => updateFlowFieldPanel(f), laser:  L => updateLaserPanel(L),
  wave:      s => updateWavePanel(s),      slinky: S => updateSlinkyPanel(S),
};
function _remoteRefreshOtherPanels(type, t) {
  if (type === 'body')  { if (selectedIds.has(t.id)) { updatePropsPanel(t); syncSliders(); } return; }
  if (type === 'joint') { if (selectedJointId === t.id) { updateJointPanel(t); syncSliders(); } return; }
  if (type === 'circuit') { if (selectedCircuit === t) updateCircuitPanel(t); return; }
  const e = selectedElement;
  const same = e && (e.field === t || e.laser === t || e.source === t || e.slinky === t);
  if (same && _REMOTE_PANEL_REFRESH[type]) { _REMOTE_PANEL_REFRESH[type](t); syncSliders(); }
}

// ── すり抜け（切替）─────────────────────────────────────────
//   ★レイヤーを 0 にすると、この engine では「物理から見えない物体」になる
//     （collision.js の _ghostBody の★：当たらない・光も水も気体分子も透過する）。
//     ここで新しい概念は作らず、既にある1つの状態へ入れるだけにしてある。
//   ★消えはしない。ゴーストは黄色い破線の輪郭で描かれ続ける（render/body.js）。
//     仕切りなら「無くなった」ではなく「開いている」が見える＝そのほうが正しい。
//   ★元の値はリモコンが預かる（保存もする）。レイヤーは衝突・光・水・分子の6か所から
//     直に読まれていて、動力のようにゲート1つでは切れないため、値そのものを
//     入れ替える方式にした。★書くのは切り替えた瞬間だけ＝すり抜けていない間は
//     右パネルからふつうにレイヤーを編集できる。
//   ★相手が複数のときは**代表の状態でそろえて切り替える**。1つずつ自分の状態を反転
//     させると、ずれたまま二度とそろわない（片方だけすり抜けている状態が残る）。
//     預かる元の値も代表のぶんだけ持つ：レイヤーの違う物体を1つの窓でまとめて
//     すり抜けさせたときは、戻すと全員が代表の値になる。
// ★電場・磁場の領域では「強さ 0」がすり抜けにあたる（_remoteIsOff）。元の強さは
//   リモコンが預かる。切っている間に〈設定を変える〉のつまみで強さを上げたら、
//   それは「入った」と読む（状態は預かった印ではなく、相手の値から導く）。
function _remoteIsOff(r, t) {
  if (!t) return false;
  if (r.targetType === 'circuit') return !t.closed;   // スイッチは「開いている」が切
  if (r.targetType === 'joint')   return !!t.detached;   // ヒンジは「外してある」が切
  if (r.targetType === 'gas')     return _gasSwitch(r) === 'iso' ? t.thermostat == null : !t.pistonLocked;
  return r.targetType === 'emfield' ? t.strength === 0 : t.layers === 0;
}
function toggleRemoteGhost(r) {
  const ts = r.targets();
  if (!ts.length) return;
  if (r.targetType === 'circuit') {
    // ★回路のスイッチ。右パネルの「閉じる」と同じ状態を切り替え、同じく不連続の印を付ける
    //   （過渡のトリガにもなる＝グラフの捕捉がここから始まる）。代表の状態でそろえる
    const close = !ts[0].closed;
    for (const t of ts) if (t.type === 'switch') t.closed = close;
    markCircuitDiscontinuity();
    for (const t of ts) _remoteRefreshOtherPanels('circuit', t);
    syncAllRemotePanels();
    return;
  }
  if (r.targetType === 'joint') {
    // ★ヒンジを外す・留め直す。代表の状態でそろえる（回路のスイッチと同じ）
    const off = !ts[0].detached;
    for (const t of ts) setHingeDetached(t, off);
    syncAllRemotePanels();
    return;
  }
  if (r.targetType === 'gas') {
    // ★代表の状態でそろえる（回路のスイッチと同じ）。右パネルが出ていればそちらも合わせる
    const on = _remoteIsOff(r, ts[0]);
    for (const t of ts) {
      if (_gasSwitch(r) === 'iso') setGasThermal(t, on ? 'isothermal' : 'adiabatic');
      else setGasPistonLocked(t, on);
      if (selectedElement && selectedElement.kind === 'gas' && selectedElement.chamber === t) updateGasPanel(t);
    }
    wakeAll();               // ★固定を外した蓋が眠ったままだと、定圧に戻っても動き出さない
    syncAllRemotePanels();
    return;
  }
  if (r.targetType === 'emfield') {
    if (ts[0].strength === 0) {
      const back = r.savedStrength > 0 ? r.savedStrength : 1;
      for (const t of ts) t.strength = back;
    } else {
      r.savedStrength = ts[0].strength;
      for (const t of ts) t.strength = 0;
    }
    wakeAll();
    syncAllRemotePanels();   // ★同じ領域につないだつまみの窓も、値が変わったので出し直す
    return;
  }
  const on = ts[0].layers === 0;              // 代表がすり抜けているか
  if (on) {
    const back = (r.savedLayers === undefined || r.savedLayers === 0) ? LAYER_DEFAULT : r.savedLayers;
    for (const t of ts) t.layers = back;
  } else {
    r.savedLayers = ts[0].layers;
    for (const t of ts) t.layers = 0;
  }
  for (const t of ts) { t.sleeping = false; t.sleepTimer = 0; }
  wakeAll();          // ★すり抜けが変わると、隣で眠っていた物体の前提も変わる
  syncRemotePanel(r);
}

// ── 毎 tick、相手に「いま効かせるか」を書き込む ───────────────────
//   ★simTick の頭で1回だけ呼ぶ（サブステップの中ではない）。押しているかどうかは
//     人の操作なので、サブステップごとに変わることはない。
//   ★印は相手側の `_remoteHold`（0/1/−1）。付いていない相手は undefined のままで、
//     body.js / joint.js は undefined を「リモコンなし＝いつもどおり」と読む。
let _remoteMarked = new Set();
function applyRemotes() {
  applyRemoteSignals();
  // 前の tick に印を付けた相手から先に消す。★これが無いと、リモコンを外したあとも
  //   0 が残り続けて、その動力が二度と効かなくなる。
  for (const t of _remoteMarked) { delete t._remoteHold; delete t._remoteStop; }
  _remoteMarked.clear();
  for (const r of remotes) {
    if (!r.isPush() || r.kind === 'prop') continue;   // 切替・スライダーは tick に関係しない
    if (r.kind === 'drive') continue;                 // ★印ではなく速度を書く（applyRemoteDrives）
    const g = r.gate();
    // ★押した／放した瞬間は相手を起こす。眠りは速度を 0 にするので、眠ったままの相手は
    //   キーを押しても動き出せない（〈すり抜け〉と〈手で動かす〉が切り替わる瞬間に
    //   wakeAll を呼んでいるのと同じ理由。ここは相手だけで足りる）。
    const changed = (g !== r._lastGate);
    r._lastGate = g;
    for (const t of r.targets()) {                    // ★1台が複数の相手を受け持つ
      // ★同じ相手に正転と逆転を付けたときは「押されているほう」が勝つ（両方押したら先勝ち）
      if (t._remoteHold === undefined || t._remoteHold === 0) t._remoteHold = g;
      if (r.stops()) t._remoteStop = true;            // 「止めろ」は誰か1台が言えば立つ
      _remoteMarked.add(t);
      if (changed) _wakeRemoteTarget(r.targetType, t);
    }
  }
  applyRemoteDrives();
}
// 合図を受ける。★届いた合図は progSigNext（program.js）。プログラムがそれを受けるのは
//   この tick の終わりの updatePrograms なので、リモコンもプログラムも「出た次の tick」に
//   受けることになる（program.js の 'signal' の★）。
//   ★入と切が同じ tick に来たら切が勝つ（止まる側に倒す）。同じ番号なら入れ替え。
function applyRemoteSignals() {
  if (!progSigNext.size) return;
  let any = false;
  for (const r of remotes) {
    if (!r.usesSignal() || (!r.sigOn && !r.sigOff)) continue;
    // ★回路のスイッチは「押したまま」を持たず、スイッチの開閉そのものを書き換える
    //   （手で〈入れる〉を押したのと同じ状態。入ったまま・切れたままはスイッチが覚えている）。
    //   規則は下と同じ：同じ番号なら入れ替え、入と切が同じ tick に来たら切が勝つ。
    // ★ヒンジも同じ形（入＝留める／切＝外す。状態はヒンジが覚えている）
    if (r.isStateSwitch() && r.targetType === 'joint') {
      const ts = r.targets().filter(t => t.type === 'hinge');
      if (!ts.length) continue;
      let on = !ts[0].detached;
      if (r.sigOn && r.sigOn === r.sigOff) { if (progSigNext.has(r.sigOn)) on = !on; }
      else {
        if (r.sigOn  && progSigNext.has(r.sigOn))  on = true;
        if (r.sigOff && progSigNext.has(r.sigOff)) on = false;
      }
      if (ts.every(t => t.detached === !on)) continue;
      for (const t of ts) setHingeDetached(t, !on);
      any = true;
      continue;
    }
    if (r.isCircuitSwitch()) {
      const ts = r.targets().filter(t => t.type === 'switch');
      if (!ts.length) continue;
      let close = ts[0].closed;
      if (r.sigOn && r.sigOn === r.sigOff) { if (progSigNext.has(r.sigOn)) close = !close; }
      else {
        if (r.sigOn  && progSigNext.has(r.sigOn))  close = true;
        if (r.sigOff && progSigNext.has(r.sigOff)) close = false;
      }
      if (ts.every(t => t.closed === close)) continue;
      for (const t of ts) t.closed = close;
      markCircuitDiscontinuity();          // ★手で切り替えたときと同じ印（toggleRemoteGhost）
      for (const t of ts) _remoteRefreshOtherPanels('circuit', t);
      any = true;
      continue;
    }
    const was = r._sigOn;
    if (r.sigOn && r.sigOn === r.sigOff) { if (progSigNext.has(r.sigOn)) r._sigOn = !r._sigOn; }
    else {
      if (r.sigOn  && progSigNext.has(r.sigOn))  r._sigOn = true;
      if (r.sigOff && progSigNext.has(r.sigOff)) r._sigOn = false;
    }
    if (r._sigOn !== was) any = true;
  }
  if (any) syncAllRemotePanels();
}
// 相手が消えた／リモコンを外したときに印を残さない
function _clearRemoteMark(t) {
  if (t && t._remoteHold !== undefined) {
    delete t._remoteHold; delete t._remoteStop; _remoteMarked.delete(t);
  }
}
// 相手（物体・モーター）を起こす。★モーターの相手は軸そのものではなく、その両端の物体。
function _wakeRemoteTarget(type, t) {
  if (type === 'joint') {
    for (const b of [t.bodyA, t.bodyB])
      if (b && !b.isStatic) { b.sleeping = false; b.sleepTimer = 0; }
  } else if (type === 'thruster') {
    if (t.body) { t.body.sleeping = false; t.body.sleepTimer = 0; }
  } else if (type === 'body') {
    t.sleeping = false; t.sleepTimer = 0;
  }
}

// ── 手で動かす ───────────────────────────────────────────
//   ★ここだけは印（_remoteHold）ではなく**速度そのもの**を書き込む。壁の表面速度は
//     分子・水・接触ソルバが b.vx を直に読んでいて（molecule.js:323 の★）、印を立てて
//     別の場所で動かすと「動いているのに仕事をしない壁」になる。座標を書き換えて
//     動かすのが駄目なのも同じ理由で、その壁で押し縮めた気体は温まらない。
//   ★押している間は逆質量0にする＝押し負けない（constVel とまったく同じ状態へ入れる。
//     integrate もその一本道を通る）。手で押しているのだから、相手に押し返されて
//     速さが変わるほうがおかしい。
//   ★放したらその場で止める（速度を 0 にする）。台車から手を離す setConstVel とは逆だが、
//     こちらは「手」なので、放した壁が滑っていくほうが嘘になる。
//   ★回すのは受け持たない（av は 0 に伏せる）。回すのはモーターの仕事で、2つの道具が
//     同じことをできると、どちらで組んだかで見え方が変わる。
let _remoteDriven = new Set();
function applyRemoteDrives() {
  const now = new Set();
  for (const r of remotes) {
    if (r.kind !== 'drive') continue;
    const g = r.gate();
    if (!g) continue;
    const a = -r.dir * Math.PI / 180;  // 窓の向きは画面の向き（y 上向きが正）
    const v = r.speed * M2PX * g;      // [px/s]。g が −1 なら逆向き
    // ★相手が複数でも、全員に**同じ速度**を書く（向きと速さは窓が持つ）。相対位置は
    //   変わらないので、まとめて押すと1つの剛体のように平行移動する。
    for (const t of r.targets()) {
      // ★同じ相手に2つ付いていたら先に見たほうが勝つ（_remoteHold と同じ約束）
      if (now.has(t)) continue;
      if (!t._remoteDrive) wakeAll();  // 動き出す瞬間だけ、周りで眠っているものを起こす
      t._remoteDrive = g;
      t.invMass = 0; t.invInertia = 0; // ★上の★。放すと setMass() が宣言どおりに戻す
      t.vx = Math.cos(a) * v; t.vy = Math.sin(a) * v; t.av = 0;
      t.sleeping = false; t.sleepTimer = 0;
      now.add(t);
    }
  }
  for (const t of _remoteDriven) if (!now.has(t)) _stopRemoteDrive(t);
  _remoteDriven = now;
}
//   ★「押していない」だけでなく、リモコンを消した・シーンを読み込んだ・実行を止めた
//     でも必ずここを通す。通らないと逆質量0のまま取り残され、固定していない物体が
//     二度と力を受け付けなくなる。
function _stopRemoteDrive(t) {
  delete t._remoteDrive;
  t.vx = 0; t.vy = 0; t.av = 0;
  t.setMass(t.mass);                   // 逆質量・慣性モーメントを isStatic/constVel から作り直す
}

// ── キー ────────────────────────────────────────────────
//   keyboard.js から呼ぶ。押している間ずっと（keydown の自動リピートも来るが、
//   状態を立てるだけなので何度来ても同じ）。
//   ★repeat は「切替」にとって致命的なので受け取って弾く。押しっぱなしにすると
//     キーの自動リピートが毎秒何十回も届き、すり抜けが猛烈に点滅する。
//     押しボタンのほうは何度来ても状態が同じなので気にしなくてよい。
// ★止めているときに押したら実行を始める（2026-10-03、ユーザーの判断）。止めたまま押しても
//   何も起きない（〈手で動かす〉も動力も tick が来ないと効かない）ので、押した＝動かしたい。
//   ★押した効果より**先に** simPlay する。simPlay がリセットの戻り先（savedState）を控えるので、
//     後ろにすると〈すり抜け〉の切替が「実行前の姿」に混ざる。
//   ★つまみ（'prop'）は対象外。止めたまま値を合わせるのは右パネルと同じ「準備」の操作。
function _remoteStartSim() { if (!running) simPlay(); }
function remoteKeyDown(code, repeat) {
  let any = false;
  for (const r of remotes) {
    if (r.key !== code || !r.usesKey()) continue;
    if (!any) _remoteStartSim();
    any = true;
    if (r.kind === 'ghost') { if (!repeat) toggleRemoteGhost(r); }
    else r._on = true;
  }
  if (any) syncAllRemotePanels();
  return any;
}
function remoteKeyUp(code) {
  let any = false;
  for (const r of remotes) if (r.key === code && r.usesKey() && r.isPush()) { r._on = false; any = true; }
  // ★放したことを simTick 待ちにしない。止めているあいだに放すと次の tick が来ないので、
  //   〈手で動かす〉が逆質量0のまま取り残される
  if (any) { applyRemoteDrives(); syncAllRemotePanels(); }
  return any;
}
// ★窓の外でキーを放した・別のウィンドウへ移った・実行を止めた——どれでも必ず放す。
//   これが無いと「押しっぱなし」のまま戻ってきて、勝手に走り続ける。
function releaseAllRemotes() {
  let any = false;
  for (const r of remotes) if (r._on) { r._on = false; any = true; }
  applyRemoteDrives();        // ★上と同じ（止めた瞬間に手を離す）
  if (any) syncAllRemotePanels();
}

// ── 置く・消す ───────────────────────────────────────────
//   相手は置いたときに決まり、あとから変えない（別の物につなぎ直したいなら置き直す＝
//   プログラムが物体につなぎっぱなしなのと同じ流儀）。何をするか（kind）は窓で変えられる。
//   ★type は省略できる（デモからの呼び出しがすべて物体か軸なので、昔の規則で補う）。
// その場所で指せる相手と、そこに置くならどの種類で開くか。
//   ★見る順序は選択とそろえる：モーター（軸）→ 要素 → 物体 → 矩形の領域。
//     軸は物体の上に重なっていて、要素も物体の上に重なっていることが多いので、
//     物体を先に拾うと永久に指せないものが出る。
//   ★置くとき（道具）も足すとき（窓の＋）も**この1つを通す**。2つ書くと必ず
//     片方だけ直すことになる（選択の3経路の★と同じ）。
function remotePickAt(wp) {
  const j = jointAtPoint(wp.x, wp.y);
  if (j && j.type === 'axle') return { kind:'motor', target:j, type:'joint' };
  if (j && j.type === 'hinge') return { kind:'ghost', target:j, type:'joint' };
  const el = pickElement(wp.x, wp.y);
  if (el) {
    if (el.kind === 'laser')    return { kind:'prop',     target:el.laser,  type:'laser'  };
    if (el.kind === 'wave')     return { kind:'prop',     target:el.source, type:'wave'   };
    if (el.kind === 'slinky')   return { kind:'prop',     target:el.slinky, type:'slinky' };
    // ★動力は**その1本**を指す（物体ではない）。何本も付くので、物体を指すと
    //   どれを操る窓なのか決まらない。噴射口のアイコンを指して選ぶ。
    if (el.kind === 'thruster') return { kind:'thruster', target:el.thr,    type:'thruster' };
  }
  // ★回路素子は物体の上に描かれるので、物体より先に見る（領域より先なのも同じ理由）。
  //   スイッチは入り切り、つまみで変わる量を持つ素子はつまみ。導線や計器は指せない。
  const ce = circuitAtPoint(wp.x, wp.y);
  if (ce) {
    if (ce.type === 'switch') return { kind:'ghost', target:ce, type:'circuit' };
    if (remoteKnobs('circuit', ce).length) return { kind:'prop', target:ce, type:'circuit' };
  }
  // ★気体は器と蓋（物体）の内側にあるので、物体より先に見る（選択の ①-b と同じ順）
  const gch = gasChamberAtPoint(wp.x, wp.y);
  if (gch) return { kind:'ghost', target:gch, type:'gas' };
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (!o.containsPoint(wp.x, wp.y)) continue;
    // ★動力が1本だけ付いていれば、その動力を操る窓で開く（アイコンを外して物体の上を
    //   指しても、いちばん多い意図はこれ）。2本以上あるときはどれとも決められないので
    //   物体のつまみで開く——アイコンを指せば1本を選べる。
    //   ★固定した物体だけは〈手で動かす〉で開く。動力を持てず（持っても動かない）、
    //     つまみで変わる量もほとんど効かないので、固定した物体にリモコンを付ける人は
    //     まず「動かしたい」人である。
    if (o.thrusters.length === 1)
      return { kind:'thruster', target:o.thrusters[0], type:'thruster' };
    return { kind: o.isStatic ? 'drive' : 'prop', target:o, type:'body' };
  }
  const ef = emFieldAtPoint(wp.x, wp.y);   if (ef) return { kind:'prop', target:ef, type:'emfield'   };
  const hf = heatFieldAtPoint(wp.x, wp.y); if (hf) return { kind:'prop', target:hf, type:'heatfield' };
  const ff = flowFieldAtPoint(wp.x, wp.y); if (ff) return { kind:'prop', target:ff, type:'flowfield' };
  return null;
}

// ── 相手を増やす・減らす ─────────────────────────────────────
//   ★経路は2つとも同じ関数を通す：①道具で複数まとめて置く／②窓の「＋」で足す。
//     2つ書くと必ず片方だけ直すことになる（選択の3経路の★と同じ）。
//   ★型が違う相手は足せない。触れる量（remoteKnobs）が相手の型で決まるので、
//     混ぜるとつまみが「誰の値なのか」決まらなくなる。
function remoteToggleTarget(r, t, type) {
  if (!r || !t) return false;
  if (type !== r.targetType) {
    flashHint('このリモコンは「' + remoteTargetName(r.targetType, r.target()) + '」と同じ種類にだけつなげます');
    return false;
  }
  const at = r.targetIds.indexOf(t.id);
  if (at >= 0) {
    // ★最後の1つは外せない（相手のいない窓は何をする窓なのか決まらない）
    if (r.targetIds.length <= 1) { flashHint('相手が1つだけのときは外せません（窓を ✕ で閉じてください）'); return false; }
    pushUndo();
    r.targetIds.splice(at, 1);
    _clearRemoteMark(t);
    applyRemoteDrives();            // ★外した相手を握ったままにしない
  } else {
    pushUndo();
    r.targetIds.push(t.id);
  }
  syncRemotePanel(r);
  return true;
}
// 窓の「＋」で待ち受け中のリモコン（null なら待っていない）
let remoteAddFor = null;
function armRemoteAdd(r) {
  remoteAddFor = (remoteAddFor === r) ? null : r;
  for (const x of remotes) syncRemotePanel(x);
}
// ① 道具で置くとき、一緒に受け持つ仲間の ID。★選び方は一括設定と同じ経路を通す
//    （物体は selectedIds、それ以外は bulkPeers＝applyToBulk が配る先とそろえる）
function remotePeerIds(type, t) {
  const ids = [t.id];
  if (type === 'body') {
    if (selectedIds.has(t.id)) for (const id of selectedIds) if (id !== t.id) ids.push(id);
  }
  for (const o of bulkPeers(type, t)) if (!ids.includes(o.id)) ids.push(o.id);
  return ids;
}
function addRemote(kind, target, type, ids) {
  if (remotes.length >= REMOTE_MAX) {
    appAlert('リモコン', '同時に置けるのは<b>' + REMOTE_MAX + '個</b>までです。'
           + '<div class="am-note">要らない窓を ✕ で閉じてください。</div>');
    return null;
  }
  pushUndo();
  // ★窓は左下から縦に積む。プログラムの窓（右上）とぶつからない側で、
  //   説明文（左上・幅500px）の下でもある。
  const r = new Remote({ kind,
                         targetIds: (ids && ids.length) ? ids : [target.id],
                         targetType: type || (kind === 'motor' ? 'joint'
                                            : kind === 'thruster' ? 'thruster' : 'body'),
                         fy: 0.62 - (remotes.length % 4) * 0.085 });
  ensureRemoteProp(r);          // その相手にある量を初期値にする（物体以外は 'mass' が無い）
  remotes.push(r);
  buildRemotePanel(r);
  return r;
}
function removeRemote(r) {
  if (remoteAddFor === r) remoteAddFor = null;   // ★待ち受けたまま窓を閉じさせない
  const i = remotes.indexOf(r);
  if (i >= 0) { pushUndo(); remotes.splice(i, 1); }
  for (const t of r.targets()) _clearRemoteMark(t);
  applyRemoteDrives();        // ★消したリモコンが押していた相手を止める
  if (r.panel) r.panel.remove();
}
function clearRemotes() {
  remoteAddFor = null;
  for (const r of remotes) { for (const t of r.targets()) _clearRemoteMark(t); if (r.panel) r.panel.remove(); }
  remotes = [];
  applyRemoteDrives();
}

// ── 保存・復元 ───────────────────────────────────────────
//   ★押している最中かどうかは保存しない（シーンは「実行前の姿」。開いた瞬間に
//     アクセルが踏まれている状態から始まったら、配った人と開いた人で見えるものが変わる）。
function serializeRemote(r) {
  return { id: r.id, kind: r.kind, targetType: r.targetType, targetIds: r.targetIds.slice(),
           prop: r.prop, lo: r.lo, hi: r.hi, speed: r.speed, dir: r.dir,
           fx: r.fx, fy: r.fy, key: r.key, mode: r.mode, collapsed: r.collapsed,
           sigOn: r.sigOn, sigOff: r.sigOff,
           savedLayers: r.savedLayers, savedStrength: r.savedStrength };   // ★すり抜け中に保存されたら、戻す先はここにしかない
}
function deserializeRemotes(arr) {
  remoteAddFor = null;
  for (const r of remotes) { for (const t of r.targets()) _clearRemoteMark(t); if (r.panel) r.panel.remove(); }
  for (const t of _remoteDriven) _stopRemoteDrive(t);   // ★前のシーンの物体を握ったままにしない
  _remoteDriven = new Set();
  remotes = (arr || []).map(d => new Remote(d));
  for (const r of remotes) buildRemotePanel(r);
  return remotes;
}

// ════════════════════════════════════════
//  窓（画面に貼り付く）
// ════════════════════════════════════════
//  枠はプログラムの窓と同じ CSS を借りる。★押しているあいだ光る＝キーで押しても
//  画面のボタンで押しても、効いていることが同じ見え方になる。
function buildRemotePanel(r) {
  const host = document.getElementById('canvas-wrap') || document.body;
  const panel = document.createElement('div');
  panel.className = 'velgraph-panel remote-panel';
  panel.style.width = '170px';
  panel.innerHTML =
    '<div class="vg-header">' +
      // ★見出しの残りの幅はタイトルが取る＝⌄ と × を窓の右上に寄せる（プログラムの窓と同じ位置）
      '<span class="vg-title" style="flex:1 1 auto;min-width:0">リモコン ' + r.id + '</span>' +
      '<span class="vg-close rm-fold" title="畳む／開く">⌄</span>' +
      '<span class="vg-close rm-del">×</span>' +
    '</div>' +
    '<div style="padding:6px 8px 8px">' +
      // ★何を操るか。中身は相手によって変わる（remoteKindOptions）。
      //   選択肢を出しておいて disabled で蓋をする、はしない（蓋が閉まったまま
      //   開かなくなる形の事故になる。この窓で実際に起きていた）
      '<select class="prop-input rm-kind" style="width:100%;margin-bottom:6px"></select>' +
      // ★畳んだときだけ出す1行（何を・どのキーで）。選択欄を残すと窓が縮まない
      '<div class="rm-sum" style="font-size:11px;color:var(--text);margin-bottom:5px;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>' +
      '<button class="rm-push" style="width:100%;padding:8px 0;margin-bottom:6px;' +
        'border-radius:6px;border:1px solid var(--border);background:var(--panel2);' +
        'color:var(--text);font-size:13px;cursor:pointer;user-select:none">押す</button>' +
      // ★〈手で動かす〉の速さと向き。見出しは置かず単位だけ（170px の窓にこの2つを
      //   並べると、見出しを付けた瞬間に数字の桁が入らなくなる。rm-lo/rm-hi と同じ形）
      // ★並べ方は CSS 側（.rm-driverow）。ここに display:flex と書くと、行を出し直す
      //   `style.display = ''`（syncRemotePanel の show）がそれごと消してしまう
      '<div class="rm-driverow" ' +
        'title="押している間、この速さでこの向きへ動きます。&#10;' +
        '向きは画面の向きで、0°＝右・90°＝上・180°＝左です。&#10;' +
        '固定した物体でも動きます（手で押すのと同じ）">' +
        '<input class="prop-input rm-speed" type="number" step="0.1" min="0" ' +
          'style="flex:1 1 0;width:0;min-width:0;font-size:10px;padding:1px 3px">' +
        '<span style="font-size:10px;color:var(--text2)">m/s</span>' +
        '<input class="prop-input rm-dir" type="number" step="15" ' +
          'style="flex:1 1 0;width:0;min-width:0;font-size:10px;padding:1px 3px">' +
        '<span style="font-size:10px;color:var(--text2)">°</span>' +
      '</div>' +
      '<div class="rm-proprow">' +
        '<select class="prop-input rm-prop" style="width:100%"></select>' +
        '<div style="display:flex;align-items:center;gap:6px;margin-top:4px">' +
          '<input class="rm-slider" type="range" style="flex:1 1 auto;min-width:0">' +
          '<span class="rm-val" style="font-size:11px;color:var(--text);min-width:44px;' +
            'text-align:right"></span></div>' +
        // ★つまみの範囲。空欄なら右パネルと同じ可動域。狭めると刻みも細かくなる
        // ★並べ方は CSS 側（.rm-rangerow）。理由は rm-driverow と同じ
        '<div class="rm-rangerow" ' +
          'title="つまみの範囲です。空欄なら右パネルのつまみと同じ幅になります。&#10;' +
          '狭めるとそのぶん刻みが細かくなります（0.2 と 0.3 を打ち分けたいときに使います）">' +
          // ★見出しは置かない（170px の窓では、見出しを置くと数値が2文字も入らない）。
          //   何の欄かは placeholder と、行そのものの説明（title）で分かる。
          '<input class="prop-input rm-lo" type="number" placeholder="下限" ' +
            'style="flex:1 1 0;width:0;min-width:0;font-size:10px;padding:1px 3px">' +
          '<span style="font-size:10px;color:var(--text2)">〜</span>' +
          '<input class="prop-input rm-hi" type="number" placeholder="上限" ' +
            'style="flex:1 1 0;width:0;min-width:0;font-size:10px;padding:1px 3px">' +
        '</div></div>' +
      // ★合図で入れる・切る（番号。空欄＝使わない）。並べ方は CSS 側（.rm-sigrow）
      '<div class="rm-sigrow" ' +
        'title="プログラムの〈合図を出す〉で、このリモコンを押したままにする／放します。&#10;' +
        '回路のスイッチなら、スイッチを入れる／切ります。&#10;' +
        '同じ番号にすると、合図のたびに入と切が入れ替わります。空欄は使いません。&#10;' +
        'キーや画面のボタンでも、これまでどおり押せます">' +
        '<span style="font-size:10px;color:var(--text2)">合図 入</span>' +
        '<input class="prop-input rm-sigon" type="number" step="1" min="0" ' +
          'style="flex:1 1 0;width:0;min-width:0;font-size:10px;padding:1px 3px">' +
        '<span style="font-size:10px;color:var(--text2)">切</span>' +
        '<input class="prop-input rm-sigoff" type="number" step="1" min="0" ' +
          'style="flex:1 1 0;width:0;min-width:0;font-size:10px;padding:1px 3px">' +
      '</div>' +
      '<div class="prop-row rm-keyrow"><span class="prop-label">キー</span>' +
        '<input class="prop-input rm-key" type="text" readonly ' +
        'title="ここを押してから、割り当てたいキーを打ってください。&#10;押している間だけ効きます"></div>' +
      // ★見出しを付けず、選択肢そのものを1文にする（窓は 150px しかなく、
      //   「押している間」という見出しを置くと選択肢の文字が入らなくなる）
      '<select class="prop-input rm-mode" style="width:100%;margin-top:4px" ' +
        'title="「効かせる」＝押していない間は切れています（ふつうの使い方）。&#10;' +
        '「止まる」＝押していない間はいつもどおり効いていて、押すと止まります。&#10;' +
        '（モーターは押している間ブレーキがかかります。動力は切れます）&#10;' +
        '正転と逆転で使い分けるときは、リモコンをもう1つ置いて別のキーを割り当ててください">' +
          '<option value="on">押すと 効く</option>' +
          '<option value="rev">押すと 逆に効く</option>' +
          '<option value="off">押すと 止まる</option></select>' +
      // ★受け持っている相手。1つだけのときも出す（「増やせる」と分かるのがこの行の役目）。
      //   ＋を押すと待ち受けに入り、画面の相手をクリックするたびに足す／外す。
      // ★並べ方は CSS 側（.rm-tgtrow）。理由は rm-driverow と同じ
      '<div class="rm-tgtrow" ' +
        'title="このリモコンが受け持つ相手です。1台で何台でも同時に動かせます。&#10;' +
        '＋を押してから画面の相手をクリックすると足せます（もう一度クリックで外れます）。&#10;' +
        'つなげるのは同じ種類の相手だけです（モーターとモーター、物体と物体）">' +
        '<span class="vg-hint rm-tgt" style="flex:1 1 auto;min-width:0"></span>' +
        '<button class="btn-small rm-add" style="padding:1px 7px">＋</button>' +
      '</div>' +
      '<div class="vg-hint rm-note"></div>' +
    '</div>';
  host.appendChild(panel);
  r.panel = panel;

  const sel = c => panel.querySelector(c);
  sel('.rm-add').addEventListener('click', () => {
    // ★相手を指すのはリモコンの道具の仕事。押したらその道具へ切り替える（道具が
    //   違うままクリックさせると、選択や配置のほうが先に起きて相手を指せない）。
    if (currentTool !== 'remote') setTool('remote');
    armRemoteAdd(r);
  });
  sel('.rm-kind').addEventListener('change', e => {
    const [k, sw] = e.target.value.split(':');    // ★気体だけ「種類:切替」（remoteKindValue）
    r.kind = k;
    if (sw) r.prop = sw;
    if (r.kind === 'ghost') r._on = false;      // 切替へ移るときに押しっぱなしを持ち越さない
    applyRemoteDrives();                        // ★〈手で動かす〉から離れたら相手を放す
    syncRemotePanel(r);
  });
  // 速さと向き。★空欄・数字でないものは前の値のまま（0 に落ちると黙って動かなくなる）
  const drv = () => {
    const s = parseFloat(sel('.rm-speed').value), d = parseFloat(sel('.rm-dir').value);
    if (Number.isFinite(s)) r.speed = Math.max(0, s);
    if (Number.isFinite(d)) r.dir = d;
    applyRemoteDrives();                        // 押しながら変えたら、その場で速さが変わる
    syncRemotePanel(r);
  };
  sel('.rm-speed').addEventListener('change', drv);
  const sig = () => {
    r.sigOn  = Math.max(0, parseInt(sel('.rm-sigon').value)  || 0);
    r.sigOff = Math.max(0, parseInt(sel('.rm-sigoff').value) || 0);
    syncRemotePanel(r);
  };
  sel('.rm-sigon').addEventListener('change', sig);
  sel('.rm-sigoff').addEventListener('change', sig);
  sel('.rm-dir').addEventListener('change', drv);
  sel('.rm-prop').addEventListener('change', e => {
    r.prop = e.target.value; r.lo = r.hi = undefined;   // 量を変えたら範囲は表の既定へ戻す
    syncRemotePanel(r);
  });
  const rng = () => {
    const a = parseFloat(sel('.rm-lo').value), b = parseFloat(sel('.rm-hi').value);
    r.lo = Number.isFinite(a) ? a : undefined;
    r.hi = Number.isFinite(b) ? b : undefined;
    if (r.lo !== undefined && r.hi !== undefined && r.hi <= r.lo) r.hi = undefined;
    syncRemotePanel(r);
  };
  sel('.rm-lo').addEventListener('change', rng);
  sel('.rm-hi').addEventListener('change', rng);
  // スライダー：右パネルと同じ書き込み口（applyBodyProp）を通す
  const sld = sel('.rm-slider');
  sld.addEventListener('pointerdown', () => pushUndo());   // ドラッグの前に1回だけ控える
  sld.addEventListener('input', () => { remoteSlide(r, sld.value); });
  // 画面のボタン：押している間だけ／すり抜けだけは押すたびに切替
  //   ★放す側は window で拾う（窓の外で放しても止まる）
  const push = sel('.rm-push');
  const down = e => {
    e.preventDefault();
    _remoteStartSim();                            // ★止めているなら動かす（remoteKeyDown の上の★）
    if (r.kind === 'ghost') { toggleRemoteGhost(r); return; }
    r._on = true; syncRemotePanel(r);
  };
  const up   = () => { if (r._on && r.isPush()) { r._on = false; applyRemoteDrives(); syncRemotePanel(r); } };
  push.addEventListener('mousedown', down);
  push.addEventListener('mouseleave', up);      // 押したまま外へ出たら放したことにする
  window.addEventListener('mouseup', up);
  // キーの割り当て：欄を押してから次に打ったキーを取る（プログラムの窓と同じ流儀）
  const keyEl = sel('.rm-key');
  keyEl.addEventListener('focus', () => { keyEl.value = '（キーを押す）'; r._grabKey = true; });
  keyEl.addEventListener('blur',  () => { r._grabKey = false; syncRemotePanel(r); });
  keyEl.addEventListener('keydown', e => {
    e.preventDefault(); e.stopPropagation();
    // ★受け取らないのは予約キーだけ（keyboard.js の★）。ほかのリモコンと同じキーは
    //   **受け取ったうえで知らせる**。1つのキーで複数を同時に動かすのは機構として要る
    //   （左右の波源から山を同時に出す、など）ので、禁止ではなく事故の防止に寄せる。
    const why = keyBindConflict(e.code, r);
    if (why) flashHint(remoteKeyLabel(e.code) + ' は' + why);
    else {
      r.key = e.code;
      const share = keyBindShared(e.code, r);
      if (share) flashHint(remoteKeyLabel(e.code) + ' は ' + share + ' と同時に動きます');
    }
    r._grabKey = false; keyEl.blur(); syncRemotePanel(r);
  });
  sel('.rm-mode').addEventListener('change', e => { r.mode = e.target.value; syncRemotePanel(r); });
  // ★消す前に確かめる。畳む（⌄）の隣にあるので押し間違えやすい。Ctrl+Z で戻せるが、
  //   それを知らない人には設定が一瞬で消えたようにしか見えない（プログラムの窓も同じ）
  sel('.rm-del').addEventListener('click', async () => {
    const ok = await appConfirm('リモコンの削除',
      '<b>リモコン ' + r.id + '</b> を削除します。'
    + '<div class="am-note">Ctrl+Z（元に戻す）で戻せます。</div>',
      '削除する', true);
    if (ok) removeRemote(r);
  });
  // ★畳んだら置き直す（プログラムの窓と同じ理由：置く計算が窓の高さを使う）
  sel('.rm-fold').addEventListener('click', () => {
    r.collapsed = !r.collapsed; syncRemotePanel(r); placeRemotePanel(r);
  });
  remotePanelDraggable(r);
  // ★中身を先に整えてから置く（js/ui/panel-program.js の同じ★）。窓の高さは相手と
  //   モードで変わるので、行を出し入れする前に置くと下端の余白ぶん上へずれる。
  syncRemotePanel(r);
  placeRemotePanel(r);
}
function placeRemotePanel(r) {
  const host = r.panel.offsetParent || document.body;
  const hr = host.getBoundingClientRect();
  const w = r.panel.offsetWidth || 170, h = r.panel.offsetHeight || 120;
  r.panel.style.right = 'auto'; r.panel.style.bottom = 'auto';
  r.panel.style.left = Math.max(56, Math.min(hr.width  - w - 4, r.fx * hr.width))  + 'px';
  r.panel.style.top  = Math.max(4,  Math.min(hr.height - h - 4, r.fy * hr.height)) + 'px';
}
function remotePanelDraggable(r) {
  const header = r.panel.querySelector('.vg-header');
  let drag = false, ox = 0, oy = 0;
  header.addEventListener('mousedown', e => {
    if (e.target.classList.contains('vg-close')) return;
    const rc = r.panel.getBoundingClientRect();
    drag = true; ox = e.clientX - rc.left; oy = e.clientY - rc.top;
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    const host = r.panel.offsetParent || document.body;
    const hr = host.getBoundingClientRect();
    r.fx = (e.clientX - hr.left - ox) / hr.width;
    r.fy = (e.clientY - hr.top  - oy) / hr.height;
    placeRemotePanel(r);
  });
  window.addEventListener('mouseup', () => drag = false);
}
// キーの見せ方。★欄が狭いので `ArrowRight` は「Arrow」で切れてしまう。
//   矢印は記号に、`KeyD`/`Digit1` は頭を落として1文字にする（保存するのは e.code のまま）。
function remoteKeyLabel(code) {
  const arrows = { ArrowRight:'→', ArrowLeft:'←', ArrowUp:'↑', ArrowDown:'↓' };
  if (arrows[code]) return arrows[code];
  if (/^Key[A-Z]$/.test(code))  return code.slice(3);
  if (/^Digit\d$/.test(code))   return code.slice(5);
  return code;
}
// スライダーの段。★可動域は remoteKnobs（右パネルと同じ定数から引いた表）から取る。
//   有効数字方式の量（質量）だけは、同じ可動域を 200 等分した線形にする——窓が 150px
//   しかなく、桁をまたぐ目盛りをそのまま刻んでも読めないため。可動域は共有される。
//   屈折率だけは段が飛び飛び（0 の次が 1.05）なので IOR_TICKS をそのまま使う。
function remotePropTicks(knob, lo, hi) {
  if (!knob) return [0];
  if (knob.ticks) return knob.ticks;
  const a = (lo !== undefined && lo !== null) ? lo : knob.lo;
  const b = (hi !== undefined && hi !== null) ? hi : knob.hi;
  // ★狭めたぶん刻みも細かくする（つまみの段数はいつも 100〜200 段になる）。
  //   0.2 と 0.3 を打ち分けたい題材で、表の刻みのままだと届かない。
  const span = Math.abs(b - a);
  const step = knob.sig ? span / 200 : Math.min(knob.step, Math.max(span / 200, 1e-4));
  const out = [];
  for (let v = a; v <= b + 1e-9; v += step) out.push(+v.toFixed(6));
  // ★0 への吸着（knob.detent）。0 のまわりの段を 0 で埋めて、つまみの上で幅を持たせる
  //   （heat-field.js の heatPowerTicks と同じ作り）。幅は可動域の 1% を上限にする＝
  //   窓で範囲を狭めても、吸着の幅はつまみの上で同じ見た目の幅のまま。
  if (knob.detent && a < 0 && b > 0) {
    // detent:true は幅を決めない印（右パネルと共有の表から来る。slider.js の zeroDetentTicks）
    const d = knob.detent === true ? span * 0.01 : Math.min(knob.detent, span * 0.01);
    for (let i = 0; i < out.length; i++) if (Math.abs(out[i]) < d) out[i] = 0;
  }
  return out;
}
// 窓に出す値。★1 未満は有効数字3桁（小数2桁で切ると 0.025 Hz が 0.03、0.0125 が 0.01 と出て、
//   つまみで打ち分けた値が読めない）。1 以上は今までどおり小数2桁
function _remoteFmt(v) {
  if (!isFinite(v)) return String(v);
  return Math.abs(v) >= 1 || v === 0 ? v.toFixed(2) : String(+v.toPrecision(3));
}
function remoteSlide(r, idx) {
  const ts = r.targets();
  const knob = remoteKnob(r);
  if (!ts.length || !knob) return;
  const ticks = remotePropTicks(knob, r.lo, r.hi);
  const v = ticks[Math.max(0, Math.min(ticks.length - 1, Math.round(idx)))];
  // ★相手が複数なら全員に同じ値を配る（一括設定の applyToBulk と同じ約束）。
  //   ばらばらの値を保ったまま同じ比で動かす、はしない——つまみが指す数字と
  //   相手の値が食い違うと、窓が「いま何なのか」を示さなくなる。
  for (const t of ts) knob.set(t, v);
  // ★相手が眠っていたら起こす（右パネルの setter が最後に wakeAll しているのと同じ理由。
  //   場の強さや流速を変えても、周りが眠ったままだと次にぶつかるまで何も起きない）
  wakeAll();
  for (const t of ts) _remoteRefreshOtherPanels(r.targetType, t);
  syncRemotePanel(r);
}
// プルダウンの中身を入れ替える。★中身が同じなら触らない（syncRemotePanel は
//   キーを押すたびに走るので、毎回作り直すと開いているプルダウンが閉じてしまう）。
function _fillRemoteSelect(el, pairs, cur) {
  const sig = pairs.map(p => p[0] + ':' + p[1]).join('|');
  if (el._sig !== sig) {
    el._sig = sig;
    el.innerHTML = '';
    for (const [v, label] of pairs) el.add(new Option(label, v));
  }
  if (pairs.some(p => p[0] === cur)) el.value = cur;
}
function syncRemotePanel(r) {
  const panel = r.panel;
  if (!panel) return;
  const sel = c => panel.querySelector(c);
  const t = r.target();
  ensureRemoteProp(r);
  if (!r._grabKey) sel('.rm-key').value = remoteKeyLabel(r.key);
  sel('.rm-mode').value = r.mode;
  // ★選べるのは「その相手にできること」＋「いま選んでいるもの」
  const kv = remoteKindValue(r);
  _fillRemoteSelect(sel('.rm-kind'), remoteKindOptions(r.targetType, t, kv), kv);
  const knobs = remoteKnobs(r.targetType, t);
  _fillRemoteSelect(sel('.rm-prop'), knobs.map(k => [k.key, k.label]), r.prop);
  // ★出すのはその種類に要る欄だけ（右パネル・プログラムの窓と同じ流儀）
  const isProp = (r.kind === 'prop');
  const show = (c, on) => { const e = sel(c); if (e) e.style.display = on ? '' : 'none'; };
  const c = r.collapsed;
  show('.rm-proprow', isProp);
  show('.rm-kind', !c);
  show('.rm-sum', c);
  show('.rm-prop', !c);
  show('.rm-rangerow', !c);
  show('.rm-tgtrow', !c);
  show('.rm-driverow', !c && r.kind === 'drive');
  if (r.kind === 'drive') {
    if (document.activeElement !== sel('.rm-speed')) sel('.rm-speed').value = r.speed;
    if (document.activeElement !== sel('.rm-dir'))   sel('.rm-dir').value   = r.dir;
  }
  show('.rm-push', !isProp);
  show('.rm-mode', !c && r.isPush() && !isProp);
  show('.rm-keyrow', !c && !isProp);
  show('.rm-sigrow', !c && r.usesSignal());
  if (document.activeElement !== sel('.rm-sigon'))  sel('.rm-sigon').value  = r.sigOn  || '';
  if (document.activeElement !== sel('.rm-sigoff')) sel('.rm-sigoff').value = r.sigOff || '';
  if (c) {
    // ★畳んだ窓の1行：何を（機能）・どのキーで。つまみは押す操作が無いので量の名前を出す。
    //   正転・逆転を2台で分けているときに見分けがつくよう、〈逆に効く〉〈止まる〉は添える
    const kl = (remoteKindOptions(r.targetType, t, kv).find(o => o[0] === kv) || ['', kv])[1];
    const knob0 = isProp ? remoteKnob(r) : null;
    let md = (r.isPush() && r.mode === 'rev') ? '（逆）' : (r.isPush() && r.mode === 'off') ? '（止める）' : '';
    // ★波源は向きで言い直す。〈押している間だけ波を出す（止める）〉は正反対の意味に読めた
    //   （ノイズキャンセルの打ち消し側：ユーザーの指摘 2026-10-04）
    let kl2 = kl;
    if (r.kind === 'emit') { kl2 = r.mode === 'off' ? '押す間だけ波を止める'
                                 : r.mode === 'rev' ? '押す間だけ谷から出す' : '押す間だけ波を出す'; md = ''; }
    const sg = (r.usesSignal() && (r.sigOn || r.sigOff)) ? ' · 合図' : '';
    const txt = isProp ? (knob0 ? knob0.label : kl)
                       : kl2 + md + ' · ' + remoteKeyLabel(r.key) + ' キー' + sg;
    sel('.rm-sum').textContent = txt;
    sel('.rm-sum').title = txt;          // ★幅が足りず … で切れたときの全文
  }
  sel('.rm-fold').textContent = c ? '⌃' : '⌄';          // ★つまみにキーは割り当てられない（押す操作が無い）
  const knob = remoteKnob(r);
  if (isProp && t && knob) {
    const ticks = remotePropTicks(knob, r.lo, r.hi);
    if (document.activeElement !== sel('.rm-lo')) sel('.rm-lo').value = r.lo !== undefined ? r.lo : '';
    if (document.activeElement !== sel('.rm-hi')) sel('.rm-hi').value = r.hi !== undefined ? r.hi : '';
    const cur = knob.get(t);
    const sld = sel('.rm-slider');
    sld.min = 0; sld.max = ticks.length - 1; sld.step = 1;
    sld.value = _nearestTickIndex(ticks, cur);   // ★吸着の段（0 が並ぶ）では真ん中に置く
    sel('.rm-val').textContent = (r.prop === 'ior' && cur <= 1) ? '不透明' : _remoteFmt(+cur);
  } else if (!isProp) {
    const push = sel('.rm-push');
    // ★光っているかどうかではなく「いま効いているか」を出す。〈止める〉のリモコンは
    //   押していないときこそ効いているので、文字と色をそこに合わせないと嘘になる。
    const ghosted = (r.kind === 'ghost' && _remoteIsOff(r, t));
    const fieldSw = r.targetType === 'emfield' || r.targetType === 'circuit' || r.targetType === 'joint'
                 || r.targetType === 'gas';   // ★入り切りのスイッチ
    const hinge = r.targetType === 'joint';
    push.textContent = r.kind === 'ghost'
                     ? (hinge ? (ghosted ? 'ここで留める' : '外す')
                      : fieldSw ? (ghosted ? '入れる' : '切る')
                                : (ghosted ? '元に戻す' : 'すり抜けにする'))
                     : r.pressed() ? (r.mode === 'off' ? '止めています' : '効いています') : '押す';
    // ★場のスイッチは「入っている」ときに光る（物体のすり抜けは「すり抜けている」ときに光る）。
    //   どちらも「いつもと違う状態に入れてある」ほうではなく、見る人が効いていると読むほう
    const lit = r.kind === 'ghost' ? (fieldSw ? !ghosted : ghosted) : r.pressed();
    push.style.background = lit ? REMOTE_COLOR : 'var(--panel2)';
    push.style.color      = lit ? '#0b1220' : 'var(--text)';
  }
  // 受け持っている相手の数と、待ち受け中かどうか
  const n = r.targetIds.length;
  sel('.rm-tgt').textContent = n <= 1 ? remoteTargetName(r.targetType, t)
                                      : remoteTargetName(r.targetType, t) + ' ほか ' + (n - 1) + '台';
  const add = sel('.rm-add');
  const arming = (remoteAddFor === r);
  add.textContent = arming ? '選ぶ中' : '＋';
  add.style.background = arming ? REMOTE_COLOR : '';
  add.style.color      = arming ? '#0b1220' : '';
  sel('.rm-note').textContent = arming
    ? '画面の相手をクリックすると足す／外す（＋でやめる）'
    : remoteNoteText(r);
}
// 角度 [°]（画面の向き。0＝右・90＝上）を8方位の矢印にする
function arrowOfDeg(deg) {
  const a = ['→','↗','↑','↖','←','↙','↓','↘'];
  return a[((Math.round(deg / 45) % 8) + 8) % 8];
}
function remoteNoteText(r) {
  const t = r.target();
  if (!t) return 'つないだ相手がありません（消えました）';
  const nm = remoteTargetName(r.targetType, t);
  if (r.kind === 'motor') return nm + ' ' + Math.abs(t.motorSpeed).toFixed(1) + ' rad/s';
  if (r.kind === 'ghost' && r.targetType === 'emfield') return nm + (t.strength === 0 ? '（切）' : '（入）');
  if (r.kind === 'ghost' && r.targetType === 'circuit') return nm + (t.closed ? '（入）' : '（切）');
  if (r.kind === 'ghost' && r.targetType === 'joint')   return nm + (t.detached ? '（外してある）' : '（留めてある）');
  if (r.kind === 'ghost' && r.targetType === 'gas')
    return _gasSwitch(r) === 'iso'
      ? (t.thermostat != null ? '恒温槽 ' + (t.thermostat - 273.15).toFixed(1) + '℃（等温）' : '恒温槽なし（断熱）')
      : (t.pistonLocked ? 'ピストン固定（定積）' : 'ピストン自由（定圧）');
  if (r.kind === 'ghost')  return nm + (t.layers === 0 ? '（いますり抜け）' : '（ふつう）');
  // ★向きは矢印で出す（8方位）。「−90°」より「↓」のほうが、押す前に確かめられる
  if (r.kind === 'drive')  return nm + ' を ' + arrowOfDeg(r.dir) + ' ' + r.speed + ' m/s';
  if (r.kind === 'prop')   return nm;
  if (r.kind === 'emit')
    return nm + ' f=' + t.freq.toFixed(2) + ' Hz'
         + (r.gate() ? (r.gate() < 0 ? '（谷から出しています）' : '（出しています）') : '（止めています）');
  if (!t.force)            return nm + ' は推力 0 です（つまみか右パネルで上げてください）';
  return nm + ' ' + t.force.toFixed(0) + ' N ' + arrowOfDeg(-t.worldDir() * 180 / Math.PI);
}
function syncAllRemotePanels() { for (const r of remotes) syncRemotePanel(r); }

// ── つなぎ線 ─────────────────────────────────────────────
//   render() の最後（HUD と同じ画面座標）で引く。★プログラムの黄色い破線と分けるため
//   水色にしてある。押している間は実線＋太くする＝どれが効いているかが図の側でも分かる。
function drawRemoteLinks() {
  if (!remotes.length) return;
  ctx.save();
  for (const r of remotes) {
    if (!r.panel) continue;
    const rc = r.panel.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    const px = rc.left - cr.left + rc.width / 2, py = rc.top - cr.top;
    // ★相手が複数なら線も本数ぶん引く。1台がどこまで受け持っているかは、
    //   窓の文字ではなく線で分かるのがいちばん早い。
    for (const t of r.targets()) {
      // 相手の位置（軸は取り付け点、物体は力点、領域は中心。remoteTargetPos）
      const p = remoteTargetPos(r.targetType, t);
      const s = worldToScreen(p.x, p.y);
      const m = 14;
      const cx = Math.max(m, Math.min(canvas.width - m, s.x));
      const cy = Math.max(m, Math.min(canvas.height - m, s.y));
      ctx.strokeStyle = REMOTE_COLOR;
      ctx.lineWidth = r._on ? 2 : 1;
      ctx.setLineDash(r._on ? [] : [4, 4]);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = REMOTE_COLOR;
      ctx.beginPath(); ctx.arc(cx, cy, r._on ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}
