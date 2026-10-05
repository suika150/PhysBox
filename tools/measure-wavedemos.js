#!/usr/bin/env node
// 波動デモの★の実測値を取り直す。★1ページ＝1デモ＝1条件（同じページで作り直すと汚染する）。
//   node tools/measure-wavedemos.js wt 0      … 横波と縦波
//   node tools/measure-wavedemos.js rf 0.3    … 波の反射
//
// ★変位の基準は「作った直後の節点の位置」。両端を結ぶ線を基準にすると、端そのものの
//   振れが定義上 0 になり、自由端が測れない（最初これで全ゼロを出した）。
// 横波と縦波 … 900tick 落ち着かせてから 300tick。
//   一様さ … 節点ごとの振れ幅（平均位置からのずれの最大）の、両端 10% を除いた min/max。
//            1.0 が完全な進行波。★のものとは定義が同じとは限らないので、絶対値ではなく
//            damp 0 との差で読む。
// 波の反射 … X を 43tick 押して放す。端の振れが最大になる tick を反射の時刻として前後に
//   分け、左 60% の区間で符号つきの極値を読む（符号：下向きが正＝内部の y と同じ向き）。
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const which = process.argv[2] || 'wt';
const damp  = Number(process.argv[3] ?? 0);

const RUN = async ({ which, damp }) => {
  let s = 88172645463325252n;
  Math.random = () => { s ^= s << 13n; s ^= s >> 7n; s ^= s << 17n;
    return Number(s & 0xffffffffn) / 4294967296; };

  if (which === 'wt') {
    demoWaveTypes();
    for (const S of slinkies) { S.damp = damp; S._sync(); }
    const SS = slinkies.slice(0, 2);          // 0:横波 1:縦波
    for (let t = 0; t < 900; t++) simTick();
    const N = SS.map(S => S.nodes.length);
    const sum = SS.map((S, k) => Array.from({ length: N[k] }, () => ({ x:0, y:0 })));
    const frames = SS.map(() => []);
    for (let t = 0; t < 300; t++) {
      simTick();
      SS.forEach((S, k) => {
        frames[k].push(S.nodes.map(n => ({ x:n.x, y:n.y })));
        S.nodes.forEach((n, i) => { sum[k][i].x += n.x; sum[k][i].y += n.y; });
      });
    }
    return SS.map((S, k) => {
      const mean = sum[k].map(p => ({ x:p.x/300, y:p.y/300 }));
      const dev = new Array(N[k]).fill(0);
      for (const f of frames[k]) f.forEach((p, i) => {
        const d = Math.hypot(p.x - mean[i].x, p.y - mean[i].y);
        if (d > dev[i]) dev[i] = d;
      });
      const a = Math.floor(N[k]*0.10), b = Math.min(N[k]-1, Math.ceil(N[k]*0.90));
      let mn = Infinity, mx = 0;
      for (let i = a; i <= b; i++) { mn = Math.min(mn, dev[i]); mx = Math.max(mx, dev[i]); }
      return { unif: mn/mx, amp: mx };
    });
  }

  demoWaveReflection();
  for (const S of slinkies) { S.damp = damp; S._sync(); }
  const SS = slinkies.slice(0, 2);            // 0:固定端 1:自由端
  const base = SS.map(S => S.nodes.map(n => n.y));
  const rem = remotes[0];
  // ★行きと帰りの分かれ目は「山の位置が右端に届いた tick」で決める。端の振れで決めると
  //   固定端（端は 0.02px しか動かない）では雑音が最大値になり、帰りの符号を読み損ねる。
  const rec = SS.map(() => ({ endPk:0, endT:0, hist:[], turn:-1 }));
  for (let t = 0; t < 480; t++) {
    rem._on = (t < 43);
    simTick();
    SS.forEach((S, k) => {
      const nd = S.nodes, N = nd.length;
      const e = Math.abs(nd[N-1].y - base[k][N-1]);
      if (e > rec[k].endPk) { rec[k].endPk = e; rec[k].endT = t; }
      // ★窓は弦の中ほど（25〜55%）。左 60% だと波源側の端が入り、戻ってきた山が台で
      //   二度目の反射をした瞬間（行きより大きい −66.7px）を拾ってしまう。
      let ext = 0, pk = 0, pkI = 0;
      for (let i = 0; i < N; i++) {
        const d = nd[i].y - base[k][i];
        if (i >= N*0.25 && i <= N*0.55 && Math.abs(d) > Math.abs(ext)) ext = d;
        if (Math.abs(d) > pk) { pk = Math.abs(d); pkI = i; }
      }
      if (rec[k].turn < 0 && pkI >= N*0.85) rec[k].turn = t;
      // 帰りの山が波源へ戻り切る前で切る
      if (rec[k].turn >= 0 && t > rec[k].turn && rec[k].stop === undefined && pkI < N*0.2)
        rec[k].stop = t;
      rec[k].hist.push(ext);
    });
  }
  return SS.map((S, k) => {
    const { endPk, endT, hist, turn } = rec[k];
    const stop = rec[k].stop === undefined ? hist.length : rec[k].stop;
    let go = 0, back = 0;
    for (let t = 0; t < hist.length; t++) {
      if (turn >= 0 && t > turn) { if (t < stop && Math.abs(hist[t]) > Math.abs(back)) back = hist[t]; }
      else if (Math.abs(hist[t]) > Math.abs(go)) go = hist[t];
    }
    return { go, back, endPk, endT: endT/60, turn: turn/60 };
  });
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href,
                  { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');
  const r = await page.evaluate(RUN, { which, damp });
  await browser.close();

  const sg = v => (v > 0 ? '+' : '') + v.toFixed(1);
  if (which === 'wt') {
    console.log(`■ 横波と縦波　damp = ${damp}`);
    ['横波', '縦波'].forEach((nm, k) =>
      console.log(`  ${nm} … 一様さ ${r[k].unif.toFixed(3)}　振れ幅 ${r[k].amp.toFixed(1)} px`));
  } else {
    console.log(`■ 波の反射　damp = ${damp}`);
    ['固定端', '自由端'].forEach((nm, k) =>
      console.log(`  ${nm} … 行き ${sg(r[k].go)} px　端の振れ ${r[k].endPk.toFixed(2)} px`
        + `　帰り ${sg(r[k].back)} px（折り返し ${r[k].turn.toFixed(2)}秒）`));
  }
  if (errors.length) { console.error('--- ページ内エラー ---'); errors.slice(0,5).forEach(e => console.error(e)); }
})();
