// 사용 통계: 에이전트들이 이 컴퓨터에 남긴 기록에서 "토큰 수 · 시각 · 모델 · 작업 폴더 이름"만 읽어 집계한다.
// 대화 내용은 읽지 않는다 (줄에 토큰 기록 표시가 있을 때만 JSON을 풀고, 그 안에서도 숫자와 모델 이름만 꺼낸다).
//
//  - Claude Code: ~/.claude/projects/*/*.jsonl  (응답마다 message.usage · message.model · timestamp · cwd)
//  - Codex:       ~/.codex/sessions/**/rollout-*.jsonl(.zst)  (token_usage_record 또는 예전 token_count · turn_context.model · session_meta)
//  - Antigravity: ~/.gemini/antigravity-cli/brain/*/.system_generated/logs/transcript.jsonl  (단계마다 토큰 수)
//
// 파일마다 "시간(1시간) × 모델 × 프로젝트 × 실행 방식" 단위로 줄여서 캐시하고, 다음에는 늘어난 부분만 이어서 읽는다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const CACHE_VERSION = 2; // 2: 작업용 임시 폴더(worktree)를 원래 프로젝트 이름으로 합침

const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const codexDir = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const agHome = () => process.env.ANTIGRAVITY_HOME || path.join(os.homedir(), '.gemini', 'antigravity-cli');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const hourOf = (ms) => { const d = new Date(ms); d.setMinutes(0, 0, 0); return d.getTime(); };
// 작업 폴더 → 프로젝트 이름. 에이전트가 만든 임시 작업 폴더(worktree)는 원래 저장소 이름으로 합친다
//   …/my-app/.claude/worktrees/keen-rhodes-ce5e39 → my-app · ~/.codex/worktrees/<id>/my-app → my-app
function projectOf(cwd) {
  if (!cwd) return '';
  const s = String(cwd).replace(/\\/g, '/').replace(/\/+$/, '');
  let m = s.match(/^(.*)\/\.claude\/worktrees\/[^/]+/);
  if (m) return path.posix.basename(m[1]) || '/';
  m = s.match(/\/\.codex\/worktrees\/[^/]+\/([^/]+)/);
  if (m) return m[1];
  return path.posix.basename(s) || '/';
}
// 저장소 주소 → 이름 (https://github.com/a/my-app.git → my-app)
const repoName = (url) => { const m = String(url || '').match(/([^/:]+?)(?:\.git)?\/?$/); return m ? m[1] : ''; };

// ── 파일 하나를 읽는 동안 쓰는 집계기 ──
function newAcc(agent) {
  return { agent, rows: {}, first: 0, last: 0, n: 0, project: '', src: '', model: '', seen: new Set() };
}
function add(acc, t, { model, project, src, inT = 0, out = 0, cacheR = 0, cacheW = 0, reason = 0 }) {
  if (!t || !(inT || out || cacheR || cacheW)) return;
  const key = `${hourOf(t)}|${model || ''}|${project || ''}|${src || ''}`;
  const r = acc.rows[key] || (acc.rows[key] = { in: 0, out: 0, cr: 0, cw: 0, rs: 0, n: 0 });
  r.in += inT; r.out += out; r.cr += cacheR; r.cw += cacheW; r.rs += reason; r.n += 1;
  acc.n += 1;
  if (!acc.first || t < acc.first) acc.first = t;
  if (t > acc.last) acc.last = t;
}

// ── 줄 해석 (줄마다 호출) ──
function claudeLine(acc, line) {
  if (line.indexOf('"usage"') === -1 || line.indexOf('"assistant"') === -1) return;
  let d; try { d = JSON.parse(line); } catch { return; }
  const m = d && d.message;
  if (!m || typeof m !== 'object' || !m.usage) return;
  // 한 응답이 여러 줄로 나뉘어 같은 사용량이 반복 기록되므로 응답 id로 한 번만 센다
  const id = `${m.id || ''}:${d.requestId || ''}`;
  if (id !== ':') { if (acc.seen.has(id)) return; acc.seen.add(id); }
  const t = Date.parse(d.timestamp);
  if (Number.isNaN(t)) return;
  const u = m.usage;
  if (d.cwd && !acc.project) acc.project = projectOf(d.cwd);
  add(acc, t, { model: m.model || '', project: projectOf(d.cwd) || acc.project, src: d.entrypoint || '',
    inT: num(u.input_tokens), out: num(u.output_tokens), cacheR: num(u.cache_read_input_tokens), cacheW: num(u.cache_creation_input_tokens) });
}

