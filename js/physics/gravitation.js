function applyCustomPhysics(dt) {              // ★dt[秒] を受け取る
  for(const b of objects){
    if(b._sun){
      const dx=b._sun.x-b.x, dy=b._sun.y-b.y;
      const d=Math.hypot(dx,dy)+0.001;
      const a=1800000/(d*d);                   // [px/s²]（旧 500 px/frame² × 3600）
      b.vx+=dx/d*a*dt;
      b.vy+=dy/d*a*dt;
    }
  }
}
// ── 万有引力：物体間の引力 F = G_sim·m₁m₂/(r²+ε²) ──
//   ε はソフトニング（r→0 の発散防止）。静的物体は源になるが力を受けない。
// ★ε は px の絶対値なので、「軌道の大きさに比べて十分小さい」ことが要る。既定の 8px は
//   ぶつかる大きさの物体（半径 10〜300px）どうしが接触寸前でも発散しない値として選んである。
//   ところが縮尺模型では軌道のほうが小さくなり、ε が効いてしまう：
//   実測、太陽系のデモ（1 AU = 120px）で木星の衛星を半径 10px に置くと、ε=8px では
//   引力が 38% も減り、衛星の周期の比が 1 : 2.0 : 4.0 : 9.4 から 1 : 1.8 : 3.3 : 7.5 へずれた
//   ＝ ケプラーの第3法則が成り立たなくなる（惑星側も水星で周期が 1.5% 伸びていた）。
//   だから定数ではなく world の設定にしてある（world.gravSoften [px]）。ぶつからない
//   点状の天体だけを扱う場面では 1px 程度まで下げてよい（0 は r→0 で発散するので不可）。
//   ★下限 0.1px は 0 を入れられたときに r=0 で NaN を出さないための床。物理的には
//     0.01px² ＝ どの軌道に対しても無視できる大きさなので、見え方は 0 と変わらない。
function gravSoften2() { const e = world.gravSoften; return e > 0.1 ? e * e : 0.01; }
//   ★step.js はこれを1サブステップに2回、半分の刻みで呼ぶ（位置を進める前と後。速度ベルレ）。
//     post＝後ろの半分。後ろの半分で足した速度は位置の更新に使われていないので、その量を
//     物体の _gHx/_gHy（一様な重力の半分と同じ帳簿）に足す。接触の接線ずれの補正
//     （collision.js の _vtPos）がそれを差し引いて、斜面で止まった物体を這い上がらせない。
//     ★2026-09-27 に半分ずつへ直した。以前は integrate のあとに1サブステップぶんを丸ごと
//       足していた（位置を進めてから力を足す）。実測（表面の重力 9.8 m/s² の静的な星・4刻み）：
//         反発1の球を星の表面で60秒弾ませる  旧 E +41%（跳ねる高さ 190→434px）→ 新 +0.8%
//         円軌道（半径 300px）10周の半径の振れ 旧 299.59〜300.42px → 新 300.000〜300.011px
//         連星のデモ 軌道半径の標準偏差 旧 0.089% → 新 0.010%（周期・重心・運動量は変わらず）
//       星の表面の斜面（てっぺんから10°・μ0.5）に置いた箱は新旧とも60秒で0px（後ろの半分を
//       _gHx に足さないと、接線ずれの補正が戻しすぎる）。予測線（predict.js）は新旧とも本番と 0px。
function applyGravitation(dt, post) {
  if (!world.gravitation) return;
  const G = world.gravStrength;
  const soften2 = gravSoften2();
  const n = objects.length;
  for (let i = 0; i < n; i++) {
    const a = objects[i];
    if (!a.hasGravity || !isFieldSource(a)) continue;
    for (let j = i + 1; j < n; j++) {
      const b = objects[j];
      if (!b.hasGravity || !isFieldSource(b)) continue;
      if (a.isStatic && b.isStatic) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const r2 = dx*dx + dy*dy + soften2;
      const invr = 1 / Math.sqrt(r2);
      const f = G * a.mass * b.mass / r2;      // 力の大きさ [kg·px/s²]
      const fx = f * dx * invr, fy = f * dy * invr;
      // 引き合う相手としては参加するが、力を受け取るのは動かせる物体だけ
      // （掴んでドラッグ中の物体に速度を溜めると、接触解決で相手が弾き飛ばされる）
      if (acceptsForce(a)) {
        const ax = (fx / a.mass) * dt, ay = (fy / a.mass) * dt;
        a.vx += ax; a.vy += ay;
        if (post) { a._gHx = (a._gHx || 0) + ax; a._gHy = (a._gHy || 0) + ay; }
        a.recordForce('gravity', fx*dt, fy*dt);
      }
      if (acceptsForce(b)) {
        const bx = (fx / b.mass) * dt, by = (fy / b.mass) * dt;
        b.vx -= bx; b.vy -= by;
        if (post) { b._gHx = (b._gHx || 0) - bx; b._gHy = (b._gHy || 0) - by; }
        b.recordForce('gravity', -fx*dt, -fy*dt);
      }
    }
  }
}
// ════════════════════════════════════════
//  GIF録画（範囲指定 → 3秒カウントダウン → 録画 → 保存/破棄）
// ════════════════════════════════════════
