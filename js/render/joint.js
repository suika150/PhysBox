function jointAtPoint(wx, wy) {
  const thresh = 8 / cam.zoom;
  for (let i = joints.length - 1; i >= 0; i--) {
    const j = joints[i];
    const a = j.getWorldAnchorA(), b = j.getWorldAnchorB();

    let pts;
    if (j.type === 'rope') {
      ensureRopeNodes(j);
      pts = [a, ...j.nodes.map(n=>({x:n.x,y:n.y})), b];
    } else pts = [a, b];
    for (let k=0;k<pts.length-1;k++){
      const p0=pts[k], p1=pts[k+1];
      const dx=p1.x-p0.x, dy=p1.y-p0.y, segL2=dx*dx+dy*dy;
      let t = segL2>0 ? ((wx-p0.x)*dx + (wy-p0.y)*dy)/segL2 : 0;
      t = t<0?0:t>1?1:t;
      const qx=p0.x+dx*t, qy=p0.y+dy*t;
      if (Math.hypot(wx-qx, wy-qy) <= thresh) return j;
    }
  }
  return null;
}
// 地面に取り付けた端の印。地面に打ち込んだ杭に見えるよう、地面へ食い込む短い線を出す。
//   背景（空間に固定した点）に留めた端と見分けがつかないと、地面を傾けたときに
//   どちらが一緒に動くのか分からなくなる。
function drawGroundStake(sx, sy) {
  const a = ground.angle;                      // 画面座標も world と同じ向き（y下が正）
  const nx = Math.sin(a), ny = -Math.cos(a);   // 地面から離れる向き
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(sx + nx * 5, sy + ny * 5);
  ctx.lineTo(sx - nx * 7, sy - ny * 7);
  ctx.strokeStyle = '#cfd8dc';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}
