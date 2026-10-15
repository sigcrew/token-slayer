// Codex 사용량 읽기: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl 에 기록되는
// token_count 이벤트의 rate_limits(5시간 / 주간 사용 비율)를 가장 최근 것부터 찾는다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');

const TAIL_BYTES = 768 * 1024;
const MAX_FILES = 40;

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

// ChatGPT 앱의 Codex(dot 같은 에이전트)는 세션 기록(rollout) 대신 이 로그 폴더에 일한 흔적을 남긴다. 일할 때만 몰려서 바뀌고 쉴 때는 조용하다 (맥만 확인함)
function desktopLogDir() {
  return process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Logs', 'com.openai.codex') : null;
}

// 그 로그 폴더(년/월/일/*.log)에서 가장 최근에 쓰인 로그 파일 몇 개. 열린 파일에 계속 덧붙여 써서 폴더 알림이 안 오므로 직접 확인(probe)한다
function recentDesktopLogs(dir = desktopLogDir(), max = 3) {
  if (!dir) return [];
  const out = [];
  const ls = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };
  const desc = (list) => list.filter((e) => e.isDirectory() && /^\d+$/.test(e.name)).map((e) => e.name).sort().reverse();
  for (const y of desc(ls(dir)).slice(0, 1)) for (const m of desc(ls(path.join(dir, y))).slice(0, 1)) for (const d of desc(ls(path.join(dir, y, m))).slice(0, 2)) {
    for (const e of ls(path.join(dir, y, m, d))) {
      if (!e.isFile() || !/\.log$/.test(e.name)) continue;
      const f = path.join(dir, y, m, d, e.name);
      try { out.push({ f, mtime: fs.statSync(f).mtimeMs }); } catch {}
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, max).map((x) => x.f);
}

function toMs(v, baseMs) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isNaN(n)) v = n;
    else {
      const t = Date.parse(v);
      return Number.isNaN(t) ? null : t;
    }
  }
  if (typeof v !== 'number') return null;
  return v > 1e12 ? v : v * 1000; // ms 또는 초 단위 unix time
}

function parseWindow(w, lineMs) {
  if (!w || typeof w.used_percent !== 'number') return null;
  let resetsAt = null;
  if (w.resets_at != null) resetsAt = toMs(w.resets_at);
  else if (typeof w.resets_in_seconds === 'number' && lineMs) resetsAt = lineMs + w.resets_in_seconds * 1000;
  return {
    usedPercent: w.used_percent,
    windowMinutes: typeof w.window_minutes === 'number' ? w.window_minutes : null,
    resetsAt,
  };
}

// rate_limits 객체 → { fiveHour, weekly }
function classify(rl, lineMs) {
  const wins = [parseWindow(rl.primary, lineMs), parseWindow(rl.secondary, lineMs)];
  let fiveHour = null;
  let weekly = null;
  wins.forEach((w, i) => {
    if (!w) return;
    if (w.windowMinutes != null) {
      if (w.windowMinutes >= 24 * 60) weekly = weekly || w;
      else fiveHour = fiveHour || w;
    } else if (i === 0) fiveHour = fiveHour || w;
    else weekly = weekly || w;
  });
  return { fiveHour, weekly };
}

// JSONL 텍스트에서 마지막 rate_limits 스냅샷 찾기
function parseLatestFromText(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line.indexOf('rate_limits') === -1) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const p = obj.payload || obj.msg || obj;
    if (!p || p.type !== 'token_count' || !p.rate_limits) continue;
    const rl = p.rate_limits;
    if (rl.limit_id && rl.limit_id !== 'codex') continue;
    const lineMs = obj.timestamp ? Date.parse(obj.timestamp) : null;
    const { fiveHour, weekly } = classify(rl, lineMs);
    if (!fiveHour && !weekly) continue;
    return { fiveHour, weekly, observedAt: lineMs, plan: rl.plan_type || null };
  }
  return null;
}

async function readTail(file) {
  // 오래된 세션은 Codex가 .jsonl.zst로 압축해 둔다
  if (file.endsWith('.zst')) {
    if (typeof zlib.zstdDecompressSync !== 'function') return '';
    const text = zlib.zstdDecompressSync(await fs.promises.readFile(file)).toString('utf8');
    return text.length > TAIL_BYTES ? text.slice(-TAIL_BYTES) : text;
  }
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return text;
  } finally {
    await fh.close();
  }
}

async function listDirs(dir) {
  try {
    const ents = await fs.promises.readdir(dir, { withFileTypes: true });
    return ents.filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
  } catch { return []; }
}

