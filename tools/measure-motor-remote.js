#!/usr/bin/env node
// モーターに付けたリモコンが、窓に書いてあるとおりに効くかを測る（1条件＝1ページ）。
//   node tools/measure-motor-remote.js
// 見るのは2つ：
//   ① 〈押すと止まる〉で本当に止まるか（切るだけだと、摩擦の無い軸は回り続ける）
//   ② 眠った軸が、押したときに起き上がって回り出せるか
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

// 台座＋円板＋モーター。重力を切って、軸以外なにも触れない状態で測る。
const build = brake => `
  objects.length = 0; joints.length = 0; particles.length = 0;
  world.gravity = false;
  const mount = new Body({ type:'box', x:400, y:400, w:26, h:26, isStatic:true, mass:0 });
  objects.push(mount);
  const disk = new Body({ type:'circle', x:400, y:400, radius:60, mass:1,
                          friction:0, frictionStatic:0, restitution:0 });
  objects.push(disk);
  const axle = new Joint({ type:'axle', bodyA:mount, bodyB:disk,
    anchorAx:0, anchorAy:0, anchorBx:0, anchorBy:0,
    motorSpeed: 6.0, motorTorque: 20, motorBrake: ${brake} });
  joints.push(axle);
`;

const CASES = [
  { title: '〈押すと止まる〉放したら止める＝切', mode: 'off', brake: false },
  { title: '〈押すと止まる〉放したら止める＝入', mode: 'off', brake: true  },
  { title: '〈押すと効く〉  眠った軸を押す',     mode: 'on',  brake: false },
  { title: '〈押すと逆に効く〉眠った軸を押す',   mode: 'rev', brake: false },
];

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];
  for (const c of CASES) {
    // ★1ケース＝1ページ。作り直すと再現しない（シーンを消して組み直すと、
    //   眠りのタイマーや前のリモコンの印が残る経路がある）。
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href,
                    { waitUntil: 'load' });
    await page.waitForSelector('#main-canvas');
    const rec = await page.evaluate(({ src, mode }) => {
      (0, eval)(src);
      const disk = objects[1], axle = joints[0];
      const r = addRemote('motor', axle, 'joint');
      r.mode = mode;
      const out = [];
      const run = (n, label) => { for (let t = 0; t < n; t++) simTick();
                                  out.push([label, disk.av, disk.sleeping]); };
      run(180, '押す前 3.0s');
      r._on = true;
      run(6,   '押して 0.1s');
      run(174, '押して 3.0s');
      r._on = false;
      run(60,  '放して 1.0s');
      return out;
    }, { src: build(c.brake), mode: c.mode });
    console.log(c.title);
    for (const [k, v, s] of rec)
      console.log(`  ${k.padEnd(12)} 角速度 ${v.toFixed(3).padStart(7)} rad/s  眠り=${s ? 'あり' : 'なし'}`);
    await page.close();
  }
  await browser.close();
  if (errors.length) { console.error('--- ページ内エラー ---'); errors.slice(0,5).forEach(e => console.error(e)); }
})();
