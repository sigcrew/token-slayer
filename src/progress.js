// 레벨 · 경험치 · BURNING TIME
//  - 사용량 1% = 경험치 100 (BURNING TIME 중에는 2배)
//  - 레벨 L까지 필요한 누적 경험치 = 500 × L × (L-1)   (Lv2 1,000 · Lv5 10,000 · Lv10 45,000 · Lv20 190,000)
//  - BURNING TIME: 리셋이 가까운데 한도가 많이 남았을 때 (기한 전에 태워 쓰기)
const fs = require('fs');
const path = require('path');

const XP_PER_PERCENT = 100;
const BURN_MULT = 2;

const xpForLevel = (L) => 500 * L * (L - 1);
function levelFor(xp) {
  let L = 1;
  while (xpForLevel(L + 1) <= xp) L++;
  return L;
}
function levelInfo(xp) {
  const level = levelFor(xp);
  const a = xpForLevel(level), b = xpForLevel(level + 1);
  return { level, xp, progress: (xp - a) / (b - a), toNext: b - xp };
}

// 한도 창별 BURNING TIME 조건: 리셋까지 남은 시간이 짧은데 남은 한도가 많을 때
// 5시간처럼 짧은 창은 하루에도 여러 번 리셋돼서, 그걸로 버닝을 주면 그 서비스만 빨리 큰다 → 주간·월간 창만 본다
function burnRule(w) {
  const mins = w.windowMinutes || (w.key === 'fiveHour' ? 300 : w.key === 'monthly' ? 43200 : w.key === 'weekly' || /^weekly/.test(w.key) ? 10080 : null);
  if (!mins || mins <= 600) return null; // 짧은 창(5시간 등)은 버닝 없음
  if (mins <= 20160) return { withinMs: 12 * 3600e3, minRemaining: 20 }; // 주간: 12시간 이내, 20% 이상
  return { withinMs: 3 * 86400e3, minRemaining: 20 }; // 월간 등: 3일 이내, 20% 이상
}

// 결과의 windows 중 BURNING TIME인 창 (가장 급한 것)
function burning(windows, now = Date.now()) {
  let best = null;
  for (const w of windows || []) {
    if (!w.resetsAt || typeof w.usedPercent !== 'number') continue;
    const left = w.resetsAt - now;
    const remaining = 100 - w.usedPercent;
    const rule = burnRule(w);
    if (!rule) continue;
    if (left > 0 && left <= rule.withinMs && remaining >= rule.minRemaining) {
      if (!best || left < best.msLeft) best = { key: w.key, label: w.label, msLeft: left, remaining: Math.round(remaining), resetsAt: w.resetsAt };
    }
  }
  return best;
}

// 한도 창 길이 (분)
function windowMinutes(w) {
  if (w.windowMinutes) return w.windowMinutes;
  if (w.key === 'fiveHour') return 300;
  if (/^weekly/.test(w.key || '')) return 10080;
  if (['monthly', 'auto', 'api'].includes(w.key)) return 43200;
  return 300;
}

// 1%당 경험치: 한도 창이 길수록 1%가 더 많은 작업이라 더 많이 줌 (서비스끼리 공평하게)
//   5시간 창 100 · 주간 400 · 월간 1,500
function xpPerPercent(w) {
  const m = windowMinutes(w);
  if (m <= 600) return 100;
  if (m <= 20160) return 400;
  return 1500;
}

// 한 번의 조회(몇 분 간격)에서 이만큼 이상 늘어난 값은 실제 사용이 아니라 서버가 잠깐 준 이상한 값이다.
// (예: 전부 0%로 읽혔다가 실제 값으로 돌아오면, 이미 쓰여 있던 44%가 "방금 쓴 것"으로 잡혀 경험치가 한꺼번에 쌓였다.)
// 하루 이상짜리 창(주간 · 월간)에만 적용한다: 5시간 창은 병렬 작업으로 짧은 시간에 빨리 찰 수 있다.
const MAX_STEP = 25; // %p
function stepCap(w) { return windowMinutes(w) >= 1440 ? MAX_STEP : Infinity; }