// 최근 날짜 폴더부터 rollout 파일을 수정시간 역순으로 모은다
// 세션 파일 목록: 날짜 폴더 순서가 아니라 "마지막으로 쓰인 시각" 전체 순서로 정렬한다.
// (어제 시작한 대화나 예전 대화를 이어서 쓰면 그 파일은 옛 날짜 폴더에 있어서, 폴더 순서로는 놓친다)
const SCAN_DAYS = 30;
const SCAN_CACHE_MS = 10000;
let scanCache = { at: 0, files: [], pending: null };

function dayOf(y, m, d) { return Date.UTC(+y, +m - 1, +d); }

async function scanRollouts(now = Date.now()) {
  const root = path.join(codexHome(), 'sessions');
  const oldest = now - (SCAN_DAYS + 1) * 86400e3;
  const out = [];
  for (const y of await listDirs(root)) {
    for (const m of await listDirs(path.join(root, y))) {
      for (const d of await listDirs(path.join(root, y, m))) {
        if (dayOf(y, m, d) < oldest) return sortByMtime(out);
        const dir = path.join(root, y, m, d);
        let names = [];
        try { names = await fs.promises.readdir(dir); } catch {}
        for (const n of names) {
          if (!n.startsWith('rollout-') || !(n.endsWith('.jsonl') || n.endsWith('.jsonl.zst'))) continue;
          const f = path.join(dir, n);
          try { const st = await fs.promises.stat(f); out.push({ f, mtime: st.mtimeMs, size: st.size }); } catch {}
        }
      }
    }
  }
  return sortByMtime(out);
}

function sortByMtime(a) { return a.sort((x, y) => y.mtime - x.mtime); }

async function recentRolloutFiles() {
  const now = Date.now();
  const home = codexHome();
  if (scanCache.home !== home) scanCache = { at: 0, files: [], pending: null, home };
  if (now - scanCache.at < SCAN_CACHE_MS) return scanCache.files;
  if (!scanCache.pending) {
    scanCache.pending = scanRollouts(now)
      .then((files) => { if (scanCache.home === home) scanCache = { at: Date.now(), files: files.slice(0, MAX_FILES), pending: null, home }; return files.slice(0, MAX_FILES); })
      .catch(() => { scanCache.pending = null; return scanCache.files; });
  }
  return scanCache.pending;
}

function resetScanCache() { scanCache = { at: 0, files: [], pending: null }; }

// 리셋 시각이 지났으면 사용량 0으로 본다
function applyResets(win, now) {
  if (!win) return null;
  if (win.resetsAt && now >= win.resetsAt) return { ...win, usedPercent: 0, resetsAt: null, resetPassed: true };
  return win;
}

// Codex 로그인 여부: 기본은 ~/.codex/auth.json, 설정에 따라 키체인("Codex Auth")에 저장된다.
// 비밀값은 읽지 않고 존재 여부만 확인한다.
async function isLoggedIn() {
  const home = codexHome();
  try { await fs.promises.access(path.join(home, 'auth.json')); return true; } catch {}
  let store = 'file';
  try {
    const cfg = await fs.promises.readFile(path.join(home, 'config.toml'), 'utf8');
    const m = cfg.match(/^\s*cli_auth_credentials_store\s*=\s*"(\w+)"/m);
    if (m) store = m[1];
  } catch {}
  if (store === 'ephemeral') return true; // 확인할 방법이 없으니 로그인된 것으로 봄
  if ((store === 'keyring' || store === 'auto') && process.platform === 'darwin') {
    return new Promise((resolve) => {
      execFile('security', ['find-generic-password', '-s', 'Codex Auth'], { timeout: 5000 }, (err) => resolve(!err));
    });
  }
  if (store === 'keyring' || store === 'auto') return true; // 다른 OS 키링은 확인 생략
  return false;
}

// 마지막 사용 시각: 가장 최근 세션 파일
async function codexLastUsed() {
  const files = await recentRolloutFiles();
  let best = files.length ? Math.max(...files.slice(0, 20).map((x) => x.mtime)) : null;
  try {
    const t = (await fs.promises.stat(path.join(codexHome(), 'history.jsonl'))).mtimeMs;
    if (!best || t > best) best = t;
  } catch {}
  return best;
}

