// 사용 통계 창이 기록을 읽는 동안 보여 주는 놀이 화면. 위젯의 용사들이 열 때마다 셋 중 하나를 한다:
//  - 토큰 줍기: 떨어지는 토큰을 받아 모은다. 왼쪽 토큰 더미는 기록 읽기 진행률만큼 쌓인다
//  - 술래잡기: 술래가 3·2·1 세고 쫓아가고, 잡히면 TAG! (둘 이상일 때만)
//  - 공놀이: 통통 튀는 공을 쫓아가서 찬다
// Scene의 도트 그리기 도구만 빌려 쓰고, 전투 장면과는 따로 움직인다.
(function () {
  const W = 320, H = 112, GROUND = 98, S = 4; // 용사 한 명은 12칸 × 4 = 48
  const SIZE = 12 * S;
  const FACE = {
    fight: [[6, 7, 'o'], [6, 8, 'o'], [9, 7, 'o'], [9, 8, 'o'], [4, 8, '#FF9DA7'], [10, 8, '#FF9DA7'], [7, 9, 'o'], [8, 9, 'o']],
    happy: [[5, 8, 'o'], [6, 7, 'o'], [7, 8, 'o'], [8, 8, 'o'], [9, 7, 'o'], [10, 8, 'o'], [4, 9, '#FF9DA7'], [11, 9, '#FF9DA7'], [7, 9, 'o'], [8, 9, 'o']],
    hit: [[5, 7, 'o'], [7, 7, 'o'], [6, 8, 'o'], [8, 7, 'o'], [10, 7, 'o'], [9, 8, 'o'], [7, 10, 'o'], [8, 10, 'o']],
  };
  const GOLD = '#FFD166', GOLD_D = '#C9A42E', GOLD_L = '#FFF6D8';

  const hex2rgb = (hex) => { const n = parseInt(String(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const shade = (hex, f) => { const m = (v) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)))).toString(16).padStart(2, '0'); const [r, g, b] = hex2rgb(hex); return `#${m(r)}${m(g)}${m(b)}`; };
  // 위젯의 용사와 같은 색: 몸 · 그림자 · 서비스 색(c · C)과 고해상도용 하이라이트(ĉ ċ Ĉ Ċ)
  function palette(skin, color) {
    const C = shade(color, -0.35);
    return { o: '#171522', w: '#FFF1DC', s: '#F3CFA6', ...((skin && skin.palette) || {}), c: color, C, 'ĉ': shade(color, 0.3), 'ċ': shade(color, -0.18), 'Ĉ': shade(C, 0.3), 'Ċ': shade(C, -0.2) };
  }

  let raf = 0;
  let progress = 0; // 기록 읽기 진행률 0~1 (토큰 더미 높이)

  // game: 'coins' | 'tag' | 'ball' (없으면 무작위, 술래잡기는 둘 이상일 때만)
  function start(canvas, heroes, game) {
    stop();
    if (!canvas || !window.Scene || !heroes || !heroes.length) return null;
    const T = Math.max(2, Math.round(window.devicePixelRatio || 1));
    canvas.width = W * T;
    canvas.height = H * T;
    const sc = new window.Scene(canvas);
    canvas.width = W * T; canvas.height = H * T; canvas.style.height = ''; // Scene이 정한 크기 · 높이를 다시 맞춘다
    sc.T = T; sc.w = W; sc.h = H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const kids = heroes.slice(0, 4).map((h, i) => ({
      skin: h.skin, pal: palette(h.skin, h.color || GOLD),
      x: 40 + i * ((W - 80 - SIZE) / Math.max(1, heroes.length - 1 || 1)), dir: i % 2 ? -1 : 1, phase: i, hitT: 0, speed: 52 + i * 6, jy: 0, vy: 0, jumpVx: 95, got: 0,
    }));
    const games = ['coins', 'ball', ...(kids.length > 1 ? ['tag'] : [])];
    const mode = games.includes(game) ? game : games[Math.floor(Math.random() * games.length)];
    let last = performance.now(), t = 0;

    // 술래잡기
    let it = 0, freeze = 1.2, tagT = 0, tagX = 0;
    // 공놀이
    const ball = { x: W / 2, y: 30, vx: 60, vy: 0 };
    // 토큰 줍기: 떨어지는 토큰 · 땅에 떨어진 토큰 · +1 글자
    const coins = [], pops = [];
    let spawnIn = 0.3;
    const PILE_X = 6, PILE_W = 26, LEFT = mode === 'coins' ? PILE_X + PILE_W + 6 : 4;

    const clampX = (k) => { k.x = Math.max(LEFT, Math.min(W - SIZE - 4, k.x)); };
    const jump = (k, vy, vx) => { k.vy = vy; k.jy = 0.01; k.jumpVx = vx; };
    // 점프 중이면 포물선으로 움직이고 true
    const air = (k, dt) => {
      if (!(k.jy > 0 || k.vy)) return false;
      k.vy -= 520 * dt; k.jy += k.vy * dt; k.x += k.dir * k.jumpVx * dt;
      if (k.jy <= 0) { k.jy = 0; k.vy = 0; }
      clampX(k);
      return true;
    };

    const drawHero = (k, face) => {
      const y = GROUND - SIZE - (k.jy > 0 ? k.jy : Math.abs(Math.sin(k.phase)) * (face === 'hit' ? 0 : 5));
      const x = Math.round(k.x);
      // 왼쪽으로 달릴 때는 좌우를 뒤집어 그린다 (용사 그림은 오른쪽을 본다)
      if (k.dir < 0) ctx.setTransform(-1, 0, 0, 1, (2 * x + SIZE) * T, 0);
      const sk = k.skin;
      if (sk && sk.hires) {
        sc.blitHi(sk.grid, x, y, k.pal, S);
        const f = (sk.faces && (sk.faces[face] || sk.faces.fight)) || [];
        sc.dotsHi(f, x, y, k.pal, S, sk.grid.length);
      } else if (sk) {
        sc.blit(sk.grid, x, y, k.pal, S);
        sc.dots(FACE[face] || FACE.fight, x, y, k.pal, S);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    // 토큰 하나 (6×6, 반짝임은 시간에 따라 옆으로 이동)
    const coin = (x, y, spin) => {
      const w = Math.max(2, Math.round(6 * Math.abs(Math.cos(spin)))), ox = Math.round(x) + Math.round((6 - w) / 2), oy = Math.round(y);
      sc.px(ox, oy, w, 6, GOLD_D);
      sc.px(ox, oy, Math.max(1, w - 1), 5, GOLD);
      if (w > 3) sc.px(ox + 1, oy + 1, 1, 2, GOLD_L);
    };

    const playCoins = (dt) => {
      // 토큰 더미: 진행률만큼 아래부터 쌓인다
      const rows = Math.round(progress * 15);
      for (let r = 0; r < rows; r++) {
        const y = GROUND - 4 - r * 4, off = r % 2 ? 2 : 0;
        for (let x = PILE_X + off; x + 6 <= PILE_X + PILE_W - (r % 2 ? 0 : 2); x += 6) { sc.px(x, y, 6, 4, GOLD_D); sc.px(x, y, 5, 3, GOLD); }
      }
      sc.text(`${Math.round(progress * 100)}%`, PILE_X + PILE_W / 2, GROUND - 4 - rows * 4 - 9, GOLD, { s: 1, align: 'center' });

      spawnIn -= dt;
      if (spawnIn <= 0) { spawnIn = 0.28 + Math.random() * 0.3; coins.push({ x: LEFT + 6 + Math.random() * (W - LEFT - 18), y: -6, vy: 34 + Math.random() * 30, spin: Math.random() * 6, ground: 0 }); }
      for (const c of coins) {
        if (c.ground) { c.ground += dt; continue; }
        c.y += c.vy * dt; c.spin += dt * 7;
        if (c.y >= GROUND - 6) { c.y = GROUND - 6; c.ground = 0.001; }
      }
      kids.forEach((k, i) => {
        k.hitT = Math.max(0, k.hitT - dt);
        const cx = k.x + SIZE / 2;
        // 가장 먼저 닿을 것 같은 토큰을 고른다 (다른 용사가 더 가까우면 양보)
        let target = null, best = Infinity;
        for (const c of coins) {
          if (c.ground) continue;
          const d = Math.abs(c.x + 3 - cx) - c.y * 0.6;
          const closer = kids.some((o, j) => j !== i && Math.abs(c.x + 3 - (o.x + SIZE / 2)) < Math.abs(c.x + 3 - cx) - 10);
          if (!closer && d < best) { best = d; target = c; }
        }
        if (!air(k, dt) && target) {
          const dx = target.x + 3 - cx;
          if (Math.abs(dx) > 3) { k.dir = dx > 0 ? 1 : -1; k.x += k.dir * (k.speed + 10) * dt; k.phase += dt * 12; clampX(k); }
          // 머리 위로 지나가는 토큰은 뛰어서 받는다
          if (Math.abs(dx) < 14 && target.y > GROUND - SIZE - 46 && target.y < GROUND - SIZE - 8) jump(k, 150, 0);
        }
        // 받기: 토큰이 용사 몸에 닿으면
        const top = GROUND - SIZE - k.jy;
        for (const c of coins) {
          if (c.ground || c.taken) continue;
          if (Math.abs(c.x + 3 - (k.x + SIZE / 2)) < SIZE * 0.42 && c.y + 6 > top && c.y < top + SIZE * 0.6) {
            c.taken = true; k.got++; k.hitT = 0.35;
            pops.push({ x: c.x + 3, y: top - 4, t: 0.8 });
          }
        }
      });
      for (let i = coins.length - 1; i >= 0; i--) if (coins[i].taken || coins[i].ground > 1.6) coins.splice(i, 1);
      for (const c of coins) { if (c.ground) ctx.globalAlpha = Math.max(0, 1 - c.ground / 1.6); coin(c.x, c.y, c.ground ? 0 : c.spin); ctx.globalAlpha = 1; }
      kids.forEach((k) => drawHero(k, k.hitT > 0 ? 'happy' : 'fight'));
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i]; p.t -= dt; p.y -= dt * 18;
        if (p.t <= 0) { pops.splice(i, 1); continue; }
        ctx.globalAlpha = Math.min(1, p.t * 2);
        sc.text('+1', Math.round(p.x), Math.round(p.y), GOLD, { s: 1, align: 'center', outline: '#0B0C16' });
        ctx.globalAlpha = 1;
      }
    };

    const playBall = (dt) => {
      ball.vy += 260 * dt; ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      if (ball.y > GROUND - 6) { ball.y = GROUND - 6; ball.vy = -Math.abs(ball.vy) * 0.82 - 20; }
      if (ball.x < 6 || ball.x > W - 12) { ball.vx *= -1; ball.x = Math.max(6, Math.min(W - 12, ball.x)); }
      kids.forEach((k, i) => {
        k.hitT = Math.max(0, k.hitT - dt);
        // 여럿이면 서로 조금씩 다른 자리에서 기다리다가 공으로 달려간다
        const target = ball.x - SIZE / 2 + (kids.length > 1 ? (i - (kids.length - 1) / 2) * 22 : 0);
        k.dir = target > k.x ? 1 : -1;
        if (Math.abs(target - k.x) > 3) { k.x += k.dir * k.speed * dt; k.phase += dt * 11; clampX(k); }
        if (Math.abs(ball.x - (k.x + SIZE / 2)) < 14 && ball.y > GROUND - 26) { ball.vx = k.dir * (70 + Math.random() * 60); ball.vy = -170; k.hitT = 0.25; }
      });
      kids.forEach((k) => drawHero(k, k.hitT > 0 ? 'happy' : 'fight'));
      sc.px(Math.round(ball.x), Math.round(ball.y), 6, 6, GOLD);
      sc.px(Math.round(ball.x) + 1, Math.round(ball.y) + 1, 2, 2, GOLD_L);
    };

    const playTag = (dt) => {
      // 술래(it)는 가까운 용사를 쫓고, 나머지는 술래 반대쪽으로 도망간다. 잡히면 술래가 바뀐다
      freeze = Math.max(0, freeze - dt);
      tagT = Math.max(0, tagT - dt);
      const chaser = kids[it];
      let prey = null, best = Infinity;
      kids.forEach((k, i) => { if (i !== it && Math.abs(k.x - chaser.x) < best) { best = Math.abs(k.x - chaser.x); prey = k; } });
      kids.forEach((k, i) => {
        k.hitT = Math.max(0, k.hitT - dt);
        if (air(k, dt)) return; // 점프 중엔 잡히지 않음
        if (k.hitT > 0) return;
        if (i === it) {
          if (freeze > 0) return; // 술래가 된 직후엔 셋을 세고 출발
          k.dir = prey.x > k.x ? 1 : -1;
          k.x += k.dir * (k.speed + 14) * dt;
        } else {
          k.dir = k.x > chaser.x ? 1 : -1;
          const cornered = (k.dir < 0 && k.x < 24) || (k.dir > 0 && k.x > W - SIZE - 24);
          // 벽에 몰렸는데 술래가 다가오면 술래 머리 위로 뛰어넘어 반대쪽으로
          if (cornered && Math.abs(k.x - chaser.x) < SIZE * 1.6) { k.dir = -k.dir; jump(k, 205, 95); return; }
          if (!cornered) k.x += k.dir * (k.speed + Math.sin(t * 3 + i) * 12) * dt;
        }
        clampX(k);
        k.phase += dt * 12;
      });
      if (freeze <= 0 && prey && prey.jy <= 0 && Math.abs(prey.x - chaser.x) < SIZE * 0.55) {
        prey.hitT = 0.6; tagT = 0.9; tagX = prey.x + SIZE / 2;
        it = kids.indexOf(prey); freeze = 1.2;
      }
      kids.forEach((k, i) => drawHero(k, k.hitT > 0 ? 'hit' : i === it ? 'fight' : 'happy'));
      // 술래 머리 위 3·2·1과 잡혔을 때 TAG!
      const c = kids[it];
      sc.text(freeze > 0 ? String(Math.min(3, Math.ceil(freeze / 0.4))) : '!', Math.round(c.x + SIZE / 2), GROUND - SIZE - 12, '#FF9F1C', { s: 1, align: 'center' });
      if (tagT > 0) sc.text('TAG!', Math.round(tagX), GROUND - SIZE - 22 - (0.9 - tagT) * 10, GOLD, { s: 2, align: 'center', outline: '#0B0C16' });
    };

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // 밤하늘 별과 땅
      for (let i = 0; i < 24; i++) { const sx = (i * 89) % W, sy = (i * 37) % 40 + 4; sc.px(sx, sy, 1, 1, `rgba(255,255,255,${0.15 + 0.15 * Math.sin(t * 2 + i)})`); }
      sc.px(0, GROUND, W, 1, '#2C3150');
      for (let x = 4; x < W; x += 9) sc.px(x, GROUND + 4 + ((x * 7) % 5), 2, 1, '#23263F');
      if (mode === 'coins') playCoins(dt);
      else if (mode === 'tag') playTag(dt);
      else playBall(dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return mode;
  }

  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function setProgress(p) { progress = Math.max(0, Math.min(1, Number(p) || 0)); }

  window.StatsPlay = { start, stop, setProgress };
})();
