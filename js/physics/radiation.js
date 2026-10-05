// ════════════════════════════════════════
//  熱放射（ステファン・ボルツマン）
//   物体が電磁波として熱を出し入れする。伝導・対流と違って**間に何も要らない**＝
//   真空を隔てても伝わる、という一点がこの機構の存在理由。
//
//  ══ どこまで扱うか（線を引く）══════════════════════════════════
//    扱う：剛体どうしの放射交換／剛体と周囲（world.ambientTemp）との交換／
//          間に別の物体があれば遮られる（影）。
//    扱わない：波長分布・色による放射率の違い・鏡面反射・粒子（水と気体分子）の放射。
//      粒子を入れないのは、SPH の1粒子が 0.63kg の水の塊であって表面ではないため。
//      「水面から放射する」を出すには自由表面の抽出が要り、それは別の話になる。
//
//  ── 既定では放射しない（emissivity = 0）───────────────────────────
//    放射率を既定で 0 にしてある。0.9 のような実物どおりの値を既定にすると、
//    既存のすべてのシーンで温めた物体が勝手に冷え始め、たとえば「熱量保存」の
//    デモの「熱の行き先は水しかない」が黙って崩れる。空気抵抗（drag）を既定 0 に
//    してあるのと同じ扱いで、**使うデモ・使う物体だけが明示的に入れる**。
//
//  ── 幾何：どの物体も「同じ面積の円板」とみなす ────────────────────
//    2次元なので、放射する面は輪郭を奥行き方向へ伸ばした帯になる。
//    物体ごとの輪郭の長さをまじめに使うと**相反則（A_A·F_AB = A_B·F_BA）が
//    崩れて熱量保存が壊れる**ので、どの物体も「面積の等しい円板」に置き換える：
//        等価直径   s   = 2√(面積/π)                     [m]
//        放射する面 A   = π·s·（奥行き）                  [m²]
//        A から見た B の立体角の割合  F_AB = s_B / (2π·d)  （d は中心間距離）
//        やりとりに効く面積          S_AB = A_A·F_AB = s_A·s_B·(奥行き)/(2d)
//    S_AB は A と B を入れ替えても同じ ＝ **相反則が厳密に成り立つ**。
//    だから熱量は「2者間の取引を一度だけ計算する」形（thermal.js の冒頭）に乗り、
//    片方から引いた熱をそのまま他方へ足せる。
//
//  ── 周囲との交換で二重に数えないために ──────────────────────────
//    B のほうを向いている面は、同時に周囲へも放射しているわけではない。
//    そこで周囲との交換には「どの物体にも向いていない残りの割合」1 − ΣF を掛ける
//    （囲い（enclosure）の考え方そのもの）。ΣF は 1 で頭打ちにする。
//
//  ── 速さの倍率は熱伝導と同じものを使う ─────────────────────────
//    world.thermalRate を放射にも掛ける。実物どおりだと遅すぎるのは伝導と同じで
//    （実測：0.5m角・500K・ε=0.9 のブロックが 0.01 K/s しか下がらない）、
//    **同じ倍率を掛けておけば「伝導と放射のどちらが速いか」の比は実物のまま**になる。
//    別々の倍率を持たせると、その比が設定次第で逆転してしまう。
//
//  ── 数値の安定性 ─────────────────────────────────────────────
//    T⁴ は硬い。陽解法のまま放っておくと平衡温度を通り越して振動・発散する。
//    放射も伝導と同じ「熱の網」（thermal.js）に割線のコンダクタンス
//        U = G·(Ta⁴ − Tb⁴)/(Ta − Tb) = G·(Ta² + Tb²)(Ta + Tb)     [W/K]
//    として登録する。網は tick の頭の温度で全部の取引を同時に見積もり、硬い物体の取引を
//    縮めるので、dt や放射率によらず無条件に安定かつ単調（行き過ぎない・負にならない）。
//    割線なので、縮めない限り取引の量は G·(Ta⁴ − Tb⁴) そのもの＝ステファン・ボルツマンのまま。
//    ★2026-09-28 まで、周囲との交換を物体どうしの交換で温まった「あと」の温度で計算して
//      いたため、熱源から受けて周囲へ捨てる定常状態が倍率に比例して低く出ていた
//      （500℃ の黒体から 2.5m の器：理論 137.73℃ に対し、倍率 50000 で 131.33℃）。
//      網に載せて 137.73℃ になった（倍率によらない）。

const STEFAN = 5.670374419e-8;      // [W/(m²·K⁴)] ステファン・ボルツマン定数

