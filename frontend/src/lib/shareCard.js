export function downloadShareCard(glCanvas, event, mass) {
  const W = 1080;
  const H = 1080;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  // background: capture the live WebGL frame if possible
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  try {
    const canvas2d = glCanvas && glCanvas.current ? glCanvas.current : glCanvas;
    if (canvas2d && canvas2d.width) {
      const s = Math.max(W / canvas2d.width, H / canvas2d.height);
      const dw = canvas2d.width * s;
      const dh = canvas2d.height * s;
      ctx.drawImage(canvas2d, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
  } catch {
    /* tainted or unavailable — keep black */
  }

  // dark gradient for legibility
  const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.92)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // top label
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '700 34px Inter, system-ui, sans-serif';
  ctx.fillText('THE INTERNET VOID', W / 2, 90);

  ctx.font = '600 24px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('BLACK HOLE MASS', W / 2, 140);

  ctx.font = '900 96px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#ffcf8a';
  ctx.shadowColor = 'rgba(255,160,60,0.8)';
  ctx.shadowBlur = 40;
  ctx.fillText(
    Number(mass || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + ' M☉',
    W / 2,
    240
  );
  ctx.shadowBlur = 0;

  // the sacrificed object
  const label = (event?.text || event?.name || 'destroyed').slice(0, 60);
  ctx.font = '800 54px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  wrapText(ctx, label, W / 2, H - 300, W - 160, 62);

  ctx.font = '700 30px Inter, system-ui, sans-serif';
  ctx.fillStyle = event?.premium ? '#ff7ae0' : '#ffb066';
  ctx.fillText(
    event?.premium ? 'GAMMA BURST ⚡' : 'SUCKED INTO THE VOID',
    W / 2,
    H - 170
  );

  ctx.font = '600 26px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('throwyoursin.com', W / 2, H - 90);

  c.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'void-' + Date.now() + '.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const startY = y - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineH));
}
