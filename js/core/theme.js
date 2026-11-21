// ─── 配色のプリセット（黒／白）──────────────────────────────────
//   ★テーマはシーンではなく「使う人」の設定（localStorage）。シーンに入れると、
//     共有シーンを開いた瞬間に先生の画面（プロジェクタ）の配色が勝手に変わる。
//     表示メニューと全体設定タブの「配色」は、同じこの1つの設定を切り替える2つの入口。
//   ★選べるのは黒と白の2つだけ。背景色を自由に選ぶ欄は置かない（2026-10-28 ユーザーの指示：
//     白と黒で十分）。以前のシーンに入っている world.bgColor は読み込み時に捨てる（scene-io.js）。
//   ここが持つのはキャンバスの配色だけ。パネル類は css/style.css の変数（data-theme）で切り替える。
const THEMES = {
  dark: {
    label: '黒',
    bg: '#12141a',
    text: '224,230,240',            // 文字（rgb。不透明度は使う側が決める）
    line: '255,255,255',            // 背景の上に引く補助線・枠
    halo: '0,0,0',                  // 文字・矢印の縁取り（背景と反対の明るさ）
    hudBg: 'rgba(26,28,35,0.82)',   // キャンバスに浮かべる札（凡例など）の地
    // ★暗い背景では方眼を白の半透明で引く（以前の drawGrid の値そのまま。スナップ中は 1.7 倍）
    gridMinor: 'rgba(255,255,255,0.04)',  gridMajor: 'rgba(255,255,255,0.07)',
    gridMinorSnap: 'rgba(255,255,255,0.068)', gridMajorSnap: 'rgba(255,255,255,0.119)',
  },
  light: {
    label: '白',
    bg: '#FAFBF7',
    text: '33,45,58',
    line: '30,45,60',
    halo: '255,255,255',
    hudBg: 'rgba(255,255,255,0.88)',
    // ★方眼の色は指定値（細線 #DCE8EF・太線 #B9CFDC）。スナップ中は同じ色相のまま一段濃くする
    gridMinor: '#DCE8EF', gridMajor: '#B9CFDC',
    gridMinorSnap: '#C2D6E2', gridMajorSnap: '#94B3C6',
  },
};
const THEME_KEY = 'physbox-theme';
let uiTheme = 'dark';
try { const t = localStorage.getItem(THEME_KEY); if (THEMES[t]) uiTheme = t; } catch (e) {}
document.documentElement.dataset.theme = uiTheme;

// いまキャンバスに敷く背景色
function canvasBg() { return THEMES[uiTheme].bg; }

