// 사용 통계 창이 기록을 읽는 동안 보여 주는 놀이 화면: 위젯의 용사들이 술래잡기를 한다 (혼자면 공놀이).
// Scene의 도트 그리기 도구만 빌려 쓰고, 전투 장면과는 따로 움직인다.
(function () {
  const W = 320, H = 112, GROUND = 98, S = 4; // 용사 한 명은 12칸 × 4 = 48
  const SIZE = 12 * S;
  const FACE = {
    fight: [[6, 7, 'o'], [6, 8, 'o'], [9, 7, 'o'], [9, 8, 'o'], [4, 8, '#FF9DA7'], [10, 8, '#FF9DA7'], [7, 9, 'o'], [8, 9, 'o']],
    happy: [[5, 8, 'o'], [6, 7, 'o'], [7, 8, 'o'], [8, 8, 'o'], [9, 7, 'o'], [10, 8, 'o'], [4, 9, '#FF9DA7'], [11, 9, '#FF9DA7'], [7, 9, 'o'], [8, 9, 'o']],
    hit: [[5, 7, 'o'], [7, 7, 'o'], [6, 8, 'o'], [8, 7, 'o'], [10, 7, 'o'], [9, 8, 'o'], [7, 10, 'o'], [8, 10, 'o']],
  };

  const hex2rgb = (hex) => { const n = parseInt(String(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const shade = (hex, f) => { const m = (v) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)))).toString(16).padStart(2, '0'); const [r, g, b] = hex2rgb(hex); return `#${m(r)}${m(g)}${m(b)}`; };
  // 위젯의 용사와 같은 색: 몸 · 그림자 · 서비스 색(c · C)과 고해상도용 하이라이트(ĉ ċ Ĉ Ċ)
  function palette(skin, color) {
    const C = shade(color, -0.35);
    return { o: '#171522', w: '#FFF1DC', s: '#F3CFA6', ...((skin && skin.palette) || {}), c: color, C, 'ĉ': shade(color, 0.3), 'ċ': shade(color, -0.18), 'Ĉ': shade(C, 0.3), 'Ċ': shade(C, -0.2) };
  }

  let raf = 0;

  function start(canvas, heroes) {
    stop();
    if (!canvas || !window.Scene || !heroes || !heroes.length) return;
    const T = Math.max(2, Math.round(window.devicePixelRatio || 1));
    canvas.width = W * T;
    canvas.height = H * T;
    const sc = new window.Scene(canvas);
    canvas.width = W * T; canvas.height = H * T; canvas.style.height = ''; // Scene이 정한 크기 · 높이를 다시 맞춘다
    sc.T = T; sc.w = W; sc.h = H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const kids = heroes.slice(0, 4).map((h, i) => ({
      skin: h.skin, pal: palette(h.skin, h.color || '#FFD166'),
      x: 30 + i * ((W - 60 - SIZE) / Math.max(1, heroes.length - 1 || 1)), dir: i % 2 ? -1 : 1, phase: i, hitT: 0, speed: 52 + i * 6, jy: 0, vy: 0,
    }));
    let it = 0, freeze = 1.2, tagT = 0, tagX = 0;
    const ball = { x: W / 2, y: 30, vx: 60, vy: 0 };
    let last = performance.now(), t = 0;

    const drawHero = (k, mode) => {
      const y = GROUND - SIZE - (k.jy > 0 ? k.jy : Math.abs(Math.sin(k.phase)) * (mode === 'hit' ? 0 : 5));
      const x = Math.round(k.x);
      // 왼쪽으로 달릴 때는 좌우를 뒤집어 그린다 (용사 그림은 오른쪽을 본다)
      if (k.dir < 0) ctx.setTransform(-1, 0, 0, 1, (2 * x + SIZE) * T, 0);
      const sk = k.skin;
      if (sk && sk.hires) {
        sc.blitHi(sk.grid, x, y, k.pal, S);
        const f = (sk.faces && (sk.faces[mode] || sk.faces.fight)) || [];
        sc.dotsHi(f, x, y, k.pal, S, sk.grid.length);
      } else if (sk) {
        sc.blit(sk.grid, x, y, k.pal, S);
        sc.dots(FACE[mode] || FACE.fight, x, y, k.pal, S);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // 밤하늘 별과 땅
      for (let i = 0; i < 24; i++) { const sx = (i * 89) % W, sy = (i * 37) % 40 + 4; sc.px(sx, sy, 1, 1, `rgba(255,255,255,${0.15 + 0.15 * Math.sin(t * 2 + i)})`); }
      sc.px(0, GROUND, W, 1, '#2C3150');
      for (let x = 4; x < W; x += 9) sc.px(x, GROUND + 4 + ((x * 7) % 5), 2, 1, '#23263F');

      if (kids.length === 1) {
        // 혼자: 통통 튀는 공을 쫓아가서 찬다
        const k = kids[0];
        ball.vy += 260 * dt; ball.x += ball.vx * dt; ball.y += ball.vy * dt;
        if (ball.y > GROUND - 6) { ball.y = GROUND - 6; ball.vy = -Math.abs(ball.vy) * 0.82 - 20; }
        if (ball.x < 6 || ball.x > W - 12) { ball.vx *= -1; ball.x = Math.max(6, Math.min(W - 12, ball.x)); }
        const target = ball.x - SIZE / 2;
        k.dir = target > k.x ? 1 : -1;
        if (Math.abs(target - k.x) > 3) { k.x += k.dir * k.speed * dt; k.phase += dt * 11; }
        if (Math.abs(ball.x - (k.x + SIZE / 2)) < 14 && ball.y > GROUND - 26) { ball.vx = k.dir * (70 + Math.random() * 60); ball.vy = -170; k.hitT = 0.25; }
        k.hitT = Math.max(0, k.hitT - dt);
        drawHero(k, k.hitT > 0 ? 'happy' : 'fight');
        sc.px(Math.round(ball.x), Math.round(ball.y), 6, 6, '#FFD166');
        sc.px(Math.round(ball.x) + 1, Math.round(ball.y) + 1, 2, 2, '#FFF6D8');
      } else {
        // 술래잡기: 술래(it)는 가까운 용사를 쫓고, 나머지는 술래 반대쪽으로 도망간다. 잡히면 술래가 바뀐다
        freeze = Math.max(0, freeze - dt);
        tagT = Math.max(0, tagT - dt);
        const chaser = kids[it];
        let prey = null, best = Infinity;
        kids.forEach((k, i) => { if (i !== it && Math.abs(k.x - chaser.x) < best) { best = Math.abs(k.x - chaser.x); prey = k; } });
        kids.forEach((k, i) => {
          k.hitT = Math.max(0, k.hitT - dt);
          // 점프 중: 포물선으로 날아가며 술래를 넘는다 (공중에선 잡히지 않음)
          if (k.jy > 0 || k.vy) {
            k.vy -= 520 * dt; k.jy += k.vy * dt; k.x += k.dir * 95 * dt;
            if (k.jy <= 0) { k.jy = 0; k.vy = 0; }
            k.x = Math.max(4, Math.min(W - SIZE - 4, k.x));
            return;
          }
          if (k.hitT > 0) return;
          if (i === it) {
            if (freeze > 0) return; // 술래가 된 직후엔 셋을 세고 출발
            k.dir = prey.x > k.x ? 1 : -1;
            k.x += k.dir * (k.speed + 14) * dt;
          } else {
            k.dir = k.x > chaser.x ? 1 : -1;
            const cornered = (k.dir < 0 && k.x < 24) || (k.dir > 0 && k.x > W - SIZE - 24);
            // 벽에 몰렸는데 술래가 다가오면 술래 머리 위로 뛰어넘어 반대쪽으로
            if (cornered && Math.abs(k.x - chaser.x) < SIZE * 1.6) { k.dir = -k.dir; k.vy = 205; k.jy = 0.01; return; }
            if (!cornered) k.x += k.dir * (k.speed + Math.sin(t * 3 + i) * 12) * dt;
          }
          k.x = Math.max(4, Math.min(W - SIZE - 4, k.x));
          k.phase += dt * 12;
        });
        if (freeze <= 0 && prey && prey.jy <= 0 && Math.abs(prey.x - chaser.x) < SIZE * 0.55) {
          prey.hitT = 0.6; tagT = 0.9; tagX = prey.x + SIZE / 2;
          it = kids.indexOf(prey); freeze = 1.1;
        }
        kids.forEach((k, i) => drawHero(k, k.hitT > 0 ? 'hit' : i === it ? 'fight' : 'happy'));
        // 술래 머리 위 표시와 잡혔을 때 TAG!
        const c = kids[it];
        sc.text(freeze > 0 ? String(Math.ceil(freeze * 2.7)) : '!', Math.round(c.x + SIZE / 2), GROUND - SIZE - 12, '#FF9F1C', { s: 1, align: 'center' });
        if (tagT > 0) sc.text('TAG!', Math.round(tagX), GROUND - SIZE - 22 - (0.9 - tagT) * 10, '#FFD166', { s: 2, align: 'center', outline: '#0B0C16' });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  window.StatsPlay = { start, stop };
})();