// 여러 세션 파일에서 읽은 스냅샷 합치기: 가장 최근 것을 기준으로, 5분 안에 기록됐고 같은 리셋 시각의 창이면 더 높은 사용률을 쓴다
function mergeSnapshots(cands) {
  if (!cands.length) return null;
  const newest = cands.reduce((a, b) => ((b.observedAt || 0) > (a.observedAt || 0) ? b : a));
  const pick = (k) => {
    const base = newest[k];
    if (!base) return null;
    let best = base;
    for (const c of cands) {
      const w = c[k];
      if (!w || c === newest) continue;
      const close = !!(c.observedAt && newest.observedAt) && Math.abs(c.observedAt - newest.observedAt) <= 5 * 60e3; // 기록 시각이 없으면 합치지 않음
      const same = w.resetsAt == null || base.resetsAt == null || Math.abs(w.resetsAt - base.resetsAt) < 60e3;
      if (close && same && w.usedPercent > best.usedPercent) best = { ...base, usedPercent: w.usedPercent };
    }
    return best;
  };
  return { ...newest, fiveHour: pick('fiveHour'), weekly: pick('weekly') };
}


// ── 서버 조회: Codex 자신의 /status와 같은 사용량 조회 (공식 공개 API는 아님 · 바뀌면 로컬 기록으로 돌아간다)
//  로컬 세션 기록은 "그 컴퓨터에서 대화가 끝날 때마다" 갱신돼서, 웹 · 클라우드 · 다른 컴퓨터에서 쓴 양은 반영되지 않는다.
//  로그인 토큰은 읽기만 한다 (갱신은 하지 않는다: Codex CLI가 직접 하는 일이고, 우리가 하면 그쪽 로그인에 영향이 갈 수 있다)
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const SERVER_TTL = 45 * 1000;           // 성공하면 이 시간 동안은 다시 묻지 않음
const RETRY_AUTH = 10 * 60 * 1000;      // 로그인이 거절되면(만료 등) 오래 쉼
const RETRY_OTHER = 3 * 60 * 1000;      // 그 밖의 실패
const RETRY_NET = 2 * 60 * 1000;        // 네트워크 문제

function readAuthTokens() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(codexHome(), 'auth.json'), 'utf8'));
    const t = j && j.tokens;
    if (t && typeof t.access_token === 'string' && t.access_token) return { token: t.access_token, account: t.account_id || '' };
  } catch {}
  return null; // 키체인에 저장하는 설정이면 읽지 않는다 → 로컬 기록 사용
}

function jwtExpMs(tok) {
  try {
    const p = JSON.parse(Buffer.from(String(tok).split('.')[1], 'base64url').toString('utf8'));
    return typeof p.exp === 'number' ? p.exp * 1000 : null;
  } catch { return null; }
}

// 서버 응답 → { fiveHour, weekly, plan }  (창 길이가 하루 이상이면 주간, 아니면 5시간)
function parseServerUsage(body, now) {
  const rl = body && body.rate_limit;
  if (!rl || typeof rl !== 'object') return null;
  let fiveHour = null;
  let weekly = null;
  for (const w of [rl.primary_window, rl.secondary_window]) {
    if (!w || typeof w.used_percent !== 'number') continue;
    const minutes = typeof w.limit_window_seconds === 'number' ? Math.round(w.limit_window_seconds / 60) : null;
    const resetsAt = typeof w.reset_at === 'number' ? toMs(w.reset_at) : (typeof w.reset_after_seconds === 'number' ? now + w.reset_after_seconds * 1000 : null);
    const win = { usedPercent: w.used_percent, windowMinutes: minutes, resetsAt };
    if (minutes != null && minutes >= 24 * 60) weekly = weekly || win;
    else fiveHour = fiveHour || win;
  }
  if (!fiveHour && !weekly) return null;
  return { fiveHour, weekly, plan: typeof body.plan_type === 'string' ? body.plan_type : undefined };
}

class CodexReader {
  // fetchFn이 없으면(테스트 · 설정에서 끔) 서버에는 묻지 않고 로컬 기록만 쓴다
  constructor(fetchFn = null) {
    this.cacheKey = null; this.cached = null; this.authAt = 0; this.loggedIn = true;
    this.fetchFn = fetchFn; this.serverEnabled = true;
    this.server = null; this.serverAt = 0; this.retryAt = 0; this.serverNote = null;
  }