function codexSrc(meta) {
  const o = String(meta.originator || ''), s = String(meta.source || '');
  if (s === 'exec' || o === 'codex_exec') return 'exec';
  if (/desktop|vscode|ide/i.test(o + ' ' + s)) return 'app';
  return 'cli';
}
function codexLine(acc, line) {
  const isRec = line.indexOf('token_usage_record') !== -1;
  const isCount = !isRec && line.indexOf('"token_count"') !== -1;
  const isCtx = line.indexOf('"turn_context"') !== -1;
  const isMeta = !acc.metaDone && line.indexOf('"session_meta"') !== -1;
  if (!isRec && !isCount && !isCtx && !isMeta) return;
  let d; try { d = JSON.parse(line); } catch { return; }
  const p = (d && d.payload) || {};
  if (d.type === 'session_meta') {
    acc.metaDone = true;
    // 저장소 정보가 있으면 그 이름을 쓴다 (도구가 만든 임시 폴더 이름보다 정확)
    acc.repo = repoName(p.git && p.git.repository_url);
    acc.project = acc.repo || projectOf(p.cwd);
    acc.src = codexSrc(p);
    return;
  }
  if (d.type === 'turn_context') { if (p.model) acc.model = p.model; if (p.cwd && !acc.repo) acc.project = projectOf(p.cwd); return; }
  const t = Date.parse(d.timestamp);
  if (Number.isNaN(t)) return;
  const take = (u) => {
    // Codex의 input_tokens에는 캐시에서 읽은 토큰이 포함돼 있다 → 새 입력 = input - cached
    const cached = num(u.cached_input_tokens);
    add(acc, t, { model: acc.model, project: acc.project, src: acc.src, inT: Math.max(0, num(u.input_tokens) - cached), out: num(u.output_tokens), cacheR: cached, cacheW: num(u.cache_write_input_tokens), reason: num(u.reasoning_output_tokens) });
  };
  if (d.type === 'token_usage_record' && p.usage) { acc.hasRecords = true; take(p.usage); return; }
  // 예전 형식: token_count 이벤트. 누적값이 늘었을 때만 마지막 사용량을 더한다 (사용량 없이 한도만 알려 주는 이벤트도 있음)
  if (isCount && !acc.hasRecords && p.type === 'token_count' && p.info && p.info.last_token_usage) {
    const total = num(p.info.total_token_usage && p.info.total_token_usage.total_tokens);
    if (total && total <= (acc.prevTotal || 0)) return;
    acc.prevTotal = total;
    take(p.info.last_token_usage);
  }
}

function antigravityLine(acc, line) {
  if (line.indexOf('_tokens') === -1) return;
  let d; try { d = JSON.parse(line); } catch { return; }
  const t = Date.parse(d && d.created_at);
  if (Number.isNaN(t)) return;
  add(acc, t, { model: d.model || '', project: '', src: '', inT: num(d.input_tokens), out: num(d.output_tokens), cacheR: num(d.cache_read_tokens) });
}

const PARSERS = { claude: claudeLine, codex: codexLine, antigravity: antigravityLine };

// ── 기록 파일 목록 ──
async function walk(dir, filter, depth = 4, out = []) {
  let ents;
  try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) await walk(f, filter, depth - 1, out); }
    else if (filter(e.name, f)) out.push(f);
  }
  return out;
}
async function listFiles() {
  const out = [];
  for (const f of await walk(path.join(claudeDir(), 'projects'), (n) => n.endsWith('.jsonl'), 3)) out.push({ agent: 'claude', f });
  for (const f of await walk(path.join(codexDir(), 'sessions'), (n) => n.startsWith('rollout-') && (n.endsWith('.jsonl') || n.endsWith('.jsonl.zst')), 4)) out.push({ agent: 'codex', f });
  for (const f of await walk(path.join(agHome(), 'brain'), (n, f) => n === 'transcript.jsonl' && /\.system_generated[\\/]logs[\\/]transcript\.jsonl$/.test(f), 4)) out.push({ agent: 'antigravity', f });
  return out;
}

