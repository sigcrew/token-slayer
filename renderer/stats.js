// 사용 통계 창: 메인 프로세스(src/stats.js)가 집계한 요약을 그린다.
(function () {
  const $ = (s) => document.querySelector(s);
  const T = (ko, vars) => window.TSI18N.tr(ko, vars);
  const lang = window.TSI18N.getLang();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => new Intl.NumberFormat(lang === 'en' ? 'en' : 'ko', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
  const full = (n) => new Intl.NumberFormat(lang === 'en' ? 'en' : 'ko').format(n || 0);
  const NAMES = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity', cursor: 'Cursor' };
  const COLORS = { claude: '#E07A5F', codex: '#6C8CFF', antigravity: '#3FCF8E', cursor: '#B98CFF' };
  const SRC = { app: () => T('Codex 앱 · IDE'), cli: () => T('터미널 (CLI)'), exec: () => T('자동 실행 (codex exec)') };
  // 모델 id → 읽기 쉬운 이름: claude-opus-5-5 → Claude Opus 5.5 · gpt-6-astra → GPT-6 Astra · claude-sonnet-4-5-20250929 → Claude Sonnet 4.5
  function prettyModel(id) {
    const parts = String(id || '').split('-').filter((p) => !/^\d{8}$/.test(p));
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (/^gpt$/i.test(p) && parts[i + 1] && /^[\d.]+$/.test(parts[i + 1])) { out.push(`GPT-${parts[++i]}`); continue; }
      if (/^\d+$/.test(p) && out.length && /^\d+(\.\d+)*$/.test(out[out.length - 1])) { out[out.length - 1] += `.${p}`; continue; }
      out.push(/^[\d.]+$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1));
    }
    return out.join(' ') || String(id || '');
  }
  const WEEK = () => [T('일'), T('월'), T('화'), T('수'), T('목'), T('금'), T('토')];

  // 데모: 브라우저에서 열어 볼 때 (?demo=1)
  const bridge = window.statsBridge || { get: async () => ({ summary: null }), onProgress: () => {} };

  let days = 30;
  try { const raw = localStorage.getItem('ts.stats.days'); const v = Number(raw); if (raw !== null && [7, 30, 0].includes(v)) days = v; } catch {}
  let hideProjects = false;
  try { hideProjects = localStorage.getItem('ts.stats.hideProjects') === '1'; } catch {}
  // 비율 · 막대는 기본으로 캐시 읽기를 뺀 값. 캐시 읽기는 응답마다 대화 전체를 다시 읽은 양이라
  // 대화가 긴 에이전트(Claude Code)일수록 크게 부풀어 체감 사용량과 멀어진다
  let withCache = false;
  try { withCache = localStorage.getItem('ts.stats.withCache') === '1'; } catch {}
  const amt = (x) => (withCache ? x.tokens : x.tokens - x.cr);
  const byAmt = (list) => list.filter((x) => amt(x) > 0).sort((a, b) => amt(b) - amt(a));

  document.title = T('사용 통계');
  $('#title').textContent = T('사용 통계');
  $('#refresh').textContent = T('다시 계산');
  const tabs = [[7, T('7일')], [30, T('30일')], [0, T('전체')]];
  $('#tabs').innerHTML = tabs.map(([d, l]) => `<button data-d="${d}">${esc(l)}</button>`).join('');
  const markTabs = () => document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', Number(b.dataset.d) === days));
  markTabs();
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    days = Number(b.dataset.d); markTabs();
    try { localStorage.setItem('ts.stats.days', String(days)); } catch {}
    load(false);
  });
  $('#refresh').addEventListener('click', () => load(true));
  // 카드로 공유: 프로젝트 이름 · 세션 시간대는 빼고, 기간 요약과 6개월 히트맵만 보낸다
  $('#share').textContent = T('카드로 공유');
  if (!bridge.card) $('#share').hidden = true;
  $('#share').addEventListener('click', async () => {
    const s = last && last.summary;
    if (!s || !s.totals.n) return;
    const agents = byAmt(s.byAgent);
    const agentTotal = agents.reduce((a, x) => a + amt(x), 0) || 1;
    const models = byAmt(s.byModel);
    const data = {
      days: s.days || 0,
      from: s.days ? (() => { const d = new Date(s.since); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })() : null,
      tokens: s.totals.tokens, noCache: s.totals.tokens - s.totals.cr, activeDays: s.activeDays, streak: s.streak.current, longest: s.streak.longest, sessions: s.sessions,
      agents: agents.slice(0, 3).map((a) => ({ id: a.key, name: NAMES[a.key] || a.key, color: COLORS[a.key] || '#FFD166', share: Math.round((amt(a) / agentTotal) * 100), tokens: amt(a) })),
      withCache,
      // 총 토큰(캐시 포함) 아래에 적는 에이전트별 합계
      agentTotals: s.byAgent.filter((a) => a.tokens > 0).slice(0, 3).map((a) => ({ name: NAMES[a.key] || a.key, color: COLORS[a.key] || '#FFD166', tokens: a.tokens })),
      models: models.slice(0, 3).map((m) => ({ name: prettyModel(m.key), color: COLORS[m.agent] || '#FFD166', tokens: amt(m) })),
      heat: s.heat,
    };
    $('#share').disabled = true;
    try {
      const r = await bridge.card(data);
      $('#progress').textContent = r && r.ok ? T('카드를 다운로드 폴더에 저장하고 클립보드에 복사했어요') : T('카드를 만들지 못했어요');
    } catch { $('#progress').textContent = T('카드를 만들지 못했어요'); }
    $('#share').disabled = false;
  });
  bridge.onProgress(({ done, total }) => { $('#progress').textContent = T('기록 읽는 중… {n}%', { n: total ? Math.round((done / total) * 100) : 0 }); });

  const bars = (list, { color, label, max, dim } = {}) => {
    list = byAmt(list);
    const top = max || Math.max(1, ...list.map(amt));
    return list.map((x) => `<div class="bar${dim && dim(x) ? ' dim' : ''}"><span class="name" title="${esc(label ? label(x) : x.key)}">${label ? label(x) : esc(x.key)}</span><span class="track"><span class="fill" style="display:block;width:${Math.max(1, (amt(x) / top) * 100).toFixed(1)}%;background:${color ? color(x) : 'var(--gold)'}"></span></span><span class="v" title="${full(amt(x))}">${fmt(amt(x))}</span></div>`).join('');
  };

  function heatmap(h) {
    const vals = h.values || {};
    // 진하기는 "내가 쓴 날들" 안에서의 순위로 나눈다 (가장 많이 쓴 하루 기준이면 대부분 같은 색이 됨)
    const nz = Object.values(vals).filter((v) => v > 0).sort((a, b) => a - b);
    const q = (p) => (nz.length ? nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] : 0);
    const cut = [q(0.25), q(0.5), q(0.75)];
    const level = (v) => (v <= 0 ? 0 : v < cut[0] ? 1 : v < cut[1] ? 2 : v < cut[2] ? 3 : 4);
    const first = new Date(h.since); first.setHours(0, 0, 0, 0);
    const start = new Date(first);
    start.setDate(start.getDate() - start.getDay()); // 일요일부터 한 주
    const end = new Date(); end.setHours(0, 0, 0, 0);
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const legend = `<div class="legend">${esc(T('적음'))} <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> ${esc(T('많음'))}</div>`;
    // 6주 이하(7일 · 30일)는 달력 모양: 가로 7칸이 요일, 한 줄이 한 주
    if ((end - start) / 86400e3 < 42) {
      const rows = [];
      for (let d = new Date(start); d <= end;) {
        const cells = [];
        for (let w = 0; w < 7; w++, d.setDate(d.getDate() + 1)) {
          if (d < first || d > end) { cells.push('<i class="blank"></i>'); continue; }
          const k = key(d), v = vals[k] || 0;
          cells.push(`<i class="l${level(v)}" title="${esc(dateText(k))} · ${full(v)}"><span>${d.getDate() === 1 ? `${d.getMonth() + 1}/1` : d.getDate()}</span></i>`);
        }
        rows.push(cells.join(''));
      }
      return `<div class="cal">${WEEK().map((w) => `<b>${esc(w)}</b>`).join('')}${rows.join('')}</div>` + legend;
    }
    const cols = [];
    let months = [];
    for (let d = new Date(start), c = 0; d <= end; c++) {
      const cells = [];
      for (let w = 0; w < 7; w++, d.setDate(d.getDate() + 1)) {
        if (d < first || d > end) { cells.push('<i class="blank"></i>'); continue; }
        const k = key(d);
        const v = vals[k] || 0;
        if (d.getDate() === 1 || (c === 0 && w === 0)) months.push({ c, label: d.toLocaleDateString(lang === 'en' ? 'en-US' : 'ko-KR', { month: 'short' }) });
        cells.push(`<i class="l${level(v)}" title="${esc(dateText(k))} · ${full(v)}"></i>`);
      }
      cols.push(`<div class="wk">${cells.join('')}</div>`);
    }
    // 첫 칸의 월 표시가 바로 다음 1일과 겹치면 하나만
    months = months.filter((m, i) => !(i === 0 && months[1] && months[1].c - m.c < 3));
    const week = WEEK();
    // 요일은 일요일부터 7개 모두 표시 (월·수·금만 있으면 어느 줄이 무슨 요일인지 헷갈림)
    return `<div class="heatwrap"><div class="days"><span></span>${week.map((w) => `<span>${esc(w)}</span>`).join('')}</div>`
      + `<div><div class="months">${months.map((m) => `<span style="left:${m.c * 15}px">${esc(m.label)}</span>`).join('')}</div><div class="heat">${cols.join('')}</div></div></div>`
      + legend;
  }

  function columns(arr, labels, every) {
    const max = Math.max(1, ...arr);
    const peak = arr.indexOf(Math.max(...arr));
    return `<div class="cols">${arr.map((v, i) => `<div class="${i === peak && v > 0 ? 'hot' : ''}" style="height:${((v / max) * 100).toFixed(1)}%" title="${esc(labels[i])} · ${full(v)}"></div>`).join('')}</div>`
      + `<div class="axis">${labels.filter((_, i) => i % every === 0).map((l) => `<span>${esc(l)}</span>`).join('')}</div>`;
  }

  const dur = (h) => (h >= 24 ? T('{d}일 {h}시간', { d: Math.floor(h / 24), h: h % 24 }) : T('{h}시간', { h }));
  const dateText = (k) => { const d = new Date(`${k}T12:00:00`); return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'ko-KR', { month: 'short', day: 'numeric', weekday: 'short' }); };
  const proj = (p) => (hideProjects ? T('(가림)') : esc(p || T('(폴더 없음)')));

  function render(s, meta) {
    if (!s || !s.totals.n) {
      $('#main').innerHTML = `<div class="card"><p class="note">${esc(T('아직 집계할 기록이 없어요. Claude Code · Codex · Antigravity를 쓰면 이 컴퓨터에 남는 기록에서 토큰 사용량을 모아 보여 줘요.'))}</p></div>`;
      return;
    }
    const t = s.totals;
    const agents = byAmt(s.byAgent);
    const agentTotal = agents.reduce((a, x) => a + amt(x), 0) || 1;
    const share = (x) => amt(x) / agentTotal;
    const html = [];
    html.push(`<div class="big">
      <div class="card"><small>${esc(T('총 토큰'))}</small><b title="${full(t.tokens)}">${fmt(t.tokens)}</b><small>${esc(T('캐시 읽기 제외 {n}', { n: fmt(t.tokens - t.cr) }))}</small><br><small>${esc(T('입력 {i} · 출력 {o}', { i: fmt(t.in), o: fmt(t.out) }))}</small></div>
      <div class="card"><small>${esc(T('사용한 날'))}</small><b>${s.activeDays}</b><small>${esc(T('하루 평균 {n}', { n: fmt(s.avgPerActiveDay) }))}</small></div>
      <div class="card"><small>${esc(T('연속 사용'))}</small><b>${esc(T('{n}일', { n: s.streak.current }))}</b><small>${esc(T('최장 {n}일', { n: s.streak.longest }))}</small></div>
      <div class="card"><small>${esc(T('대화(세션)'))}</small><b>${full(s.sessions)}</b><small>${esc(T('응답 {n}번', { n: fmt(t.n) }))}</small></div>
    </div>`);
    html.push(`<div class="card"><h2>${esc(T('날짜별 사용량'))}</h2>${heatmap(s.heat)}</div>`);
    html.push(`<div class="card"><h2>${esc(T('에이전트별'))} · ${esc(withCache ? T('캐시 읽기 포함') : T('캐시 읽기 제외'))} <button class="tool" id="cacheMode" style="float:right;padding:2px 8px;font-size:11px">${esc(withCache ? T('캐시 읽기 빼고 보기') : T('캐시 읽기 포함해서 보기'))}</button></h2>
      <div class="stack">${agents.map((x) => `<div style="width:${(share(x) * 100).toFixed(2)}%;background:${COLORS[x.key] || '#888'}" title="${esc(NAMES[x.key] || x.key)} · ${full(amt(x))}"></div>`).join('')}</div>
      ${bars(s.byAgent, { color: (x) => COLORS[x.key] || '#888', label: (x) => `<span class="dot" style="background:${COLORS[x.key] || '#888'}"></span>${esc(NAMES[x.key] || x.key)} · ${share(x) < 0.01 ? '&lt;1' : Math.round(share(x) * 100)}%`, dim: (x) => share(x) < 0.01 })}</div>`);
    html.push(`<div class="split">
      <div class="card"><h2>${esc(T('모델별'))}</h2>${bars(s.byModel, { color: (x) => COLORS[x.agent] || 'var(--gold)', label: (x) => `<span title="${esc(x.key)}">${esc(prettyModel(x.key))}</span>` })}</div>
      <div class="card"><h2>${esc(T('프로젝트별'))} <button class="tool" id="hideProj" style="float:right;padding:2px 8px;font-size:11px">${esc(hideProjects ? T('이름 보이기') : T('이름 가리기'))}</button></h2>${s.byProject.length ? bars(s.byProject, { label: (x) => proj(x.key) }) : `<p class="note">${esc(T('폴더 정보가 있는 기록이 없어요'))}</p>`}</div>
    </div>`);
    const hours = Array.from({ length: 24 }, (_, i) => T('{h}시', { h: i }));
    html.push(`<div class="split">
      <div class="card"><h2>${esc(T('시간대별'))}</h2>${columns(s.byHour, hours, 6)}</div>
      <div class="card"><h2>${esc(T('요일별'))}</h2>${columns(s.byWeekday, WEEK(), 1)}</div>
    </div>`);
    const rows = [];
    if (s.peakDay) rows.push(`<span>${esc(T('가장 많이 쓴 날'))}</span><div>${esc(dateText(s.peakDay.day))} · ${fmt(s.peakDay.tokens)}</div>`);
    if (s.longestSession) rows.push(`<span>${esc(T('가장 오래 일한 대화'))}</span><div>${esc(NAMES[s.longestSession.agent] || '')} · ${proj(s.longestSession.project)} · ${esc(dur(s.longestSession.activeHours))} · ${fmt(s.longestSession.tokens)}</div>`);
    if (s.topSession) rows.push(`<span>${esc(T('토큰을 가장 많이 쓴 대화'))}</span><div>${esc(NAMES[s.topSession.agent] || '')} · ${proj(s.topSession.project)} · ${fmt(s.topSession.tokens)}</div>`);
    rows.push(`<span>${esc(T('캐시에서 읽음'))}</span><div>${fmt(t.cr)} (${Math.round((t.cr / (t.tokens || 1)) * 100)}%) · ${esc(T('캐시에 씀'))} ${fmt(t.cw)}</div>`);
    if (t.rs) rows.push(`<span>${esc(T('추론 토큰 (Codex)'))}</span><div>${fmt(t.rs)}</div>`);
    html.push(`<div class="card"><h2>${esc(T('기록'))}</h2><div class="rows">${rows.join('')}</div></div>`);
    if (s.bySrc.length) html.push(`<div class="card"><h2>${esc(T('Codex 실행 방식'))}</h2>${bars(s.bySrc, { color: () => COLORS.codex, label: (x) => esc(SRC[x.key] ? SRC[x.key]() : x.key) })}<p class="note">${esc(T('자동 실행은 다른 도구나 스크립트가 codex exec로 Codex를 대신 부른 경우예요.'))}</p></div>`);
    const when = meta && meta.scannedAt ? new Date(meta.scannedAt).toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR') : '';
    html.push(`<p class="note">${esc(T('이 컴퓨터에 남은 Claude Code · Codex · Antigravity 기록에서 토큰 수 · 시각 · 모델 · 폴더 이름만 읽어 집계해요. 대화 내용은 읽지 않고, 어디로도 보내지 않아요. claude.ai 웹 · Claude 앱 · Cursor처럼 이 컴퓨터에 토큰 기록을 남기지 않는 사용은 빠져요. 총 토큰은 캐시에서 읽은 토큰까지 포함하고, 에이전트 · 모델 · 프로젝트별 막대는 기본으로 캐시 읽기를 뺀 값이에요. 캐시 읽기는 응답할 때마다 대화 전체를 다시 읽은 양이라 대화가 긴 에이전트일수록 크게 늘어나요.'))}${when ? ` ${esc(T('마지막 계산: {t}', { t: when }))}` : ''}</p>`);
    $('#main').innerHTML = html.join('');
    const hp = $('#hideProj');
    $('#cacheMode').addEventListener('click', () => { withCache = !withCache; try { localStorage.setItem('ts.stats.withCache', withCache ? '1' : '0'); } catch {} render(s, meta); });
    if (hp) hp.addEventListener('click', () => { hideProjects = !hideProjects; try { localStorage.setItem('ts.stats.hideProjects', hideProjects ? '1' : '0'); } catch {} render(s, meta); });
  }

  let last = null;
  async function load(refresh) {
    $('#progress').textContent = refresh || !last ? T('기록 읽는 중…') : '';
    try {
      const r = await bridge.get({ days, refresh });
      last = r;
      $('#progress').textContent = '';
      render(r.summary, r);
    } catch (e) {
      $('#progress').textContent = T('통계를 계산하지 못했어요');
    }
  }
  load(false);
})();
