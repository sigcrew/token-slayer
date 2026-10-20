// 여러 서비스(공급자)의 사용량을 각자 주기로 읽어서 하나의 스냅샷으로 합친다.
//
// 새 서비스를 추가하려면 PROVIDERS에 한 줄 추가하면 된다:
//   id, 이름, 색, 조회 주기(ms), reader(read()가 { ok, windows|fiveHour/weekly, needsLogin, message }를 돌려줌)
//   login: 로그인 버튼 동작 ('terminal' + 명령어, 'app' + 열 앱 이름, 'web' = 앱 안 로그인 창)
const { EventEmitter } = require('events');
const { ClaudeReader } = require('./claude');
const { CodexReader } = require('./codex');
const { CursorReader } = require('./cursor');
const { AntigravityReader } = require('./antigravity');
const agMod = require('./antigravity');
const activity = require('./activity');
const progress = require('./progress');
const { Forecaster, HpAlarm } = require('./forecast');
const os = require('os');
const path = require('path');
const { codexHome, activeRolloutFiles, recentDesktopLogs } = require('./codex');
const cursorMod = require('./cursor');

const DROP_BUSY_MS = 90000; // 사용량이 줄어든 뒤 이만큼은 '싸우는 중'으로 봄

// 실시간 감시 대상: 에이전트가 일할 때 쓰는 파일
function watchTargets() {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const desk = activity.appSupport('Claude');
  return {
    // Codex는 열린 세션 파일에 계속 덧붙여 써서 파일 알림이 안 오는 경우가 있음 → 최근 세션 파일을 1.5초마다 직접 확인
    codex: {
      paths: [{ dir: path.join(codexHome(), 'sessions'), recursive: true, match: (f) => /\.jsonl$/.test(f) }],
      // 세션 파일 외에, ChatGPT 앱의 Codex(dot 등)가 일할 때만 바뀌는 로그 파일(맥)도 같이 확인한다 (쉴 때는 조용함)
      probe: async () => [...(await activeRolloutFiles()), ...recentDesktopLogs()], probeEvery: 1500, probeRefreshMs: 10000,
      idleMs: 60000, // dot 같은 에이전트는 모델 응답을 기다리느라 40초쯤 조용할 때가 있어서 30초면 중간에 쉬는 모습이 나온다
    },
    claude: {
      paths: [
        { dir: path.join(claudeDir, 'projects'), recursive: true, match: (f) => /\.jsonl$/.test(f) }, // Claude Code 대화 기록
        // 데스크톱 앱 대화 저장소: 대화 내용이 저장되는 blob과 쓰기 로그 (LOCK·MANIFEST 등 정리 파일은 무시)
        // 앱이 대화와 상관없이 5분마다 blob 2개를 혼자 쓴다 → 10초 안에 3번 이상 몰려서 바뀔 때만 인정
        { dir: path.join(desk, 'IndexedDB'), recursive: true, match: (f) => /indexeddb\.blob|\.log$/.test(f), minEvents: 3, windowMs: 10000 },
      ],
      idleMs: 45000,    // 대화 중에도 저장은 띄엄띄엄 일어나서 조금 길게
      minEvents: 1,
    },
    cursor: {
      paths: [{ dir: path.dirname(cursorMod.dbPath()), match: (f) => /^state\.vscdb/.test(f) }],
      idleMs: 30000,
      minEvents: 3,   // Cursor는 AI를 안 쓸 때도 가끔(30초에 1번쯤) 파일을 건드려서, 몰려서 바뀔 때만 인정
      windowMs: 15000,
      probe: async () => cursorMod.activityFiles(), probeEvery: 1500, probeRefreshMs: 10000,
      // 가장 믿을 만한 신호: 에이전트 대화 기록의 마지막 줄이 turn_ended가 아니고 최근에 바뀌었으면 일하는 중
      stateProbe: { files: async () => cursorMod.recentTranscripts(), state: (files, now, cache) => cursorMod.transcriptState(files, now, cache) },
    },
    // Antigravity: 일하는 동안 대화 기록(transcript.jsonl)과 대화 DB(WAL)가 몇 초마다 바뀌고, 쉬면 멈춘다
    antigravity: {
      paths: [],
      probe: async () => agMod.activityFiles(), probeEvery: 1500, probeRefreshMs: 10000,
      idleMs: 30000,
      minEvents: 1,
    },
  };
}

