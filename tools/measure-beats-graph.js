#!/usr/bin/env node
// うなりのデモで、受信計が振動数 f を出す／出さないがどう入れかわるかを測る。
//   node tools/measure-beats-graph.js [secs]
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const secs = Number(process.argv[2] ?? 20);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href,
                  { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');

  const out = await page.evaluate(({ secs }) => {
    closeToolPopups(); setTool('pointer'); clearScene(); simPause();
    buildingScene = true; try { demoBeats(); } finally { buildingScene = false; }
    const g = waveGraphs[0];
    const T = Math.round(secs * 60);
    // ★ゼロ交差の間隔そのものを拾う（f を出す／出さないの判定より手前の生の量）。
    //   「乱れているのは何周期ぶんか」が分かると、空白の幅が現象のせいか
    //   測り方（WG_KEEP_PERIODS で1つの乱れが次の4周期を巻き添えにする）のせいか分けられる。
    const cross = [];
    let last = null;
    for (let t = 0; t < T; t++) {
      simTick();
      if (g._tCross !== null && g._tCross !== last) { cross.push(g._tCross); last = g._tCross; }
    }
    const periods = [];
    for (let i = 1; i < cross.length; i++) periods.push(cross[i] - cross[i-1]);
    const med = periods.slice().sort((a,b)=>a-b)[periods.length >> 1] || 1;
    const bad = periods.filter(T2 => Math.abs(T2 - med) / med > 0.06).length;
    // 理由ごとの tick 数と、f が出た区間の切れ目を数える
    const tally = {};
    let runs = 0, prev = null, fmin = Infinity, fmax = 0;
    for (const s of g.samples) {
      const key = s.f === null ? '（理由つきで空白）' : 'f が出た';
      tally[key] = (tally[key] || 0) + 1;
      if (s.f !== null) { fmin = Math.min(fmin, s.f); fmax = Math.max(fmax, s.f); }
      const on = s.f !== null;
      if (on && prev === false) runs++;
      if (on && prev === null) runs++;
      prev = on;
    }
    return { n: g.samples.length, tally, runs,
             fmin: fmin === Infinity ? null : fmin, fmax: fmax || null,
             reason: g.reason, fA: waveSources[0].freq, fB: waveSources[1].freq,
             nPeriods: periods.length, bad, med, keep: WG_KEEP_PERIODS };
  }, { secs });

  console.log(`うなりのデモ：fA=${out.fA} Hz / fB=${out.fB} Hz（うなり ${Math.abs(out.fA-out.fB).toFixed(1)} Hz）`);
  console.log(`  標本 ${out.n} 個（${secs} 秒）`);
  for (const k in out.tally)
    console.log(`  ${k.padEnd(20)} ${String(out.tally[k]).padStart(5)} tick  (${(100*out.tally[k]/out.n).toFixed(1)}%)`);
  console.log(`  f が出た区間の本数： ${out.runs}  ＝ この回数だけ線が切れて飛び飛びになる`);
  if (out.fmin !== null)
    console.log(`  出たときの f の幅： ${out.fmin.toFixed(2)} 〜 ${out.fmax.toFixed(2)} Hz`
              + `（平均振動数 ${( (out.fA+out.fB)/2 ).toFixed(2)} Hz）`);
  console.log(`  最後の理由： ${out.reason ?? '（無し＝f を出していた）'}`);
  console.log(`  ゼロ交差の間隔： ${out.nPeriods} 本（中央値 ${out.med.toFixed(3)} s ＝ ${(1/out.med).toFixed(2)} Hz）`);
  console.log(`    うち中央値から 6% 以上ずれたもの： ${out.bad} 本`
            + `（＝本当に乱れている周期。残り ${out.nPeriods - out.bad} 本はそろっている）`);
  console.log(`    ★1本の乱れが、そのあと WG_KEEP_PERIODS=${out.keep} 周期ぶん判定に残る`);
  await browser.close();
  if (errors.length) { console.error('--- ページ内エラー ---'); errors.slice(0,5).forEach(e => console.error(e)); }
})();