// 等価直径 [m]（面積の等しい円板に置き換えたときの直径。上の★）
function radEquivDiameter(b) {
  return 2 * Math.sqrt(Math.max(b.areaM2(), 1e-12) / Math.PI);
}
// 放射する面の面積 [m²]（等価円板の周＝πs を奥行き方向へ伸ばした帯）
function radArea(b) {
  return Math.PI * radEquivDiameter(b) * world.depth;
}
// 放射に参加するか。★門番は bodyHasHeat と揃える（熱伝導率0＝完全な断熱材は
//   熱のやりとりから外れる、というプロパティ欄の説明をここでも守る）。
function bodyRadiates(b) {
  return b.emissivity > 0 && bodyHasHeat(b);
}
// 割線のコンダクタンス [W/K]（上の★）。G は放射のコンダクタンス [W/K⁴]
function radSecantU(G, Ta, Tb) { return G * (Ta*Ta + Tb*Tb) * (Ta + Tb); }
// ── 間に別の物体があるか（影）────────────────────────────────────
//   ★中心どうしを結ぶ1本で判定する。輪郭まで見て部分的な遮りを出すこともできるが、
//     「半分だけ影」を出しても読み取れる題材にならないうえ、遮られたかどうかが
//     連続的に変わると、影の縁で温度がじわっと変わって原因が分かりにくくなる。
//     教材としては「遮った／遮らない」がはっきり切り替わるほうが読める。
function radBlocked(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = len(dx, dy);
  if (!(d > 1e-6)) return false;
  const hit = raycastAll(a.x, a.y, dx/d, dy/d, a, false);   // ★自分は無視。地面は遮る
  return !!(hit && hit.body !== b && hit.t < d);
}

// ── 本体（simTick が tick に一度だけ呼ぶ）───────────────────────────
//   ★温度はここでは動かさず、網へ登録するだけ（thermal.js 熱の網の★）
const _radBuf = [];
function linkRadiation() {
  if (!world.thermalOn) return;
  const rate = world.thermalRate > 0 ? world.thermalRate : 0;
  if (!(rate > 0)) return;
  const list = _radBuf;
  list.length = 0;
  for (const b of objects) if (bodyRadiates(b)) list.push(b);
  if (!list.length) return;
  const n = list.length;
  // 諸元を1回だけ作る（面積・等価直径）
  const s = new Array(n), A = new Array(n), fSum = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    s[i] = radEquivDiameter(list[i]);
    A[i] = Math.PI * s[i] * world.depth;
  }
  // ── ① 物体どうし ────────────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const a = list[i];
    for (let j = i + 1; j < n; j++) {
      const b = list[j];
      const d = len(b.x - a.x, b.y - a.y);
      // ★中心間距離は「触れている」ところで下限を打つ。0 に近づくと S が発散する。
      const dMin = (s[i] + s[j]) * 0.5 * M2PX;   // [px] 等価円板が接する距離
      const dd = Math.max(d, dMin);
      // 見える割合（立体角の割合）。合計が1を超えないよう、あとで頭打ちにする
      const fAB = s[j] / (2 * Math.PI * (dd * PX2M));
      const fBA = s[i] / (2 * Math.PI * (dd * PX2M));
      if (radBlocked(a, b)) continue;            // ★遮られていたら、周囲ぶんの取り分にも数えない
      fSum[i] += fAB; fSum[j] += fBA;
      const S = s[i] * s[j] * world.depth / (2 * dd * PX2M);   // [m²] 相反則を満たす面積
      const G = STEFAN * a.emissivity * b.emissivity * S * rate;
      heatNetLink(HN_BODY, a, HN_BODY, b, radSecantU(G, a.temp, b.temp));
    }
  }
  // ── ② 周囲との交換 ──────────────────────────────────────────
  //   ★系の外との出入りなので、網の「周囲」の節点が reservoirHeatTotal に積む。これで
  //     Δ(系の熱量) = 散逸で出た熱 + 熱源が与えた熱 の台帳が閉じたままになる。
  //   ★周囲は熱容量が無限なので、網の縮め率のおかげで周囲の温度を通り越すこともない。
  const Tenv = world.ambientTemp;
  for (let i = 0; i < n; i++) {
    const b = list[i];
    const open = 1 - Math.min(1, fSum[i]);        // どの物体にも向いていない割合
    if (!(open > 0)) continue;
    const G = STEFAN * b.emissivity * A[i] * open * rate;
    heatNetLink(HN_BODY, b, HN_AMB, _hn.amb, radSecantU(G, b.temp, Tenv));
  }
}