const PROVIDERS = [
  // Claude: Claude Code 로그인이 있으면 그걸, 없으면 앱 안의 claude.ai 로그인 창 세션을 쓴다
  { id: 'claude', name: 'Claude', color: '#E07A5F', every: 60000, busyEvery: 20000, make: (f, ctx) => new ClaudeReader(f, ctx.claudeWeb),
    login: { type: 'web', label: '로그인하기' } },
  { id: 'codex', name: 'Codex', color: '#6C8CFF', every: 5000, busyFromActivity: true, make: (f) => new CodexReader(f),
    login: { type: 'terminal', cmd: 'codex login', label: '로그인하기', hint: '브라우저가 열리면 ChatGPT 계정으로 로그인하세요.', install: 'Codex CLI를 먼저 설치해 주세요: npm i -g @openai/codex' } },
  { id: 'cursor', name: 'Cursor', color: '#B98CFF', every: 120000, busyEvery: 40000, make: (f) => new CursorReader(f),
    login: { type: 'app', app: 'Cursor', label: 'Cursor 열기' } },
  // Antigravity(Google): 공식 CLI(agy)의 사용량 보고를 실행해서 읽는다. 프로세스를 띄우는 비용이 있어 조회 간격을 길게
  { id: 'antigravity', name: 'Antigravity', color: '#3FCF8E', every: 300000, busyEvery: 120000, make: () => new AntigravityReader(),
    login: { type: 'terminal', cmd: 'agy', label: '로그인하기', hint: 'Google 계정으로 로그인하세요.', install: 'Antigravity CLI를 먼저 설치해 주세요: brew install --cask antigravity-cli' } },
];

// HP·GAME OVER·경고·바닥 예측은 서비스 전체 한도(5시간·주간·월간)로만 판단한다.
// Opus·Sonnet 전용 주간 한도는 그 모델만 막힌 것이라 죽음으로 치지 않는다 (패널에는 계속 보이고, BURNING TIME에는 반영됨)
const MODEL_WINDOW = /^weekly(Opus|Sonnet)$/;
// basis: 'auto'는 남은 게 가장 적은 창, 'fiveHour'는 5시간(짧은 창)만, 'weekly'는 주간·월간(긴 창)만. 해당하는 창이 없으면 자동으로 돌아간다
// 서비스별 설정 { claude: 'weekly' } 에서 그 서비스의 기준 (예전처럼 문자열 하나여도 받아 줌)
function basisFor(map, id) {
  if (typeof map === 'string') return map;
  return (map && map[id]) || 'auto';
}
// 5시간처럼 짧은 창과 주간·월간처럼 긴 창이 둘 다 있어서 기준을 고를 수 있는 서비스인지
function hasBasisChoice(windows) {
  const base = hpWindows(windows, 'auto');
  return base.some((w) => progress.windowMinutes(w) <= 600) && base.some((w) => progress.windowMinutes(w) > 600);
}
function hpWindows(windows, basis = 'auto') {
  const all = windows || [];
  const main = all.filter((w) => !MODEL_WINDOW.test(w.key));
  const base = main.length ? main : all;
  if (basis === 'fiveHour' || basis === 'weekly') {
    const pick = base.filter((w) => (progress.windowMinutes(w) <= 600) === (basis === 'fiveHour'));
    if (pick.length) return pick;
  }
  return base;
}

const LABELS = { fiveHour: '5시간', weekly: '주간', weeklyOpus: 'Opus 주간', weeklySonnet: 'Sonnet 주간' };
const BACKOFF = 5 * 60000;

// 리셋 시간이 지난 창은 0% 사용으로
function applyReset(w, now) {
  if (w && w.resetsAt && now >= w.resetsAt) return { ...w, usedPercent: 0, resetsAt: null, resetPassed: true };
  return w;
}

// 공급자별 결과를 공통 형태 { windows: [{ key, label, usedPercent, resetsAt }] } 로 맞춘다
function normalize(r) {
  if (!r || !r.ok) return r;
  if (Array.isArray(r.windows)) return r;
  const windows = [];
  for (const key of Object.keys(LABELS)) {
    if (r[key]) windows.push({ key, label: LABELS[key], ...r[key] });
  }
  return { ...r, windows };
}

