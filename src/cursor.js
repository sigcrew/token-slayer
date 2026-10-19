// Cursor 사용량 읽기: Cursor 앱이 자기 설정 DB(state.vscdb)에 저장해 둔 로그인 토큰으로
// 대시보드와 같은 사용량 API(cursor.com/api/usage-summary, 비공식)를 조회한다.
// 토큰은 읽기만 한다. 만료되면 Cursor 앱을 열면 앱이 알아서 갱신한다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { tr } = require('../renderer/i18n');

const USAGE_URL = 'https://cursor.com/api/usage-summary';
const TOKEN_KEY = 'cursorAuth/accessToken';

function dbPath() {
  if (process.env.CURSOR_STATE_DB) return process.env.CURSOR_STATE_DB;
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  return path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

// 에이전트가 일할 때 같이 바뀌는 파일들 (측정: 일하는 동안 전역 설정 DB·대화 DB·작업공간 DB의 WAL이 몇 초마다 바뀌고, 쉴 때는 30초에 한 번 정도)
// 열린 파일에 덧붙여 쓰는 거라 폴더 알림이 놓치기 쉬워서, 이 파일들을 짧은 간격으로 직접 확인한다
function activityFiles() {
  const db = dbPath();
  const gs = path.dirname(db);
  const root = path.resolve(gs, '..', '..');
  const out = [db + '-wal', path.join(gs, 'conversation-search.db-wal')];
  const newest = (dir, pick) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    return names.map((n) => pick(path.join(dir, n), n)).filter(Boolean)
      .map((f) => { try { return { f, t: fs.statSync(f).mtimeMs }; } catch { return null; } }).filter(Boolean)
      .sort((a, b) => b.t - a.t).map((x) => x.f);
  };
  out.push(...newest(path.join(root, 'User', 'workspaceStorage'), (d) => path.join(d, 'state.vscdb-wal')).slice(0, 2));
  out.push(...newest(path.join(root, 'IndexedDB', 'vscode-file_vscode-app_0.indexeddb.leveldb'), (f, n) => (/\.log$/.test(n) ? f : null)).slice(0, 1));
  return out;
}

// ── 에이전트 대화 기록(transcript)으로 "지금 일하는 중인가" 판단 ──
// ~/.cursor/projects/<프로젝트>/agent-transcripts/<id>/<id>.jsonl 은 한 줄씩 덧붙는다.
// 한 줄은 {role, message} 이거나, 턴이 끝날 때 {type:'turn_ended', status:'success'|'error'|'aborted'} 다.
// 마지막 줄이 turn_ended 가 아니고 파일이 최근에 바뀌었으면 에이전트가 일하는 중이다.
const TRANSCRIPT_ACTIVE_MS = 5 * 60 * 1000;   // 이 시간 동안 안 바뀌면 멈춘(또는 비정상 종료된) 것으로 본다
const TAIL_BYTES = 256 * 1024;

function projectsDir() {
  return process.env.CURSOR_PROJECTS_DIR || path.join(os.homedir(), '.cursor', 'projects');
}

// 최근에 바뀐 대화 기록 파일들 (프로젝트 폴더 목록을 훑는 거라 몇 초에 한 번만 부르면 된다)
function recentTranscripts(now = Date.now(), windowMs = 60 * 60 * 1000) {
  const out = [];
  const root = projectsDir();
  let projects = [];
  try { projects = fs.readdirSync(root); } catch { return out; }
  for (const p of projects) {
    const base = path.join(root, p, 'agent-transcripts');
    let ids = [];
    try { ids = fs.readdirSync(base); } catch { continue; }
    for (const id of ids) {
      const dir = path.join(base, id);
      let names = [];
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const n of names) {
        if (!n.endsWith('.jsonl')) continue;
        const f = path.join(dir, n);
        try { if (now - fs.statSync(f).mtimeMs <= windowMs) out.push(f); } catch {}
      }
    }
  }
  return out;
}

// 마지막 줄만 읽어서 턴이 끝났는지 본다. 읽는 도중이라 줄이 덜 써졌으면 "아직 일하는 중"
function lastLineEnded(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
    if (!lines.length) return false;
    try { return JSON.parse(lines[lines.length - 1]).type === 'turn_ended'; } catch { return false; }
  } catch { return false; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

// 지금 일하는 대화가 있는가: { working, at(가장 최근 갱신 시각) }
function transcriptState(files, now = Date.now(), cache = new Map()) {
  let working = false, at = 0;
  for (const f of files) {
    let st;
    try { st = fs.statSync(f); } catch { continue; }
    if (now - st.mtimeMs > TRANSCRIPT_ACTIVE_MS) continue;
    const key = `${st.size}:${st.mtimeMs}`;
    let c = cache.get(f);
    if (!c || c.key !== key) { c = { key, ended: lastLineEnded(f) }; cache.set(f, c); }
    if (!c.ended) { working = true; at = Math.max(at, st.mtimeMs); }
  }
  return { working, at };
}

// ── 토큰 읽기: node:sqlite → sqlite3 명령 → 파일 직접 스캔 순서로 시도 ──
function viaNodeSqlite(file) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { return undefined; }
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare('SELECT CAST(value AS BLOB) AS v FROM ItemTable WHERE key = ?').get(TOKEN_KEY);
    if (!row || row.v == null) return null;
    return Buffer.from(row.v).toString('utf8').trim() || null;
  } finally { db.close(); }
}