  // 서버에서 최신 사용량을 가져온다 (실패하면 null → 호출한 쪽이 로컬 기록을 쓴다)
  async serverSnapshot(now) {
    if (!this.fetchFn || !this.serverEnabled) return null;
    if (this.server && now - this.serverAt < SERVER_TTL) return this.server;
    if (now < this.retryAt) return this.server && now - this.serverAt < 3 * SERVER_TTL ? this.server : null;
    const auth = readAuthTokens();
    if (!auth) { this.retryAt = now + RETRY_OTHER; this.serverNote = 'no-file-token'; return null; }
    const exp = jwtExpMs(auth.token);
    if (exp && exp < now + 30000) { this.retryAt = now + RETRY_OTHER; this.serverNote = 'token-expired'; this.server = null; return null; }
    try {
      const res = await this.fetchFn(USAGE_URL, { headers: { Authorization: `Bearer ${auth.token}`, 'ChatGPT-Account-Id': auth.account, Accept: 'application/json' } });
      if (res.status === 401 || res.status === 403) { this.retryAt = now + RETRY_AUTH; this.serverNote = `http-${res.status}`; this.server = null; return null; }
      if (!res.ok) { this.retryAt = now + RETRY_OTHER; this.serverNote = `http-${res.status}`; return null; }
      const snap = parseServerUsage(await res.json(), now);
      if (!snap) { this.retryAt = now + RETRY_OTHER; this.serverNote = 'unexpected-format'; return null; }
      this.server = snap; this.serverAt = now; this.serverNote = 'ok';
      return snap;
    } catch {
      this.retryAt = now + RETRY_NET; this.serverNote = 'network';
      return null;
    }
  }

  lastUsed() { return codexLastUsed(); }

  async checkLogin(now) {
    if (now - this.authAt > 20000) {
      this.authAt = now;
      try { this.loggedIn = await isLoggedIn(); } catch { this.loggedIn = true; }
    }
    return this.loggedIn;
  }

  async read(now = Date.now()) {
    let r = await this.readData(now);
    if (r.error === 'not-installed') return r;
    const sv = await this.serverSnapshot(now);
    if (sv) {
      // 서버 값이 가장 정확하다 (다른 기기 · 웹에서 쓴 것까지 반영). 로컬 기록은 서버를 못 쓸 때만 쓴다
      r = { ok: true, fiveHour: applyResets(sv.fiveHour, now), weekly: applyResets(sv.weekly, now), observedAt: this.serverAt, plan: sv.plan || r.plan, source: 'server' };
    }
    if (!(await this.checkLogin(now))) {
      return { ...r, needsLogin: true, loginMessage: 'Codex 로그인이 필요해요', message: r.ok ? r.message : 'Codex 로그인이 필요해요' };
    }
    return r;
  }


  async readData(now) {
    let exists = true;
    try { await fs.promises.access(codexHome()); } catch { exists = false; }
    if (!exists) return { ok: false, error: 'not-installed', message: 'Codex가 설치되어 있지 않아요' };

    const files = await recentRolloutFiles();
    if (!files.length) return { ok: false, error: 'no-data', message: 'Codex를 한 번 사용하면 표시돼요' };

    const key = files.slice(0, 4).map((x) => `${x.f}:${x.mtime}:${x.size}`).join('|');
    if (key !== this.cacheKey) {
      // 세션(대화)마다 마지막으로 기록한 사용률이 1%p씩 뒤처져 있을 수 있다 → 최근 몇 개를 같이 보고 가장 앞선 값을 쓴다
      const cands = [];
      for (const x of files.slice(0, 4)) {
        try { const r = parseLatestFromText(await readTail(x.f)); if (r) cands.push(r); } catch {}
      }
      if (!cands.length) {
        for (const x of files.slice(4)) {
          try { const r = parseLatestFromText(await readTail(x.f)); if (r) { cands.push(r); break; } } catch {}
        }
      }
      this.cacheKey = key;
      this.cached = mergeSnapshots(cands);
    }
    if (!this.cached) return { ok: false, error: 'no-data', message: 'Codex를 한 번 사용하면 표시돼요' };
    return {
      ok: true,
      fiveHour: applyResets(this.cached.fiveHour, now),
      weekly: applyResets(this.cached.weekly, now),
      observedAt: this.cached.observedAt,
      plan: this.cached.plan,
    };
  }
}

// 지금 쓰이고 있을 가능성이 큰 세션 파일들 (가장 최근 몇 개)
// 지금 쓰이고 있을 수 있는 세션 파일: 최근 10분 안에 쓰인 것 전부 (여러 대화를 동시에 돌려도 다 본다)
const ACTIVE_WINDOW_MS = 10 * 60e3;
async function activeRolloutFiles(min = 3, max = 16) {
  const now = Date.now();
  const files = (await recentRolloutFiles()).filter((x) => !x.f.endsWith('.zst'));
  const fresh = files.filter((x) => now - x.mtime <= ACTIVE_WINDOW_MS);
  return (fresh.length >= min ? fresh : files.slice(0, min)).slice(0, max).map((x) => x.f);
}

module.exports = { recentDesktopLogs, desktopLogDir, parseServerUsage, jwtExpMs, mergeSnapshots, activeRolloutFiles, recentRolloutFiles, resetScanCache, CodexReader, parseLatestFromText, applyResets, codexHome, isLoggedIn };