class UsageService extends EventEmitter {
  // ctx: 환경별 부가 기능 (예: { claudeWeb } — Electron에서만)
  constructor(fetchFn, ctx = {}) {
    super();
    this.progress = ctx.progress || null; // 레벨·경험치 저장소 (없으면 레벨 기능 끔)
    this.watcher = ctx.watcher || null;   // 실시간 파일 감시 (없으면 조회 때만 판단)
    this.forecaster = new Forecaster();   // 바닥 예측
    this.hpAlarm = new HpAlarm();         // HP 20% · 10% 경고
    if (this.watcher) this.watcher.on('change', (id, busy) => this.onActivity(id, busy));
    this.providers = PROVIDERS.map((p) => ({ ...p, reader: p.make(fetchFn, ctx), timer: null }));
    this.hpBasis = {};                    // 서비스별 HP 기준 (설정에서 바뀜)
    this.state = {};
    for (const p of this.providers) this.state[p.id] = { ok: false, error: 'loading', message: '불러오는 중…' };
  }

  meta() {
    return this.providers.map((p) => ({ id: p.id, name: p.name, color: p.color, loginLabel: p.login && p.login.label }));
  }

  provider(id) { return this.providers.find((p) => p.id === id); }

  snapshot() { return { providers: this.meta(), data: this.state, at: Date.now() }; }

  emitUpdate() { this.emit('update', this.snapshot()); }

  async poll(id) {
    const p = this.provider(id);
    if (!p) return;
    clearTimeout(p.timer);
    let next = p.every;
    const prev = this.state[id];
    try {
      const r = normalize(await p.reader.read());
      // 최근 30일 안에 썼는지: 파일 기록 + 이번 한도 기간에 사용량이 있으면 사용 중으로 봄
      let last = null;
      try { last = p.reader.lastUsed ? await p.reader.lastUsed() : null; } catch {}
      // 지금 일하는 중인지: 기록 파일이 1분 안에 바뀌었으면 (Codex처럼 실시간 기록이 남는 서비스만)
      r.busy = !!(p.busyFromActivity && last && Date.now() - last < 30000);
      r.busyWhy = r.busy ? ['기록 파일 30초 이내'] : [];
      // 앱 사용 흔적으로 '지금 쓰는 중' 판단 (Claude 데스크톱 앱 등)
      // (실시간 감시가 켜져 있으면 그쪽만 믿는다 — 조회 때 파일 시각을 보면 스스로 계속 '바쁨'이 되는 문제가 있었음)
      if (!r.busy && p.reader.activityAt && !(this.watcher && this.watcher.isWatching(id))) {
        try { const t = await p.reader.activityAt(); r.busy = !!(t && Date.now() - t < 30000); if (r.busy) r.busyWhy.push('앱 파일 30초 이내'); } catch {}
      }
      // 사용량이 줄었으면 한동안 '쓰는 중'
      const dropped = prev && prev.ok && r.ok && prev.windows && r.windows
        && r.windows.some((w) => { const o = prev.windows.find((x) => x.key === w.key); return o && w.usedPercent > o.usedPercent; });
      if (dropped) p.lastDropAt = Date.now();
      // 실시간 감시가 되는 서비스는 감시 결과만 믿음 (서버 수치는 늦게 줄어서, 일이 끝난 뒤에도 계속 싸우게 됨)
      const watched = !!(this.watcher && this.watcher.isWatching(id));
      r.watched = watched;
      if (!watched && p.lastDropAt && Date.now() - p.lastDropAt < DROP_BUSY_MS) { r.busy = true; r.busyWhy.push('사용량 감소 90초 이내'); }
      if (this.watcher && this.watcher.isBusy(id)) { r.busy = true; r.busyWhy.push('실시간 감시'); }
      if (this.watcher) r.activityAt = this.watcher.lastAt(id);
      if (r.ok && r.windows && r.windows.some((w) => w.usedPercent > 0)) last = Date.now();
      r.lastUsedAt = last || (prev && prev.lastUsedAt) || null;
      r.active = activity.isActive(r.lastUsedAt);
      // 같은 한도 주기에서 사용률이 크게 줄어든 읽기는 한 번은 건너뛴다 (서버가 잠깐 이상한 값을 준 것일 수 있다). 다음에도 그대로면 받아들인다
      const drop = r.ok && prev && prev.ok ? progress.suspiciousDrop(prev, r) : null;
      let held = false;
      if (drop) {
        if (p.heldAt && Date.now() - p.heldAt < 10 * 60000) p.heldAt = null; // 두 번 연속이면 진짜
        else { p.heldAt = Date.now(); held = true; }
      } else p.heldAt = null;
      if (held) {
        const now = Date.now();
        this.state[id] = { ...prev, windows: prev.windows.map((w) => applyReset(w, now)), stale: true, staleReason: 'implausible-drop', staleMessage: `${drop.key} ${drop.from}% → ${drop.to}% (ignored once)`, lastUsedAt: r.lastUsedAt, active: r.active };
        this.emit('anomaly', { id, name: p.name, kind: 'drop', ...drop });
      } else if (!r.ok && prev.ok && (r.error === 'network' || r.error === 'rate-limited' || r.error === 'rejected' || r.error === 'keychain' || (r.error === 'expired' && !r.needsLogin))) {
        // 일시적 오류면 마지막 값을 유지 (리셋 시간만 반영)
        const now = Date.now();
        this.state[id] = { ...prev, windows: prev.windows.map((w) => applyReset(w, now)), stale: true, staleReason: r.error, staleMessage: r.message, lastUsedAt: r.lastUsedAt, active: r.active };
      } else this.state[id] = r;
      if (!held) this.applyProgress(id, p, prev, this.state[id], r);
      if (r.busy && p.busyEvery) next = p.busyEvery; // 쓰는 중이면 더 자주 확인
      if (r.error === 'rate-limited' || r.error === 'not-installed') next = Math.max(next, BACKOFF);
    } catch (e) {
      this.state[id] = { ok: false, error: 'internal', message: String((e && e.message) || e) };
    }
    this.emitUpdate();
    p.timer = setTimeout(() => this.poll(id), next);
  }