// 背景の明るさで選んだキャンバスの配色。毎フレーム何度も呼ばれるので背景色ごとに覚えておく
let _cpalKey = null, _cpal = THEMES.dark;
function cpal() {
  const bg = canvasBg();
  if (bg !== _cpalKey) { _cpalKey = bg; _cpal = _isLightColor(bg) ? THEMES.light : THEMES.dark; }
  return _cpal;
}
function cText(a) { return `rgba(${cpal().text},${a})`; }   // 背景の上の文字
function cLine(a) { return `rgba(${cpal().line},${a})`; }   // 背景の上の補助線
function cHalo(a) { return themeRaw(`rgba(${cpal().halo},${a})`); }   // 縁取り（白い縁取りは白のまま通す）
// シーンが持つ色（注釈・物体の名札など）のうち、背景に溶ける色を前景色へ読み替える。
//   ★対象は「白っぽい色を明るい背景に」「黒っぽい色を暗い背景に」置いたときだけ。
//     注釈の既定色は白（#ffffff）で、デモの説明文もほぼ白で書かれている。シーンの値は
//     書き換えず描く瞬間だけ読み替えるので、黒の配色に戻せば元どおり白で出る。
function cInk(color) {
  const L = _luminance(color);
  if (L == null) return color;
  const lightBg = cpal() === THEMES.light;
  if (lightBg ? L > 0.8 : L < 0.01) return cText(1);
  return color;
}
// 色に添える縁取り。★中身と反対の明るさにする（明るい色には黒、暗い色には白）。
//   背景ではなく中身で決めるのは、縁取りの役目が「物体や地面に重なっても字を立たせる」ことだから。
//   ★明るい背景では中身の色は必ず濃い色へ読み替わる（themeColor）ので、縁取りはいつも白
function cHaloFor(color, a) {
  if (isLightCanvas()) return themeRaw(`rgba(255,255,255,${a})`);
  const L = _luminance(color);
  return (L != null && L < 0.18) ? themeRaw(`rgba(255,255,255,${a})`) : `rgba(0,0,0,${a})`;
}
function _isLightColor(c) { const L = _luminance(c); return L != null && L > 0.4; }
// 相対輝度（#rgb / #rrggbb / rgb() を受ける。読めない色は null）。同じ色を何度も聞かれるので覚えておく
const _lumCache = new Map();
function _luminance(c) {
  if (_lumCache.has(c)) return _lumCache.get(c);
  const L = _calcLuminance(c);
  if (_lumCache.size > 500) _lumCache.clear();
  _lumCache.set(c, L);
  return L;
}
function _calcLuminance(c) {
  let r, g, b;
  const s = String(c).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) [r, g, b] = m[1].split('').map(h => parseInt(h + h, 16));
  else if ((m = /^#([0-9a-f]{6})/i.exec(s))) [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].substr(i, 2), 16));
  else if ((m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s))) [r, g, b] = [+m[1], +m[2], +m[3]];
  else if (/^white$/i.test(s)) return 1;
  else if (/^black$/i.test(s)) return 0;
  else return null;
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// プリセットを選ぶ（背景・方眼・文字・パネル・アイコンの一式が替わる）
function setUiTheme(name) {
  if (!THEMES[name]) return;
  uiTheme = name;
  try { localStorage.setItem(THEME_KEY, name); } catch (e) {}
  document.documentElement.dataset.theme = name;
  applyIconTheme();
  if (typeof syncThemeUI === 'function') syncThemeUI();
}
// いまの背景が明るいか（明るい背景でだけ色を変える箇所の分岐に使う）
function isLightCanvas() { return cpal() === THEMES.light; }

// ─── 明るい背景向けの色の読み替え ─────────────────────────────────
//   ★この系の色はすべて暗い背景で見えるように選ばれている（Material の 300〜400 番台の明るい色）。
//     白い背景では同じ色が沈むので、メインキャンバスの fillStyle / strokeStyle に渡る色を
//     ここで一度だけ受けて、明るい背景のときだけ濃い色へ読み替える。
//     描く側（数百か所・デモ・シーンの物体色）は暗い背景用の色のまま書いてよく、シーンの値も変えない。
//   ★読み替えは2段：よく使う色は手で選んだ対応表（色相の見え方を保つため。黄は機械的に
//     暗くすると濁った黄土色になるので琥珀〜褐色を選んである）、それ以外は色相を保ったまま
//     背景とのコントラストが LIGHT_MIN_CONTRAST になるまで OKLCH の明度を下げる。
//     もともと十分に濃い色は変えない（＝読み替えは何度通しても同じ結果になる）。
//   ★黒の配色（暗い背景）のときは何もしない（黒は今まで通りの色そのもの）。
//   ★わざと薄くしている色（方眼・背景・白い縁取り・札の地）は themeRaw で登録して素通しにする。
const LIGHT_MIN_CONTRAST = 3;   // 線・図形の目安（WCAG の非文字要素 3:1）
const LIGHT_COLOR_MAP = {
  '#4fc3f7':'#0288d1', '#29b6f6':'#0277bd', '#81d4fa':'#0288d1', '#03a9f4':'#0277bd',
  '#42a5f5':'#1976d2', '#64b5f6':'#1e88e5', '#90caf9':'#1e88e5', '#2196f3':'#1565c0',
  '#ffd54f':'#a87900', '#ffca28':'#a06f00', '#ffc107':'#a06f00', '#ffe082':'#a87900',
  '#ffee58':'#9e8c00', '#ffeb3b':'#9e8c00', '#fff176':'#9e8c00', '#fdd835':'#9e8c00',
  '#ffb74d':'#e65100', '#ffa726':'#e65100', '#ff9800':'#e65100', '#ffcc80':'#ef6c00',
  '#ff7043':'#d84315', '#ff8a65':'#d84315', '#ff5722':'#d84315', '#ffab91':'#d84315',
  '#ef5350':'#c62828', '#e57373':'#c62828', '#f44336':'#c62828', '#ef9a9a':'#c62828',
  '#66bb6a':'#2e7d32', '#81c784':'#2e7d32', '#a5d6a7':'#388e3c', '#4caf50':'#2e7d32',
  '#9ccc65':'#558b2f', '#aed581':'#558b2f', '#8bc34a':'#558b2f', '#d4e157':'#827717',
  '#26c6da':'#00838f', '#4dd0e1':'#00838f', '#80deea':'#00838f', '#00bcd4':'#00838f',
  '#b2ebf2':'#00838f', '#26a69a':'#00796b', '#4db6ac':'#00796b', '#80cbc4':'#00796b',
  '#ab47bc':'#7b1fa2', '#ba68c8':'#7b1fa2', '#ce93d8':'#8e24aa', '#9c27b0':'#7b1fa2',
  '#7e57c2':'#5e35b1', '#9575cd':'#5e35b1', '#b39ddb':'#5e35b1',
  '#ec407a':'#c2185b', '#f06292':'#c2185b', '#f48fb1':'#c2185b',
  '#5c6bc0':'#3949ab', '#7986cb':'#3949ab',
  '#78909c':'#546e7a', '#90a4ae':'#546e7a', '#b0bec5':'#607d8b', '#cfd8dc':'#78909c', '#eceff1':'#78909c',
  '#8d6e63':'#6d4c41', '#a1887f':'#6d4c41', '#bdbdbd':'#757575', '#e0e0e0':'#757575', '#9e9e9e':'#757575',
};
// ★素通しの登録は2つに分ける。配色そのもの（方眼・札の地）は消えない表に、描くたびに作る色
//   （縁取り・温度の色）は溢れたら捨てる表に入れる。捨てても使う直前に登録し直すので困らない。
const _rawFixed = new Set(), _rawColors = new Set();
function themeRaw(c) { if (_rawColors.size > 4000) _rawColors.clear(); _rawColors.add(c); return c; }
for (const k of Object.keys(THEMES.light)) if (typeof THEMES.light[k] === 'string' && /^(#|rgb)/.test(THEMES.light[k])) _rawFixed.add(THEMES.light[k]);

const _adaptCache = new Map();
function themeColor(c, light = isLightCanvas()) {
  if (typeof c !== 'string' || !light || _rawFixed.has(c) || _rawColors.has(c) || c === canvasBg()) return c;
  let r = _adaptCache.get(c);
  if (r === undefined) {
    r = _adaptForLight(c);
    if (_adaptCache.size > 4000) _adaptCache.clear();
    _adaptCache.set(c, r);
  }
  return r;
}
function _adaptForLight(c) {
  const m = _parseColor(c);
  if (!m) return c;                                   // 名前付きの色・グラデーション名などは触らない
  const hex = '#' + [m.r, m.g, m.b].map(v => v.toString(16).padStart(2, '0')).join('');
  const spread = Math.max(m.r, m.g, m.b) - Math.min(m.r, m.g, m.b);
  // ★黒に近い無彩色（真っ黒は除く）は「暗い地の札・吹き出し」の地として使われている
  //   （グラフの読み取り札・気体室の数値札など）。濃くするのではなく白い地に裏返す。
  //   真っ黒（影・縁取り・地面の斜線）と、暗い灰青（壁・物体 #263238 以上）は対象外。
  if (spread < 16 && m.r + m.g + m.b > 0 && _luminance(hex) < 0.015)
    return `rgba(250,251,248,${m.a})`;
  let out = LIGHT_COLOR_MAP[hex];
  // ★白〜明るい灰（無彩色）は「暗い背景の上の前景色」として使われている（文字・枠・印）。
  //   中間の灰へ暗くするより、白の配色の文字色へ揃えたほうが読める
  if (!out && spread < 24 && _luminance(hex) > 0.6)
    out = `rgb(${THEMES.light.text})`;
  if (!out) {
    // ★基準は白の配色の背景（キャンバスとパネルで共通にして、読み替えの結果を1つの表に覚える）
    const bgL = _luminance(THEMES.light.bg);
    const maxL = (bgL + 0.05) / LIGHT_MIN_CONTRAST - 0.05;
    if (_luminance(hex) <= maxL) return c;            // もう十分に濃い
    out = _darkenToLuminance(m.r, m.g, m.b, maxL);
  }
  const o = _parseColor(out);
  return m.a >= 1 ? out : `rgba(${o.r},${o.g},${o.b},${m.a})`;
}
function _parseColor(c) {
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) { const [r, g, b] = m[1].split('').map(h => parseInt(h + h, 16)); return { r, g, b, a: 1 }; }
  if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s))) {
    const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].substr(i, 2), 16));
    return { r, g, b, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  }
  if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s))) {
    let a = m[4] == null ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a };
  }
  if (/^white$/i.test(s)) return { r: 255, g: 255, b: 255, a: 1 };
  return null;
}
// 色相を保って OKLCH の明度だけを下げ、相対輝度が maxL 以下になる最も明るい色を返す
//   （彩度は sRGB に収まるところまで落とす）
function _darkenToLuminance(r, g, b, maxL) {
  const toLin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const toSrgb = v => { v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, v)) * 255); };
  const [lr, lg, lb] = [toLin(r), toLin(g), toLin(b)];
  const l_ = Math.cbrt(0.4122214708*lr + 0.5363325363*lg + 0.0514459929*lb);
  const m_ = Math.cbrt(0.2119034982*lr + 0.6806995451*lg + 0.1073969566*lb);
  const s_ = Math.cbrt(0.0883024619*lr + 0.2817188376*lg + 0.6299787005*lb);
  const L0 = 0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_;
  const A  = 1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_;
  const B  = 0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_;
  const fromOk = (L, a, bb) => {
    const l = Math.pow(L + 0.3963377774*a + 0.2158037573*bb, 3);
    const m = Math.pow(L - 0.1055613458*a - 0.0638541728*bb, 3);
    const s = Math.pow(L - 0.0894841775*a - 1.2914855480*bb, 3);
    return [ 4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
            -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
            -0.0041960863*l - 0.7034186147*m + 1.7076147010*s];
  };
  const make = L => {                               // 明度 L で、収まるまで彩度を落とした色
    for (let k = 1; k > 0.01; k *= 0.9) {
      const c = fromOk(L, A * k, B * k);
      if (c.every(v => v >= -1e-4 && v <= 1 + 1e-4)) return c;
    }
    return fromOk(L, 0, 0);
  };
  let lo = 0, hi = L0;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2, c = make(mid);
    const Y = 0.2126*Math.max(0, c[0]) + 0.7152*Math.max(0, c[1]) + 0.0722*Math.max(0, c[2]);
    if (Y > maxL) hi = mid; else lo = mid;
  }
  const c = make(lo);
  return '#' + c.map(v => toSrgb(Math.max(0, v)).toString(16).padStart(2, '0')).join('');
}
// 地面の塗り。★暗い背景では「暗い地面＋明るい空」だが、明るい背景で同じ色を敷くと
//   画面の下が重い塊になる。明るい背景では地面の色を背景へ GROUND_LIGHT_MIX だけ寄せた
//   淡い色にする（色相は地面の色のまま。境目の線と斜線は濃く読み替わるので地面だと分かる）。
const GROUND_LIGHT_MIX = 0.72;
function groundFillColor(c) {
  if (!isLightCanvas()) return c;
  const m = _parseColor(c), b = _parseColor(canvasBg());
  if (!m || !b) return c;
  const mix = (x, y) => Math.round(x * (1 - GROUND_LIGHT_MIX) + y * GROUND_LIGHT_MIX);
  return themeRaw(`rgb(${mix(m.r, b.r)},${mix(m.g, b.g)},${mix(m.b, b.b)})`);
}
// 2D の描画先の fillStyle / strokeStyle に読み替えを差し込む（文字列の色だけ。グラデーションは素通し）。
//   ★メインキャンバスもグラフの窓など（panel=true）も、いまは選んだ配色だけで決まる。
//     分けてあるのは、メインは「実際の背景の明るさ」（cpal）を見る作りのまま残しているため。
//   ★プロトタイプではなく描画先ごとに掛ける。ツールメニューのアイコンなど、掛けない描画先もある。
function themeHookContext(g, panel) {
  if (g._themeHooked) return g;     // 描くたびに getContext し直す窓もある（同じ描画先が返る）
  g._themeHooked = true;
  const P = CanvasRenderingContext2D.prototype;
  for (const prop of ['fillStyle', 'strokeStyle']) {
    const d = Object.getOwnPropertyDescriptor(P, prop);
    Object.defineProperty(g, prop, {
      configurable: true,
      get() { return d.get.call(this); },
      set(v) { d.set.call(this, themeColor(v, panel ? uiTheme === 'light' : isLightCanvas())); },
    });
  }
  return g;
}
themeHookContext(ctx, false);

