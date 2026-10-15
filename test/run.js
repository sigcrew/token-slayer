// node test/run.js — 파서 테스트 (Electron 없이 실행)
const assert = require('assert');
process.env.TOKEN_SLAYER_NO_KEYCHAIN = '1'; // 테스트가 실제 키체인(허용 창)을 건드리지 않게
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseLatestFromText, applyResets, CodexReader } = require('../src/codex');
const { parseUsage, ClaudeReader, pickOrder } = require('../src/claude');

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };

(async () => {
  await t('codex 신형 (resets_at, window_minutes)', () => {
    const text = [
      JSON.stringify({ timestamp: '2026-09-29T05:00:00.000Z', type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: { primary: { used_percent: 10, window_minutes: 300, resets_at: 1790000000 }, secondary: { used_percent: 20, window_minutes: 10080, resets_at: 1790500000 } } } }),
      JSON.stringify({ timestamp: '2026-09-29T05:10:00.000Z', type: 'response_item', payload: { type: 'message' } }),
      JSON.stringify({ timestamp: '2026-09-29T05:20:00.000Z', type: 'event_msg', payload: { type: 'token_count', info: {}, rate_limits: { limit_id: 'codex', primary: { used_percent: 37.5, window_minutes: 300, resets_at: 1790001000 }, secondary: { used_percent: 22, window_minutes: 10080, resets_at: 1790500000 }, plan_type: 'plus' } } }),
      '{broken json',
    ].join('\n');
    const r = parseLatestFromText(text);
    assert.strictEqual(r.fiveHour.usedPercent, 37.5);
    assert.strictEqual(r.fiveHour.resetsAt, 1790001000 * 1000);
    assert.strictEqual(r.weekly.usedPercent, 22);
    assert.strictEqual(r.plan, 'plus');
  });

  await t('codex 구형 (resets_in_seconds, window_minutes 없음)', () => {
    const text = JSON.stringify({ timestamp: '2026-09-29T05:00:00.000Z', type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 50, resets_in_seconds: 600 }, secondary: { used_percent: 5, resets_in_seconds: 86400 } } } });
    const r = parseLatestFromText(text);
    assert.strictEqual(r.fiveHour.usedPercent, 50);
    assert.strictEqual(r.fiveHour.resetsAt, Date.parse('2026-09-29T05:00:00.000Z') + 600000);
    assert.strictEqual(r.weekly.usedPercent, 5);
  });

  await t('codex 순서가 바뀐 창도 window_minutes로 분류', () => {
    const text = JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 70, window_minutes: 10080 }, secondary: { used_percent: 30, window_minutes: 300 } } } });
    const r = parseLatestFromText(text);
    assert.strictEqual(r.fiveHour.usedPercent, 30);
    assert.strictEqual(r.weekly.usedPercent, 70);
  });

  await t('codex rate_limits null이면 건너뜀', () => {
    const text = JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: null } });
    assert.strictEqual(parseLatestFromText(text), null);
  });

  await t('리셋 시간이 지나면 0%', () => {
    const w = applyResets({ usedPercent: 80, resetsAt: 1000 }, 2000);
    assert.strictEqual(w.usedPercent, 0);
    assert.strictEqual(applyResets({ usedPercent: 80, resetsAt: 3000 }, 2000).usedPercent, 80);
  });

  await t('CodexReader가 가장 최근 세션 파일에서 읽음', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
    process.env.CODEX_HOME = home;
    const mk = (d, name, used, mtime) => {
      const dir = path.join(home, 'sessions', ...d.split('/'));
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, name);
      fs.writeFileSync(f, JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: used, window_minutes: 300, resets_at: 4102444800 } } } }) + '\n');
      fs.utimesSync(f, mtime, mtime);
    };
    mk('2026/09/28', 'rollout-a.jsonl', 11, 1000);
    mk('2026/09/29', 'rollout-b.jsonl', 42, 2000);
    mk('2026/09/29', 'rollout-c.jsonl', 99, 1500);
    fs.mkdirSync(path.join(home, 'sessions/2026/09/29'), { recursive: true });
    fs.writeFileSync(path.join(home, 'sessions/2026/09/29/rollout-d.jsonl'), '{"type":"session_meta"}\n');
    fs.utimesSync(path.join(home, 'sessions/2026/09/29/rollout-d.jsonl'), 3000, 3000);
    const r = await new CodexReader().read();
    assert.ok(r.ok);
    assert.strictEqual(r.fiveHour.usedPercent, 42);
    delete process.env.CODEX_HOME;
  });

  await t('claude 응답 파싱', () => {
    const u = parseUsage({ five_hour: { utilization: 23, resets_at: '2026-09-29T08:00:00.000000+00:00' }, seven_day: { utilization: 61.5, resets_at: '2026-10-02T00:00:00+00:00' }, seven_day_opus: null });
    assert.strictEqual(u.fiveHour.usedPercent, 23);
    assert.strictEqual(u.fiveHour.resetsAt, Date.parse('2026-09-29T08:00:00Z'));
    assert.strictEqual(u.weekly.usedPercent, 61.5);
    assert.strictEqual(u.weeklyOpus, null);
  });

  await t('ClaudeReader: 파일 토큰으로 조회 + 401 처리', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() + 3600e3 } }));
    let seen;
    const okFetch = async (url, opts) => { seen = opts.headers; return { ok: true, status: 200, json: async () => ({ five_hour: { utilization: 10, resets_at: null }, seven_day: { utilization: 5, resets_at: null } }) }; };
    const r = await new ClaudeReader(okFetch).read();
    assert.ok(r.ok);
    assert.strictEqual(seen.Authorization, 'Bearer tok');
    assert.strictEqual(r.fiveHour.usedPercent, 10);
    const r2 = await new ClaudeReader(async () => ({ ok: false, status: 401 })).read();
    assert.strictEqual(r2.error, 'expired');
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  await t('압축된 .jsonl.zst 세션도 읽음', async () => {
    const zlib = require('zlib');
    if (typeof zlib.zstdCompressSync !== 'function') { console.log('  (이 Node에는 zstd 없음, 건너뜀)'); return; }
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
    process.env.CODEX_HOME = home;
    const dir = path.join(home, 'sessions/2026/09/20');
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 33, window_minutes: 300, resets_at: 4102444800 } } } });
    fs.writeFileSync(path.join(dir, 'rollout-x.jsonl.zst'), zlib.zstdCompressSync(Buffer.from(line + '\n')));
    const r = await new CodexReader().read();
    assert.strictEqual(r.fiveHour.usedPercent, 33);
    delete process.env.CODEX_HOME;
  });

  await t('ClaudeReader: 만료 토큰을 갱신하고 파일에 다시 저장', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    const f = path.join(dir, '.credentials.json');
    fs.writeFileSync(f, JSON.stringify({ claudeAiOauth: { accessToken: 'old', refreshToken: 'r1', expiresAt: Date.now() - 1000, scopes: ['x'] }, other: 1 }));
    const calls = [];
    const fetchFn = async (url, opts) => {
      calls.push(url);
      if (url.includes('/oauth/token')) {
        const b = JSON.parse(opts.body);
        assert.strictEqual(b.grant_type, 'refresh_token');
        assert.strictEqual(b.refresh_token, 'r1');
        return { ok: true, status: 200, json: async () => ({ access_token: 'new', refresh_token: 'r2', expires_in: 28800 }) };
      }
      assert.strictEqual(opts.headers.Authorization, 'Bearer new');
      return { ok: true, status: 200, json: async () => ({ five_hour: { utilization: 40, resets_at: null }, seven_day: null }) };
    };
    const r = await new ClaudeReader(fetchFn).read();
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(r.fiveHour.usedPercent, 40);
    const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.strictEqual(saved.claudeAiOauth.accessToken, 'new');
    assert.strictEqual(saved.claudeAiOauth.refreshToken, 'r2');
    assert.deepStrictEqual(saved.claudeAiOauth.scopes, ['x']);
    assert.strictEqual(saved.other, 1);
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  await t('ClaudeReader: 갱신 거절(400)이면 재로그인 안내', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'old', refreshToken: 'bad', expiresAt: Date.now() - 1000 } }));
    const r = await new ClaudeReader(async () => ({ ok: false, status: 400 })).read();
    assert.strictEqual(r.error, 'expired');
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  await t('Claude 로그인 정보가 여럿이면 안 만료된 것, 그다음 만료가 늦은 것을 먼저 쓴다', () => {
    const now = Date.now();
    const mk = (source, expiresAt) => ({ source, oauth: { accessToken: source, expiresAt } });
    // 낡은 파일이 키체인의 새 로그인을 가리지 않는다
    assert.deepStrictEqual(pickOrder([mk('file', now - 3600e3), mk('keychain', now + 3600e3)], now).map((c) => c.source), ['keychain', 'file']);
    assert.deepStrictEqual(pickOrder([mk('keychain', now + 1000e3), mk('file', now + 5000e3)], now).map((c) => c.source), ['file', 'keychain']);
    assert.deepStrictEqual(pickOrder([mk('file', now - 9000e3), mk('keychain', now - 1000e3)], now).map((c) => c.source), ['keychain', 'file']);
  });

  await t('ClaudeReader: 갱신 429면 바로 재로그인 안내, 같은 토큰으로 재요청 안 함', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'old', refreshToken: 'r', expiresAt: Date.now() - 1000 } }));
    let n = 0;
    const reader = new ClaudeReader(async () => { n++; return { ok: false, status: 429, text: async () => 'rate' }; });
    const r1 = await reader.read();
    assert.ok(r1.needsLogin, JSON.stringify(r1));
    const before = n;
    const r2 = await reader.read();
    assert.ok(r2.needsLogin);
    assert.strictEqual(n, before);
    // 다시 로그인해서 새 토큰이 저장되면 바로 사용
    fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'fresh', refreshToken: 'r2', expiresAt: Date.now() + 3600e3 } }));
    reader.fetch = async (url, o) => ({ ok: true, status: 200, json: async () => ({ five_hour: { utilization: 7, resets_at: null } }) });
    const r3 = await reader.read();
    assert.ok(r3.ok, JSON.stringify(r3));
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  await t('Codex 로그인 여부: auth.json 없으면 needsLogin, 데이터는 유지', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-'));
    process.env.CODEX_HOME = home;
    const dir = path.join(home, 'sessions/2026/09/29');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'rollout-a.jsonl'), JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: { secondary: { used_percent: 49, window_minutes: 10080, resets_at: 4102444800 } } } }) + '\n');
    const r1 = await new CodexReader().read();
    assert.ok(r1.ok && r1.needsLogin);
    assert.strictEqual(r1.weekly.usedPercent, 49);
    fs.writeFileSync(path.join(home, 'auth.json'), '{}');
    const r2 = await new CodexReader().read();
    assert.ok(r2.ok && !r2.needsLogin);
    fs.unlinkSync(path.join(home, 'auth.json'));
    fs.writeFileSync(path.join(home, 'config.toml'), 'cli_auth_credentials_store = "ephemeral"\n');
    const r3 = await new CodexReader().read();
    assert.ok(!r3.needsLogin);
    delete process.env.CODEX_HOME;
  });

  const cursor = require('../src/cursor');
  const mkJwt = (claims) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig_abc'].join('.');

  await t('Cursor 사용량 파싱 (Pro: totalPercentUsed / auto / api)', () => {
    const u = cursor.parseUsage({ billingCycleEnd: '2026-10-15T00:00:00.000Z', membershipType: 'pro', individualUsage: { plan: { enabled: true, used: 800, limit: 2000, autoPercentUsed: 12, apiPercentUsed: 40, totalPercentUsed: 33 } } });
    assert.strictEqual(u.windows[0].usedPercent, 33);
    assert.strictEqual(u.windows[0].resetsAt, Date.parse('2026-10-15T00:00:00Z'));
    assert.deepStrictEqual(u.windows.map((w) => w.key), ['monthly', 'auto', 'api']);
  });

  await t('Cursor 파싱: total 없으면 auto/api 중 큰 값, 그다음 used/limit, 팀 on-demand', () => {
    assert.strictEqual(cursor.parseUsage({ individualUsage: { plan: { autoPercentUsed: 10, apiPercentUsed: 25 } } }).windows[0].usedPercent, 25);
    assert.strictEqual(cursor.parseUsage({ individualUsage: { plan: { used: 50, limit: 200 } } }).windows[0].usedPercent, 25);
    assert.strictEqual(cursor.parseUsage({ teamUsage: { onDemand: { enabled: true, used: 1, limit: 4 } }, individualUsage: { overall: { enabled: false, used: 0, limit: null } } }).windows[0].usedPercent, 25);
    assert.strictEqual(cursor.parseUsage({ isUnlimited: true }).windows[0].usedPercent, 0);
    assert.strictEqual(cursor.parseUsage({}), null);
  });

  await t('Cursor 세션 쿠키: sub에서 userId 추출, 만료 감지', () => {
    const now = Date.now();
    const tok = mkJwt({ sub: 'auth0|user_01ABC', exp: Math.floor(now / 1000) + 3600 });
    assert.strictEqual(cursor.sessionCookie(tok, now).cookie, `WorkosCursorSessionToken=user_01ABC%3A%3A${tok}`);
    assert.strictEqual(cursor.sessionCookie(mkJwt({ sub: 'auth0|u', exp: Math.floor(now / 1000) - 10 }), now).error, 'expired');
    assert.strictEqual(cursor.sessionCookie('nope', now).error, 'invalid');
  });

  await t('Cursor: 토큰이 만료돼도 "로그인하세요"가 아니라 앱을 열면 갱신된다고 안내', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cu-')), 'state.vscdb');
    const tok = mkJwt({ sub: 'auth0|u1', exp: Math.floor(Date.now() / 1000) - 60 });
    fs.writeFileSync(file, Buffer.from(`xxcursorAuth/accessToken${tok}yy`));
    process.env.CURSOR_STATE_DB = file;
    try {
      const r = await new cursor.CursorReader(async () => { throw new Error('호출되면 안 됨'); }).read();
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.error, 'expired');
      assert.ok(!r.needsLogin, '만료는 로그인 풀림이 아님');
      assert.match(r.message, /앱을 열면/);
    } finally { delete process.env.CURSOR_STATE_DB; }
  });

  await t('Cursor: 서버가 401을 돌려줄 때 — 토큰이 멀쩡하면 "거절당함"(마지막 값 유지), 곧 만료면 갱신 안내', async () => {
    const mkDb = (expSec) => { const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cu-')), 'state.vscdb'); fs.writeFileSync(file, Buffer.from(`xxcursorAuth/accessToken${mkJwt({ sub: 'auth0|u1', exp: expSec })}yy`)); return file; };
    try {
      // 토큰이 60일 남았는데 서버가 거절: "인증이 잠시 만료"라고 거짓말하지 않는다
      process.env.CURSOR_STATE_DB = mkDb(Math.floor(Date.now() / 1000) + 60 * 86400);
      let r = await new cursor.CursorReader(async () => ({ ok: false, status: 401 })).read();
      assert.strictEqual(r.error, 'rejected'); assert.ok(!r.needsLogin); assert.match(r.message, /거절/); assert.ok(r.message.includes('401'));
      r = await new cursor.CursorReader(async () => ({ ok: false, status: 403 })).read();
      assert.strictEqual(r.error, 'rejected');
      // 곧 만료(5분 남음)면 Cursor 앱이 갱신해 준다는 안내
      process.env.CURSOR_STATE_DB = mkDb(Math.floor(Date.now() / 1000) + 300);
      r = await new cursor.CursorReader(async () => ({ ok: false, status: 401 })).read();
      assert.strictEqual(r.error, 'expired'); assert.ok(!r.needsLogin); assert.match(r.message, /앱을 열면/);
    } finally { delete process.env.CURSOR_STATE_DB; }
  });

  await t('조회 요청은 앱 공용 쿠키 보관함을 쓰지 않는다 (credentials: omit) — 헤더 · 다른 옵션은 그대로', async () => {
    const { omitCookies } = require('../src/nocookie');
    const seen = [];
    const f = omitCookies(async (url, opts) => { seen.push({ url, opts }); return { ok: true }; });
    await f('https://example.test/a', { headers: { Cookie: 'x=1', Authorization: 'Bearer t' }, method: 'GET' });
    await f('https://example.test/b');
    assert.strictEqual(seen[0].opts.credentials, 'omit');
    assert.deepStrictEqual(seen[0].opts.headers, { Cookie: 'x=1', Authorization: 'Bearer t' }, '직접 지정한 헤더(Cookie 포함)는 그대로');
    assert.strictEqual(seen[0].opts.method, 'GET');
    assert.strictEqual(seen[1].opts.credentials, 'omit', 'opts가 없어도 적용');
    // 거절당함은 일시적 오류처럼: 이전 값이 있으면 마지막 값을 유지한다
    const { UsageService } = require('../src/usage');
    const svc = new UsageService(async () => ({ ok: true }));
    const prov = svc.provider('cursor');
    let calls = 0;
    prov.reader = { read: async () => (calls++ === 0 ? { ok: true, windows: [{ key: 'monthly', label: '월간', usedPercent: 40, resetsAt: Date.now() + 86400000 }] } : { ok: false, error: 'rejected', message: 'x' }), lastUsed: async () => Date.now() };
    await svc.poll('cursor'); await svc.poll('cursor');
    assert.strictEqual(svc.state.cursor.ok, true); assert.strictEqual(svc.state.cursor.stale, true); assert.strictEqual(svc.state.cursor.windows[0].usedPercent, 40);
    clearTimeout(prov.timer);
  });

  await t('Cursor 토큰 파일 스캔: 가장 늦게 만료되는 토큰 선택', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-'));
    const f = path.join(dir, 'state.vscdb');
    const old = mkJwt({ sub: 'a|u1', exp: 1000 }), fresh = mkJwt({ sub: 'a|u1', exp: 4102444800 });
    fs.writeFileSync(f, Buffer.concat([Buffer.from('SQLite format 3\0 junk cursorAuth/accessToken' + old + ' more'), Buffer.from([0, 1, 2]), Buffer.from('cursorAuth/accessToken\x05' + fresh)]));
    assert.strictEqual(cursor.viaScan(f), fresh);
  });

  await t('CursorReader: DB 없으면 not-installed, 토큰으로 조회 성공', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-'));
    process.env.CURSOR_STATE_DB = path.join(dir, 'state.vscdb');
    const r0 = await new cursor.CursorReader(async () => { throw new Error('x'); }).read();
    assert.strictEqual(r0.error, 'not-installed');
    const tok = mkJwt({ sub: 'auth0|user_9', exp: 4102444800 });
    fs.writeFileSync(process.env.CURSOR_STATE_DB, 'cursorAuth/accessToken' + tok);
    let cookie;
    const r = await new cursor.CursorReader(async (url, o) => { cookie = o.headers.Cookie; return { ok: true, status: 200, json: async () => ({ individualUsage: { plan: { totalPercentUsed: 61 } } }) }; }).read();
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(r.windows[0].usedPercent, 61);
    assert.ok(cookie.startsWith('WorkosCursorSessionToken=user_9%3A%3A'));
    delete process.env.CURSOR_STATE_DB;
  });

  await t('공통 형태로 변환 (fiveHour/weekly → windows)', () => {
    const { normalize } = require('../src/usage');
    const r = normalize({ ok: true, fiveHour: { usedPercent: 10, resetsAt: 1 }, weekly: { usedPercent: 20, resetsAt: 2 }, weeklyOpus: null });
    assert.deepStrictEqual(r.windows.map((w) => [w.key, w.label, w.usedPercent]), [['fiveHour', '5시간', 10], ['weekly', '주간', 20]]);
  });

  await t('최근 30일 사용 여부 판단', async () => {
    const { UsageService } = require('../src/usage');
    const svc = new UsageService(async () => { throw new Error('no net'); });
    svc.stop();
    const day = 86400e3;
    const fake = (win, last) => ({ id: 'x', every: 1e9, timer: null, reader: { read: async () => ({ ok: true, windows: [{ key: 'm', label: 'm', usedPercent: win, resetsAt: null }] }), lastUsed: async () => last } });
    const run = async (win, last) => { svc.providers = [fake(win, last)]; svc.state = { x: { ok: false } }; await svc.poll('x'); clearTimeout(svc.providers[0].timer); return svc.state.x; };
    assert.strictEqual((await run(0, Date.now() - 40 * day)).active, false);
    assert.strictEqual((await run(0, Date.now() - 3 * day)).active, true);
    assert.strictEqual((await run(12, null)).active, true);
    assert.strictEqual((await run(0, null)).active, false);
  });

  await t('Codex 마지막 사용 시각 = 최신 세션 파일', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-'));
    process.env.CODEX_HOME = home;
    const d0 = new Date(); // 최근 며칠만 훑으므로 오늘 날짜 폴더에 만든다
    const dir = path.join(home, 'sessions', String(d0.getFullYear()), String(d0.getMonth() + 1).padStart(2, '0'), String(d0.getDate()).padStart(2, '0'));
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'rollout-a.jsonl');
    fs.writeFileSync(f, '{}\n');
    fs.utimesSync(f, 1700000000, 1700000000);
    const t1 = await new CodexReader().lastUsed();
    assert.strictEqual(Math.round(t1 / 1000), 1700000000);
    delete process.env.CODEX_HOME;
  });

  await t('Claude: Claude Code 로그인이 없으면 claude.ai 세션으로 조회', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-'));
    process.env.CLAUDE_CONFIG_DIR = dir; // 자격 증명 파일 없음
    const calls = [];
    const web = {
      hasSession: async () => true,
      cookie: async (n) => (n === 'lastActiveOrg' ? 'org-2' : null),
      get: async (p) => {
        calls.push(p);
        if (p === '/organizations') return { status: 200, json: [{ uuid: 'org-1', capabilities: ['api'] }, { uuid: 'org-2', capabilities: ['chat', 'claude_pro'] }] };
        return { status: 200, json: { five_hour: { utilization: 18, resets_at: '2026-09-29T12:00:00Z' }, seven_day: { utilization: 44, resets_at: null } } };
      },
    };
    const reader = new ClaudeReader(async () => { throw new Error('no'); }, web);
    if (process.platform === 'darwin') return; // 실제 키체인이 있을 수 있어 건너뜀
    const r = await reader.read();
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(r.source, 'claude.ai');
    assert.strictEqual(r.fiveHour.usedPercent, 18);
    assert.strictEqual(r.weekly.usedPercent, 44);
    assert.deepStrictEqual(calls, ['/organizations', '/organizations/org-2/usage']);
    await reader.read();
    assert.strictEqual(calls.length, 3, '조직 정보는 캐시');
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  await t('Claude: 로그인 둘 다 없으면 로그인 안내, 웹 세션 만료면 만료 안내', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    if (process.platform === 'darwin') return;
    const none = await new ClaudeReader(null, { hasSession: async () => false, cookie: async () => null, get: async () => ({}) }).read();
    assert.ok(none.needsLogin);
    const exp = await new ClaudeReader(null, { hasSession: async () => true, cookie: async () => null, get: async () => ({ status: 403, json: null }) }).read();
    assert.ok(exp.needsLogin);
    assert.ok(exp.message.includes('만료'));
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  await t('시리즈 적용: 열려 있는 팩만 고르고, 없으면 무료 맛보기로, 용사는 서비스 순서대로', () => {
    const { SERIES, membersOf, planSeries } = require('../src/series');
    const { loadPacks } = require('../src/packs');
    const packs = loadPacks(fs.mkdtempSync(path.join(os.tmpdir(), 'sr-')));
    const byKey = new Map(packs.map((p) => [`${p.type}:${p.id}`, p]));
    // 시리즈 표와 팩 파일이 서로 맞아야 함: 표의 팩은 실제로 있고, 팩의 series 표시는 표와 같은 시리즈
    for (const sr of SERIES) for (const [type, id] of membersOf(sr)) {
      const p = byKey.get(`${type}:${id}`);
      assert.ok(p, `${sr.name}: ${type}:${id} 팩이 없음`);
      if (p.series) assert.strictEqual(p.series, sr.name, `${id}의 series 표시가 표와 다름`);
    }
    for (const p of packs.filter((x) => x.series)) assert.ok(SERIES.some((sr) => sr.name === p.series && membersOf(sr).some(([t, id]) => t === p.type && id === p.id)), `${p.id}가 시리즈 표에 없음`);
    const japan = SERIES.find((s) => s.id === 'japan');
    const svc = ['claude', 'codex', 'cursor'];
    const none = () => false;
    assert.strictEqual(planSeries(japan, none, {}, svc).changes, 0, '열린 게 없으면 바꿀 것도 없음');
    const freeOnly = (type, id) => byKey.get(`${type}:${id}`).tier !== 'premium';
    const p1 = planSeries(japan, freeOnly, {}, svc);
    assert.deepStrictEqual(p1.patch, { backdropTheme: 'cherry' }, '프리미엄이 잠겨 있으면 무료 벚꽃으로 맛보기');
    assert.strictEqual(p1.open, 1); assert.strictEqual(p1.total, 6);
    const all = () => true;
    const p2 = planSeries(japan, all, { claude: 'knight', codex: 'wizard', cursor: 'archer' }, svc);
    assert.deepStrictEqual(p2.patch, { backdropTheme: 'shrine', enemyTheme: 'yokai', restTheme: 'lantern', skins: { claude: 'samurai', codex: 'ninja', cursor: 'archer' } }, '시리즈 용사는 서비스 순서대로, 남는 서비스는 그대로');
    assert.deepStrictEqual(p2.locked, []);
    const hell = SERIES.find((s) => s.id === 'hell');
    assert.strictEqual(planSeries(hell, all, {}, svc).patch.enemyTheme, 'legacy', '같은 종류 후보는 앞쪽부터');
  });

  await t('시리즈 완주 업적: 시리즈의 팩을 전부 써 봐야 받고, 네 시리즈를 다 하면 컬렉터', () => {
    const pg = require('../src/progress');
    const ach = require('../src/achievements');
    const { SERIES, membersOf } = require('../src/series');
    const store = pg.createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-')));
    const japan = SERIES.find((s) => s.id === 'japan');
    const mem = membersOf(japan);
    for (const [type, id] of mem.slice(0, -1)) store.addToSet('packsTried', `${type}:${id}`);
    assert.ok(!ach.evaluate(store, {}).some((a) => a.id === 'series_japan'), '하나 남았으면 아직');
    const [lt, lid] = mem[mem.length - 1]; store.addToSet('packsTried', `${lt}:${lid}`);
    let got = ach.evaluate(store, {}).map((a) => a.id);
    assert.ok(got.includes('series_japan') && !got.includes('seriesAll') && !got.includes('series_cyber'));
    for (const sr of SERIES) for (const [type, id] of membersOf(sr)) store.addToSet('packsTried', `${type}:${id}`);
    got = ach.evaluate(store, {}).map((a) => a.id);
    assert.ok(got.includes('series_cyber') && got.includes('series_hell') && got.includes('series_dungeon') && got.includes('seriesAll'));
  });

  await t('프리미엄 팩 해금 레벨 정책 (한도를 매주 다 써서 던전 약 1주 ~ 닌자 약 4~5개월, 25종)', () => {
    const { loadPacks } = require('../src/packs');
    const prem = Object.fromEntries(loadPacks(fs.mkdtempSync(path.join(os.tmpdir(), 'ul-'))).filter((p) => p.source === 'builtin' && p.tier === 'premium').map((p) => [p.id, p.unlockLevel]));
    assert.deepStrictEqual(prem, {
      dungeon: 10, graveyard: 11, shrine: 12, autumntemple: 13, monsters: 14, ghosts: 15, yokai: 16, gwisin: 17, lava: 18, jacklantern: 19, lantern: 20, jeongja: 21, torchcamp: 22, pumpkins: 23, cyber: 24, gyeongbok: 25, hotspring: 26, dokkaebi: 27, paladin: 28, musa: 29,
      legacy: 30, witch: 31, serverroom: 32, vampire: 33, samurai: 34, attacks: 35, demon: 36, nightdesk: 37, meeting: 38, hacker: 39, ninja: 40,
    });
  });

  await t('고해상도 용사: 모든 보통 용사에 24칸 hd 그림이 있고, 형식 검증이 맞다', () => {
    const { loadPacks, validate } = require('../src/packs');
    const heroes = loadPacks(fs.mkdtempSync(path.join(os.tmpdir(), 'hd-'))).filter((p) => p.type === 'hero' && p.source === 'builtin');
    for (const p of heroes) {
      assert.ok(p.hd && p.hd.grid.length === 24 && p.hd.grid.every((r) => r.length === 24), `${p.id}: hd 그림`);
      for (const m of ['fight', 'rest', 'hit', 'happy', 'tired', 'blink']) assert.ok(Array.isArray(p.hd.faces[m]) && p.hd.faces[m].length > 0, `${p.id}: ${m} 표정`);
      // 쓰인 글자는 모두 색이 정해져 있어야 한다 (c · C 계열은 서비스 색이라 코드가 채움)
      const pal = { o: 1, w: 1, s: 1, c: 1, C: 1, ...(p.palette || {}), ...(p.hd.palette || {}) };
      const dynamic = new Set(['c', 'C', '\u0109', '\u010B', '\u0108', '\u010A']);
      for (const ch of new Set(p.hd.grid.join(''))) if (ch !== '.') assert.ok(pal[ch] || dynamic.has(ch), `${p.id}: 색 없는 글자 ${ch}`);
      for (const m of Object.keys(p.hd.faces)) for (const [x, y, c] of p.hd.faces[m]) assert.ok(x >= 0 && x < 24 && y >= 0 && y < 24 && (pal[c] || /^#/.test(c)), `${p.id}: ${m} 표정 점`);
    }
    assert.ok(!validate({ id: 'z', type: 'hero', name: 'z', grid: Array(12).fill('.'.repeat(12)), hd: { grid: ['.'], faces: {} } }), '잘못된 hd는 거절');
  });

  await t('추억 팩(memory): 사진·문구·편지 형식 검증', () => {
    const { validate } = require('../src/packs');
    const base = { id: 'm', type: 'hero', name: 'm', grid: Array(12).fill('.'.repeat(12)) };
    const photo = 'data:image/jpeg;base64,/9j/4AAQ';
    assert.ok(validate({ ...base, memory: { photo, clicks: 5, captions: ['안녕'], welcome: { title: '제목', body: '본문', button: '고마워요' } } }));
    assert.ok(validate({ ...base, memory: {} }), '비어 있어도 됨');
    assert.ok(!validate({ ...base, memory: { photo: 'https://x.com/a.jpg' } }), '외부 주소 사진 금지(data URI만)');
    assert.ok(!validate({ ...base, memory: { clicks: 2 } }), '너무 적은 클릭');
    assert.ok(validate({ ...base, memory: { notify: { levelup: ['a'], warn: ['b'], burning: ['c'] } } }), '알림 한마디');
    assert.ok(!validate({ ...base, memory: { notify: { weird: ['a'] } } }), '알 수 없는 알림 종류');
    assert.ok(!validate({ ...base, memory: { notify: { levelup: Array(7).fill('a') } } }), '알림 한마디는 종류당 6개까지');
    assert.ok(!validate({ ...base, memory: { captions: Array(13).fill('a') } }), '문구 12개까지');
    assert.ok(!validate({ ...base, memory: { welcome: { title: '', body: 'x' } } }), '편지 제목 필요');
    assert.ok(!validate({ id: 'e', type: 'enemies', name: 'e', texts: ['A'], memory: {} }), '용사 팩에만 쓸 수 있음');
  });

  await t('꾸미기 팩: 기본 팩 51개 로드, 잘못된 사용자 팩은 무시', () => {
    const { loadPacks, validate } = require('../src/packs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-'));
    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ id: 'x', type: 'hero', name: 'x', grid: ['...'] }));
    fs.writeFileSync(path.join(dir, 'css.json'), JSON.stringify({ id: 'css', type: 'enemies', name: 'CSS', texts: ['!IMPORTANT'], tier: 'premium' }));
    const packs = loadPacks(dir);
    assert.ok(packs.find((p) => p.id === 'knight' && p.type === 'hero'));
    assert.ok(!packs.find((p) => p.id === 'x'));
    const css = packs.find((p) => p.id === 'css');
    assert.strictEqual(css.tier, 'free', '내 팩은 항상 사용 가능');
    for (const p of packs.filter((p) => p.source === 'builtin')) assert.ok(validate(p), p.id);
    assert.strictEqual(packs.filter((p) => p.source === 'builtin').length, 51);
    // 적 글자는 도트 글꼴에 있는 문자만 (없는 문자는 빈칸으로 보임)
    const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'scene.js'), 'utf8');
    const glyphs = new Set([' ', ...[...src.matchAll(/^\s*'(.)'\s*:/gm)].map((m) => m[1]), ...[...src.matchAll(/^\s*"(.)"\s*:/gm)].map((m) => m[1])]);
    for (const p of packs.filter((p) => p.source === 'builtin' && p.type === 'enemies')) {
      for (const txt of [...p.texts, ...(p.fatal || [])]) for (const ch of txt) assert.ok(glyphs.has(ch), `${p.id}: '${txt}'의 '${ch}'`);
    }
  });

  await t('레벨·경험치·BURNING TIME', () => {
    const pg = require('../src/progress');
    assert.strictEqual(pg.levelFor(0), 1);
    assert.strictEqual(pg.levelFor(999), 1);
    assert.strictEqual(pg.levelFor(1000), 2);
    assert.strictEqual(pg.levelFor(45000), 10);
    const now = Date.now();
    // 5시간 창은 리셋이 잦아서 버닝 없음 (서비스끼리 공평하게)
    assert.strictEqual(pg.burning([{ key: 'fiveHour', label: '5시간', usedPercent: 65, resetsAt: now + 40 * 60e3 }], now), null);
    // 주간: 리셋 10시간 전, 35% 남음 → 버닝 (5시간 창이 같이 있어도 주간 기준)
    const b = pg.burning([{ key: 'fiveHour', usedPercent: 10, resetsAt: now + 30 * 60e3 }, { key: 'weekly', label: '주간', usedPercent: 65, resetsAt: now + 10 * 3600e3 }], now);
    assert.ok(b && b.key === 'weekly' && b.remaining === 35);
    // 리셋 20시간 전이면 아직 아님, 10%만 남아도 아님
    assert.strictEqual(pg.burning([{ key: 'weekly', usedPercent: 65, resetsAt: now + 20 * 3600e3 }], now), null);
    assert.strictEqual(pg.burning([{ key: 'weekly', usedPercent: 90, resetsAt: now + 3 * 3600e3 }], now), null);
    // 월간: 2일 남고 25% 남음 → 버닝
    assert.ok(pg.burning([{ key: 'monthly', usedPercent: 75, resetsAt: now + 2 * 86400e3 }], now));
    // 사용량 증가분
    const prev = { ok: true, windows: [{ key: 'a', usedPercent: 10 }, { key: 'b', usedPercent: 50 }] };
    const cur = { ok: true, windows: [{ key: 'a', usedPercent: 13 }, { key: 'b', usedPercent: 51 }] };
    assert.strictEqual(pg.usageGain(prev, cur), 3);
    assert.strictEqual(pg.usageGain(cur, prev), 0, '리셋(감소)은 경험치 없음');
  });

  await t('사용량이 늘면 경험치 적립, BURNING TIME이면 2배', async () => {
    const { UsageService } = require('../src/usage');
    const pg = require('../src/progress');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-'));
    const store = pg.createStore(dir);
    const svc = new UsageService(async () => { throw new Error('x'); }, { progress: store });
    svc.stop();
    let used = 10, reset = Date.now() + 3 * 86400e3;
    svc.providers = [{ id: 'x', name: 'X', every: 1e9, timer: null, reader: { read: async () => ({ ok: true, windows: [{ key: 'weekly', label: '주간', usedPercent: used, resetsAt: reset }] }) } }];
    svc.state = { x: { ok: false } };
    const run = async () => { await svc.poll('x'); clearTimeout(svc.providers[0].timer); };
    await run();
    used = 15; await run();
    assert.strictEqual(store.get('x').xp, 2000); // 주간 1% = 400
    reset = Date.now() + 5 * 3600e3; used = 16; await run(); // 버닝 중 1% → 800
    assert.strictEqual(store.get('x').xp, 2800);
    assert.ok(svc.state.x.burning);
    assert.strictEqual(svc.state.x.level, 2);
  });

  await t('업적: 기록으로 달성, 한 번만 알림', () => {
    const pg = require('../src/progress');
    const ach = require('../src/achievements');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-'));
    const store = pg.createStore(dir);
    assert.deepStrictEqual(ach.evaluate(store, {}).map((a) => a.id), []);
    store.addXp('claude', 12000); // Lv5
    store.addUsage('claude', 120);
    const got = ach.evaluate(store, { fightingNow: 3 }).map((a) => a.id).sort();
    assert.deepStrictEqual(got.filter((x) => x !== 'earlybird' && x !== 'night'), ['century', 'first', 'lv5', 'party']);
    assert.deepStrictEqual(ach.evaluate(store, { fightingNow: 3 }), [], '이미 받은 업적은 다시 안 줌');
    store.count('gameOvers'); store.count('revives');
    for (let i = 0; i < 50; i++) store.count('pets');
    assert.deepStrictEqual(ach.evaluate(store, {}).map((a) => a.id).sort(), ['gameover', 'petter', 'phoenix']);
    // 새 업적들
    store.addXp('codex', 12000); store.addXp('cursor', 12000);
    store.addUsage('codex', 5); store.addUsage('cursor', 5);
    store.flag('angry'); store.flag('boo'); store.count('clutches'); store.count('cards');
    ['knight', 'wizard', 'archer'].forEach((v) => store.addToSet('skinsTried', v));
    const more = ach.evaluate(store, { deadNow: 3, userPacks: 1 }).map((a) => a.id).sort();
    for (const id of ['allLv5', 'angry', 'boo', 'clutch', 'fashion', 'maker', 'reporter', 'trinity', 'wipeout']) assert.ok(more.includes(id), id);
    assert.strictEqual(ach.LIST.length, 66);
    assert.strictEqual(new Set(ach.LIST.map((a) => a.id)).size, 66, '업적 id 중복 없음');
  });

  await t('업적 3차: 명절·정확히 100·공평·숨은 업적 등', () => {
    const pg = require('../src/progress');
    const ach = require('../src/achievements');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-'));
    const store = pg.createStore(dir);
    const yest = Date.now() - 86400e3;
    // 어제: 세 에이전트 30/32/38 → 합계 100, 차이 8 → 정확히 100 + 공평한 리더
    store.addUsage('claude', 30, { at: yest }); store.addUsage('codex', 32, { at: yest }); store.addUsage('cursor', 38, { at: yest });
    store.addUsage('claude', 1, { at: new Date('2026-09-25T15:00:00').getTime() }); // 추석
    store.addUsage('claude', 1, { at: new Date('2026-12-25T15:00:00').getTime() }); // 크리스마스
    store.addUsage('claude', 1, { at: new Date('2026-10-02T23:00:00').getTime() }); // 금요일 밤
    store.addXp('claude', 300000); // Lv25
    store.flag('dragonSlain'); store.flag('menuSpam'); store.flag('speedrun'); store.flag('revive3'); store.flag('iceHero'); store.flag('burnStreak5');
    for (let i = 0; i < 100; i++) store.count('panelOpens');
    const got = ach.evaluate(store, {}).map((a) => a.id);
    for (const id of ['exact100', 'fair', 'koreanHoliday', 'christmas', 'fridayNight', 'claudeLv10', 'dragon', 'dontLeave', 'detective', 'speedrun', 'revive3', 'iceHero', 'burnStreak'])
      assert.ok(got.includes(id), id);
    assert.ok(!got.includes('codexLv10'));
    assert.ok(ach.LIST.filter((a) => a.hidden).length === 3);
  });

  await t('공평한 리더: 조금만 써서는 안 됨(각 5%p 이상), 사용량은 소수 둘째 자리까지 쌓임', () => {
    const pg = require('../src/progress');
    const ach = require('../src/achievements');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-'));
    const store = pg.createStore(dir);
    const at = Date.now() - 86400e3;
    store.addUsage('claude', 0.5, { at }); store.addUsage('codex', 0.6, { at }); store.addUsage('cursor', 0.4, { at });
    assert.ok(!ach.evaluate(store, {}).some((a) => a.id === 'fair'), '각각 1%도 안 써서는 못 받음');
    store.addUsage('claude', 6, { at }); store.addUsage('codex', 6, { at }); store.addUsage('cursor', 6, { at });
    assert.ok(ach.evaluate(store, {}).some((a) => a.id === 'fair'), '각각 5%p 넘게 비슷하게 쓰면 받음');
    const s2 = pg.createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'fr2-')));
    for (let i = 0; i < 100; i++) s2.addUsage('cursor', 0.02); // 0.02씩 100번 = 2
    assert.strictEqual(s2.stats().totalPct, 2, '작은 증가도 사라지지 않음');
  });

  await t('GAME OVER·부활: 99↔100으로 흔들려도 한 번만 세고, 진짜 리셋이면 부활로 셈', () => {
    const pg = require('../src/progress');
    const { UsageService } = require('../src/usage');
    const store = pg.createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'go-')));
    const svc = new UsageService(async () => ({}), { progress: store });
    const p = svc.provider('codex');
    const res = (u, reset = 9e12) => ({ ok: true, windows: [{ key: 'weekly', label: '주간', usedPercent: u, windowMinutes: 10080, resetsAt: reset }] });
    let state = null;
    const feed = (u, reset) => { const cur = res(u, reset); svc.applyProgress('codex', p, state, cur, cur); state = cur; };
    for (const u of [97, 99, 100, 99, 100, 99, 100, 99]) feed(u);
    assert.strictEqual(store.stats().gameOvers, 1, '흔들려도 GAME OVER는 한 번');
    assert.ok(!store.stats().revives, '흔들림은 부활이 아님');
    feed(2, 9.5e12); // 리셋
    assert.strictEqual(store.stats().revives, 1, '진짜 리셋은 부활');
    svc.stop && svc.stop();
  });

  await t('한도 리셋 알림: 꽤 쓰던 한도가 다시 차면 한 번 알리고, 거의 안 쓴 한도·흔들림·30분 안 중복은 알리지 않음', () => {
    const pg = require('../src/progress');
    const { UsageService } = require('../src/usage');
    const mk = () => {
      const svc = new UsageService(async () => ({}), { progress: pg.createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'))) });
      const p = svc.provider('codex');
      const resets = [];
      svc.on('reset', (e) => resets.push(e));
      let state = null;
      const feed = (u, reset = 9e12) => { const cur = { ok: true, windows: [{ key: 'weekly', label: '주간', usedPercent: u, windowMinutes: 10080, resetsAt: reset }] }; svc.applyProgress('codex', p, state, cur, cur); state = cur; };
      return { svc, resets, feed };
    };
    // 많이 쓰다 리셋 → 알림 1번
    let a = mk();
    for (const u of [40, 60, 80, 79, 80]) a.feed(u);
    assert.strictEqual(a.resets.length, 0, '쓰는 중에는 알리지 않음');
    a.feed(3, 9.5e12);
    assert.strictEqual(a.resets.length, 1);
    assert.deepStrictEqual([a.resets[0].before, a.resets[0].after], [20, 97]);
    a.feed(60, 9.5e12); a.feed(5, 9.9e12);
    assert.strictEqual(a.resets.length, 1, '30분 안 두 번째 리셋은 알리지 않음');
    // 거의 안 쓴 한도의 리셋은 소식이 아님
    let b = mk();
    for (const u of [10, 20, 25]) b.feed(u);
    b.feed(0, 9.5e12);
    assert.strictEqual(b.resets.length, 0);
    // 99↔100 흔들림은 리셋이 아님
    let c = mk();
    for (const u of [97, 99, 100, 99, 100, 99]) c.feed(u);
    assert.strictEqual(c.resets.length, 0);
    [a, b, c].forEach((x) => x.svc.stop && x.svc.stop());
  });

  await t('진단: Claude · Cursor 진단 결과에 토큰 값이 들어 있지 않다', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-'));
    process.env.CLAUDE_CONFIG_DIR = dir;
    fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'SECRET-ACCESS', refreshToken: 'SECRET-REFRESH', expiresAt: Date.now() + 7200e3 } }));
    const d = await new ClaudeReader(async () => ({})).diagnose();
    delete process.env.CLAUDE_CONFIG_DIR;
    assert.strictEqual(d.sources.length, 1);
    assert.strictEqual(d.sources[0].source, 'file');
    assert.strictEqual(d.sources[0].hasRefreshToken, true);
    assert.ok(!JSON.stringify(d).includes('SECRET'), '토큰 값이 새어 나가면 안 됨');
    assert.ok(d.sources[0].expiresInHours > 1.5 && d.sources[0].expiresInHours < 2.5);
  });

  await t('위젯 크기 배율: 0.5~1.75로 제한하고 소수 둘째 자리까지, 이상한 값은 1', () => {
    const { clampScale, SCALE_MIN, SCALE_MAX } = require('../src/settings');
    assert.strictEqual(clampScale(0.8), 0.8);
    assert.strictEqual(clampScale(0.123), SCALE_MIN);
    assert.strictEqual(clampScale(9), SCALE_MAX);
    assert.strictEqual(clampScale(1.2349), 1.23);
    assert.strictEqual(clampScale('abc'), 1);
    assert.strictEqual(clampScale(NaN), 1);
  });

  await t('옛 이름의 claude.ai 세션 저장소를 새 이름으로 옮김 (새 폴더가 있으면 그대로)', () => {
    const { renameClaudePartition } = require('../src/legacy');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-'));
    assert.strictEqual(renameClaudePartition(dir), false, '옮길 게 없으면 아무 일 없음');
    fs.mkdirSync(path.join(dir, 'Partitions', 'token-buddy-claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Partitions', 'token-buddy-claude', 'Cookies'), 'login');
    assert.strictEqual(renameClaudePartition(dir), true);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'Partitions', 'token-slayer-claude', 'Cookies'), 'utf8'), 'login');
    assert.ok(!fs.existsSync(path.join(dir, 'Partitions', 'token-buddy-claude')));
    fs.mkdirSync(path.join(dir, 'Partitions', 'token-buddy-claude'), { recursive: true });
    assert.strictEqual(renameClaudePartition(dir), false, '새 폴더가 이미 있으면 덮어쓰지 않음');
  });

  await t('업데이트 폴더 지우기: app.asar가 들어 있는 받아 둔 앱도 통째로 지워짐', () => {
    const { removeDir } = require('../src/updater');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-'));
    const res = path.join(root, 'updates', 'app', 'Token Slayer.app', 'Contents', 'Resources');
    fs.mkdirSync(res, { recursive: true });
    fs.writeFileSync(path.join(res, 'app.asar'), 'x');
    removeDir(path.join(root, 'updates'));
    assert.ok(!fs.existsSync(path.join(root, 'updates')));
    removeDir(path.join(root, 'updates')); // 없는 폴더도 오류 없이
    assert.strictEqual(process.noAsar === true, false, 'asar 처리를 켠 채로 돌려놓음');
  });

  await t('한도 창이 끝날 때의 최종 사용률: 진짜 리셋만 기록, 잠자기·흔들림은 기록 안 함', () => {
    const pg = require('../src/progress');
    const win = (used, reset) => ({ ok: true, windows: [{ key: 'weekly', usedPercent: used, windowMinutes: 10080, resetsAt: reset }] });
    const ends = [];
    const peaks = {};
    const on = (key, e) => ends.push([key, e.max, e.mins]);
    let now = 1e12;
    let prev = null;
    const feed = (u, reset, dt = 5000) => { now += dt; const cur = win(u, reset); pg.ratchetPrev(peaks, prev, cur, on, now); prev = cur; };
    feed(6, 5e12); feed(8, 5e12); feed(7, 5e12);            // 흔들려도 끝난 게 아님
    assert.deepStrictEqual(ends, []);
    feed(1, 6e12);                                          // 리셋 시각이 바뀜 → 최종 8%
    assert.deepStrictEqual(ends, [['weekly', 8, 10080]]);
    feed(3, 6e12); feed(2, 6e12);
    assert.strictEqual(ends.length, 1, '새 창 안에서는 다시 안 세짐');
    feed(40, 6e12, 60000); feed(0, null, 5000);             // Codex처럼 리셋 시각 없이 0%로 → 최종 40%
    assert.deepStrictEqual(ends[1], ['weekly', 40, 10080]);
    feed(30, 7e12); feed(1, 8e12, 2 * 3600e3);              // 2시간 못 본 뒤 리셋 → 최종값을 믿을 수 없어서 기록 안 함
    assert.strictEqual(ends.length, 2);
  });

  await t('소진율 업적: 알뜰 살림·3주 연속·월말 정산·딱 맞춰 씀·리셋 사냥꾼 (마스터는 Lv25)', () => {
    const pg = require('../src/progress');
    const ach = require('../src/achievements');
    const store = pg.createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'th-')));
    const W = 7 * 86400e3, t0 = Date.now() - 30 * 86400e3;
    store.addWindowEnd('codex', 'weekly', 60, 10080, t0);
    assert.ok(!ach.evaluate(store, {}).some((a) => a.group === '소진율'), '60%는 알뜰이 아님');
    store.addWindowEnd('codex', 'weekly', 92, 10080, t0 + W);
    store.addWindowEnd('codex', 'weekly', 95, 10080, t0 + 2 * W);
    let got = ach.evaluate(store, {}).map((a) => a.id);
    assert.ok(got.includes('thrifty') && !got.includes('thrifty3'), '두 번 연속은 아직 3주 연속이 아님');
    store.addWindowEnd('codex', 'weekly', 98.5, 10080, t0 + 3 * W); // 98% 이상이지만 GAME OVER(99.5) 미만
    got = ach.evaluate(store, {}).map((a) => a.id);
    assert.ok(got.includes('thrifty3') && got.includes('exactFit'));
    assert.strictEqual(ach.thriftyStreak([{ id: 'a', key: 'weekly', util: 95, at: 0 }, { id: 'a', key: 'weekly', util: 95, at: 20 * 86400e3 }, { id: 'a', key: 'weekly', util: 95, at: 27 * 86400e3 }]), 2, '중간에 몇 주 빠지면 이어진 게 아님');
    store.addWindowEnd('cursor', 'monthly', 93, 43200);
    assert.ok(ach.evaluate(store, {}).some((a) => a.id === 'monthClose'));
    store.flag('burnHunter');
    assert.ok(ach.evaluate(store, {}).some((a) => a.id === 'burnHunter'));
    // 마스터는 Lv25
    store.addXp('codex', 45000); // Lv10
    assert.ok(!ach.evaluate(store, {}).some((a) => a.id === 'codexLv10'));
    store.addXp('codex', 255000); // 합계 300,000 = Lv25
    assert.ok(ach.evaluate(store, {}).some((a) => a.id === 'codexLv10'));
  });

  await t('모델별 주간 한도(Opus·Sonnet)는 HP·GAME OVER·경고에서 제외, 다른 창이 없으면 그대로 씀', () => {
    const { hpWindows, UsageService } = require('../src/usage');
    const pg = require('../src/progress');
    const W = (key, used) => ({ key, label: key, usedPercent: used, windowMinutes: 10080, resetsAt: 9e12 });
    assert.deepStrictEqual(hpWindows([W('fiveHour', 20), W('weekly', 30), W('weeklyOpus', 100), W('weeklySonnet', 90)]).map((w) => w.key), ['fiveHour', 'weekly']);
    assert.deepStrictEqual(hpWindows([W('weeklyOpus', 100)]).map((w) => w.key), ['weeklyOpus'], '모델별 창만 있으면 그대로');
    const store = pg.createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'mw-')));
    const svc = new UsageService(async () => ({}), { progress: store });
    const p = svc.provider('claude');
    const warns = [];
    svc.on('hpwarn', (e) => warns.push(e.threshold));
    let state = null;
    const feed = (opus, weekly) => { const cur = { ok: true, active: true, windows: [W('weekly', weekly), W('weeklyOpus', opus)] }; svc.applyProgress('claude', p, state, cur, cur); state = cur; };
    feed(40, 30); feed(80, 31); feed(100, 32);              // Opus 전용 한도가 100%가 돼도
    assert.ok(!store.stats().gameOvers, 'GAME OVER 아님');
    assert.deepStrictEqual(warns, [], 'HP 경고도 없음');
    feed(100, 100);                                         // 전체 주간 한도가 다 차면 GAME OVER
    assert.strictEqual(store.stats().gameOvers, 1);
  });

  await t('HP 기준: 자동은 가장 적은 창, 5시간·주간은 그 창만, 없으면 자동으로 (GAME OVER도 그 기준)', () => {
    const { hpWindows, UsageService } = require('../src/usage');
    const pg = require('../src/progress');
    const W = (key, used, m) => ({ key, label: key, usedPercent: used, windowMinutes: m, resetsAt: 9e12 });
    const wins = [W('fiveHour', 100, 300), W('weekly', 30, 10080)];
    assert.deepStrictEqual(hpWindows(wins, 'auto').map((w) => w.key), ['fiveHour', 'weekly']);
    assert.deepStrictEqual(hpWindows(wins, 'fiveHour').map((w) => w.key), ['fiveHour']);
    assert.deepStrictEqual(hpWindows(wins, 'weekly').map((w) => w.key), ['weekly']);
    assert.deepStrictEqual(hpWindows([W('monthly', 40, 43200)], 'fiveHour').map((w) => w.key), ['monthly'], '5시간 창이 없으면 자동');
    const run = (basis) => {
      const store = pg.createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'hb-')));
      const svc = new UsageService(async () => ({}), { progress: store });
      svc.hpBasis = { claude: basis };   // 서비스별 기준 (다른 서비스는 자동)
      const p = svc.provider('claude');
      let state = null;
      const feed = (five) => { const cur = { ok: true, active: true, windows: [W('fiveHour', five, 300), W('weekly', 30, 10080)] }; svc.applyProgress('claude', p, state, cur, cur); state = cur; };
      feed(60); feed(100);                                   // 5시간 한도가 다 참, 주간은 30%
      return store.stats().gameOvers || 0;
    };
    assert.strictEqual(run('auto'), 1, '자동: 5시간이 다 차면 GAME OVER');
    assert.strictEqual(run('fiveHour'), 1);
    assert.strictEqual(run('weekly'), 0, '주간 기준: 5시간이 다 차도 GAME OVER 아님');
    // 서비스별: 다른 서비스의 설정은 영향이 없고, 창이 둘 이상인 서비스만 고를 수 있음
    const { basisFor, hasBasisChoice } = require('../src/usage');
    assert.strictEqual(basisFor({ claude: 'weekly' }, 'claude'), 'weekly');
    assert.strictEqual(basisFor({ claude: 'weekly' }, 'codex'), 'auto', '다른 서비스는 자동');
    assert.strictEqual(basisFor('fiveHour', 'cursor'), 'fiveHour', '예전 문자열 설정도 받아 줌');
    assert.strictEqual(hasBasisChoice(wins), true, '5시간+주간이면 고를 수 있음');
    assert.strictEqual(hasBasisChoice([W('weekly', 30, 10080)]), false, '주간만 있는 Codex는 고를 게 없음');
    assert.strictEqual(hasBasisChoice([W('monthly', 40, 43200)]), false, '월간만 있는 Cursor도 마찬가지');
    assert.strictEqual(hasBasisChoice([W('fiveHour', 1, 300), W('weekly', 1, 10080), W('weeklyOpus', 1, 10080)]), true, '모델별 창은 세지 않음');
  });

  await t('BURNING TIME 사냥꾼: 들어갈 때 남은 한도의 80% 이상을 리셋 전에 태우면', async () => {
    const pg = require('../src/progress');
    const { UsageService } = require('../src/usage');
    const store = pg.createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'bh-')));
    const svc = new UsageService(async () => ({}), { progress: store });
    const p = svc.provider('codex');
    const soon = Date.now() + 6 * 3600e3; // 주간 창: 리셋 12시간 이내 + 20% 이상 남으면 BURNING TIME
    const res = (u, reset) => ({ ok: true, active: true, windows: [{ key: 'weekly', label: '주간', usedPercent: u, windowMinutes: 10080, resetsAt: reset }] });
    let state = null;
    const feed = (u, reset) => { const cur = { ...res(u, reset) }; svc.applyProgress('codex', p, state, cur, cur); state = cur; };
    feed(40, soon); feed(41, soon);                           // BURNING TIME 진입: 남은 59%
    feed(80, soon); feed(93, soon);                           // 93%까지 태움: (93-41)/59 = 88%
    feed(1, soon + 7 * 86400e3);                              // 리셋
    assert.ok(store.stats().burnHunter, '80% 이상 태웠으니 사냥꾼');
    assert.ok(store.stats().windowEnds.some((e) => e.key === 'weekly' && e.util === 93), '창 종료 기록');
  });

  await t('낭비 배지: 유통기한 만료·월말의 후회·동면, 알림 없이(quiet)', () => {
    const pg = require('../src/progress');
    const ach = require('../src/achievements');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
    const store = pg.createStore(dir);
    assert.ok(ach.LIST.filter((a) => a.group === '낭비 배지').every((a) => a.quiet), '낭비 배지는 전부 조용히');
    assert.deepStrictEqual(ach.LIST.filter((a) => a.group === '낭비 배지').map((a) => a.id).sort(), ['expired', 'hibernate', 'iceHero', 'monthRegret']);
    store.addWindowEnd('codex', 'weekly', 60, 10080);       // 60% 쓰고 끝남 → 낭비 아님
    store.addWindowEnd('claude', 'weeklyOpus', 2, 10080);   // 모델별 주간 창은 대상 아님
    assert.ok(!ach.evaluate(store, {}).some((a) => ['expired', 'monthRegret'].includes(a.id)));
    store.addWindowEnd('codex', 'weekly', 8, 10080);
    store.addWindowEnd('cursor', 'monthly', 15, 43200);
    const got = ach.evaluate(store, {}).map((a) => a.id);
    assert.ok(got.includes('expired') && got.includes('monthRegret'));
    // 동면: 앱이 켜져 있던 7일이 전부 사용량 0이어야 함 (꺼져 있던 날이 섞이면 인정 안 함)
    const now = Date.now();
    for (let i = 1; i <= 7; i++) if (i !== 4) store.markRunDay(now - i * 86400e3);
    assert.ok(!ach.hibernated(store.stats().days, store.stats().runDays, now), '하루라도 앱이 꺼져 있었으면 아님');
    store.markRunDay(now - 4 * 86400e3);
    assert.ok(ach.hibernated(store.stats().days, store.stats().runDays, now));
    store.addUsage('claude', 3, { at: now - 2 * 86400e3 });
    assert.ok(!ach.hibernated(store.stats().days, store.stats().runDays, now), '그중 하루라도 썼으면 아님');
  });

  await t('명절 판정: 음력으로 계산 (2028년 이후도)', () => {
    const { isKoreanHoliday } = require('../src/progress');
    const at = (d) => new Date(`${d}T12:00:00+09:00`).getTime();
    for (const d of ['2026-09-25', '2028-01-27', '2029-02-12', '2029-02-13', '2029-02-14', '2029-09-22', '2030-02-03', '2035-02-08', '2035-09-16'])
      assert.ok(isKoreanHoliday(at(d)), d);
    for (const d of ['2029-02-16', '2029-03-01', '2030-09-20']) assert.ok(!isKoreanHoliday(at(d)), d);
  });

  await t('연속 전투 일수', () => {
    const { streak } = require('../src/achievements');
    const { dayKey } = require('../src/progress');
    const now = Date.now();
    const days = {};
    for (let i = 0; i < 7; i++) days[dayKey(now - i * 86400e3)] = { claude: 5 };
    assert.strictEqual(streak(days, now), 7);
    delete days[dayKey(now - 3 * 86400e3)];
    assert.strictEqual(streak(days, now), 3);
  });

  await t('실시간 파일 감시: 쓰면 바로 전투, 조용하면 휴식, 잡음 거르기', async () => {
    const { ActivityWatcher } = require('../src/watch');
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
    fs.mkdirSync(path.join(a, 'sub'), { recursive: true });
    let clock = Date.now();
    const w = new ActivityWatcher({
      codex: { paths: [{ dir: a, recursive: true, match: (f) => /\.jsonl$/.test(f) }], idleMs: 30000 },
      cursor: { paths: [{ dir: b }], idleMs: 30000, minEvents: 3, windowMs: 10000 },
    }, { now: () => clock });
    const events = [];
    w.on('change', (id, busy) => events.push(`${id}:${busy}`));
    w.start();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(100);
    fs.writeFileSync(path.join(a, 'sub', 'note.txt'), 'x'); // 무시 (jsonl 아님)
    await wait(300);
    assert.ok(!w.isBusy('codex'));
    fs.writeFileSync(path.join(a, 'sub', 'rollout-1.jsonl'), '{}\n');
    await wait(400);
    assert.ok(w.isBusy('codex'), '하위 폴더의 세션 기록 변화를 바로 감지');
    fs.writeFileSync(path.join(b, 'state.vscdb'), '1'); // 한 번은 잡음으로 봄
    await wait(300);
    assert.ok(!w.isBusy('cursor'));
    for (let i = 0; i < 4; i++) { fs.appendFileSync(path.join(b, 'state.vscdb'), 'x'); await wait(60); }
    await wait(300);
    assert.ok(w.isBusy('cursor'), '몰려서 바뀌면 인정');
    clock += 31000;
    w.checkIdle();
    assert.ok(!w.isBusy('codex') && !w.isBusy('cursor'), '30초 조용하면 휴식');
    assert.deepStrictEqual(events, ['codex:true', 'cursor:true', 'codex:false', 'cursor:false']);
    w.stop();
  });

  await t('종료할 때 업데이트: 꺼진 뒤 바꿔 넣고, 다시 켜지 않고, 두 번 실행되지 않음', async () => {
    const cp = require('child_process');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uq-'));
    fs.mkdirSync(path.join(root, 'dest', 'Fake.app'), { recursive: true });
    fs.mkdirSync(path.join(root, 'upd', 'app', 'Fake.app'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dest', 'Fake.app', 'v'), 'old');
    fs.writeFileSync(path.join(root, 'upd', 'app', 'Fake.app', 'v'), 'new');
    let cap = null;
    const realSpawn = cp.spawn;
    cp.spawn = (c, a) => { cap = { c, a }; return { unref() {} }; };
    try {
      delete require.cache[require.resolve('../src/updater')];
      const { Updater } = require('../src/updater');
      const app = { getPath: () => root, getVersion: () => '0.0.1', quit() { this.quit_called = true; } };
      const u = new Updater({ app, net: {}, shell: {} });
      assert.strictEqual(u.installOnQuit(), false, '받아 둔 업데이트가 없으면 아무것도 안 함');
      u.ready = { version: '9.9.9', kind: 'mac', path: path.join(root, 'upd', 'app', 'Fake.app'), bundle: path.join(root, 'dest', 'Fake.app') };
      assert.strictEqual(u.installOnQuit(), true);
      assert.ok(!app.quit_called, '종료 중이니 다시 종료를 부르지 않음');
      assert.strictEqual(u.installOnQuit(), false, '두 번 실행되지 않음');
      cp.spawn = realSpawn;
      if (process.platform === 'darwin') {
        const r = cp.spawnSync('/bin/bash', [cap.a[0], '999999', ...cap.a.slice(2)]);
        assert.strictEqual(r.status, 0);
        assert.strictEqual(fs.readFileSync(path.join(root, 'dest', 'Fake.app', 'v'), 'utf8'), 'new');
        assert.strictEqual(cap.a[4], '0', '다시 켜기 표시가 꺼져 있음');
      }
    } finally { cp.spawn = realSpawn; delete require.cache[require.resolve('../src/updater')]; }
  });

  await t('경로별 기준: 앱이 혼자 쓰는 1~2개 변화는 거르고, 몰리면 인정', async () => {
    const { ActivityWatcher } = require('../src/watch');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-'));
    const w = new ActivityWatcher({ claude: { paths: [{ dir: d, minEvents: 3, windowMs: 10000 }], idleMs: 30000 } });
    w.start();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(100);
    fs.writeFileSync(path.join(d, 'a'), '1'); // 주기 저장처럼 1~2번 (파일 하나 만들면 알림이 2번 올 수 있음)
    await wait(300);
    assert.ok(!w.isBusy('claude'), '2번은 잡음');
    for (let i = 0; i < 3; i++) { fs.appendFileSync(path.join(d, 'a'), 'x'); await wait(60); }
    await wait(300);
    assert.ok(w.isBusy('claude'), '몰려서 바뀌면 인정');
    w.stop();
  });

  await t('파일 알림이 없어도 직접 확인(probe)으로 덧붙여 쓰기 감지', async () => {
    const { ActivityWatcher } = require('../src/watch');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-'));
    const f = path.join(d, 'rollout.jsonl');
    fs.writeFileSync(f, 'a\n');
    const w = new ActivityWatcher({ codex: { paths: [], probe: async () => [f], probeEvery: 100, idleMs: 30000 } });
    w.start();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(250);
    assert.ok(!w.isBusy('codex'));
    fs.appendFileSync(f, 'b\n');
    await wait(250);
    assert.ok(w.isBusy('codex'));
    assert.ok(w.diag().codex.probeHits >= 1);
    w.stop();
  });

  await t('경험치 공평화: 창 길이별 가중치', () => {
    const pg = require('../src/progress');
    const W = (key, used, extra = {}) => ({ key, usedPercent: used, ...extra });
    // Claude: 5시간 +3%(300) vs 주간 +0.5%(200) → 300
    assert.strictEqual(pg.xpGain({ ok: true, windows: [W('fiveHour', 20), W('weekly', 40)] }, { ok: true, windows: [W('fiveHour', 23), W('weekly', 40.5)] }), 300);
    // Codex 주간만: +2% → 800
    assert.strictEqual(pg.xpGain({ ok: true, windows: [W('weekly', 50, { windowMinutes: 10080 })] }, { ok: true, windows: [W('weekly', 52, { windowMinutes: 10080 })] }), 800);
    // Cursor 월간: +1% → 1500
    assert.strictEqual(pg.xpGain({ ok: true, windows: [W('monthly', 30)] }, { ok: true, windows: [W('monthly', 31)] }), 1500);
    // 리셋은 0
    assert.strictEqual(pg.xpGain({ ok: true, windows: [W('fiveHour', 90)] }, { ok: true, windows: [W('fiveHour', 0)] }), 0);
  });

  await t('경험치: 세션마다 1%p씩 뒤처진 값으로 흔들려도 두 번 세지 않음, 리셋 뒤에는 다시 셈', () => {
    const pg = require('../src/progress');
    const win = (used, resetsAt = 1e12) => ({ ok: true, windows: [{ key: 'weekly', usedPercent: used, windowMinutes: 10080, resetsAt }] });
    const peaks = {};
    let prev = win(48), xp = 0;
    pg.ratchetPrev(peaks, null, prev);
    for (const v of [49, 48, 49, 48, 49, 50, 49, 50]) { // 48→49 한 번, 49→50 한 번만 실제 증가
      const cur = win(v);
      xp += pg.xpGain(pg.ratchetPrev(peaks, prev, cur), cur);
      prev = cur;
    }
    assert.strictEqual(xp, 2 * 400, '실제로 늘어난 2%p만 (흔들림은 제외)');
    // 창이 리셋되면(크게 떨어짐) 새로 시작
    let cur = win(3, 2e12);
    assert.strictEqual(pg.xpGain(pg.ratchetPrev(peaks, prev, cur), cur), 0);
    prev = cur; cur = win(4, 2e12);
    assert.strictEqual(pg.xpGain(pg.ratchetPrev(peaks, prev, cur), cur), 400, '리셋 뒤 늘어난 1%p는 다시 셈');
  });

  await t('Codex: 여러 세션 스냅샷은 5분 안·같은 리셋이면 높은 값, 오래됐거나 다른 창이면 최신 것', () => {
    const { mergeSnapshots } = require('../src/codex');
    const snap = (used, at, reset = 5e12) => ({ fiveHour: null, weekly: { usedPercent: used, windowMinutes: 10080, resetsAt: reset }, observedAt: at });
    const now = Date.now();
    assert.strictEqual(mergeSnapshots([snap(48, now), snap(49, now - 5000)]).weekly.usedPercent, 49, '뒤처진 값이 최신 파일이어도 높은 값');
    assert.strictEqual(mergeSnapshots([snap(48, now), snap(70, now - 3600e3)]).weekly.usedPercent, 48, '한 시간 전 값은 무시');
    assert.strictEqual(mergeSnapshots([snap(3, now, 6e12), snap(80, now - 1000, 5e12)]).weekly.usedPercent, 3, '리셋된 새 창은 옛 창 값으로 덮지 않음');
    assert.strictEqual(mergeSnapshots([]), null);
  });

  await t('바닥 예측과 HP 경고', () => {
    const { Forecaster, HpAlarm } = require('../src/forecast');
    const f = new Forecaster();
    const t0 = Date.now() - 20 * 60e3;
    const reset = Date.now() + 3 * 3600e3;
    // 20분 동안 40% → 60% (시간당 60%) → 남은 40%는 40분 뒤 바닥, 리셋(3시간)보다 먼저
    f.add('claude', [{ key: 'fiveHour', label: '5시간', usedPercent: 40, resetsAt: reset }], t0);
    f.add('claude', [{ key: 'fiveHour', label: '5시간', usedPercent: 50, resetsAt: reset }], t0 + 10 * 60e3);
    f.add('claude', [{ key: 'fiveHour', label: '5시간', usedPercent: 60, resetsAt: reset }], t0 + 20 * 60e3);
    const p = f.predict('claude', [{ key: 'fiveHour', label: '5시간', usedPercent: 60, resetsAt: reset }], t0 + 20 * 60e3);
    assert.strictEqual(p.ratePerHour, 60);
    assert.ok(Math.abs(p.etaMs - 40 * 60e3) < 1000);
    assert.ok(p.beforeReset);
    // 느리게 쓰면 리셋까지 버팀
    const g = new Forecaster();
    g.add('x', [{ key: 'weekly', usedPercent: 10, resetsAt: Date.now() + 3600e3 }], t0);
    g.add('x', [{ key: 'weekly', usedPercent: 11, resetsAt: Date.now() + 3600e3 }], t0 + 20 * 60e3);
    assert.strictEqual(g.predict('x', [{ key: 'weekly', usedPercent: 11, resetsAt: Date.now() + 3600e3 }], t0 + 20 * 60e3).beforeReset, false);
    // 리셋되면 샘플 초기화
    f.add('claude', [{ key: 'fiveHour', usedPercent: 2, resetsAt: reset + 5 * 3600e3 }], t0 + 21 * 60e3);
    assert.strictEqual(f.predict('claude', [{ key: 'fiveHour', usedPercent: 2, resetsAt: reset + 5 * 3600e3 }], t0 + 21 * 60e3), null);
    // HP 경고: 25 → 18(20% 경고) → 15(없음) → 8(10% 경고) → 50(초기화) → 19(다시 20%)
    const a = new HpAlarm();
    assert.deepStrictEqual([25, 18, 15, 8, 50, 19].map((r) => a.check('c', r)), [null, 20, null, 10, null, 20]);
  });

  await t('Codex 여러 대화: 옛 날짜 폴더의 대화도 최근 순으로 잡는다', async () => {
    const codex = require('../src/codex');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-multi-'));
    process.env.CODEX_HOME = home;
    const now = Date.now();
    const day = (ms) => { const d = new Date(ms); return [String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')]; };
    const put = (ms, name, ageMin) => {
      const dir = path.join(home, 'sessions', ...day(ms));
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, `rollout-${name}.jsonl`);
      fs.writeFileSync(f, '{}\n');
      const t = (now - ageMin * 60e3) / 1000;
      fs.utimesSync(f, t, t);
      return f;
    };
    // 오늘 대화 3개는 한참 전에 멈췄고, 사흘 전 시작한 대화와 오늘 대화 2개가 지금 동시에 돌아가는 중
    put(now, 'today-old1', 120); put(now, 'today-old2', 130); put(now, 'today-old3', 140);
    const resumed = put(now - 3 * 86400e3, 'resumed', 1);
    const a = put(now, 'today-live-a', 2);
    const b = put(now, 'today-live-b', 0);
    codex.resetScanCache();
    const recent = await codex.recentRolloutFiles();
    assert.strictEqual(recent[0].f, b);
    assert.strictEqual(recent[1].f, resumed);
    const active = await codex.activeRolloutFiles();
    assert.deepStrictEqual(active.sort(), [a, b, resumed].sort());
    delete process.env.CODEX_HOME;
    codex.resetScanCache();
  });

  await t('업데이트: 버전 비교·파일 고르기·확인값', async () => {
    const u = require('../src/updater');
    assert.strictEqual(u.compareVersions('v0.20.0', '0.19.1'), 1);
    assert.strictEqual(u.compareVersions('0.19.1', '0.19.1'), 0);
    assert.strictEqual(u.compareVersions('0.9.0', '0.10.0'), -1);
    assert.strictEqual(u.compareVersions('1.0.0', '1.0.0-beta.1'), 1);
    const A = (name) => ({ name, browser_download_url: `https://x/${name}` });
    const assets = ['TokenSlayer-0.20.0-mac-arm64.zip', 'TokenSlayer-0.20.0-mac-x64.zip', 'TokenSlayer-0.20.0-mac-arm64.dmg', 'TokenSlayer-0.20.0-mac-x64.dmg',
      'TokenSlayer-Setup-0.20.0-x64.exe', 'TokenSlayer-Setup-0.20.0-arm64.exe', 'TokenSlayer-Portable-0.20.0-x64.exe', 'SHA256SUMS.txt'].map(A);
    assert.strictEqual(u.pickAsset(assets, 'darwin', 'arm64').name, 'TokenSlayer-0.20.0-mac-arm64.zip');
    assert.strictEqual(u.pickAsset(assets, 'darwin', 'x64').name, 'TokenSlayer-0.20.0-mac-x64.zip');
    assert.strictEqual(u.pickAsset(assets, 'win32', 'x64').name, 'TokenSlayer-Setup-0.20.0-x64.exe');
    assert.strictEqual(u.pickAsset(assets, 'win32', 'arm64').name, 'TokenSlayer-Setup-0.20.0-arm64.exe');
    assert.strictEqual(u.pickAsset(assets, 'linux', 'x64'), null);
    assert.strictEqual(u.pickInstaller(assets, 'darwin', 'arm64').name, 'TokenSlayer-0.20.0-mac-arm64.dmg');
    const h = 'a'.repeat(64);
    assert.strictEqual(u.digestOf({ digest: `sha256:${h}` }), h);
    assert.strictEqual(u.digestOf({}), null);
    assert.deepStrictEqual(u.parseSums(`${h}  TokenSlayer-Setup-0.20.0-x64.exe\n`), { 'TokenSlayer-Setup-0.20.0-x64.exe': h });
    // 바꿔 넣을 수 있는 자리인지
    const exe = '/Applications/Token Slayer.app/Contents/MacOS/Token Slayer';
    assert.strictEqual(u.macBundlePath(exe), '/Applications/Token Slayer.app');
    const ok = () => true;
    assert.deepStrictEqual(u.canSelfInstall({ platform: 'darwin', isPackaged: true, exePath: exe, writable: ok }), { ok: true, bundle: '/Applications/Token Slayer.app' });
    assert.strictEqual(u.canSelfInstall({ platform: 'darwin', isPackaged: true, exePath: '/Volumes/Token Slayer/Token Slayer.app/Contents/MacOS/Token Slayer', writable: ok }).why, 'dmg');
    assert.strictEqual(u.canSelfInstall({ platform: 'darwin', isPackaged: true, exePath: exe, writable: () => false }).why, 'readonly');
    assert.strictEqual(u.canSelfInstall({ platform: 'darwin', isPackaged: false, exePath: exe, writable: ok }).why, 'source');
  });

  await t('업데이트: 새 버전을 받아 확인값이 맞을 때만 준비', async () => {
    const { Updater } = require('../src/updater');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
    const payload = Buffer.from('new installer bytes');
    const hash = require('crypto').createHash('sha256').update(payload).digest('hex');
    const name = process.arch === 'arm64' ? 'TokenSlayer-Setup-0.99.0-arm64.exe' : 'TokenSlayer-Setup-0.99.0-x64.exe';
    const mk = (digest) => {
      const rel = { tag_name: 'v0.99.0', html_url: 'https://github.com/sigcrew/token-slayer/releases/tag/v0.99.0',
        assets: [{ name, size: payload.length, digest: `sha256:${digest}`, browser_download_url: 'https://dl/x.exe' }] };
      const net = { fetch: async (url) => url.includes('api.github.com')
        ? { ok: true, json: async () => rel }
        : { ok: true, status: 200, headers: { get: () => String(payload.length) }, body: new Blob([payload]).stream() } };
      const app = { getPath: (k) => (k === 'exe' ? 'C:\\Program Files\\Token Slayer\\Token Slayer.exe' : dir), getVersion: () => '0.20.0', isPackaged: true, quit() {} };
      return new Updater({ app, net, shell: {} });
    };
    const plat = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const good = mk(hash);
      let ready = null;
      good.on('ready', (r) => { ready = r; });
      await good.check();
      assert.strictEqual(good.state.status, 'ready');
      assert.strictEqual(ready.version, '0.99.0');
      assert.deepStrictEqual(fs.readFileSync(ready.path), payload);
      const bad = mk('b'.repeat(64));
      await bad.check();
      assert.strictEqual(bad.state.status, 'error');
      assert.strictEqual(bad.ready, null);
    } finally {
      Object.defineProperty(process, 'platform', plat);
    }
  });

  // ── 라이선스 (가짜 fetch) ──
  const licConfig = require('../src/license-config');
  const licLib = require('../src/license');
  const KEY = 'ABCD1234-ABCD-1234-ABCD-1234ABCD1234';
  const mkFetch = (handlers) => {
    const calls = [];
    const fn = async (url, opts) => {
      const ep = url.split('/').pop();
      calls.push({ ep, body: Object.fromEntries(new URLSearchParams(opts.body)) });
      const h = handlers[ep];
      if (h instanceof Error) throw h;
      return { status: 200, json: async () => h };
    };
    fn.calls = calls;
    return fn;
  };
  const okMeta = { store_id: 11, product_id: 22 };
  const activateOk = { activated: true, instance: { id: 'inst-1' }, license_key: { status: 'active' }, meta: okMeta };
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ts-lic-'));
  licConfig.STORE_ID = 11; licConfig.PRODUCT_ID = 22;

  await t('라이선스: 활성화하면 저장되고 유효', async () => {
    const dir = tmp();
    const l = licLib.create(dir, { fetchFn: mkFetch({ activate: activateOk }) });
    assert.strictEqual(l.isValid(), false);
    assert.deepStrictEqual(await l.activate(KEY), { ok: true });
    assert.strictEqual(l.isValid(), true);
    assert.strictEqual(licLib.create(dir).isValid(), true); // 재시작 뒤에도 유지
  });

  await t('라이선스: 이미 활성화된 키를 다시 붙여 넣어도 새 자리를 쓰지 않는다', async () => {
    const f = mkFetch({ activate: activateOk, validate: { valid: true, license_key: { status: 'active' }, meta: okMeta } });
    const l = licLib.create(tmp(), { fetchFn: f });
    await l.activate(KEY);
    const r = await l.activate(KEY);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(f.calls.filter((c) => c.ep === 'activate').length, 1, '서버 활성화는 한 번만');
    assert.strictEqual(l.isValid(), true);
  });

  await t('라이선스: 서버가 옛 자리를 모르면 새로 활성화하고, 다른 키로 바꾸면 옛 자리를 반납한다', async () => {
    const dir = tmp();
    const f1 = mkFetch({ activate: activateOk });
    await licLib.create(dir, { fetchFn: f1 }).activate(KEY);
    // 같은 키지만 서버가 이 자리를 모른다고 답함 → 새 활성화, 옛 자리 반납 시도
    const f2 = mkFetch({ validate: { valid: false, license_key: { status: 'active' }, meta: okMeta }, activate: { ...activateOk, instance: { id: 'inst-2' } }, deactivate: { deactivated: true } });
    const l = licLib.create(dir, { fetchFn: f2 });
    assert.deepStrictEqual(await l.activate(KEY), { ok: true });
    assert.ok(f2.calls.some((c) => c.ep === 'deactivate' && c.body.instance_id === 'inst-1'), '옛 자리 반납');
    // 다른 키로 바꾸기
    const KEY2 = 'ZZZZ1234-ABCD-1234-ABCD-1234ABCD9999';
    const f3 = mkFetch({ activate: { ...activateOk, instance: { id: 'inst-3' } }, deactivate: { deactivated: true } });
    const l2 = licLib.create(dir, { fetchFn: f3 });
    assert.deepStrictEqual(await l2.activate(KEY2), { ok: true });
    assert.ok(f3.calls.some((c) => c.ep === 'deactivate' && c.body.instance_id === 'inst-2' && c.body.license_key === KEY), '이전 키의 자리 반납');
  });

  await t('라이선스: 새 키 활성화가 거절되면 기존 키는 그대로 유지', async () => {
    const dir = tmp();
    await licLib.create(dir, { fetchFn: mkFetch({ activate: activateOk }) }).activate(KEY);
    const l = licLib.create(dir, { fetchFn: mkFetch({ activate: { activated: false, error: 'limit' } }) });
    const r = await l.activate('QQQQ1234-ABCD-1234-ABCD-1234ABCD0000');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(l.isValid(), true);
    assert.strictEqual(l.info().key, KEY);
  });

  await t('라이선스: 활성화할 때 컴퓨터 이름(hostname)을 보내지 않음', async () => {
    const f = mkFetch({ activate: activateOk });
    const l = licLib.create(tmp(), { fetchFn: f });
    await l.activate(KEY);
    const sent = f.calls.find((c) => c.ep === 'activate').body;
    assert.ok(!sent.instance_name.includes(os.hostname()), '컴퓨터 이름이 들어가면 안 됨');
    assert.match(sent.instance_name, /^Token Slayer [a-z0-9]+-[a-z0-9_]+ #[0-9a-f]{6}$/);
    assert.deepStrictEqual(Object.keys(sent).sort(), ['instance_name', 'license_key'], '키와 이름 말고는 보내지 않음');
  });

  await t('라이선스: 다른 상품 키는 거부하고 자리도 반납', async () => {
    const f = mkFetch({ activate: { ...activateOk, meta: { store_id: 11, product_id: 99 } }, deactivate: { deactivated: true } });
    const l = licLib.create(tmp(), { fetchFn: f });
    const r = await l.activate(KEY);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'wrong-product');
    assert.strictEqual(l.isValid(), false);
    assert.ok(f.calls.some((c) => c.ep === 'deactivate'));
  });

  await t('라이선스: 스토어 미설정이면 어떤 키도 거부', async () => {
    licConfig.STORE_ID = 0;
    try {
      const l = licLib.create(tmp(), { fetchFn: mkFetch({ activate: activateOk, deactivate: {} }) });
      assert.strictEqual((await l.activate(KEY)).ok, false);
    } finally { licConfig.STORE_ID = 11; }
  });

  await t('라이선스: 형식 오류·서버 거절·오프라인', async () => {
    const l1 = licLib.create(tmp(), { fetchFn: mkFetch({}) });
    assert.strictEqual((await l1.activate('short')).reason, 'format');
    const l2 = licLib.create(tmp(), { fetchFn: mkFetch({ activate: { activated: false, error: 'license_key not found' } }) });
    const r2 = await l2.activate(KEY);
    assert.strictEqual(r2.reason, 'rejected');
    assert.strictEqual(r2.message, 'license_key not found');
    const l3 = licLib.create(tmp(), { fetchFn: mkFetch({ activate: new Error('offline') }) });
    assert.strictEqual((await l3.activate(KEY)).reason, 'network');
  });

  await t('라이선스: 재확인 — 환불되면 잠기고, 오프라인이면 유지, 30일 넘으면 잠김', async () => {
    let clock = 1e12;
    const dir = tmp();
    const handlers = { activate: activateOk, validate: { valid: true, license_key: { status: 'active' }, meta: okMeta } };
    const l = licLib.create(dir, { fetchFn: mkFetch(handlers), now: () => clock });
    await l.activate(KEY);
    // 하루 안에는 서버에 다시 묻지 않는다
    assert.deepStrictEqual(await l.revalidate(), { changed: false });
    clock += licLib.REVALIDATE_MS + 1;
    handlers.validate = new Error('offline');
    assert.strictEqual((await l.revalidate()).offline, true);
    assert.strictEqual(l.isValid(), true);
    clock += licLib.GRACE_MS;
    assert.strictEqual(l.isValid(), false); // 오래 확인 못 하면 잠김
    // 환불(disabled) → 잠김 + 파일 삭제
    clock = 1e12 + 1;
    handlers.validate = { valid: false, license_key: { status: 'disabled' }, meta: okMeta };
    const l2 = licLib.create(dir, { fetchFn: mkFetch(handlers), now: () => clock + licLib.REVALIDATE_MS + 1 });
    assert.strictEqual((await l2.revalidate()).changed, true);
    assert.strictEqual(l2.isValid(), false);
    assert.strictEqual(fs.existsSync(path.join(dir, 'license.json')), false);
  });

  await t('라이선스: 해제하면 서버에 반납하고 잠김', async () => {
    const f = mkFetch({ activate: activateOk, deactivate: { deactivated: true } });
    const l = licLib.create(tmp(), { fetchFn: f });
    await l.activate(KEY);
    assert.deepStrictEqual(await l.deactivate(), { ok: true });
    assert.strictEqual(l.isValid(), false);
    assert.ok(f.calls.some((c) => c.ep === 'deactivate' && c.body.instance_id === 'inst-1'));
  });


  // ── 다국어(i18n) ──
  const I18N = require('../renderer/i18n');
  const EN = require('../renderer/i18n-en');
  const HAN = /[가-힣]/;
  const ph = (x) => (x.match(/\{\w+\}/g) || []).sort().join();

  await t('i18n: 언어 결정 — 설정 우선, 자동이면 시스템 언어', () => {
    assert.strictEqual(I18N.resolveLang('en', 'ko-KR'), 'en');
    assert.strictEqual(I18N.resolveLang('ko', 'en-US'), 'ko');
    assert.strictEqual(I18N.resolveLang('auto', 'ko-KR'), 'ko');
    assert.strictEqual(I18N.resolveLang('auto', 'ja-JP'), 'en');
    assert.strictEqual(I18N.resolveLang('auto', ''), 'en');
  });

  await t('i18n: tr — 한국어는 그대로, 영어는 사전 · 자리표시자 채움 · 없는 문장은 한국어 유지', () => {
    I18N.setLang('ko');
    assert.strictEqual(I18N.tr('남은 사용량이 {n}%예요.', { n: 5 }), '남은 사용량이 5%예요.');
    I18N.setLang('en');
    assert.strictEqual(I18N.tr('남은 사용량이 {n}%예요.', { n: 5 }), 'Remaining usage is 5%.');
    assert.strictEqual(I18N.tr('사전에 없는 문장입니다'), '사전에 없는 문장입니다');
    assert.ok(I18N.misses.has('사전에 없는 문장입니다'));
    assert.strictEqual(I18N.tr('Token Slayer'), 'Token Slayer');
    I18N.setLang('ko');
  });

  await t('i18n: 사전 — 값에 한글이 없고 자리표시자가 키와 같음', () => {
    for (const [k, v] of Object.entries(EN)) {
      assert.ok(!HAN.test(v) || ['한국어', '자동 (Auto)', '언어 · Language'].includes(k), `한글이 남음: ${k} → ${v}`);
      assert.strictEqual(ph(v), ph(k), `자리표시자 불일치: ${k}`);
    }
  });

  await t('i18n: 코드의 tr(\'…\') · T(\'…\') 문장이 모두 사전에 있음', () => {
    const files = ['main.js', ...fs.readdirSync(path.join(__dirname, '..', 'src')).map((f) => 'src/' + f),
      'renderer/app.js', 'renderer/onboarding.js'];
    const re = /\b(?:tr|T)\(\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;
    const missing = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      let m;
      while ((m = re.exec(src))) {
        const s = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
        if (HAN.test(s) && EN[s] === undefined) missing.push(`${f}: ${s}`);
      }
    }
    assert.deepStrictEqual(missing, []);
  });

  await t('i18n: 업적 · 팩 · 시리즈 이름과 설명이 모두 사전에 있음', () => {
    const miss = [];
    const need = (s) => { if (s && HAN.test(s) && EN[s] === undefined) miss.push(s); };
    for (const a of require('../src/achievements').LIST) { need(a.group); need(a.name); need(a.desc); }
    const pdir = path.join(__dirname, '..', 'packs');
    for (const f of fs.readdirSync(pdir).filter((x) => x.endsWith('.json'))) need(JSON.parse(fs.readFileSync(path.join(pdir, f), 'utf8')).name);
    for (const sr of require('../src/series').SERIES) need(sr.name);
    assert.deepStrictEqual([...new Set(miss)], []);
  });


  await t('실행: 직접 열면 숨겨 둔 위젯도 보이고, 로그인으로 켜진 경우만 숨김 상태를 따른다', () => {
    const { showOnLaunch } = require('../src/launch');
    const hidden = { visible: false, onboarded: true };
    assert.strictEqual(showOnLaunch({ visible: true, onboarded: true }), true);
    assert.strictEqual(showOnLaunch({ onboarded: true }), true, 'visible 값이 없으면 보임');
    assert.strictEqual(showOnLaunch(hidden, { wasOpenedAtLogin: false, platform: 'darwin' }), true, '직접 열기');
    assert.strictEqual(showOnLaunch(hidden, { wasOpenedAtLogin: true, platform: 'darwin' }), false, '맥 로그인 자동 실행은 숨김 유지');
    assert.strictEqual(showOnLaunch(hidden, { wasOpenedAtLogin: true, platform: 'win32' }), true, '윈도우는 로그인 여부를 알 수 없어 직접 연 것으로 본다');
    assert.strictEqual(showOnLaunch({ visible: false, onboarded: false }, { wasOpenedAtLogin: false, platform: 'darwin' }), false, '처음 안내 중에는 안내 창이 대신한다');
  });


  await t('오류 기록: 토큰·이메일·사용자 이름을 지우고, 커지면 오래된 줄부터 버리고, 실패해도 던지지 않는다', () => {
    const errlogLib2 = require('../src/errlog');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'errlog-'));
    const L = errlogLib2.create(dir, { home: '/Users/tester', now: () => Date.UTC(2026, 9, 7, 1, 2, 3) });
    L.add('crash', new Error('open /Users/tester/Library/x failed for tester@example.com with Bearer abcdef1234567890 and sk-ant-api03-abcdefghijklmnop'), { code: 7 });
    L.add('launch', 'v0.30.4 darwin-arm64', { shown: true });
    const text = fs.readFileSync(L.file, 'utf8');
    for (const secret of ['/Users/tester', 'tester@example.com', 'abcdef1234567890', 'sk-ant-api03']) assert.ok(!text.includes(secret), `${secret} 가 남음`);
    assert.ok(text.includes('<email>') && text.includes('<token>') && text.includes('<key>') && text.includes('~/Library/x'));
    const recent = L.recent(5);
    assert.strictEqual(recent.length, 2);
    assert.ok(recent[0].startsWith('2026-10-07 01:02:03Z [crash]'));
    assert.deepStrictEqual(L.recent(5, { kinds: ['launch'] }).length, 1);
    // 크기 상한: 200줄만 남고 가장 최근 것이 보존됨
    const big = 'x'.repeat(500);
    for (let i = 0; i < 1500; i++) L.add('error', `n${i} ${big}`);
    assert.ok(fs.statSync(L.file).size <= errlogLib2.MAX_BYTES + 2000, '파일이 너무 커짐');
    assert.ok(L.recent(1)[0].includes('n1499'), '가장 최근 기록이 남아야 함');
    // 기록할 수 없는 곳이어도 앱이 멈추지 않음
    const bad = errlogLib2.create('/dev/null/not-a-dir');
    bad.add('error', 'x');
    assert.deepStrictEqual(bad.recent(3), []);
  });


  await t('Codex 서버 조회: 서버 값을 우선하고, 실패 · 만료 · 끔이면 로컬 기록으로 돌아간다 (토큰은 읽기만)', async () => {
    const { parseServerUsage, jwtExpMs } = require('../src/codex');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cxs-'));
    process.env.CODEX_HOME = home;
    const jwt = (expSec) => `h.${Buffer.from(JSON.stringify({ exp: expSec })).toString('base64url')}.s`;
    const NOW = 1_800_000_000_000;
    const writeAuth = (expSec) => fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: jwt(expSec), refresh_token: 'RT-SECRET', account_id: 'acct-1' } }));
    // 로컬 기록: 오래된 값 22% (주간 창)
    const dir = path.join(home, 'sessions/2026/10/12'); fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'rollout-x.jsonl');
    fs.writeFileSync(f, JSON.stringify({ type: 'event_msg', timestamp: '2026-10-12T07:33:28.921Z', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 22, window_minutes: 10080, resets_at: 1_800_100_000 } } } }) + '\n');
    const server = { plan_type: 'pro', rate_limit: { primary_window: { used_percent: 28, limit_window_seconds: 604800, reset_at: 1_800_100_000 }, secondary_window: null } };
    const mkFetch = (status, body) => { const calls = []; const fn = async (url, opts) => { calls.push({ url, auth: opts.headers.Authorization, acct: opts.headers['ChatGPT-Account-Id'] }); return { ok: status >= 200 && status < 300, status, json: async () => body }; }; fn.calls = calls; return fn; };

    // 응답 해석: 창 길이로 주간 / 5시간을 가름
    const ps = parseServerUsage({ rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_after_seconds: 60 }, secondary_window: { used_percent: 50, limit_window_seconds: 604800, reset_at: 1_800_100_000 } } }, NOW);
    assert.strictEqual(ps.fiveHour.usedPercent, 10); assert.strictEqual(ps.fiveHour.resetsAt, NOW + 60000);
    assert.strictEqual(ps.weekly.usedPercent, 50); assert.strictEqual(ps.weekly.windowMinutes, 10080);
    assert.strictEqual(parseServerUsage({ rate_limit: null }, NOW), null);
    assert.strictEqual(jwtExpMs(jwt(123)), 123000);

    // 1) 서버 값 우선 (22 → 28) · 토큰은 요청 헤더에만 · 45초 안에는 다시 묻지 않음
    writeAuth(NOW / 1000 + 3600);
    const f1 = mkFetch(200, server); const r1 = new CodexReader(f1);
    let r = await r1.read(NOW);
    assert.strictEqual(r.weekly.usedPercent, 28); assert.strictEqual(r.source, 'server'); assert.strictEqual(r.plan, 'pro');
    assert.ok(f1.calls[0].url.includes('/wham/usage') && f1.calls[0].auth.startsWith('Bearer ') && f1.calls[0].acct === 'acct-1');
    await r1.read(NOW + 10000); assert.strictEqual(f1.calls.length, 1, '45초 안에는 캐시');
    await r1.read(NOW + 50000); assert.strictEqual(f1.calls.length, 2, '45초 뒤에는 다시 조회');
    assert.ok(!JSON.stringify(r).includes('RT-SECRET'), '결과에 토큰이 들어가면 안 됨');

    // 2) 로그인 거절(401) → 로컬 기록(22) · 10분 동안 다시 묻지 않음
    const f2 = mkFetch(401, {}); const r2 = new CodexReader(f2);
    r = await r2.read(NOW); assert.strictEqual(r.weekly.usedPercent, 22); assert.ok(r.source !== 'server');
    await r2.read(NOW + 5 * 60000); assert.strictEqual(f2.calls.length, 1, '거절 뒤 10분은 쉼');

    // 3) 응답 형식이 달라지면 로컬로 · 네트워크 오류도 로컬로 (앱이 멈추지 않음)
    r = await new CodexReader(mkFetch(200, { hello: 1 })).read(NOW); assert.strictEqual(r.weekly.usedPercent, 22);
    r = await new CodexReader(async () => { throw new Error('offline'); }).read(NOW); assert.strictEqual(r.weekly.usedPercent, 22);

    // 4) 토큰이 이미 만료됐으면 요청하지 않음 (갱신은 Codex CLI가 하는 일)
    writeAuth(NOW / 1000 - 10);
    const f4 = mkFetch(200, server); r = await new CodexReader(f4).read(NOW);
    assert.strictEqual(f4.calls.length, 0); assert.strictEqual(r.weekly.usedPercent, 22);

    // 5) 설정에서 끄면 요청하지 않음 · fetch가 없어도 로컬만
    writeAuth(NOW / 1000 + 3600);
    const f5 = mkFetch(200, server); const r5 = new CodexReader(f5); r5.serverEnabled = false;
    r = await r5.read(NOW); assert.strictEqual(f5.calls.length, 0); assert.strictEqual(r.weekly.usedPercent, 22);
    r = await new CodexReader().read(NOW); assert.strictEqual(r.weekly.usedPercent, 22);

    // 6) 서버 값이 리셋 시각을 지났으면 0%로
    const past = { rate_limit: { primary_window: { used_percent: 90, limit_window_seconds: 604800, reset_at: NOW / 1000 - 5 } } };
    r = await new CodexReader(mkFetch(200, past)).read(NOW); assert.strictEqual(r.weekly.usedPercent, 0);
    delete process.env.CODEX_HOME;
  });


  await t('Codex 감시: ChatGPT 앱의 Codex 로그 파일도 직접 확인해서, 바뀌면 일하는 중 · 조용하면 쉼', async () => {
    const { desktopLogDir, recentDesktopLogs } = require('../src/codex');
    const { ActivityWatcher } = require('../src/watch');
    if (process.platform === 'darwin') assert.ok(String(desktopLogDir()).endsWith(path.join('Library', 'Logs', 'com.openai.codex')));
    else assert.strictEqual(desktopLogDir(), null);
    assert.deepStrictEqual(recentDesktopLogs(null), []);
    // 폴더 모양: 년/월/일/*.log — 가장 최근 날짜 폴더의 최근 파일만, .log가 아닌 것은 제외
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cxlog-'));
    const mk = (d, name, mtime) => { const p2 = path.join(dir, ...d.split('/')); fs.mkdirSync(p2, { recursive: true }); const f = path.join(p2, name); fs.writeFileSync(f, 'x\n'); fs.utimesSync(f, mtime, mtime); return f; };
    mk('2026/09/30', 'old.log', 100);
    const a = mk('2026/10/12', 'a.log', 2000); const b = mk('2026/10/12', 'b.log', 3000); mk('2026/10/12', 'note.txt', 4000);
    assert.deepStrictEqual(recentDesktopLogs(dir, 3), [b, a]);
    // 열린 파일에 덧붙여 쓰는 상황을 흉내: 안 바뀌면 쉼 → 바뀌면 일하는 중 → 조용해지면 다시 쉼
    const w = new ActivityWatcher({ codex: { paths: [], probe: () => recentDesktopLogs(dir), probeEvery: 80, probeRefreshMs: 80, idleMs: 600 } });
    w.start();
    await new Promise((r) => setTimeout(r, 400));
    assert.strictEqual(w.isBusy('codex'), false, '조용하면 쉼');
    fs.appendFileSync(b, 'working\n');
    await new Promise((r) => setTimeout(r, 400));
    assert.strictEqual(w.isBusy('codex'), true, '로그가 바뀌면 일하는 중');
    await new Promise((r) => setTimeout(r, 1200));
    assert.strictEqual(w.isBusy('codex'), false, '조용해지면 다시 쉼');
    w.stop();
  });

  await t('서비스 조회 기록: 상태가 바뀔 때만 · 마지막 값을 유지할 때는 원인까지 · 회복도 한 줄', async () => {
    const { createReaderLogger } = require('../src/readerlog');
    const { UsageService } = require('../src/usage');
    const lines = []; const onUpdate = createReaderLogger((k, m) => lines.push(`${k}|${m}`));
    const P = [{ id: 'cursor', name: 'Cursor' }];
    const snap = (x) => ({ providers: P, data: { cursor: x } });
    onUpdate(snap({ ok: false, error: 'loading' }));                                   // 불러오는 중: 기록 안 함
    onUpdate(snap({ ok: true, windows: [] }));                                        // 정상: 기록 안 함 (처음부터 정상이면 회복도 아님)
    assert.deepStrictEqual(lines, []);
    // 실제 UsageService 경로로 만든 "멀쩡하다가 401" 상태에서 원인이 남는지
    const svc = new UsageService(async () => ({ ok: true })); const prov = svc.provider('cursor'); let n = 0;
    prov.reader = { read: async () => (n++ === 0 ? { ok: true, windows: [{ key: 'monthly', label: '월간', usedPercent: 40, resetsAt: Date.now() + 86400000 }] } : { ok: false, error: 'rejected', message: 'Cursor rejected (401)' }), lastUsed: async () => Date.now() };
    await svc.poll('cursor'); await svc.poll('cursor'); clearTimeout(prov.timer);
    const stale = svc.state.cursor; assert.strictEqual(stale.stale, true); assert.strictEqual(stale.staleReason, 'rejected');
    onUpdate(snap(stale)); onUpdate(snap(stale)); onUpdate(snap(stale));               // 같은 상태가 계속돼도 한 줄만
    assert.strictEqual(lines.length, 1); assert.match(lines[0], /^reader\|Cursor: showing last value \(rejected\) — Cursor rejected \(401\)/);
    onUpdate(snap({ ok: true, windows: [] }));
    assert.strictEqual(lines.length, 2); assert.match(lines[1], /Cursor: recovered/);
    onUpdate(snap({ ok: false, error: 'network', message: 'offline' })); onUpdate(snap({ ok: false, error: 'network', message: 'offline' }));
    assert.strictEqual(lines.length, 3); assert.match(lines[2], /Cursor: network — offline/);
    onUpdate(snap({ ok: false, error: 'expired', needsLogin: true }));                 // 로그인 필요는 오류가 아님
    assert.strictEqual(lines.length, 3);
  });

  await t('main.js 배선: 조회와 라이선스 요청이 쿠키 없는 fetch로 만들어지고, 조회 기록 로거가 연결돼 있다', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.match(src, /new UsageService\(omitCookies\(/, '사용량 조회는 omitCookies로 감싸야 함 (공용 쿠키 보관함 때문에 401이 났던 문제)');
    assert.match(src, /licenseStore\.create\(.*fetchFn: omitCookies\(/, '라이선스 요청도 마찬가지');
    assert.match(src, /usage\.on\('update', createReaderLogger\(logErr\)\)/, '조회 상태 기록 연결');
  });


  await t('Cursor 활동 감시: 전역 DB·대화 DB·최근 작업공간 DB의 WAL과 IndexedDB 로그를 짧은 간격으로 확인한다', () => {
    const os2 = require('os'), fs2 = require('fs'), path2 = require('path');
    const root = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'cur-'));
    const gs = path2.join(root, 'User', 'globalStorage'); fs2.mkdirSync(gs, { recursive: true });
    fs2.writeFileSync(path2.join(gs, 'state.vscdb'), '');
    for (const w of ['a', 'b', 'c']) { const d = path2.join(root, 'User', 'workspaceStorage', w); fs2.mkdirSync(d, { recursive: true }); fs2.writeFileSync(path2.join(d, 'state.vscdb-wal'), ''); fs2.utimesSync(path2.join(d, 'state.vscdb-wal'), new Date(), new Date(Date.now() - (w === 'a' ? 0 : w === 'b' ? 1000 : 99999999))); }
    const idb = path2.join(root, 'IndexedDB', 'vscode-file_vscode-app_0.indexeddb.leveldb'); fs2.mkdirSync(idb, { recursive: true }); fs2.writeFileSync(path2.join(idb, '000001.log'), '');
    const prev = process.env.CURSOR_STATE_DB; process.env.CURSOR_STATE_DB = path2.join(gs, 'state.vscdb');
    try {
      const f = require('../src/cursor').activityFiles().map((x) => path2.relative(root, x));
      assert.ok(f.includes('User/globalStorage/state.vscdb-wal') && f.includes('User/globalStorage/conversation-search.db-wal'));
      assert.ok(f.includes('User/workspaceStorage/a/state.vscdb-wal') && f.includes('User/workspaceStorage/b/state.vscdb-wal') && !f.includes('User/workspaceStorage/c/state.vscdb-wal'), '가장 최근 작업공간 2개만');
      assert.ok(f.includes('IndexedDB/vscode-file_vscode-app_0.indexeddb.leveldb/000001.log'));
    } finally { if (prev === undefined) delete process.env.CURSOR_STATE_DB; else process.env.CURSOR_STATE_DB = prev; }
  });

  await t('Cursor 대화 기록: 마지막 줄이 turn_ended가 아니고 최근에 바뀌었으면 일하는 중, 끝났거나 오래됐으면 아님', async () => {
    const os2 = require('os'), fs2 = require('fs'), path2 = require('path');
    const root = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'curproj-'));
    const mk = (proj, id, lines, ageMs = 0) => {
      const d = path2.join(root, proj, 'agent-transcripts', id); fs2.mkdirSync(d, { recursive: true });
      const f = path2.join(d, id + '.jsonl'); fs2.writeFileSync(f, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
      const when = new Date(Date.now() - ageMs); fs2.utimesSync(f, when, when); return f;
    };
    const user = { role: 'user', message: { content: [{ type: 'text', text: 'x' }] } };
    const asst = { role: 'assistant', message: { content: [{ type: 'text', text: 'y' }] } };
    const prev = process.env.CURSOR_PROJECTS_DIR; process.env.CURSOR_PROJECTS_DIR = root;
    try {
      const cur = require('../src/cursor');
      const working = mk('p1', 'aaa', [user, asst]);
      const ended = mk('p2', 'bbb', [user, asst, { type: 'turn_ended', status: 'success' }]);
      const stale = mk('p3', 'ccc', [user, asst], 20 * 60 * 1000);
      const partial = mk('p4', 'ddd', [user, '{"role":"assist']);
      const all = cur.recentTranscripts();
      assert.ok(all.includes(working) && all.includes(ended) && all.includes(partial), '최근 파일은 찾는다');
      assert.ok(all.includes(stale), '20분 전 파일도 후보에는 들어간다 (일하는 중인지는 5분 규칙으로 따로 거른다)');
      const old = mk('p5', 'eee', [user, asst], 3 * 3600 * 1000);
      assert.ok(!cur.recentTranscripts().includes(old), '1시간 넘게 안 바뀐 파일은 후보에서 제외');
      assert.strictEqual(cur.transcriptState([working]).working, true, '마지막 줄이 대화면 일하는 중');
      assert.strictEqual(cur.transcriptState([ended]).working, false, 'turn_ended면 끝남');
      assert.strictEqual(cur.transcriptState([stale]).working, false, '5분 넘게 안 바뀌면 멈춘 것');
      assert.strictEqual(cur.transcriptState([partial]).working, true, '덜 써진 줄은 아직 일하는 중');
      assert.strictEqual(cur.transcriptState([ended, working]).working, true, '하나라도 일하면 일하는 중');
      // 끝난 뒤 새 턴이 시작되면(파일이 바뀌면) 다시 일하는 중
      const cache = new Map();
      assert.strictEqual(cur.transcriptState([ended], Date.now(), cache).working, false);
      fs2.appendFileSync(ended, JSON.stringify(user) + '\n');
      assert.strictEqual(cur.transcriptState([ended], Date.now(), cache).working, true, '캐시가 있어도 파일이 바뀌면 다시 읽는다');
      // 감시기: 상태 신호가 일하는 중이면 minEvents와 상관없이 바로 busy, 끝나면 idleMs 뒤 해제
      const { ActivityWatcher } = require('../src/watch');
      const w = new ActivityWatcher({ cursor: { paths: [], minEvents: 99, idleMs: 400, stateEvery: 60, stateRefreshMs: 60,
        stateProbe: { files: async () => cur.recentTranscripts(), state: (f, n, c) => cur.transcriptState(f, n, c) } } });
      const seen = []; w.on('change', (_i, b) => seen.push(b));
      fs2.writeFileSync(ended, [user, asst, { type: 'turn_ended', status: 'success' }].map((l) => JSON.stringify(l)).join('\n') + '\n');
      for (const f of [stale, partial, working]) fs2.rmSync(f);
      w.start();
      await new Promise((r) => setTimeout(r, 300));
      assert.deepStrictEqual(seen, [], '모두 끝났으면 busy가 안 된다');
      fs2.appendFileSync(ended, JSON.stringify(user) + '\n');
      await new Promise((r) => setTimeout(r, 300));
      assert.strictEqual(w.isBusy('cursor'), true, '새 턴이 시작되면 바로 busy');
      fs2.appendFileSync(ended, JSON.stringify({ type: 'turn_ended', status: 'success' }) + '\n');
      await new Promise((r) => setTimeout(r, 2700));
      assert.strictEqual(w.isBusy('cursor'), false, '턴이 끝나고 조용해지면 해제');
      w.stop();
    } finally { if (prev === undefined) delete process.env.CURSOR_PROJECTS_DIR; else process.env.CURSOR_PROJECTS_DIR = prev; }
  });

  await t('경험치: 서버가 잠깐 준 이상한 값(전부 0% → 실제 값)은 세지 않고, 정상 사용 · 진짜 리셋은 그대로 인정', async () => {
    const pg2 = require('../src/progress'); const { UsageService } = require('../src/usage');
    const R1 = Date.now() + 10 * 86400000, R2 = R1 + 30 * 86400000; // 리셋까지 10일: BURNING TIME(리셋 3일 이내 + 20% 이상 남음, 경험치 2배)이 아닌 평소 상태
    const W = (key, used, reset = R1) => ({ key, label: key, usedPercent: used, resetsAt: reset });
    const ok = (m, a, reset) => ({ ok: true, windows: [W('monthly', m, reset), W('auto', a, reset)] });
    const run = async (seq) => {
      const svc = new UsageService(async () => ({ ok: true }), { progress: pg2.createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'xpv-'))) });
      const prov = svc.provider('cursor'); let i = 0; const anomalies = []; svc.on('anomaly', (a) => anomalies.push(a.kind));
      prov.reader = { read: async () => seq[Math.min(i++, seq.length - 1)], lastUsed: async () => Date.now() };
      const shown = [];
      for (let k = 0; k < seq.length; k++) { await svc.poll('cursor'); clearTimeout(prov.timer); shown.push(svc.state.cursor.windows && svc.state.cursor.windows[0] && Math.round(svc.state.cursor.windows[0].usedPercent)); }
      return { xp: svc.progress.get('cursor').xp || 0, anomalies, shown, state: svc.state.cursor };
    };
    // 이상한 값: 처음 읽은 값이 0%였다가 실제 값(42%)이 오는 경우 → 이미 있던 사용량을 새로 쓴 것으로 세면 안 됨
    let r = await run([ok(0, 0), ok(42, 44)]); assert.strictEqual(r.xp, 0); assert.deepStrictEqual(r.anomalies, ['jump']);
    // 멀쩡하다가 한 번 0%로 읽힌 경우: 한 번은 건너뛰고(화면은 마지막 값 유지), 경험치도 0
    r = await run([ok(42, 44), ok(0, 0), ok(42, 44)]); assert.strictEqual(r.xp, 0); assert.deepStrictEqual(r.shown, [42, 42, 42]); assert.ok(r.anomalies.includes('drop'));
    // 같은 낮은 값이 두 번 연속이면 진짜로 받아들인다
    r = await run([ok(42, 44), ok(10, 10), ok(10, 10)]); assert.strictEqual(r.shown[1], 42); assert.strictEqual(r.shown[2], 10); assert.strictEqual(r.xp, 0);
    // 진짜 리셋(리셋 시각이 바뀜)은 바로 인정: 80% → 새 주기 0%
    r = await run([ok(80, 80, R1), ok(0, 0, R2)]); assert.strictEqual(r.shown[1], 0); assert.ok(!r.anomalies.includes('drop'));
    // 정상 사용: 40% → 42% 는 2%p × 1500 = 3000 XP (월간 가중치)
    r = await run([ok(40, 40), ok(42, 41)]); assert.strictEqual(r.xp, 3000); assert.deepStrictEqual(r.anomalies, []);
    // 오류 → 정상 복구는 경험치 0, 상한: 25%p 이하의 큰 증가는 그대로 인정 (밤새 쓴 경우)
    r = await run([{ ok: false, error: 'expired', message: 'x' }, ok(30, 30), ok(52, 52)]); assert.strictEqual(r.xp, 22 * 1500);
    assert.strictEqual(pg2.xpGain({ ok: true, windows: [W('fiveHour', 0)] }, { ok: true, windows: [W('fiveHour', 60)] }), 6000, '5시간 창은 상한 없음');
    assert.strictEqual(pg2.xpGain({ ok: true, windows: [W('weekly', 10)] }, { ok: true, windows: [W('weekly', 60)] }), 0, '주간 +50%p는 이상한 값');
  });


  console.log(`\n${pass} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
