// 주간 기록 카드 (도트 스타일 PNG). Scene의 도트 글꼴·스프라이트 도구를 그대로 쓴다.
(function () {
  const W = 640, H = 380, T = 2; // 1280 x 760 PNG
  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  function lighten(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.round(v + (255 - v) * f);
    return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
  }

  function renderCard(data, packs) {
    const canvas = document.createElement('canvas');
    const sc = new window.Scene(canvas);
    canvas.width = W * T;
    canvas.height = H * T;
    sc.T = T;
    sc.w = W;
    sc.h = H;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // 배경 · 틀
    sc.frameBox(0, 0, W, H);
    for (let i = 0; i < 40; i++) { // 별
      const x = (i * 97) % W, y = (i * 53) % 60 + 6;
      sc.px(x, y, 1, 1, 'rgba(255,255,255,0.25)');
    }

    // 제목
    const [y0, m0, d0] = data.days[0].split('-');
    const [, m1, d1] = data.days[6].split('-');
    sc.text('TOKEN SLAYER', 24, 20, '#FFD166', { s: 3, outline: '#0B0C16' });
    sc.text(`WEEKLY REPORT  ${m0}.${d0} - ${m1}.${d1}  ${y0}`, 24, 44, '#8A8FA8', { s: 1 });
    const total = data.providers.reduce((a, p) => a + p.total, 0);
    sc.text(`TOTAL ${total}%`, W - 24, 22, '#F4F4F8', { s: 2, align: 'right' });
    sc.text(`STREAK ${data.streak} DAYS`, W - 24, 44, '#FF9F1C', { s: 1, align: 'right' });

    // 서비스별 줄
    const rowH = 88;
    const maxDay = Math.max(1, ...data.providers.flatMap((p) => p.daily));
    data.providers.forEach((p, i) => {
      const top = 64 + i * rowH;
      if (i > 0) for (let x = 20; x < W - 20; x += 5) sc.px(x, top, 2, 1, 'rgba(255,255,255,0.10)');
      // 용사 (4배 크기)
      const skin = packs.find((k) => k.type === 'hero' && k.id === p.skin && (!data.openPacks || data.openPacks.includes(`hero:${k.id}`)))
        || packs.find((k) => k.type === 'hero' && k.id === 'knight');
      const darker = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${Math.round(((n >> 16) & 255) * 0.65)},${Math.round(((n >> 8) & 255) * 0.65)},${Math.round((n & 255) * 0.65)})`; };
      const pal = { o: '#171522', w: '#FFF1DC', s: '#F3CFA6', ...(skin ? skin.palette : {}), c: p.color, C: darker(p.color) };
      // 용사 뒤 받침 (어두운 외곽선이 배경에 묻히지 않게)
      sc.px(20, top + 8, 72, 72, '#232742');
      sc.px(22, top + 10, 68, 68, '#2B3050');
      if (skin) {
        if (skin.hires) { sc.blitHi(skin.grid, 26, top + 14, pal, 5); sc.dotsHi((skin.faces && skin.faces.fight) || [], 26, top + 14, pal, 5, skin.grid.length); } else {
        sc.blit(skin.grid, 26, top + 14, pal, 5);
        sc.dots([[6, 7, 'o'], [6, 8, 'o'], [9, 7, 'o'], [9, 8, 'o'], [4, 8, '#FF9DA7'], [10, 8, '#FF9DA7'], [7, 9, 'o'], [8, 9, 'o']].filter(([, y]) => !(skin.faceNoMouth && y === 9)), 26, top + 14, pal, 5); }
      }
      // 이름 · 레벨 · 합계
      sc.text(p.name, 104, top + 16, lighten(p.color, 0.2), { s: 3 });
      sc.text(`LV${p.level}`, 104, top + 42, '#FFD166', { s: 2 });
      sc.text(`USED ${p.total}%`, 104, top + 60, '#F4F4F8', { s: 2 });

      // 요일별 막대
      const bx = 330, bw = 30, gap = 12, bh = 56, base = top + 70;
      p.daily.forEach((v, k) => {
        const x = bx + k * (bw + gap);
        const h = Math.round((bh * v) / maxDay);
        sc.px(x, base - bh, bw, bh, 'rgba(255,255,255,0.05)');
        if (h > 0) {
          sc.px(x, base - h, bw, h, p.color);
          sc.px(x, base - h, bw, 2, 'rgba(255,255,255,0.35)');
        }
        if (v > 0) sc.text(`${Math.round(v)}`, x + bw / 2, base - h - 9, '#C8CBDA', { s: 1, align: 'center' });
        const dow = new Date(data.days[k] + 'T12:00:00').getDay();
        sc.text(DAYS[dow], x + bw / 2, base + 4, k === 6 ? '#FFD166' : '#6B6F86', { s: 1, align: 'center' });
      });
    });
    if (!data.providers.length) sc.text('NO BATTLES THIS WEEK', W / 2, 180, '#8A8FA8', { s: 2, align: 'center' });

    // 아래: 업적 · GAME OVER · 워터마크
    const fy = H - 26;
    for (let x = 20; x < W - 20; x += 5) sc.px(x, fy - 10, 2, 1, 'rgba(255,255,255,0.10)');
    sc.text(`ACHIEVEMENTS ${data.achievements.got}/${data.achievements.total}`, 24, fy, '#FFD166', { s: 2 });
    sc.text(`GAME OVER X${data.gameOvers}`, 290, fy, '#FF4D5A', { s: 2 });
    sc.text('TOKEN SLAYER', W - 24, fy + 3, '#4B4F6A', { s: 1, align: 'right' });

    return canvas.toDataURL('image/png');
  }

  window.renderCard = renderCard;
})();
