#!/usr/bin/env node
// physBox.html を Chromium で開いてスクリーンショットを撮る。
//
//   node tools/shot.js out.png                         キャンバスだけ（既定・軽い）
//   node tools/shot.js out.png --full                  ページ全体
//   node tools/shot.js out.png --size 1280x720         ウィンドウサイズ
//   node tools/shot.js out.png --eval "setTool('rect')"  撮る前に走らせるJS
//   node tools/shot.js out.png --wait 500              JS実行後の待ち時間(ms)
//
// 注意: 既定は #main-canvas だけを切り出す。全画面より画像トークンが 1/4 で済み、
// 見たい描画部分の解像度は落ちないため（tools/ 以外の UI を確認したいときだけ --full）。

const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

(async () => {
  const out = process.argv[2];
  if (!out || out.startsWith('--')) {
    console.error('usage: node tools/shot.js <出力パス.png> [--full] [--size WxH] [--eval JS] [--wait ms]');
    process.exit(1);
  }

  const [w, h] = arg('--size', '1280x800').split('x').map(Number);
  const setup = arg('--eval', null);
  const wait = Number(arg('--wait', 300));
  const full = process.argv.includes('--full');

  // コンテナ内では Chromium のサンドボックスが使えない
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: w, height: h } });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const url = pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');

  if (setup) await page.evaluate(setup);
  await page.waitForTimeout(wait);

  const target = full ? page : page.locator('#main-canvas');
  await target.screenshot({ path: path.resolve(out) });

  await browser.close();

  if (errors.length) {
    console.error('--- ページ内エラー ---');
    for (const e of errors) console.error(e);
  }
  console.log(`saved: ${path.resolve(out)}${full ? ' (全体)' : ' (#main-canvas)'}`);
  process.exit(errors.length ? 1 : 0);
})();