// 이번 조회에서 '너무 크게 늘어서 세지 않은' 창이 있으면 그 증가량(%p), 없으면 0
function implausibleJump(prev, cur) {
  if (!prev || !prev.ok || !cur || !cur.ok || !prev.windows || !cur.windows) return 0;
  let big = 0;
  for (const w of cur.windows) {
    const o = prev.windows.find((x) => x.key === w.key);
    if (o && typeof o.usedPercent === 'number' && typeof w.usedPercent === 'number' && w.usedPercent - o.usedPercent > stepCap(w)) big = Math.max(big, w.usedPercent - o.usedPercent);
  }
  return big;
}

// 같은 한도 주기(리셋 시각이 그대로)에서 사용률이 크게 줄어든 읽기: 사용량은 주기 안에서 줄지 않으므로 서버가 잠깐 이상한 값을 준 것이다.
// 진짜 리셋이면 리셋 시각이 바뀐다. 해당하면 { key, from, to }, 아니면 null
const SUSPICIOUS_DROP = 20; // %p
function suspiciousDrop(prev, cur) {
  if (!prev || !prev.ok || !cur || !cur.ok || !prev.windows || !cur.windows) return null;
  for (const w of cur.windows) {
    const o = prev.windows.find((x) => x.key === w.key);
    if (!o || typeof o.usedPercent !== 'number' || typeof w.usedPercent !== 'number') continue;
    const sameCycle = o.resetsAt != null && w.resetsAt != null && Math.abs(o.resetsAt - w.resetsAt) < PEAK_RESET_TOL;
    if (sameCycle && o.usedPercent - w.usedPercent >= SUSPICIOUS_DROP) return { key: w.key, from: Math.round(o.usedPercent), to: Math.round(w.usedPercent) };
  }
  return null;
}

// 늘어난 사용량을 경험치로: 창마다 (늘어난 % × 창 가중치) 중 가장 큰 값
function xpGain(prev, cur) {
  if (!prev || !prev.ok || !cur || !cur.ok || !prev.windows || !cur.windows) return 0;
  let best = 0;
  for (const w of cur.windows) {
    const o = prev.windows.find((x) => x.key === w.key);
    if (o && typeof o.usedPercent === 'number' && typeof w.usedPercent === 'number' && w.usedPercent > o.usedPercent) {
      if (w.usedPercent - o.usedPercent > stepCap(w)) continue; // 이상한 값: 세지 않음
      best = Math.max(best, (w.usedPercent - o.usedPercent) * xpPerPercent(w));
    }
  }
  return best;
}

// 같은 한도 창에서 한 번 본 최고 사용률(peak)보다 낮게 읽혔다가 다시 올라오는 것은 '늘어난 것'으로 세지 않는다.
// Codex는 세션 파일마다 마지막 사용률이 1%p씩 뒤처져 있어서, 읽는 파일이 바뀔 때마다 48→49→48→49로 흔들리고
// 올라가는 쪽마다 경험치가 붙었다. 창이 리셋되면(크게 떨어지거나 리셋 시각이 바뀌면) peak를 새로 시작한다.
const PEAK_DROP = 5; // 이만큼 이상 떨어지면 리셋으로 봄 (%p)
const PEAK_RESET_TOL = 5 * 60e3;
const WINDOW_END_MAX_GAP = 15 * 60e3; // 이보다 오래 못 본 창은 마지막으로 본 값이 최종 사용률이라고 믿을 수 없음 (잠자기 등)
// onEnd(key, { max, mins, reset })  — 창이 끝나(리셋되)면 그 창의 최종 사용률로 한 번 불러 준다
function ratchetPrev(peaks, prev, cur, onEnd, now = Date.now()) {
  const sameWindow = (pk, w) => !!pk && w.usedPercent >= pk.max - PEAK_DROP
    && (w.resetsAt == null || pk.reset == null || Math.abs(w.resetsAt - pk.reset) < PEAK_RESET_TOL);
  let base = prev;
  if (prev && prev.ok && prev.windows && cur && cur.ok && cur.windows) {
    // 이전 값이 그 창의 peak와 같은 창이면 peak로 끌어올림 (이번 값이 리셋으로 떨어졌어도 '직전 최고치'가 기준이 되어야 GAME OVER 뒤 부활이 맞게 잡힘)
    base = { ...prev, windows: prev.windows.map((w) => {
      const pk = peaks[w.key];
      return sameWindow(pk, w) && pk.max > w.usedPercent ? { ...w, usedPercent: pk.max } : w;
    }) };
  }
  if (cur && cur.ok && cur.windows) {
    for (const w of cur.windows) {
      if (typeof w.usedPercent !== 'number') continue;
      const pk = peaks[w.key];
      const same = sameWindow(pk, w);
      if (pk && !same && onEnd && now - (pk.at || 0) <= WINDOW_END_MAX_GAP) {
        // 진짜 리셋만: 리셋 시각이 바뀌었거나, 리셋 시각 정보 없이 사용률이 거의 0으로 떨어진 경우
        const resetChanged = w.resetsAt != null && pk.reset != null && Math.abs(w.resetsAt - pk.reset) >= PEAK_RESET_TOL;
        const droppedToZero = (w.resetsAt == null || pk.reset == null) && w.usedPercent <= 5;
        if (resetChanged || droppedToZero) onEnd(w.key, { max: pk.max, mins: windowMinutes(w), reset: pk.reset });
      }
      peaks[w.key] = same
        ? { reset: w.resetsAt != null ? w.resetsAt : pk.reset, max: Math.max(pk.max, w.usedPercent), at: now }
        : { reset: w.resetsAt, max: w.usedPercent, at: now };
    }
  }
  return base;
}

