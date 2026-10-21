// 사용 통계 공유 카드 (도트 스타일 PNG). 통계 창이 고른 기간의 요약을 받아 그린다.
// 프로젝트 이름·세션 시간대는 넣지 않는다 (회사 프로젝트명이 퍼지지 않게).
(function () {
  const W = 640, H = 380, T = 2; // 1280 x 760 PNG
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const LEVELS = ['#23263F', '#4B4420', '#8A7426', '#C9A42E', '#FFD166'];

  const compact = (n) => {
    n = Number(n) || 0;
    for (const [v, u] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (n >= v) return `${(n / v).toFixed(n / v >= 100 ? 0 : 1).replace(/\.0$/, '')}${u}`;
    return String(Math.round(n));
  };
  const dk = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const md = (k) => k.slice(5).replace('-', '.');

  function lighten(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.round(v + (255 - v) * f);
    return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
  }

  function renderStatsCard(data, packs) {
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

    sc.frameBox(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      const x = (i * 97) % W, y = (i * 53) % 60 + 6;
      sc.px(x, y, 1, 1, 'rgba(255,255,255,0.25)');
    }

    // 제목 · 기간
    const today = dk(new Date());
    const period = data.days ? `LAST ${data.days} DAYS` : 'ALL TIME';
    sc.text('TOKEN SLAYER', 24, 20, '#FFD166', { s: 3, outline: '#0B0C16' });
    sc.text(`USAGE STATS  ${period}${data.from ? `  ${md(data.from)} - ${md(today)}  ${today.slice(0, 4)}` : ''}`, 24, 44, '#8A8FA8', { s: 1 });

    // 왼쪽: 큰 숫자
    sc.text('TOTAL TOKENS', 24, 70, '#8A8FA8', { s: 1 });
    sc.text(compact(data.tokens), 24, 82, '#FFD166', { s: 6, outline: '#0B0C16' });
    const rows = [['ACTIVE DAYS', String(data.activeDays)], ['STREAK', `${data.streak} DAYS`], ['SESSIONS', String(data.sessions)]];
    rows.forEach(([k, v], i) => {
      const y = 128 + i * 18;
      sc.text(k, 24, y, '#8A8FA8', { s: 2 });
      sc.text(v, 230, y, '#F4F4F8', { s: 2, align: 'right' });
    });

    // 가운데: 에이전트 비율 · 대표 모델
    const ax = 262, aw = 250;
    sc.text(data.withCache ? 'SHARE  INCL. CACHE READS' : 'SHARE  EXCL. CACHE READS', ax, 60, '#6B6F86', { s: 1 });
    (data.agents || []).filter((a) => a.share >= 1).slice(0, 3).forEach((a, i) => {
      const y = 74 + i * 26;
      sc.text(a.name, ax, y, lighten(a.color, 0.2), { s: 2 });
      sc.text(`${a.share}%`, ax + aw, y, '#F4F4F8', { s: 2, align: 'right' });
      sc.px(ax, y + 14, aw, 6, 'rgba(255,255,255,0.06)');
      const w = Math.max(2, Math.round((aw * a.share) / 100));
      sc.px(ax, y + 14, w, 6, a.color);
      sc.px(ax, y + 14, w, 1, 'rgba(255,255,255,0.35)');
    });
    if (data.topModel) {
      sc.text('TOP MODEL', ax, 160, '#8A8FA8', { s: 1 });
      let m = String(data.topModel).toUpperCase();
      while (m.length > 4 && sc.textWidth(m, 2) > aw) m = m.slice(0, -1);
      sc.text(m, ax, 170, '#F4F4F8', { s: 2 });
    }

    // 오른쪽 위: 가장 많이 쓴 에이전트의 용사
    const hero = data.hero;
    if (hero) {
      const skin = packs.find((k) => k.type === 'hero' && k.id === hero.skin && (!data.openPacks || data.openPacks.includes(`hero:${k.id}`)))
        || packs.find((k) => k.type === 'hero' && k.id === 'knight');
      const darker = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${Math.round(((n >> 16) & 255) * 0.65)},${Math.round(((n >> 8) & 255) * 0.65)},${Math.round((n & 255) * 0.65)})`; };
      const pal = { o: '#171522', w: '#FFF1DC', s: '#F3CFA6', ...(skin ? skin.palette : {}), c: hero.color, C: darker(hero.color) };
      const hx = W - 96, hy = 70;
      sc.px(hx, hy, 72, 72, '#232742');
      sc.px(hx + 2, hy + 2, 68, 68, '#2B3050');
      if (skin) {
        if (skin.hires) { sc.blitHi(skin.grid, hx + 6, hy + 6, pal, 5); sc.dotsHi((skin.faces && skin.faces.fight) || [], hx + 6, hy + 6, pal, 5, skin.grid.length); } else {
          sc.blit(skin.grid, hx + 6, hy + 6, pal, 5);
          sc.dots([[6, 7, 'o'], [6, 8, 'o'], [9, 7, 'o'], [9, 8, 'o'], [4, 8, '#FF9DA7'], [10, 8, '#FF9DA7'], [7, 9, 'o'], [8, 9, 'o']].filter(([, y]) => !(skin.faceNoMouth && y === 9)), hx + 6, hy + 6, pal, 5);
        }
      }
      if (data.longest) sc.text(`BEST STREAK ${data.longest}`, hx + 36, hy + 80, '#FF9F1C', { s: 1, align: 'center' });
    }

    // 아래: 최근 6개월 히트맵 (진하기는 쓴 날들 안에서의 순위, 통계 창과 같은 기준)
    for (let x = 20; x < W - 20; x += 5) sc.px(x, 196, 2, 1, 'rgba(255,255,255,0.10)');
    const vals = (data.heat && data.heat.values) || {};
    const nz = Object.values(vals).filter((v) => v > 0).sort((a, b) => a - b);
    const q = (p) => (nz.length ? nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] : 0);
    const cut = [q(0.25), q(0.5), q(0.75)];
    const level = (v) => (v <= 0 ? 0 : v < cut[0] ? 1 : v < cut[1] ? 2 : v < cut[2] ? 3 : 4);
    const start = new Date((data.heat && data.heat.since) || Date.now() - 182 * 86400e3);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(); end.setHours(0, 0, 0, 0);
    const cell = 15, gap = 3, hx0 = 52, hy0 = 218;
    ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].forEach((d, i) => sc.text(d, 24, hy0 + i * (cell + gap) + 4, '#6B6F86', { s: 1 }));
    let lastMonthCol = -9;
    for (let d = new Date(start), c = 0; d <= end; c++) {
      for (let w = 0; w < 7; w++, d.setDate(d.getDate() + 1)) {
        if (d > end) continue;
        const x = hx0 + c * (cell + gap), y = hy0 + w * (cell + gap);
        if (d.getDate() === 1 && c - lastMonthCol >= 3) { sc.text(MONTHS[d.getMonth()], x, hy0 - 12, '#8A8FA8', { s: 1 }); lastMonthCol = c; }
        const lv = level(vals[dk(d)] || 0);
        sc.px(x, y, cell, cell, LEVELS[lv]);
        if (lv) sc.px(x, y, cell, 1, 'rgba(255,255,255,0.25)');
      }
    }

    // 아래: 범례 · 워터마크
    const fy = H - 18;
    sc.text('LESS', W - 24 - 5 * 12 - 34, fy, '#6B6F86', { s: 1, align: 'right' });
    LEVELS.forEach((c, i) => sc.px(W - 24 - 5 * 12 - 28 + i * 12, fy - 1, 9, 9, c));
    sc.text('MORE', W - 24, fy, '#6B6F86', { s: 1, align: 'right' });
    sc.text('TOKEN-SLAYER.VERCEL.APP', 24, fy, '#4B4F6A', { s: 1 });

    return canvas.toDataURL('image/png');
  }

  window.renderStatsCard = renderStatsCard;
})();