// ── 파일 하나 읽기 (이어 읽기 지원) ──
// prev: 이전 캐시 항목. 같은 파일이 뒤에 덧붙기만 했으면 offset부터 이어서 읽는다
async function readFile(agent, f, st, prev) {
  const parse = PARSERS[agent];
  const acc = newAcc(agent);
  let start = 0;
  const appendOk = prev && !f.endsWith('.zst') && prev.ino === st.ino && st.size > prev.size && prev.offset > 0 && prev.state;
  if (appendOk) {
    // 이전 집계와 상태(모델 · 프로젝트 · 중복 확인용 id 일부)를 이어받는다
    acc.rows = JSON.parse(JSON.stringify(prev.rows || {}));
    Object.assign(acc, { first: prev.first, last: prev.last, n: prev.n, project: prev.project, src: prev.src, model: prev.state.model || '', repo: prev.state.repo || '',
      metaDone: !!prev.state.metaDone, hasRecords: !!prev.state.hasRecords, prevTotal: prev.state.prevTotal || 0 });
    for (const id of prev.state.seen || []) acc.seen.add(id);
    start = prev.offset;
  }
  if (f.endsWith('.zst')) {
    if (typeof zlib.zstdDecompressSync !== 'function') return null;
    let text;
    try { text = zlib.zstdDecompressSync(await fs.promises.readFile(f)).toString('utf8'); } catch { return null; }
    for (const line of text.split('\n')) if (line) parse(acc, line);
    return finish(acc, st, st.size);
  }
  // 마지막 줄이 아직 덜 써졌을 수 있어서, 끝까지 읽은 위치가 아니라 "마지막 줄바꿈 다음"을 offset으로 남긴다
  let endsWithNewline = false;
  try {
    const fd = await fs.promises.open(f, 'r');
    const b = Buffer.alloc(1);
    await fd.read(b, 0, 1, st.size - 1);
    await fd.close();
    endsWithNewline = b[0] === 10;
  } catch {}
  let offset = start;
  await new Promise((resolve) => {
    const stream = fs.createReadStream(f, { start, end: st.size - 1 });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let pos = start, pending = null;
    // 한 줄 늦게 처리한다: 마지막 줄은 줄바꿈으로 끝났을 때만(= 다 써진 줄) 읽고, 아니면 다음에 이어 읽는다
    rl.on('line', (line) => {
      if (pending !== null) { parse(acc, pending); offset = pos; }
      pos += Buffer.byteLength(line, 'utf8') + 1;
      pending = line;
    });
    rl.on('close', () => {
      if (pending !== null && endsWithNewline) { parse(acc, pending); offset = pos; }
      resolve();
    });
    stream.on('error', () => resolve());
  });
  if (offset > st.size) offset = st.size;
  return finish(acc, st, offset);
}
function finish(acc, st, offset) {
  return {
    agent: acc.agent, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino, offset,
    rows: acc.rows, first: acc.first, last: acc.last, n: acc.n, project: acc.project, src: acc.src,
    // 이어 읽기에 필요한 상태. 중복 확인용 id는 최근 것만 남긴다 (같은 응답이 파일 끝에서 이어질 때만 필요)
    state: { model: acc.model, repo: acc.repo || '', metaDone: !!acc.metaDone, hasRecords: !!acc.hasRecords, prevTotal: acc.prevTotal || 0, seen: [...acc.seen].slice(-200) },
  };
}

// ── 전체 스캔 (캐시 사용) ──
// onProgress(done, total) · 캐시는 { v, files: { [path]: entry } }
async function scan(cache, onProgress) {
  const files = await listFiles();
  const old = (cache && cache.v === CACHE_VERSION && cache.files) || {};
  const next = {};
  let done = 0;
  for (const { agent, f } of files) {
    let st;
    try { st = await fs.promises.stat(f); } catch { done++; continue; }
    const prev = old[f];
    if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs && prev.agent === agent) next[f] = prev;
    else {
      const e = await readFile(agent, f, st, prev && prev.agent === agent ? prev : null);
      if (e) next[f] = e;
    }
    done++;
    if (onProgress && (done % 20 === 0 || done === files.length)) onProgress(done, files.length);
  }
  return { v: CACHE_VERSION, at: Date.now(), files: next };
}

// ── 집계 (기간별 요약) ──
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayStart = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const tot = (r) => r.in + r.out + r.cr + r.cw;

