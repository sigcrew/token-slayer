// 배경 테마: 위젯 뒤에 깔리는 그림. 팩(type: 'backdrop')으로 정의한다.
//
//  sky       — 위→아래 색 목록 (세로 그라디언트를 도트 느낌으로 띠 지어 칠함)
//  tile      — 하늘 위에 반복해 깔 무늬 { grid, palette, s }   (벽돌 · 스캔라인 …)
//  floor     — 각 줄(용사 한 명)의 바닥 { color, edge }
//  props     — 줄마다 놓는 소품 [{ grid, palette, x(음수면 오른쪽 기준), dy(바닥에서 위로), s, lanes? }]
//  glows     — 깜빡이는 빛 번짐 [{ x, dy, color, r, a, speed }]
//  blinkers  — 깜빡이는 점(LED 등) [{ x, dy, color, speed, phase }]  줄마다 바닥(ground) 기준
//  particles — 움직이는 입자 { kind: fall | rise | code | twinkle, count, colors, size, w, h, speed, drift }  (w·h: 입자 가로·세로, 빗줄기는 w=1 h=4)
//  veil      — 글자가 잘 보이게 위에 얹는 어두운 막의 진하기 (0~1)
//
// 성능: 움직이지 않는 부분은 크기가 바뀔 때만 한 번 그려 두고 매 프레임에는 통째로 복사한다.
(function () {
  const INK = '#141626';
  const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`; };
  const rand = (a, b) => a + Math.random() * (b - a);

  class Backdrop {
    constructor(pack) {
      this.pack = pack;
      this.time = 0;
      this.key = '';
      this.layer = null;
      this.parts = [];
      this.glowCache = {};
    }

    // 크기·줄 수가 바뀌었으면 정적 그림을 다시 만든다
    ensure(g) {
      const key = `${g.w}|${g.h}|${g.T}|${g.lanes.length}`;
      if (key === this.key) return;
      this.key = key;
      this.buildLayer(g);
      this.initParticles(g);
    }

    buildLayer(g) {
      const { w, h, T, lanes } = g;
      const p = this.pack;
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w * T));
      cv.height = Math.max(1, Math.round(h * T));
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      const px = (x, y, ww, hh, c) => {
        const x0 = Math.round(Math.round(x) * T), y0 = Math.round(Math.round(y) * T);
        const x1 = Math.round((Math.round(x) + ww) * T), y1 = Math.round((Math.round(y) + hh) * T);
        ctx.fillStyle = c;
        ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      };
      const blit = (grid, pal, ox, oy, s) => {
        for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) {
          const c = pal[grid[y][x]];
          if (c) px(ox + x * s, oy + y * s, s, s, c);
        }
      };
      // 안쪽 영역 (테두리 2px은 위젯 틀이 그림)
      const ix = 2, iy = 2, iw = w - 4, ih = h - 4;
      const stops = p.sky || [INK];
      const BAND = 4;
      const bands = Math.ceil(ih / BAND);
      for (let b = 0; b < bands; b++) {
        const t = bands > 1 ? b / (bands - 1) : 0;
        const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
        const local = stops.length > 1 ? t * (stops.length - 1) - seg : 0;
        const c = stops.length > 1 ? mix(stops[seg], stops[seg + 1], local) : stops[0];
        px(ix, iy + b * BAND, iw, Math.min(BAND, ih - b * BAND), c);
      }
      if (p.tile) {
        const s = p.tile.s || 2, gw = p.tile.grid[0].length * s, gh = p.tile.grid.length * s;
        for (let ty = iy; ty < iy + ih; ty += gh) for (let tx = ix; tx < ix + iw; tx += gw) blit(p.tile.grid, p.tile.palette, tx, ty, s);
        // 타일이 안쪽 영역 밖으로 삐져나온 부분은 아래에서 틀이 덮는다
      }
      lanes.forEach((ln, i) => {
        if (p.floor) {
          px(ix, ln.ground, iw, ln.bottom - ln.ground - 1, p.floor.color);
          if (p.floor.edge) px(ix, ln.ground, iw, 1, p.floor.edge);
        }
        for (const pr of p.props || []) {
          if (pr.lanes && !pr.lanes.includes(i)) continue;
          const s = pr.s || 2;
          const pw = pr.grid[0].length * s, ph = pr.grid.length * s;
          const ox = pr.x < 0 ? w + pr.x - pw : pr.x;
          blit(pr.grid, pr.palette, ox, ln.ground + (pr.dy || 0) - ph, s);
        }
      });
      if (p.veil) { ctx.globalAlpha = p.veil; px(ix, iy, iw, ih, INK); ctx.globalAlpha = 1; }
      this.layer = cv;
    }

    initParticles(g) {
      const pt = this.pack.particles;
      this.parts = [];
      if (!pt) return;
      const { w, h } = g;
      const colors = pt.colors && pt.colors.length ? pt.colors : ['#FFFFFF'];
      if (pt.kind === 'code') {
        const gap = pt.gap || 14;
        for (let x = 6; x < w - 6; x += gap) this.parts.push({ x, y: rand(-h, h), vy: rand(pt.speed || 22, (pt.speed || 22) * 1.8), len: 3 + Math.floor(rand(0, 3)), c: colors });
        return;
      }
      for (let i = 0; i < (pt.count || 12); i++) {
        this.parts.push({
          x: rand(2, w - 2), y: rand(2, h - 2), ph: rand(0, 6.28), size: pt.size || 2,
          vy: rand(pt.speed || 16, (pt.speed || 16) * 1.6) * (pt.kind === 'rise' ? -1 : 1),
          color: colors[Math.floor(Math.random() * colors.length)], tw: rand(1, 3),
        });
      }
    }

    update(dt, g) {
      this.time += dt;
      const pt = this.pack.particles;
      if (!pt) return;
      const { w, h } = g;
      for (const q of this.parts) {
        if (pt.kind === 'code') {
          q.y += q.vy * dt;
          if (q.y - q.len * 4 > h) { q.y = rand(-30, -4); q.vy = rand(pt.speed || 22, (pt.speed || 22) * 1.8); }
        } else if (pt.kind === 'twinkle') {
          // 제자리에서 반짝
        } else {
          q.y += q.vy * dt;
          q.x += Math.sin(this.time * (pt.sway || 1.4) + q.ph) * (pt.drift || 8) * dt;
          if (q.vy > 0 && q.y > h - 2) { q.y = 2; q.x = rand(2, w - 2); }
          if (q.vy < 0 && q.y < 2) { q.y = h - 2; q.x = rand(2, w - 2); }
          if (q.x < 2) q.x = w - 3; else if (q.x > w - 2) q.x = 3;
        }
      }
    }

    glowBitmap(color, r, T) {
      const key = `${color}|${r}|${T}`;
      if (this.glowCache[key]) return this.glowCache[key];
      const [R, G, B] = rgb(color);
      const size = Math.round(r * 2 * T);
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const c = cv.getContext('2d');
      const grad = c.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
      grad.addColorStop(0, `rgba(${R},${G},${B},1)`);
      grad.addColorStop(1, `rgba(${R},${G},${B},0)`);
      c.fillStyle = grad;
      c.fillRect(0, 0, size, size);
      return (this.glowCache[key] = cv);
    }

    draw(ctx, g) {
      this.ensure(g);
      const { T, lanes } = g;
      const p = this.pack;
      ctx.drawImage(this.layer, 0, 0);
      // 깜빡이는 빛
      for (const gl of p.glows || []) {
        const bmp = this.glowBitmap(gl.color, gl.r, T);
        lanes.forEach((ln, i) => {
          if (gl.lanes && !gl.lanes.includes(i)) return;
          const cx = gl.x < 0 ? g.w + gl.x : gl.x;
          const a = (gl.a || 0.3) * (0.85 + 0.15 * Math.sin(this.time * (gl.speed || 8) + i * 1.7));
          ctx.globalAlpha = a;
          ctx.drawImage(bmp, Math.round((cx - gl.r) * T), Math.round((ln.ground + (gl.dy || 0) - gl.r) * T));
        });
      }
      // 깜빡이는 점 (서버 LED 등): 켜졌다 꺼지는 네모 점
      if (p.blinkers) {
        for (const ln of lanes) {
          for (const b of p.blinkers) {
            const on = Math.sin(this.time * (b.speed || 3) + (b.phase || 0)) > -0.2;
            ctx.globalAlpha = on ? 0.95 : 0.22;
            ctx.fillStyle = b.color;
            ctx.fillRect(Math.round(Math.round(b.x < 0 ? g.w + b.x : b.x) * T), Math.round(Math.round(ln.ground + (b.dy || 0)) * T), Math.max(1, Math.round(T)), Math.max(1, Math.round(T)));
          }
        }
      }
      ctx.globalAlpha = 1;
      // 입자
      const pt = p.particles;
      if (!pt) return;
      const px = (x, y, ww, hh) => ctx.fillRect(Math.round(Math.round(x) * T), Math.round(Math.round(y) * T), Math.max(1, Math.round(ww * T)), Math.max(1, Math.round(hh * T)));
      for (const q of this.parts) {
        if (pt.kind === 'code') {
          const cell = pt.size || 3;
          for (let k = 0; k < q.len; k++) {
            const y = q.y - k * (cell + 1);
            if (y < 2 || y > g.h - 3) continue;
            ctx.globalAlpha = k === 0 ? 0.95 : Math.max(0.12, 0.6 - k * 0.16);
            ctx.fillStyle = k === 0 ? q.c[q.c.length - 1] : q.c[0];
            px(q.x, y, cell - 1, cell);
          }
        } else if (pt.kind === 'twinkle') {
          ctx.globalAlpha = 0.25 + 0.75 * Math.max(0, Math.sin(this.time * q.tw + q.ph));
          ctx.fillStyle = q.color;
          px(q.x, q.y, q.size, q.size);
        } else {
          ctx.globalAlpha = pt.kind === 'rise' ? 0.85 : (pt.alpha || 0.9);
          ctx.fillStyle = q.color;
          px(q.x, q.y, pt.w || q.size + (pt.wide ? 1 : 0), pt.h || q.size);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  window.Backdrop = Backdrop;
})();