function viaSqliteCli(file) {
  return new Promise((resolve) => {
    execFile('sqlite3', ['-readonly', file, `SELECT value FROM ItemTable WHERE key = '${TOKEN_KEY}'`], { timeout: 5000 }, (err, out) => {
      if (err) return resolve(undefined);
      resolve(String(out).trim() || null);
    });
  });
}

function jwtClaims(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
  catch { return null; }
}

// 최후 수단: DB 파일(+WAL)에서 키 바로 뒤의 JWT를 찾고, 만료가 가장 늦은 것을 쓴다
function viaScan(file) {
  let best = null;
  for (const f of [file, file + '-wal']) {
    let buf;
    try { buf = fs.readFileSync(f); } catch { continue; }
    const text = buf.toString('latin1');
    let i = -1;
    while ((i = text.indexOf(TOKEN_KEY, i + 1)) !== -1) {
      const m = text.slice(i + TOKEN_KEY.length, i + TOKEN_KEY.length + 4096).match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
      if (!m) continue;
      const c = jwtClaims(m[0]);
      if (c && typeof c.exp === 'number' && (!best || c.exp > best.exp)) best = { token: m[0], exp: c.exp };
    }
  }
  return best ? best.token : null;
}

async function readToken(file) {
  try {
    const t = viaNodeSqlite(file);
    if (t !== undefined) return t;
  } catch {}
  const t2 = await viaSqliteCli(file);
  if (t2 !== undefined) return t2;
  return viaScan(file);
}

// Cursor 웹이 쓰는 쿠키 형식: WorkosCursorSessionToken=<userId>::<jwt>
function sessionCookie(token, now = Date.now()) {
  const c = jwtClaims(token);
  if (!c || typeof c.sub !== 'string') return { error: 'invalid' };
  const userId = c.sub.split('|').filter(Boolean).pop();
  if (!userId || !/^[\w.-]+$/.test(userId)) return { error: 'invalid' };
  if (typeof c.exp === 'number' && c.exp * 1000 - now <= 60000) return { error: 'expired' };
  return { cookie: `WorkosCursorSessionToken=${userId}%3A%3A${token}` };
}

const pct = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(100, v) : null);
const ratio = (u, l) => (typeof u === 'number' && typeof l === 'number' && l > 0 && u >= 0 ? Math.min(100, (u / l) * 100) : null);

function parseUsage(j) {
  const plan = j && j.individualUsage && j.individualUsage.plan;
  const overall = j && j.individualUsage && j.individualUsage.overall;
  const pooled = j && j.teamUsage && j.teamUsage.pooled;
  const teamOD = j && j.teamUsage && j.teamUsage.onDemand;
  // 구독이 끝나 무료 플랜이 되면 포함 사용량이 0($0 중 $0 사용)으로 오고 사용률도 0%로 온다.
  // 이걸 "하나도 안 썼다"로 읽으면 HP가 100%로 차 보이므로, 표시할 한도가 없는 것으로 따로 알린다
  const noIncluded = plan && plan.limit === 0 && !(plan.used > 0) && !(j && j.isUnlimited === true)
    && !(pooled && pooled.limit > 0) && !(teamOD && teamOD.enabled !== false && teamOD.limit > 0)
    && !(overall && overall.limit > 0);
  if (noIncluded) return { noPlan: true, plan: (j && j.membershipType) || null };
  const auto = pct(plan && plan.autoPercentUsed);
  const api = pct(plan && plan.apiPercentUsed);
  let monthly = pct(plan && plan.totalPercentUsed);
  if (monthly == null && (auto != null || api != null)) monthly = Math.max(auto || 0, api || 0);
  if (monthly == null) monthly = ratio(plan && plan.used, plan && plan.limit);
  if (monthly == null) monthly = ratio(overall && overall.used, overall && overall.limit);
  if (monthly == null) monthly = ratio(pooled && pooled.used, pooled && pooled.limit);
  if (monthly == null && teamOD && teamOD.enabled !== false) monthly = ratio(teamOD.used, teamOD.limit);
  if (monthly == null && j && j.isUnlimited === true) monthly = 0;
  if (monthly == null) return null;
  const t = j.billingCycleEnd ? Date.parse(j.billingCycleEnd) : NaN;
  const resetsAt = Number.isNaN(t) ? null : t;
  const windows = [{ key: 'monthly', label: '월간', usedPercent: monthly, resetsAt }];
  if (auto != null) windows.push({ key: 'auto', label: 'Auto', usedPercent: auto, resetsAt });
  if (api != null) windows.push({ key: 'api', label: 'API', usedPercent: api, resetsAt });
  return { windows, plan: j.membershipType || null };
}