// ─── アイコン（index.html の SVG スプライト）の白専用の色 ──────────────────
//   ★アイコンは暗い地で映える明るい色で描いてある（index.html の <symbol> の★）。白い地では
//     一律に暗くするのでなく、1色ずつ白い地用の色を決めて <symbol> の色そのものを差し替える。
//     <use> は symbol を参照しているだけなので、ここを書き換えれば画面じゅうのアイコンが替わる。
//   ★キャンバスの LIGHT_COLOR_MAP とは別の表。アイコンは道具の見分けが役目なので、
//     読ませる文字ほど濃くせず、鮮やかさを残す（Material の 600 番台前後）。
//     2026-10-27 ユーザーの指示で、最初の 700〜800 番台（くすんで見えた）からこちらへ寄せた。
//   ★表に無い色は変えない。初心者マーク（#ffd600 / #2eaa4a）は実物の色なのでそのまま。
const ICON_LIGHT_MAP = {
  '#4fc3f7':'#0a8fd8', '#29b6f6':'#0a8fd8', '#81d4fa':'#1e9be0', '#78c8ff':'#1e7fe6',
  '#4dd0e1':'#00a5b8', '#26c6da':'#00a5b8',
  '#66bb6a':'#2e9e3a', '#81c784':'#3ba845',
  '#ffd54f':'#d99a00', '#ffca28':'#d68a00', '#ffcc80':'#f57c00', '#ffb74d':'#f57000', '#ff7043':'#f4511e',
  '#ef5350':'#e53935', '#f06292':'#e91e63', '#f48fb1':'#ec407a', '#ce93d8':'#9c27b0',
  '#b0bec5':'#607d8b', '#90a4ae':'#607d8b', '#bcaaa4':'#795548', '#e0e6f0':'#2f3b47',
};
// 元の値は data-dark-* に控えておき、黒に戻すときはそれを書き戻す。
//   ★値の中の #色 を1つずつ差し替える。上のバーのアイコンは "var(--ic,#4fc3f7)" の形
//     （ON のとき CSS が --ic で色を倒す）なので、値まるごとではなく中の既定色だけを替える。
function _iconMap(v) { return v.replace(/#[0-9a-fA-F]{3,6}\b/g, h => ICON_LIGHT_MAP[h.toLowerCase()] || h); }
// ★白い地での形（2026-10-28 ユーザーと決めた方針。Fluent のカラーアイコン／SF Symbols の流儀）：
//   ・輪郭の線は濃くする … アイコンの色を ICON_LINE_DARKEN だけ文字色（#1f2a35）へ寄せた色。
//     純粋な濃い灰にしないのは、線だけでできたアイコン（ばね・ロープ・矢印など）が色を失って
//     どれも同じ灰色になるため。色相は残し、明るさだけ文字に近づける。
//   ・色は中の塗りで出す … 塗りの不透明度を ICON_FILL_BOOST 倍（上限 0.85）にする。
//     暗い地の 0.25 は白い地ではほぼ見えない。
//   ・線の太さは css（:root[data-theme="light"] .tool-btn svg.ti）で 1.7 → 2px。
//   ★上のバーのアイコン（色が var(--ic,…)）は対象外。ON のとき CSS が線ごと --ic へ倒す作りで、
//     線の色を symbol に書くとその切り替えが効かなくなる。
const ICON_LINE_DARKEN = 0.25, ICON_FILL_BOOST = 2.2;   // ★線は 0.45 だと濃すぎた（2026-10-28 ユーザー）
function _iconLineColor(hex) {
  const m = _parseColor(hex);
  if (!m) return hex;
  const t = [31, 42, 53], k = ICON_LINE_DARKEN;
  return '#' + [m.r, m.g, m.b].map((v, i) => Math.round(v * (1 - k) + t[i] * k).toString(16).padStart(2, '0')).join('');
}
function _applyIconShape(light) {
  for (const sym of document.querySelectorAll('symbol[id^="ti-"]')) {
    const st = sym.dataset.darkStyle || sym.getAttribute('style') || '';
    const col = /color:\s*(#[0-9a-fA-F]{3,6})/.exec(st);
    if (!col || st.includes('var(')) continue;
    if (light) sym.setAttribute('stroke', _iconLineColor(_iconMap(col[1])));
    else sym.removeAttribute('stroke');
    for (const el of sym.querySelectorAll('[fill-opacity]')) {
      if (el.dataset.darkFillOpacity === undefined) el.dataset.darkFillOpacity = el.getAttribute('fill-opacity');
      const o = parseFloat(el.dataset.darkFillOpacity);
      el.setAttribute('fill-opacity', light ? String(Math.max(o, Math.min(0.85, o * ICON_FILL_BOOST))) : el.dataset.darkFillOpacity);
    }
  }
}
function applyIconTheme() {
  const light = uiTheme === 'light';
  _applyIconShape(light);
  for (const el of document.querySelectorAll('symbol[id^="ti-"], symbol[id^="ti-"] *')) {
    for (const attr of ['fill', 'stroke', 'style']) {
      // ★symbol 自身の stroke は _applyIconShape が白のときだけ付ける線の色。元の色として控えない
      if (el.tagName === 'symbol' && attr !== 'style') continue;
      const key = 'dark' + attr[0].toUpperCase() + attr.slice(1);
      let orig = el.dataset[key];
      if (orig === undefined) {
        const v = el.getAttribute(attr);
        if (!v || !v.includes('#')) continue;
        orig = el.dataset[key] = v;
      }
      el.setAttribute(attr, light ? _iconMap(orig) : orig);
    }
  }
}
applyIconTheme();
