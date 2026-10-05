#!/usr/bin/env node
// 目録のデモを全部開いて、ページ内エラーが出ないかを見る（デモが唯一の回帰テスト）。
//   node tools/run-all-demos.js [ticks]
// ★1ページで順に開く。落ちたデモ名とエラーを並べて出し、1件でもあれば終了コード 1。
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const ticks = Number(process.argv[2] ?? 60);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  let current = '(起動)';
  const note = s => errors.push(`${current}: ${s}`);
  page.on('pageerror', e => note(String(e)));
  page.on('console', m => { if (m.type() === 'error') note(m.text()); });
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href,
                  { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');

  const names = await page.evaluate(() => {
    const out = [];
    for (const f of DEMO_CATALOG) for (const u of f.units) for (const d of u.demos)
      if (d.fn) out.push(d.name);
    return out;
  });
  console.log(`デモ ${names.length} 件を ${ticks} tick ずつ回します`);

  for (const name of names) {
    current = name;
    await page.evaluate(({ name, ticks }) => {
      let fn = null;
      for (const f of DEMO_CATALOG) for (const u of f.units) for (const d of u.demos)
        if (d.name === name) fn = d.fn;
      // ★窓から開くときと同じ手順を踏む（js/ui/demo-browser.js の runDemo）。
      //   clearScene を通さないと、前のデモのリモコン・プログラム・物体が積み残る。
      closeToolPopups(); setTool('pointer'); clearScene(); simPause();
      buildingScene = true;
      try { fn(); } finally { buildingScene = false; }
      updatePropsPanel(null); syncWorldPanel();
      // ★同じ物体が objects に2回入っていないか。実行中は1つの物体なので見た目では
      //   気づけないが、1 tick に2回積分され、↩（JSON から作り直し）で2つに分かれる。
      //   実例：図形和（demoUnion は自分で入れる）をデモ側でもう一度 push していた。
      const dup = objects.length - new Set(objects).size;
      if (dup) console.error('objects に同じ物体が ' + dup + ' 個重複しています');
      for (let t = 0; t < ticks; t++) simTick();
    }, { name, ticks });
    await page.waitForTimeout(20);   // 描画を1フレーム回してエラーを拾う
  }
  await browser.close();

  if (!errors.length) { console.log('エラーなし'); return; }
  console.error(`--- ${errors.length} 件のエラー ---`);
  for (const e of errors.slice(0, 40)) console.error(e);
  process.exit(1);
})();