// 이전 결과와 비교해 늘어난 사용량(%p) — 창 중 가장 크게 늘어난 값. 리셋(감소)은 0
function usageGain(prev, cur) {
  if (!prev || !prev.ok || !cur || !cur.ok || !prev.windows || !cur.windows) return 0;
  let g = 0;
  for (const w of cur.windows) {
    const o = prev.windows.find((x) => x.key === w.key);
    if (o && typeof o.usedPercent === 'number' && typeof w.usedPercent === 'number' && w.usedPercent > o.usedPercent && w.usedPercent - o.usedPercent <= stepCap(w)) {
      g = Math.max(g, w.usedPercent - o.usedPercent);
    }
  }
  return g;
}

// 설날 · 추석 연휴 판정: 음력(단기력) 1월 1일 · 8월 15일과 그 전날·다음 날.
// 해마다 날짜가 바뀌므로 Intl의 한국 음력 달력으로 계산한다 (연도 제한 없음).
// Intl이 음력을 지원하지 않는 환경에서는 아래 목록으로 대신 판단한다.
const KOREAN_HOLIDAYS_FALLBACK = [
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-09-24', '2026-09-25', '2026-09-26',
  '2027-02-06', '2027-02-07', '2027-02-08', '2027-09-14', '2027-09-15', '2027-09-16',
  '2028-01-26', '2028-01-27', '2028-01-28', '2028-10-02', '2028-10-03', '2028-10-04',
];
let lunarFmt = null;
try {
  lunarFmt = new Intl.DateTimeFormat('en-u-ca-dangi', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Seoul' });
  if (lunarFmt.resolvedOptions().calendar !== 'dangi') lunarFmt = null;
} catch { lunarFmt = null; }

function lunarMD(t) {
  const p = Object.fromEntries(lunarFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.month}/${p.day}`;
}

function isKoreanHoliday(t = Date.now()) {
  if (!lunarFmt) return KOREAN_HOLIDAYS_FALLBACK.includes(dayKey(t));
  for (const d of [-1, 0, 1]) {
    const md = lunarMD(t + d * 86400e3);
    if (md === '1/1' || md === '8/15') return true;
  }
  return false;
}

const dayKey = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 저장 형식: { <서비스id>: { xp }, _stats: { days: { 'YYYY-MM-DD': { <id>: 사용% } }, gameOvers, revives, burnXp, pets, nightOwl, fullBurn, gameOverDays }, _ach: { <업적id>: 달성시각 } }
function createStore(dir) {
  const file = path.join(dir, 'progress.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  data._stats = data._stats || {};
  data._stats.days = data._stats.days || {};
  data._ach = data._ach || {};
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch {} }, 500);
  };
  const heroes = () => Object.entries(data).filter(([k]) => !k.startsWith('_'));
  const st = data._stats;
  return {
    get: (id) => data[id] || { xp: 0 },
    all: () => data,
    stats: () => st,
    achievements: () => data._ach,
    addXp(id, amount) {
      const cur = data[id] || { xp: 0 };
      const before = levelFor(cur.xp);
      cur.xp = Math.round((cur.xp || 0) + amount);
      data[id] = cur;
      save();
      return { before, after: levelFor(cur.xp) };
    },
    // 하루 사용량(%p) 기록 — 주간 카드와 업적용
    addUsage(id, pct, { burning = false, at = Date.now() } = {}) {
      const k = dayKey(at);
      st.days[k] = st.days[k] || {};
      st.days[k][id] = Math.round(((st.days[k][id] || 0) + pct) * 100) / 100; // 0.05%p 미만씩 늘어나도 쌓이도록 소수 둘째 자리까지
      if (burning) st.burnXp = (st.burnXp || 0) + pct * XP_PER_PERCENT * BURN_MULT;
      const h = new Date(at).getHours();
      if (h >= 2 && h < 5) st.nightOwl = true;
      if (h >= 5 && h < 8) st.earlyBird = true;
      const dt = new Date(at);
      if (dt.getDay() === 5 && h >= 22) st.fridayNight = true;
      if (dt.getMonth() === 11 && dt.getDate() === 25) st.christmas = true;
      if (isKoreanHoliday(at)) st.koreanHoliday = true;
      if (!st.firstAt) st.firstAt = at;
      st.totalPct = Math.round(((st.totalPct || 0) + pct) * 100) / 100;
      // 오래된 기록은 60일만 보관
      const keys = Object.keys(st.days).sort();
      while (keys.length > 60) delete st.days[keys.shift()];
      save();
    },
    // 한도 창이 끝났을 때의 최종 사용률 기록 (낭비·알뜰 업적용, 최근 40개만)
    addWindowEnd(id, key, util, mins, at = Date.now()) {
      st.windowEnds = (st.windowEnds || []).concat({ id, key, util: Math.round(util * 10) / 10, mins, at }).slice(-40);
      save();
    },
    // 앱이 켜져 있던 날 기록 (하루 한 번만 저장) — '안 쓴 날'과 '앱이 꺼져 있던 날'을 구분하려고
    markRunDay(at = Date.now()) {
      const k = dayKey(at);
      st.runDays = st.runDays || [];
      if (st.runDays.includes(k)) return;
      st.runDays.push(k);
      st.runDays = st.runDays.slice(-60);
      save();
    },
    count(name, n = 1) { st[name] = (st[name] || 0) + n; save(); },
    // 날짜별 횟수 (예: 하루 부활 횟수)
    countDay(name, at = Date.now()) {
      const k = dayKey(at);
      st[name] = st[name] || {};
      st[name][k] = (st[name][k] || 0) + 1;
      const keys = Object.keys(st[name]).sort();
      while (keys.length > 60) delete st[name][keys.shift()];
      save();
      return st[name][k];
    },
    set(name, v) { st[name] = v; save(); },
    flag(name) { st[name] = true; save(); },
    addToSet(name, value) {
      st[name] = st[name] || [];
      if (!st[name].includes(value)) { st[name].push(value); save(); }
    },
    unlock(achId) {
      if (data._ach[achId]) return false;
      data._ach[achId] = Date.now();
      save();
      return true;
    },
    maxLevel: () => Math.max(1, ...heroes().map(([, v]) => levelFor(v.xp || 0))),
    totalXp: () => heroes().reduce((a, [, v]) => a + (v.xp || 0), 0),
  };
}

module.exports = { implausibleJump, suspiciousDrop, MAX_STEP, ratchetPrev, xpGain, xpPerPercent, windowMinutes, XP_PER_PERCENT, BURN_MULT, xpForLevel, levelFor, levelInfo, burning, usageGain, createStore, dayKey, isKoreanHoliday };
