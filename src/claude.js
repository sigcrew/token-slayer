// Claude 사용량 읽기: Claude Code 로그인 토큰으로 /usage 명령과 같은 사용량 API(비공식)를 조회한다.
// Claude 한도는 데스크톱 앱·claude.ai·Claude Code가 함께 쓰므로 앱에서 쓴 양도 여기 반영된다.
//
// 토큰은 몇 시간마다 만료된다. 데스크톱 앱만 쓰면 Claude Code가 갱신해 주지 않으므로
// 만료되면 이 앱이 직접 갱신하고, 새 토큰을 원래 자리(키체인 또는 파일)에 다시 저장해서
// Claude Code도 계속 같은 로그인을 쓸 수 있게 한다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const activity = require('./activity');
const { tr } = require('../renderer/i18n');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const TOKEN_URLS = ['https://platform.claude.com/v1/oauth/token', 'https://console.anthropic.com/v1/oauth/token'];
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const EXPIRY_MARGIN = 5 * 60 * 1000;

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}
function credFile() {
  return path.join(claudeDir(), '.credentials.json');
}

function execFileP(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

// 키체인을 못 읽은 이유 (사용자에게 "키체인 접근을 허용해 주세요"처럼 정확히 안내하려고 기록)
//  'missing' 항목 없음 · 'denied' 접근 거절/취소 · 'timeout' 허용 창에 답이 없어 시간 초과 · null 정상
const keychainState = { issue: null };

// 읽을 수 있는 로그인 정보를 모두 모은다: [{ oauth, raw, source: 'file'|'keychain', account }]
async function readAllCredentials() {
  const out = [];
  keychainState.issue = null;
  try {
    const raw = JSON.parse(await fs.promises.readFile(credFile(), 'utf8'));
    if (raw && raw.claudeAiOauth && raw.claudeAiOauth.accessToken) out.push({ oauth: raw.claudeAiOauth, raw, source: 'file' });
  } catch {}
  // 파일 로그인이 아직 유효하면 키체인은 건드리지 않는다 (불필요한 키체인 허용 창을 띄우지 않으려고)
  const fileOk = out.length > 0 && !isExpiredAt(out[0].oauth, Date.now());
  if (process.platform === 'darwin' && !fileOk && !process.env.TOKEN_SLAYER_NO_KEYCHAIN) {
    try {
      const stdout = await execFileP('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { timeout: 30000 });
      const raw = JSON.parse(stdout.trim());
      if (raw && raw.claudeAiOauth && raw.claudeAiOauth.accessToken) {
        let account = os.userInfo().username;
        try {
          const attrs = await execFileP('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], { timeout: 8000 });
          const m = attrs.match(/"acct"<blob>="([^"]*)"/);
          if (m) account = m[1];
        } catch {}
        out.push({ oauth: raw.claudeAiOauth, raw, source: 'keychain', account });
      }
    } catch (e) {
      // security 종료 코드: 44 = 항목 없음, 36 · 51 · 128 = 접근 거절/취소, 시간 초과는 신호로 종료됨
      if (e && (e.killed || e.signal)) keychainState.issue = 'timeout';
      else if (e && e.code === 44) keychainState.issue = 'missing';
      else if (e && [36, 51, 128].includes(e.code)) keychainState.issue = 'denied';
      else keychainState.issue = e && e.code === undefined ? null : 'missing';
    }
  }
  return pickOrder(out);
}

// 후보가 둘 이상이면 (낡은 .credentials.json이 키체인의 새 로그인을 가리는 일이 없게) 안 만료된 것, 그다음 만료가 가장 늦은 것 순서로
function pickOrder(list, now = Date.now()) {
  return [...list].sort((a, b) => {
    const ea = isExpiredAt(a.oauth, now), eb = isExpiredAt(b.oauth, now);
    if (ea !== eb) return ea ? 1 : -1;
    return (b.oauth.expiresAt || 0) - (a.oauth.expiresAt || 0);
  });
}
const isExpiredAt = (o, now) => !!(o.expiresAt && now > o.expiresAt - EXPIRY_MARGIN);

async function readCredentials() {
  const all = await readAllCredentials();
  return all[0] || null;
}

async function writeCredentials(creds) {
  const json = JSON.stringify(creds.raw);
  if (creds.source === 'file') {
    const tmp = credFile() + '.tmp-' + process.pid;
    await fs.promises.writeFile(tmp, json, { mode: 0o600 });
    await fs.promises.rename(tmp, credFile());
  } else {
    // Claude Code와 같은 방식으로 키체인 항목을 갱신 (-U: 있으면 덮어쓰기, -X: 16진수 데이터)
    await execFileP('security', ['add-generic-password', '-U', '-a', creds.account, '-s', KEYCHAIN_SERVICE, '-X', Buffer.from(json, 'utf8').toString('hex')], { timeout: 8000 });
  }
}

const isExpired = (o) => !!(o.expiresAt && Date.now() > o.expiresAt - EXPIRY_MARGIN);

function parseWindow(o) {
  if (!o || typeof o.utilization !== 'number') return null;
  const t = o.resets_at ? Date.parse(o.resets_at) : NaN;
  return { usedPercent: o.utilization, resetsAt: Number.isNaN(t) ? null : t };
}

function parseUsage(j) {
  return {
    fiveHour: parseWindow(j.five_hour),
    weekly: parseWindow(j.seven_day),
    weeklyOpus: parseWindow(j.seven_day_opus),
    weeklySonnet: parseWindow(j.seven_day_sonnet),
  };
}

class ClaudeReader {
  // web: claude.ai 로그인 창으로 로그인한 세션 (Electron에서만 주어짐)
  //   { hasSession(): Promise<bool>, get(path): Promise<{ status, json }>, cookie(name): Promise<string|null> }
  constructor(fetchFn, web) {
    this.fetch = fetchFn || globalThis.fetch;
    this.web = web || null;
    this.orgId = null;
    this.creds = null;
    this.needsLogin = false;
    this.deadTokens = new Map(); // 갱신이 거절된 갱신 토큰 → 시각 (같은 토큰으로 서버를 계속 두드리지 않음)
    this.refreshBlockedUntil = 0;
    this.refreshBackoff = 0;
    this.refresh429 = 0;
  }

  // 진단용: 어떤 로그인 정보를 읽을 수 있는지 (토큰 · 계정 값은 빼고 상태만)
  async diagnose() {
    const now = Date.now();
    const all = await readAllCredentials();
    return {
      sources: all.map((c) => ({ source: c.source, expired: isExpiredAt(c.oauth, now), expiresInHours: c.oauth.expiresAt ? Math.round((c.oauth.expiresAt - now) / 360000) / 10 : null, hasRefreshToken: !!c.oauth.refreshToken })),
      keychainIssue: keychainState.issue,
      keychainSkipped: !!process.env.TOKEN_SLAYER_NO_KEYCHAIN,
      deadTokens: this.deadTokens.size,
      webSession: this.web ? await this.web.hasSession().catch(() => null) : null,
    };
  }

  // 만료된 토큰 갱신. 갱신 직전에 저장소를 다시 읽어서, Claude Code가 이미 갱신했으면 그걸 쓴다.
  async refresh() {
    const all = await readAllCredentials();
    if (!all.length) return { error: 'no-credentials' };
    // 로그인 정보가 둘 이상이면 (파일 + 키체인) 하나가 죽었어도 다른 것으로 이어 간다
    let last = null;
    for (const fresh of all) {
      const r = await this.refreshWith(fresh);
      if (r.ok || r.error === 'network') return r;
      last = r;
    }
    return last;
  }

  async refreshWith(fresh) {
    if (!isExpired(fresh.oauth) && fresh.oauth.accessToken !== (this.creds && this.creds.oauth.accessToken)) {
      this.creds = fresh;
      return { ok: true };
    }
    if (!fresh.oauth.refreshToken) return { error: 'login' };
    // 이미 거절된 갱신 토큰이면 서버에 다시 묻지 않고 로그인을 기다린다
    if (this.deadTokens.has(fresh.oauth.refreshToken) && Date.now() - this.deadTokens.get(fresh.oauth.refreshToken) < 30 * 60000) {
      return { error: 'login', detail: '다시 로그인하면 바로 표시돼요' };
    }

    // 갱신 서버가 요청 제한(429)을 걸면 점점 간격을 늘려 재시도 (5분 → 10분 → … 최대 1시간)
    const wait = this.refreshBlockedUntil - Date.now();
    if (wait > 0) return { error: 'network', detail: tr('요청 제한 중 · {n}분 뒤 자동 재시도', { n: Math.ceil(wait / 60000) }) };

    let res = null;
    const tried = [];
    for (const url of TOKEN_URLS) {
      const host = new URL(url).host;
      try {
        res = await this.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: fresh.oauth.refreshToken, client_id: CLIENT_ID }),
        });
      } catch (e) {
        tried.push(`${host}: ${e && (e.cause && e.cause.code || e.message) || e}`);
        res = null;
        continue;
      }
      if (res.ok || res.status === 400 || res.status === 401) break;
      let body = '';
      try { body = (await res.text()).slice(0, 80); } catch {}
      tried.push(`${host}: HTTP ${res.status} ${body}`);
      res = null;
    }
    this.lastRefreshDetail = tried.join(' / ');
    if (!res) {
      if (tried.some((x) => x.includes('HTTP 429'))) {
        // 토큰 서버는 갱신 토큰이 이미 무효일 때도 429를 돌려준다 → 바로 다시 로그인을 안내.
        // (진짜 요청 제한이었을 수도 있으니 30분 뒤에는 같은 토큰으로 한 번 더 시도)
        this.deadTokens.set(fresh.oauth.refreshToken, Date.now());
        return { error: 'login', detail: '저장된 로그인이 더 이상 갱신되지 않아요' };
      }
      return { error: 'network', detail: this.lastRefreshDetail };
    }
    this.refreshBackoff = 0;
    this.refresh429 = 0;
    if (res.status === 400 || res.status === 401) {
      this.deadTokens.set(fresh.oauth.refreshToken, Date.now());
      let body = '';
      try { body = (await res.text()).slice(0, 80); } catch {}
      return { error: 'login', detail: `HTTP ${res.status} ${body}` };
    }

    let t;
    try { t = await res.json(); } catch { return { error: 'network', detail: 'JSON 파싱 실패' }; }
    if (!t.access_token) return { error: 'login', detail: 'no access_token' };

    fresh.raw.claudeAiOauth = {
      ...fresh.oauth,
      accessToken: t.access_token,
      refreshToken: t.refresh_token || fresh.oauth.refreshToken,
      expiresAt: Date.now() + (t.expires_in || 3600) * 1000,
    };
    fresh.oauth = fresh.raw.claudeAiOauth;
    this.creds = fresh;
    try { await writeCredentials(fresh); }
    catch (e) { return { ok: true, warn: '새 토큰을 저장하지 못했어요' }; }
    return { ok: true };
  }

  async fetchUsage() {
    try {
      return await this.fetch(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${this.creds.oauth.accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'Content-Type': 'application/json',
          'User-Agent': 'token-slayer/0.17',
        },
      });
    } catch { return null; }
  }

  // 마지막 사용 시각: Claude Code 기록 + Claude 데스크톱 앱 데이터 폴더
  async lastUsed() {
    const desk = activity.appSupport('Claude');
    return activity.newest([
      path.join(claudeDir(), 'history.jsonl'),
      { dir: path.join(claudeDir(), 'projects') },
      { dir: desk },
      { dir: path.join(desk, 'Local Storage', 'leveldb') },
      { dir: path.join(desk, 'IndexedDB') },
      { dir: path.join(desk, 'Session Storage') },
    ]);
  }

  // 1) Claude Code 로그인이 살아 있으면 그걸로, 2) 아니면 claude.ai 로그인 창 세션으로,
  // 3) 둘 다 없으면 로그인 안내
  // 지금 쓰는 중인지 가늠: 데스크톱 앱이 대화 중에 계속 쓰는 저장소 파일과 Claude Code 기록의 최근 수정 시각
  async activityAt() {
    const desk = activity.appSupport('Claude');
    return activity.newest([
      path.join(claudeDir(), 'history.jsonl'),
      { dir: path.join(desk, 'IndexedDB', 'https_claude.ai_0.indexeddb.leveldb') },
      { dir: path.join(desk, 'Local Storage', 'leveldb') },
      { dir: path.join(desk, 'Session Storage') },
    ]);
  }

  async read() {
    const code = await this.readCode();
    if (code.ok) return { ...code, source: 'claude-code' };
    if (this.web) {
      const w = await this.readWeb();
      if (w.ok || w.error !== 'no-session') return w;
    }
    if (code.error === 'network' || code.error === 'rate-limited' || code.error === 'http' || code.error === 'keychain') return code;
    return { ok: false, error: 'expired', needsLogin: true, message: 'Claude 계정으로 로그인하면 사용량이 보여요' };
  }

  async readWeb() {
    const web = this.web;
    let has = false;
    try { has = await web.hasSession(); } catch {}
    if (!has) return { ok: false, error: 'no-session' };
    const expired = { ok: false, error: 'expired', needsLogin: true, message: 'claude.ai 로그인이 만료됐어요. 다시 로그인해 주세요' };
    try {
      if (!this.orgId) {
        const last = await web.cookie('lastActiveOrg').catch(() => null);
        const r = await web.get('/organizations');
        if (r.status === 401 || r.status === 403) return expired;
        if (r.status !== 200 || !Array.isArray(r.json)) return { ok: false, error: 'http', message: tr('claude.ai 조회 실패 ({n})', { n: r.status }) };
        const orgs = r.json;
        const pick = orgs.find((o) => o.uuid === last)
          || orgs.find((o) => Array.isArray(o.capabilities) && o.capabilities.includes('chat'))
          || orgs[0];
        if (!pick) return { ok: false, error: 'no-data', message: '계정 정보를 찾지 못했어요' };
        this.orgId = pick.uuid;
      }
      const u = await web.get(`/organizations/${this.orgId}/usage`);
      if (u.status === 401 || u.status === 403) { this.orgId = null; return expired; }
      if (u.status === 404) { this.orgId = null; return { ok: false, error: 'http', message: '사용량 정보를 찾지 못했어요' }; }
      if (u.status === 429) return { ok: false, error: 'rate-limited', message: '조회가 너무 잦아요. 잠시 후 다시 시도해요' };
      if (u.status !== 200 || !u.json) return { ok: false, error: 'http', message: tr('claude.ai 조회 실패 ({n})', { n: u.status }) };
      const parsed = parseUsage(u.json);
      if (!parsed.fiveHour && !parsed.weekly) return { ok: false, error: 'no-data', message: '이 계정은 사용량 한도 정보가 없어요' };
      return { ok: true, ...parsed, fetchedAt: Date.now(), source: 'claude.ai' };
    } catch (e) {
      return { ok: false, error: 'network', message: 'claude.ai에 연결하지 못했어요' };
    }
  }

  async readCode() {
    const r = await this.readInner();
    if (r.error === 'expired' || r.error === 'no-credentials') {
      // 다음 조회 때 저장소를 새로 읽도록 (사용자가 다시 로그인했을 수 있음)
      this.creds = null;
      this.refreshBlockedUntil = 0;
      this.refreshBackoff = 0;
      return { ...r, needsLogin: true };
    }
    return r;
  }

  async readInner() {
    if (!this.creds) this.creds = await readCredentials();
    if (!this.creds) {
      if (keychainState.issue === 'denied' || keychainState.issue === 'timeout') {
        // 로그인은 돼 있는데 키체인 접근이 막힌 경우: 로그인 안내 대신 접근 허용을 안내 (다음 조회 때 다시 묻는다)
        return { ok: false, error: 'keychain', message: 'Claude 로그인 정보를 읽지 못했어요. 키체인 접근 요청이 뜨면 "허용"을 눌러 주세요' };
      }
      return fs.existsSync(claudeDir()) || process.platform === 'darwin'
        ? { ok: false, error: 'no-credentials', message: 'Claude Code 로그인이 필요해요' }
        : { ok: false, error: 'not-installed', message: 'Claude Code가 설치되어 있지 않아요' };
    }

    const loginMsg = { ok: false, error: 'expired', message: 'Claude 로그인이 풀렸어요. 다시 로그인해 주세요' };

    if (isExpired(this.creds.oauth)) {
      const r = await this.refresh();
      if (r.error === 'login' || r.error === 'no-credentials') return { ...loginMsg, message: `${tr(loginMsg.message)}${r.detail ? ` (${tr(r.detail)})` : ''}` };
      if (r.error === 'network') return { ok: false, error: 'network', message: tr('로그인 갱신 실패: {why}', { why: r.detail || tr('연결 안 됨') }) };
    }

    let res = await this.fetchUsage();
    if (res && (res.status === 401 || res.status === 403)) {
      // 만료 시간 전인데 거절되면 한 번만 갱신 후 재시도
      const r = await this.refresh();
      if (!r.ok) return r.error === 'network' ? { ok: false, error: 'network', message: tr('로그인 갱신 실패: {why}', { why: r.detail || tr('연결 안 됨') }) } : { ...loginMsg, message: `${tr(loginMsg.message)} (${tr(r.detail || '')})` };
      res = await this.fetchUsage();
      if (res && (res.status === 401 || res.status === 403)) return loginMsg;
    }
    if (!res) return { ok: false, error: 'network', message: '사용량 서버에 연결하지 못했어요' };
    if (res.status === 429) return { ok: false, error: 'rate-limited', message: '조회가 너무 잦아요. 잠시 후 다시 시도해요' };
    if (!res.ok) return { ok: false, error: 'http', message: tr('사용량 조회 실패 ({n})', { n: res.status }) };

    let j;
    try { j = await res.json(); } catch { return { ok: false, error: 'parse', message: '응답을 읽지 못했어요' }; }
    const u = parseUsage(j);
    if (!u.fiveHour && !u.weekly) return { ok: false, error: 'no-data', message: '이 계정은 사용량 한도 정보가 없어요' };
    return { ok: true, ...u, fetchedAt: Date.now() };
  }
}

module.exports = { ClaudeReader, parseUsage, pickOrder };
