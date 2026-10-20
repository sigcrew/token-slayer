// Antigravity(Google) 사용량 읽기: 공식 CLI(agy)의 사용량 보고 `agy -p /usage --output-format json`를 실행해서 읽는다.
// 이 명령은 모델에 질문을 보내지 않고(토큰 0) 그룹별 주간 한도의 남은 비율만 돌려준다 (agy 1.1.11+).
// 2026년 6월부터 개인 Google 계정의 Gemini 한도는 Gemini CLI 대신 Antigravity에서 관리된다.
// 로그인은 agy가 갖고 있으며 이 앱은 토큰을 직접 읽지 않는다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const HOME = () => process.env.ANTIGRAVITY_HOME || path.join(os.homedir(), '.gemini', 'antigravity-cli');
const RUN_TIMEOUT = 90 * 1000;

// Finder에서 실행한 앱은 PATH가 짧아서 흔한 설치 위치를 직접 찾는다
function findAgy() {
  if (process.env.ANTIGRAVITY_CLI_PATH !== undefined) {
    const p = process.env.ANTIGRAVITY_CLI_PATH;
    return p && fs.existsSync(p) ? p : null;
  }
  const exe = process.platform === 'win32' ? 'agy.exe' : 'agy';
  const dirs = [...String(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin'),
    path.join(HOME(), 'bin')];
  if (process.platform === 'win32') dirs.push(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity CLI'));
  for (const d of dirs) {
    if (!d) continue;
    const f = path.join(d, exe);
    try { if (fs.statSync(f).isFile()) return f; } catch {}
  }
  return null;
}

// 그룹 이름 → 짧은 표시 이름과 창 key. Gemini 그룹이 주 한도('weekly'), 나머지(Claude·GPT 등)는 'weeklyOther'
function groupInfo(name) {
  const n = String(name || '');
  if (/gemini/i.test(n)) return { key: 'weekly', label: 'Gemini 주간' };
  if (/claude|gpt/i.test(n)) return { key: 'weeklyOther', label: 'Claude·GPT 주간' };
  return { key: `weekly_${n.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 20) || 'other'}`, label: n || '주간' };
}

// agy 사용량 보고(JSON) → 앱의 windows. 알 수 없는 모양이면 null
function parseUsage(j, now = Date.now()) {
  const data = j && j.command && j.command.data;
  const groups = data && Array.isArray(data.groups) ? data.groups : null;
  if (!groups) return null;
  const windows = [];
  const seen = new Set();
  for (const g of groups) {
    for (const b of Array.isArray(g.buckets) ? g.buckets : []) {
      const frac = Number(b.remaining_fraction);
      if (!Number.isFinite(frac)) continue;
      const info = groupInfo(g.name);
      let key = info.key;
      while (seen.has(key)) key += '_';
      seen.add(key);
      const t = Date.parse(b.reset_time);
      const minutes = b.window === 'weekly' ? 10080 : b.window === 'daily' ? 1440 : b.window === 'monthly' ? 43200 : undefined;
      windows.push({ key, label: info.label, usedPercent: Math.max(0, Math.min(100, (1 - frac) * 100)), resetsAt: Number.isNaN(t) ? null : t, ...(minutes ? { windowMinutes: minutes } : {}) });
    }
  }
  return windows.length ? windows : null;
}

function run(agy, timeout = RUN_TIMEOUT) {
  return new Promise((resolve) => {
    let cwd;
    try { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-agy-')); } catch { cwd = os.tmpdir(); }
    // 로그인이 풀렸을 때 agy가 브라우저를 열지 않도록 (조회는 조용히 실패하고, 로그인은 사용자가 터미널에서)
    const env = { ...process.env, BROWSER: process.platform === 'win32' ? 'cmd /c exit' : '/usr/bin/false' };
    execFile(agy, ['-p', '/usage', '--output-format', 'json', '--print-timeout', '60s'], { cwd, env, timeout, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout) => {
      try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {}
      resolve({ err, stdout: String(stdout || '') });
    });
  });
}

// 작업 중 신호: 최근에 바뀐 대화 기록(brain/<id>/.system_generated/logs/transcript.jsonl)과 대화 DB의 WAL
function activityFiles(now = Date.now(), windowMs = 60 * 60 * 1000) {
  const out = [];
  const home = HOME();
  const recent = (f) => { try { return now - fs.statSync(f).mtimeMs <= windowMs; } catch { return false; } };
  try {
    for (const id of fs.readdirSync(path.join(home, 'brain'))) {
      const f = path.join(home, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
      if (recent(f)) out.push(f);
    }
  } catch {}
  try {
    for (const n of fs.readdirSync(path.join(home, 'conversations'))) {
      if (!n.endsWith('.db-wal')) continue;
      const f = path.join(home, 'conversations', n);
      if (recent(f)) out.push(f);
    }
  } catch {}
  return out;
}

class AntigravityReader {
  constructor(runner) {
    this.run = runner || run;
    this.blockedUntil = 0;
  }

  async lastUsed() {
    let best = null;
    const home = HOME();
    for (const f of [path.join(home, 'history.jsonl'), path.join(home, 'conversation_summaries.db-wal'), path.join(home, 'conversation_summaries.db')]) {
      try { const t = fs.statSync(f).mtimeMs; if (!best || t > best) best = t; } catch {}
    }
    return best;
  }

  async read() {
    const agy = findAgy();
    if (!agy) return { ok: false, error: 'not-installed', message: 'Antigravity CLI(agy)가 설치되어 있지 않아요' };
    const wait = this.blockedUntil - Date.now();
    if (wait > 0) return { ok: false, error: 'rate-limited', message: '잠시 뒤 다시 조회해요' };
    const { err, stdout } = await this.run(agy);
    if (err && err.killed) { this.blockedUntil = Date.now() + 5 * 60000; return { ok: false, error: 'network', message: 'Antigravity 사용량 조회가 너무 오래 걸려요' }; }
    let j = null;
    try { j = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() || ''); } catch {}
    if (!j) {
      if (/sign(ed)?.?in|log(ged)?.?in|auth/i.test(stdout)) return { ok: false, error: 'expired', needsLogin: true, message: 'Antigravity 로그인이 필요해요. 터미널에서 agy를 실행해 로그인해 주세요' };
      return { ok: false, error: 'parse', message: 'Antigravity 사용량을 읽지 못했어요' };
    }
    if (j.status && j.status !== 'SUCCESS') {
      const t = `${j.status} ${j.response || ''}`;
      if (/sign(ed)?.?in|log(ged)?.?in|auth|credential/i.test(t)) return { ok: false, error: 'expired', needsLogin: true, message: 'Antigravity 로그인이 필요해요. 터미널에서 agy를 실행해 로그인해 주세요' };
      return { ok: false, error: 'http', message: 'Antigravity 사용량 조회에 실패했어요' };
    }
    const windows = parseUsage(j);
    if (!windows) return { ok: false, error: 'no-data', message: '이 계정은 사용량 한도 정보가 없어요' };
    return { ok: true, windows, fetchedAt: Date.now() };
  }
}

module.exports = { AntigravityReader, parseUsage, findAgy, activityFiles, home: HOME };