  // 경험치 적립 · 레벨 정보 · BURNING TIME 판단을 결과에 붙인다
  applyProgress(id, p, prev, cur, fresh) {
    const burn = cur.ok ? progress.burning(cur.windows) : null;
    cur.burning = burn;
    // 바닥 예측 + HP 경고
    if (fresh && fresh.ok && !cur.stale) this.forecaster.add(id, cur.windows);
    cur.forecast = cur.ok ? this.forecaster.predict(id, hpWindows(cur.windows, basisFor(this.hpBasis, id))) : null;
    if (cur.ok && cur.windows && cur.windows.length) {
      const remaining = Math.min(...hpWindows(cur.windows, basisFor(this.hpBasis, id)).map((w) => 100 - w.usedPercent));
      const th = this.hpAlarm.check(id, remaining);
      if (th) this.emit('hpwarn', { id, name: p.name, threshold: th, remaining: Math.round(remaining), forecast: cur.forecast });
    }
    if (this.progress) {
      this.progress.markRunDay();
      let windowEnded = false;
      // 흔들리는 값이 다시 올라오는 것은 안 셈 + 한도 창이 끝날 때의 최종 사용률 기록 (쓰는 서비스만)
      const base = progress.ratchetPrev(p.peaks || (p.peaks = {}), prev, fresh, (key, e) => {
        if (!cur.active || !['weekly', 'monthly'].includes(key)) return; // 5시간 창·모델별 창은 기록하지 않음 (기록이 넘치고 뜻이 달라서)
        this.progress.addWindowEnd(id, key, e.max, e.mins);
        windowEnded = true;
        // BURNING TIME에 들어간 창이면: 그때 남은 한도의 80% 이상을 리셋 전에 태웠는지
        const be = p.burnEntry;
        if (be && be.key === key) {
          const atEntry = 100 - be.remaining;
          if (be.remaining > 0 && (e.max - atEntry) / be.remaining >= 0.8) this.progress.flag('burnHunter');
          p.burnEntry = null;
        }
      });
      const jump = progress.implausibleJump(base, fresh);
      if (jump) this.emit('anomaly', { id, name: p.name, kind: 'jump', delta: Math.round(jump) });
      const gain = progress.usageGain(base, fresh);
      const burningNow = !!(burn || (prev && prev.burning));
      if (gain > 0) {
        const mult = burningNow ? progress.BURN_MULT : 1;
        const res = this.progress.addXp(id, progress.xpGain(base, fresh) * mult);
        this.progress.addUsage(id, gain, { burning: burningNow });
        if (res.after > res.before) this.emit('levelup', { id, name: p.name, level: res.after });
      }
      // GAME OVER / 부활 기록 (가장 적게 남은 한도 기준)
      const eff = (x) => (x && x.ok && x.windows && x.windows.length ? Math.min(...hpWindows(x.windows, basisFor(this.hpBasis, id)).map((w) => 100 - w.usedPercent)) : null);
      // 이전 값도 '같은 창에서 본 최고 사용률' 기준으로: 99↔100처럼 흔들려도 GAME OVER·부활을 여러 번 세지 않음
      const a = eff(base), b = eff(fresh);
      if (a != null && b != null) {
        if (a > 0.5 && b <= 0.5) {
          this.progress.count('gameOvers');
          this.progress.addToSet('gameOverDays', progress.dayKey());
          if (burningNow) this.progress.flag('fullBurn');
          // 스피드런: 리셋(부활) 뒤 1시간 안에 GAME OVER
          if (p.lastResetAt && Date.now() - p.lastResetAt < 3600e3) this.progress.flag('speedrun');
        }
        if (a <= 0.5 && b >= 5) {
          this.progress.count('revives');
          if (this.progress.countDay('revivesByDay') >= 3) this.progress.flag('revive3');
        }
        if (b - a >= 20) {
          p.lastResetAt = Date.now(); // 크게 회복 = 리셋
          // 꽤 쓰던 한도가 다시 차면 알려 준다 (거의 안 쓴 한도의 리셋은 소식이 아니라 제외, 30분 안 중복 제외)
          if (a <= 70 && !(p.lastResetNoticeAt && Date.now() - p.lastResetNoticeAt < 30 * 60000)) {
            p.lastResetNoticeAt = Date.now();
            this.emit('reset', { id, name: p.name, before: Math.round(a), after: Math.round(b) });
          }
        }
        // 구사일생: 5% 아래로 버티다가 GAME OVER 없이 리셋
        if (a > 0.5 && a < 5 && b >= 50) this.progress.count('clutches');
      }
      // 얼음 용사: HP 100%로 5시간 동안 한 번도 안 씀 (앱이 켜져 있는 동안)
      if (b === 100) {
        p.fullSince = p.fullSince || Date.now();
        if (Date.now() - p.fullSince >= 5 * 3600e3) { this.progress.flag('iceHero'); }
      } else if (b != null) p.fullSince = null;
      // BURNING TIME 개근: 켜질 때마다 그 안에 사용했는지 연속으로 셈
      if (burn && gain > 0) p.burnUsed = true;
      if (prev && prev.burning && !burn) {
        const st = this.progress.stats();
        const n = p.burnUsed ? (st.burnStreak || 0) + 1 : 0;
        this.progress.set('burnStreak', n);
        if (n >= 5) this.progress.flag('burnStreak5');
        p.burnUsed = false;
      }
      if (gain > 0 || windowEnded || (a != null && b != null && a !== b) || (prev && prev.burning && !burn)) this.emit('stats');
      const info = progress.levelInfo(this.progress.get(id).xp || 0);
      cur.level = info.level;
      cur.levelProgress = info.progress;
      cur.xp = info.xp;
    }
    if (burn && !(prev && prev.burning)) { p.burnEntry = { key: burn.key, remaining: burn.remaining }; this.emit('burning', { id, name: p.name, ...burn }); }
  }