// 히트맵은 고른 기간과 같은 범위 (전체면 처음 쓴 날부터)
function summarize(cache, { days = 30, now = Date.now(), heatDays = days } = {}) {
  const since = days ? dayStart(now) - (days - 1) * DAY : 0;
  const heatSince = heatDays ? dayStart(now) - (heatDays - 1) * DAY : 0;
  const totals = { in: 0, out: 0, cr: 0, cw: 0, rs: 0, n: 0, tokens: 0 };
  const byAgent = {}, byModel = {}, byProject = {}, bySrc = {}, byDay = {}, heat = {}, byHour = new Array(24).fill(0), byWeekday = new Array(7).fill(0);
  const sessions = [];
  const allDays = new Set();
  const bump = (map, k, r, extra) => { const x = map[k] || (map[k] = { tokens: 0, in: 0, out: 0, cr: 0, cw: 0, n: 0, ...extra }); x.tokens += tot(r); x.in += r.in; x.out += r.out; x.cr += r.cr; x.cw += r.cw; x.n += r.n; return x; };
  for (const e of Object.values((cache && cache.files) || {})) {
    let inPeriod = 0;
    const sHours = new Set(); let sTokens = 0, sFirst = 0, sLast = 0;
    for (const [key, r] of Object.entries(e.rows || {})) {
      const [h, model, project, src] = key.split('|');
      const t = Number(h);
      const tk = tot(r);
      if (tk > 0) allDays.add(dayKey(t));
      if (t >= heatSince) heat[dayKey(t)] = (heat[dayKey(t)] || 0) + tk;
      if (t < since) continue;
      inPeriod += r.n;
      sHours.add(t); sTokens += tk;
      if (!sFirst || t < sFirst) sFirst = t;
      if (t > sLast) sLast = t;
      totals.in += r.in; totals.out += r.out; totals.cr += r.cr; totals.cw += r.cw; totals.rs += r.rs; totals.n += r.n; totals.tokens += tk;
      bump(byAgent, e.agent, r);
      if (model) bump(byModel, model, r, { agent: e.agent });
      if (project) bump(byProject, project, r);
      if (e.agent === 'codex' && src) bump(bySrc, src, r);
      const dk = dayKey(t);
      const dd = byDay[dk] || (byDay[dk] = { tokens: 0, byAgent: {} });
      dd.tokens += tk; dd.byAgent[e.agent] = (dd.byAgent[e.agent] || 0) + tk;
      const d = new Date(t);
      byHour[d.getHours()] += tk;
      byWeekday[d.getDay()] += tk;
    }
    // 대화(세션) 크기는 고른 기간 안에서 쓴 양만 센다: 토큰 합계와 실제로 일한 시간(토큰 기록이 있는 1시간 칸 수)
    if (inPeriod) sessions.push({ agent: e.agent, project: e.project, start: sFirst, end: sLast + HOUR, n: inPeriod, src: e.src, tokens: sTokens, activeHours: sHours.size });
  }
  // 연속 사용일 (전체 기간 기준): 오늘(또는 어제)까지 이어진 날 수와 가장 긴 연속
  const sortedDays = [...allDays].sort();
  let longest = 0, run = 0, prev = null;
  for (const k of sortedDays) {
    const t = Date.parse(`${k}T12:00:00`);
    run = prev != null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = t;
  }
  let current = 0;
  for (let d = dayStart(now); ; d -= DAY) {
    if (allDays.has(dayKey(d))) current++;
    else if (d === dayStart(now)) continue; // 오늘 아직 안 썼으면 어제부터 센다
    else break;
    if (current > 4000) break;
  }
  const rank = (map, limit) => Object.entries(map).map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.tokens - a.tokens).slice(0, limit);
  const dayList = Object.entries(byDay).map(([k, v]) => ({ day: k, ...v }));
  const peak = dayList.sort((a, b) => b.tokens - a.tokens)[0] || null;
  const topSession = sessions.slice().sort((a, b) => b.tokens - a.tokens)[0] || null;
  const longestSession = sessions.filter((s) => s.n >= 2).sort((a, b) => b.activeHours - a.activeHours || b.tokens - a.tokens)[0] || null;
  const activeDays = Object.keys(byDay).length;
  const first = [...allDays].sort()[0];
  const firstDay = first ? new Date(`${first}T00:00:00`).getTime() : dayStart(now);
  return {
    days, since, now,
    totals, activeDays, avgPerActiveDay: activeDays ? Math.round(totals.tokens / activeDays) : 0,
    streak: { current, longest },
    sessions: sessions.length,
    byAgent: rank(byAgent, 10), byModel: rank(byModel, 12), byProject: rank(byProject, 10), bySrc: rank(bySrc, 5),
    byHour, byWeekday,
    daily: Object.keys(byDay).sort().map((k) => ({ day: k, tokens: byDay[k].tokens, byAgent: byDay[k].byAgent })),
    heat: { since: heatSince || firstDay, days: heatDays || Math.round((dayStart(now) - firstDay) / DAY) + 1, values: heat },
    peakDay: peak ? { day: peak.day, tokens: peak.tokens } : null,
    longestSession: longestSession ? { agent: longestSession.agent, project: longestSession.project, start: longestSession.start, end: longestSession.end, n: longestSession.n, activeHours: longestSession.activeHours, tokens: longestSession.tokens } : null,
    topSession: topSession ? { agent: topSession.agent, project: topSession.project, start: topSession.start, end: topSession.end, n: topSession.n, activeHours: topSession.activeHours, tokens: topSession.tokens } : null,
  };
}

module.exports = { scan, summarize, listFiles, readFile, projectOf, claudeLine, codexLine, antigravityLine, newAcc, finish, dayKey, CACHE_VERSION };