class CursorReader {
  constructor(fetchFn) {
    this.fetch = fetchFn || globalThis.fetch;
    this.blockedUntil = 0;
  }

  // 진단용: 토큰이 있는지 · 언제 만료되는지 (토큰 값은 빼고)
  async diagnose() {
    const file = dbPath();
    const out = { dbFound: fs.existsSync(file) };
    if (!out.dbFound) return out;
    let token = null;
    try { token = await readToken(file); } catch {}
    out.tokenFound = !!token;
    const c = token ? jwtClaims(token) : null;
    out.tokenParsable = !!c;
    if (c && typeof c.exp === 'number') out.expiresInHours = Math.round((c.exp * 1000 - Date.now()) / 360000) / 10;
    return out;
  }

  // 마지막 사용 시각: Cursor가 실행 중에 계속 쓰는 설정 DB 파일
  async lastUsed() {
    const f = dbPath();
    let best = null;
    for (const x of [f, f + '-wal']) {
      try { const t = (await fs.promises.stat(x)).mtimeMs; if (!best || t > best) best = t; } catch {}
    }
    return best;
  }

  async read() {
    const file = dbPath();
    if (!fs.existsSync(file)) return { ok: false, error: 'not-installed', message: 'Cursor가 설치되어 있지 않아요' };

    const loginMsg = { ok: false, error: 'expired', needsLogin: true, message: 'Cursor 로그인이 필요해요. Cursor 앱을 열어 로그인해 주세요' };
    // 토큰이 만료됐을 뿐 로그인이 풀린 건 아니다: Cursor 앱을 열면 앱이 알아서 갱신하므로 "로그인하세요"라고 하지 않는다
    const staleMsg = { ok: false, error: 'expired', needsLogin: false, message: 'Cursor 인증이 잠시 만료됐어요 (로그인은 그대로예요). Cursor 앱을 열면 자동으로 갱신돼요' };
    let token;
    try { token = await readToken(file); } catch { token = null; }
    if (!token) return loginMsg;
    const s = sessionCookie(token);
    if (s.error === 'expired') return staleMsg;
    if (s.error) return loginMsg;

    const wait = this.blockedUntil - Date.now();
    if (wait > 0) return { ok: false, error: 'rate-limited', message: tr('조회 제한 중 · {n}분 뒤 재시도', { n: Math.ceil(wait / 60000) }) };

    let res;
    try {
      res = await this.fetch(USAGE_URL, { headers: { Accept: 'application/json', Cookie: s.cookie, 'User-Agent': 'token-slayer/0.17' } });
    } catch { return { ok: false, error: 'network', message: 'Cursor 서버에 연결하지 못했어요' }; }
    if (res.status === 401 || res.status === 403) {
      // 토큰이 곧 만료되거나 이미 만료됐다면 "앱을 열면 갱신된다"가 맞다. 토큰이 멀쩡한데 서버가 거절했다면 그건 우리 요청이 거절당한 것이라 사실대로 알린다
      // (예전에는 이 둘을 구분하지 않아서, 60일 남은 토큰에도 "인증이 잠시 만료"라고 나왔다)
      const c = jwtClaims(token);
      const soon = !c || typeof c.exp !== 'number' || c.exp * 1000 - Date.now() < 10 * 60000;
      if (soon) return staleMsg;
      return { ok: false, error: 'rejected', needsLogin: false, message: tr('Cursor 서버가 요청을 거절했어요 ({n})', { n: res.status }) };
    }
    if (res.status === 429) {
      this.blockedUntil = Date.now() + 5 * 60000;
      return { ok: false, error: 'rate-limited', message: '조회가 너무 잦아요. 5분 뒤 재시도해요' };
    }
    if (!res.ok) return { ok: false, error: 'http', message: tr('Cursor 사용량 조회 실패 ({n})', { n: res.status }) };
    let j;
    try { j = await res.json(); } catch { return { ok: false, error: 'parse', message: '응답을 읽지 못했어요' }; }
    const u = parseUsage(j);
    if (!u) return { ok: false, error: 'no-data', message: '이 계정은 사용량 한도 정보가 없어요' };
    if (u.noPlan) return { ok: false, error: 'no-plan', plan: u.plan, message: 'Cursor 플랜에 포함된 사용량이 없어요 (구독이 끝났거나 무료 플랜)' };
    return { ok: true, windows: u.windows, plan: u.plan, fetchedAt: Date.now() };
  }
}

module.exports = { CursorReader, parseUsage, sessionCookie, viaScan, dbPath, activityFiles, recentTranscripts, transcriptState, projectsDir };