  // 파일 감시가 '일 시작/멈춤'을 알려오면 바로 반영. 시작이면 사용량도 곧바로 한 번 조회
  onActivity(id, busy) {
    const cur = this.state[id];
    const p = this.provider(id);
    if (!cur || !p) return;
    const now = Date.now();
    const dropBusy = !this.watcher.isWatching(id) && p.lastDropAt && now - p.lastDropAt < DROP_BUSY_MS;
    cur.busy = busy || !!dropBusy;
    cur.busyWhy = busy ? ['실시간 감시'] : [];
    cur.activityAt = this.watcher.lastAt(id);
    this.emitUpdate();
    if (busy && (!p.lastQuickPoll || now - p.lastQuickPoll > 15000)) {
      p.lastQuickPoll = now;
      clearTimeout(p.timer);
      p.timer = setTimeout(() => this.poll(id), 2000);
    }
  }

  start() {
    if (this.watcher) this.watcher.start();
    for (const p of this.providers) this.poll(p.id);
  }

  refresh() { for (const p of this.providers) this.poll(p.id); }

  // 로그인 창을 연 뒤에는 로그인이 끝날 때까지 10초마다 다시 확인 (최대 5분)
  watchLogin(id) {
    clearInterval(this.loginTimer);
    const until = Date.now() + 5 * 60000;
    this.loginTimer = setInterval(() => {
      const cur = this.state[id];
      if (Date.now() > until || (cur && !cur.needsLogin)) { clearInterval(this.loginTimer); return; }
      const p = this.provider(id);
      if (p && p.reader.authAt != null) p.reader.authAt = 0; // Codex 로그인 캐시 무효화
      this.poll(id);
    }, 10000);
  }

  stop() {
    if (this.watcher) this.watcher.stop();
    clearInterval(this.loginTimer);
    for (const p of this.providers) clearTimeout(p.timer);
  }
}

module.exports = { UsageService, PROVIDERS, normalize, watchTargets, hpWindows, basisFor, hasBasisChoice };