// ロープの見た目の折れ線（画面座標）。選択中の水色の帯と縄の本体で必ず同じものを使う。
//   ★張り切ったロープは、節点がまだ直線へ収束していなくても直線で描く（taut の分岐）。
//     以前はこの分岐を縄の本体しか持っておらず、水色の帯は常に節点をなぞっていたので、
//     たるみが取れて張った瞬間に帯だけが元のたるんだ形に取り残されていた。
//     曲線の描き方（strokeCatmullRom）も揃える必要がある。帯だけ直線で結ぶと、
//     たるんだ縄では角のところで帯が内側にずれる。
function ropeScreenPoints(j, sa, sb, wa, wb) {
  ensureRopeNodes(j);
  const chord = len(wb.x - wa.x, wb.y - wa.y);
  let wrapped = false;
  if (j.nodes) for (const n of j.nodes) if (n._touchT > 0) { wrapped = true; break; }
  const taut = chord >= j.maxLength - 1.5;              // slop と同じ許容差
  if (!taut || wrapped) return [sa, ...j.nodes.map(n => worldToScreen(n.x, n.y)), sb];
  const N = j.nodes.length + 1;                         // 支点＋節点＋先端 の区間数
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push(worldToScreen(wa.x + (wb.x - wa.x) * t, wa.y + (wb.y - wa.y) * t));
  }
  return pts;
}
function drawJoint(j) {
  const wa=j.getWorldAnchorA(), wb=j.getWorldAnchorB();
  const sa=worldToScreen(wa.x,wa.y), sb=worldToScreen(wb.x,wb.y);
  // ★外してあるヒンジは、物体側の穴だけを白抜きの輪で描く（釘を抜いた跡）。
  //   釘の側（背景・地面）は描かない：留め直すときはいまの穴の位置へ打ち直すので、
  //   元の場所に残った印は「次にそこへ戻る」と誤読される（setHingeDetached の★）。
  if (j.detached) {
    const dynB = j.bodyB && !j.bodyB.isStatic && !(j.bodyA && !j.bodyA.isStatic);
    const sp = dynB ? sb : sa;
    ctx.save();
    if (j.id === selectedJointId || isBulkSelected('joint', j)) {
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(79,195,247,0.35)'; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
    ctx.strokeStyle = j.color || '#ffd54f'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
    return;
  }
  if (j.groundA) drawGroundStake(sa.x, sa.y);
  if (j.groundB) drawGroundStake(sb.x, sb.y);
  ctx.save();
  // ★範囲選択で拾った端の印。どちらの端が動くのかが見えないと、片端だけ選んだのか
  //   両端なのか（＝伸びるのか平行移動なのか）が操作前に分からない。
  for (const [selEnd, sp] of [['A', sa], ['B', sb]]) {
    if (!isJointEndSelected(j, selEnd)) continue;
    ctx.save();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(79,195,247,0.25)'; ctx.fill();
    ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }
  if (j.id === selectedJointId || isBulkSelected('joint', j)) {   // ★一括選択の仲間も強調する
    ctx.save();
    ctx.strokeStyle = 'rgba(79,195,247,0.5)';
    ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    if (j.type === 'rope') {
      strokeCatmullRom(ropeScreenPoints(j, sa, sb, wa, wb));   // 本体とまったく同じ形
    } else {
      ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y);
    }
    ctx.stroke();
    ctx.restore();
  }
  if (j.type==='spring') {
    drawSpringLine(sa, sb, j.color, j.restLength * cam.zoom);
    drawAnchorDot(sa.x, sa.y, j.color || '#ffd54f');
    drawAnchorDot(sb.x, sb.y, j.color || '#ffd54f');
  } else if (j.type==='rope') {
    ensureRopeNodes(j);
    ctx.strokeStyle = '#8d6e63';
    ctx.lineWidth = Math.max(2, j.radius * 2 * cam.zoom);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    strokeCatmullRom(ropeScreenPoints(j, sa, sb, wa, wb));
    ctx.stroke();
    drawAnchorDot(sa.x, sa.y, '#8d6e63');
    drawAnchorDot(sb.x, sb.y, '#8d6e63');
  } else if (j.type==='rod') {
    ctx.strokeStyle = '#607d8b';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(sa.x,sa.y); ctx.lineTo(sb.x,sb.y); ctx.stroke();
    drawAnchorDot(sa.x, sa.y, '#607d8b');
    drawAnchorDot(sb.x, sb.y, '#607d8b');
  } else if (j.type==='hinge') {
    ctx.strokeStyle = j.color;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sa.x,sa.y); ctx.lineTo(sb.x,sb.y); ctx.stroke();
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath(); ctx.arc(sa.x,sa.y,5,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(sb.x,sb.y,5,0,Math.PI*2); ctx.fill();
  } else if (j.type==='axle') {
    ctx.strokeStyle = '#b0bec5';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sa.x,sa.y); ctx.lineTo(sb.x,sb.y); ctx.stroke();
    ctx.fillStyle = '#37474f';
    ctx.beginPath(); ctx.arc(sa.x,sa.y,6,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#b0bec5'; ctx.lineWidth=1.5; ctx.stroke();
  } else if (j.type==='fixjoint') {
    const dx = sb.x - sa.x, dy = sb.y - sa.y;
    const sameSpot = (dx*dx + dy*dy) < 4;
    const rel   = !!j.releasable;
    const cMain = rel ? '#66bb6a' : '#ef5350';
    const cHole = rel ? '#1b5e20' : '#7f1d1d';
    if (!sameSpot) {
      ctx.strokeStyle = cMain;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    }

    const drawFixMarker = (px, py) => {
      const r = 7;
      ctx.save();
      ctx.translate(px, py);
      if (rel) {
        ctx.beginPath();
        ctx.arc(0, 0, r + 3.5, 0, Math.PI*2);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(102,187,106,0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI/6 + i*Math.PI/3;
        const x = Math.cos(a)*r, y = Math.sin(a)*r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = cMain;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r*0.4, 0, Math.PI*2);
      ctx.fillStyle = cHole;
      ctx.fill();
      ctx.restore();
    };
    drawFixMarker(sa.x, sa.y);
    if (!sameSpot) drawFixMarker(sb.x, sb.y);
  }
  ctx.restore();
  drawJointLayerBadge(j);
}

function drawJointLayerBadge(j) {
  if (!world.showLayerBadges) return;  
  if (j.type !== 'rope' && j.type !== 'rod') return;
  if (j.layers === LAYER_DEFAULT) return;
  const a = j.getWorldAnchorA(), b = j.getWorldAnchorB();
  const s = worldToScreen((a.x + b.x) / 2, (a.y + b.y) / 2);
  ctx.save();
  ctx.setLineDash([]);
  if (j.layers === 0) {
    ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(255,255,100,0.8)'; ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]); ctx.stroke();
    ctx.restore(); return;
  }
  let k = 0;
  for (let i = 0; i < LAYER_COUNT; i++) {
    if (!(j.layers & (1 << i))) continue;
    const x = s.x + 6 + k*9, y = s.y - 8;
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI*2);
    ctx.fillStyle = LAYER_COLORS[i]; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 1; ctx.stroke();
    k++;
  }
  ctx.restore();
}
function strokeCatmullRom(p) {
  const n = p.length;
  if (n < 3) { ctx.moveTo(p[0].x, p[0].y); for (let i=1;i<n;i++) ctx.lineTo(p[i].x, p[i].y); return; }
  ctx.moveTo(p[0].x, p[0].y);
  for (let i = 0; i < n - 1; i++) {
    const p0 = p[i > 0 ? i-1 : 0], p1 = p[i], p2 = p[i+1], p3 = p[i+2 < n ? i+2 : n-1];
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x)/6, p1.y + (p2.y - p0.y)/6,
      p2.x - (p3.x - p1.x)/6, p2.y - (p3.y - p1.y)/6,
      p2.x, p2.y);
  }
}
function drawSpringLine(a, b, color, restLengthScreen = null) {
  const dx=b.x-a.x, dy=b.y-a.y;
  const dist=Math.sqrt(dx*dx+dy*dy);
  if (dist < 2) return;
  const nx=dx/dist, ny=dy/dist;
  const perpx=-ny, perpy=nx;
  const rest = restLengthScreen || dist;
  const coils = Math.max(3, Math.round(rest / 15));
  let amp = 8 * (rest / dist);
  amp = Math.max(2, Math.min(amp, 20));
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  for (let i=0;i<=coils*4;i++) {
    const t=i/(coils*4);
    const side = Math.sin(t*coils*Math.PI*2)*amp;
    ctx.lineTo(a.x+nx*dist*t+perpx*side, a.y+ny*dist*t+perpy*side);
  }
  ctx.strokeStyle = color || '#ffd54f';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
