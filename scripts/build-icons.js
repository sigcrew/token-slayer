// packs/knight.json → build/icon.png, assets/icon.png, assets/tray*.png (의존성 없이 PNG 직접 생성)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const knight = JSON.parse(fs.readFileSync(path.join(root, 'packs', 'knight.json'), 'utf8'));

const INK = '#171522', BODY = '#FFF1DC', SHADE = '#F3CFA6', CHEEK = '#FF9DA7';
const FEATHER = '#FF8A5B', FEATHER_D = '#A65A3B', GOLD = '#FFD166', BLADE = '#E8ECF4';
const BG = '#2D3149';

// 16 x 16 도안: 용사는 (1,3)에, 칼은 오른쪽에 세워서
const N = 16, KX = 1, KY = 3;
const cells = Array.from({ length: N }, () => Array(N).fill(null));
const pal = { o: INK, w: BODY, s: SHADE, c: FEATHER, C: FEATHER_D, ...knight.palette };
knight.grid.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') cells[KY + y][KX + x] = { color: pal[ch], solid: true }; }));
// 얼굴 (게임 속 fight 표정과 같음)
for (const [x, y, c] of [[6, 7, INK], [6, 8, INK], [9, 7, INK], [9, 8, INK], [4, 8, CHEEK], [10, 8, CHEEK], [7, 9, INK], [8, 9, INK]]) {
  cells[KY + y][KX + x] = { color: c, solid: c === CHEEK, hole: c === INK };
}
// 칼: 손잡이(11,12), 날은 위로
for (let y = 1; y <= 9; y++) cells[y][14] = { color: y === 1 ? '#FFFFFF' : BLADE, solid: true };
for (let x = 13; x <= 15; x++) cells[10][x] = { color: GOLD, solid: true };
cells[11][14] = { color: '#8B5A2B', solid: true };
// 칼 테두리
for (let y = 0; y <= 11; y++) for (const x of [13, 15]) if (!cells[y][x]) cells[y][x] = { color: INK, solid: true };
cells[0][14] = { color: INK, solid: true };
cells[12][14] = { color: INK, solid: true };
cells[11][13] = { color: INK, solid: true };
cells[11][15] = { color: INK, solid: true };
cells[10][12] = { color: INK, solid: true };
cells[10][16 - 1] = { color: GOLD, solid: true };

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function png(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 4 + 1) + 1 + x * 4, p = px(x, y);
    raw[o] = p[0]; raw[o + 1] = p[1]; raw[o + 2] = p[2]; raw[o + 3] = p[3];
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// 앱 아이콘: 둥근 남색 판 위에 용사 (size 는 캔버스 한 변)
function appIcon(size) {
  const m = size * 64 / 1024, r = size * 200 / 1024, box = size - 2 * m;
  const cs = Math.floor(size * 0.64 / N), off = Math.round((size - cs * N) / 2);
  const bg = rgb(BG);
  return png(size, size, (x, y) => {
    // 둥근 사각형(스퀴클에 가까운 원 모서리)
    const dx = Math.max(m + r - x, x - (size - m - r), 0), dy = Math.max(m + r - y, y - (size - m - r), 0);
    const inside = x >= m && x < size - m && y >= m && y < size - m && dx * dx + dy * dy <= r * r;
    if (!inside) return [0, 0, 0, 0];
    const cx = Math.floor((x - off) / cs), cy = Math.floor((y - off) / cs);
    const c = cx >= 0 && cx < N && cy >= 0 && cy < N ? cells[cy][cx] : null;
    if (c) return [...rgb(c.color), 255];
    // 바닥 그림자
    if (cy === 15 && cx >= 1 && cx <= 12) return [...bg.map((v) => Math.round(v * 0.8)), 255];
    return [...bg, 255];
  });
}

// 트레이: 실루엣 (mac 템플릿은 검정+알파, 눈·입은 뚫음)
function trayTemplate(size) {
  const cs = Math.floor(size / N), off = Math.round((size - cs * N) / 2);
  return png(size, size, (x, y) => {
    const cx = Math.floor((x - off) / cs), cy = Math.floor((y - off) / cs);
    const c = cx >= 0 && cx < N && cy >= 0 && cy < N ? cells[cy][cx] : null;
    return c && c.solid ? [0, 0, 0, 255] : [0, 0, 0, 0];
  });
}
function trayColor(size) {
  const cs = Math.floor(size / N), off = Math.round((size - cs * N) / 2);
  return png(size, size, (x, y) => {
    const cx = Math.floor((x - off) / cs), cy = Math.floor((y - off) / cs);
    const c = cx >= 0 && cx < N && cy >= 0 && cy < N ? cells[cy][cx] : null;
    return c ? [...rgb(c.color), 255] : [0, 0, 0, 0];
  });
}

fs.writeFileSync(path.join(root, 'build', 'icon.png'), appIcon(1024));
fs.writeFileSync(path.join(root, 'assets', 'icon.png'), appIcon(512));
fs.writeFileSync(path.join(root, 'assets', 'trayTemplate.png'), trayTemplate(18));
fs.writeFileSync(path.join(root, 'assets', 'trayTemplate@2x.png'), trayTemplate(36));
fs.writeFileSync(path.join(root, 'assets', 'tray.png'), trayColor(32));
console.log('icons: build/icon.png, assets/icon.png, tray*.png');
