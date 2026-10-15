// 꾸미기 팩 불러오기: 기본 팩(packs/) + 사용자 팩(<userData>/packs/*.json)
//
// 팩 종류
//  hero    — 용사 직업: grid(12x12 문자 그리드), palette, weapon(sword|katana|staff|bow|shuriken)
//  enemies — 적 테마: texts(날아오는 글자), colors, fatal(맞을 때 글자)
//  rest    — 휴식 장면: frames(애니메이션 그리드들), palette, glow, embers, steam
//  backdrop — 배경: sky(위→아래 색), tile, floor, props, glows, particles, veil (renderer/backdrop.js 참고)
// tier: 'free' | 'premium'
const fs = require('fs');
const path = require('path');

const TYPES = ['hero', 'enemies', 'rest', 'backdrop'];
const DEFAULT_SKINS = { claude: 'knight', codex: 'wizard', cursor: 'archer' };

// 추억(memory): 용사를 여러 번 누르면 사진 카드가 뜨고(photo · captions), 팩을 처음 쓸 때 편지가 한 번 뜬다(welcome)
function validMemory(m) {
  if (m == null) return true;
  if (typeof m !== 'object') return false;
  const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (m.photo != null && !(typeof m.photo === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(m.photo) && m.photo.length <= 600000)) return false;
  if (m.clicks != null && !(Number.isInteger(m.clicks) && m.clicks >= 3 && m.clicks <= 10)) return false;
  if (m.captions != null && !(Array.isArray(m.captions) && m.captions.length <= 12 && m.captions.every((c) => str(c, 100)))) return false;
  if (m.notify != null) { // 알림에 붙는 한마디: levelup(레벨업) · warn(HP 경고) · burning(BURNING TIME) · reset(한도 리셋)
    const n = m.notify;
    if (!n || typeof n !== 'object') return false;
    for (const k of Object.keys(n)) {
      if (!['levelup', 'warn', 'burning', 'reset'].includes(k)) return false;
      if (!(Array.isArray(n[k]) && n[k].length <= 6 && n[k].every((c) => str(c, 100)))) return false;
    }
  }
  if (m.welcome != null) {
    const w = m.welcome;
    if (!w || !str(w.title, 60) || !str(w.body, 1500) || (w.button != null && !str(w.button, 16))) return false;
  }
  return true;
}

function validate(p) {
  if (!p || typeof p.id !== 'string' || !TYPES.includes(p.type) || typeof p.name !== 'string') return false;
  if (p.memory != null && !(p.type === 'hero' && validMemory(p.memory))) return false;
  if (p.type === 'hero') {
    // hires: 24·32·48칸 고해상도 용사 (표정은 faces). 보통 용사는 12칸
    if (p.hd != null) { // 보통 용사에 붙이는 고해상도 그림(프리미엄 설정에서만 보임)
      const h = p.hd, m = h && Array.isArray(h.grid) ? h.grid.length : 0;
      if (!h || ![24, 32, 48].includes(m) || !h.grid.every((r) => typeof r === 'string' && r.length === m) || !h.faces || typeof h.faces !== 'object') return false;
      if (h.down != null && !(Array.isArray(h.down.frames) && h.down.frames.length > 0 && h.down.frames.every((f) => Array.isArray(f) && f.length === m && f.every((r) => typeof r === 'string' && r.length === m)))) return false;
    }
    const n = Array.isArray(p.grid) ? p.grid.length : 0;
    if (p.hires === true ? ![24, 32, 48].includes(n) : n !== 12) return false;
    if (p.down != null && !(p.hires === true && p.down && Array.isArray(p.down.frames) && p.down.frames.length > 0 && p.down.frames.every((f) => Array.isArray(f) && f.length === n && f.every((r) => typeof r === 'string' && r.length === n)))) return false; // 밥 기다리는 모습(GAME OVER 대신)은 고해상도 팩에서만
    return p.grid.every((r) => typeof r === 'string' && r.length === n);
  }
  if (p.type === 'enemies') return Array.isArray(p.texts) && p.texts.length > 0;
  if (p.type === 'rest') return Array.isArray(p.frames) && p.frames.length > 0;
  if (p.type === 'backdrop') return p.plain === true || (Array.isArray(p.sky) && p.sky.length > 0);
  return false;
}

function readDir(dir, source) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      if (validate(p)) out.push({ ...p, tier: p.tier === 'premium' ? 'premium' : 'free', source });
    } catch {}
  }
  return out;
}

function loadPacks(userDir) {
  const builtin = readDir(path.join(__dirname, '..', 'packs'), 'builtin');
  const user = readDir(userDir, 'user').map((p) => ({ ...p, tier: 'free' })); // 직접 만든 팩은 항상 사용 가능
  const byKey = new Map();
  for (const p of [...builtin, ...user]) byKey.set(`${p.type}:${p.id}`, p);
  return [...byKey.values()];
}

module.exports = { loadPacks, validate, DEFAULT_SKINS, TYPES };
