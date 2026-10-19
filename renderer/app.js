(function () {
  const $ = (s) => document.querySelector(s);
  const root = $('#root');
  const canvas = $('#slayer');
  const panel = $('#panel');
  const scene = new window.Scene(canvas);
  scene.onEvent = (name) => { if (!settings.demo && bridge.event) bridge.event(name); };
  const lastDrop = {};      // 서비스별 마지막으로 사용량이 줄어든 시각
  const BUSY_MS = 60000; // 줄어든 뒤 1분 동안은 '전투 중' (실시간 감시가 주로 판단)

  // Electron 밖(브라우저)에서 열면 가짜 브리지로 데모 실행
  const bridge = window.slayerBridge || makeMockBridge();

  let settings = { show: {}, demo: false, clickThrough: false, skins: {}, enemyTheme: 'code', restTheme: 'campfire', backdropTheme: 'night', hpBasis: {}, unlocked: false };
  let packs = window.BUILTIN_PACKS || [];

  // 꾸미기 팩 적용 (잠긴 프리미엄 팩은 기본값으로)
  function findPack(type, id) {
    const p = packs.find((x) => x.type === type && x.id === id);
    if (!p) return null;
    const open = settings.openPacks ? settings.openPacks.includes(`${type}:${id}`) : (p.tier !== 'premium' || settings.unlocked);
    return open ? p : null;
  }
  // 고해상도(hd) 용사: 설정이 고해상도이고 프리미엄이 열려 있으면 팩의 hd 그림(grid · faces · down)으로 바꿔 쓴다
  function resolveHero(p) {
    if (!p || !p.hd || settings.heroRes !== 'hd' || !settings.unlocked) return p;
    const h = p.hd;
    return { ...p, hires: true, grid: h.grid, faces: h.faces, down: h.down, palette: { ...(p.palette || {}), ...(h.palette || {}) }, extras: h.extras || p.extras, noCape: h.noCape != null ? h.noCape : p.noCape, face: undefined, faceNoMouth: false };
  }
  function applyTheme() {
    const skins = {};
    for (const [id, packId] of Object.entries(settings.skins || {})) skins[id] = resolveHero(findPack('hero', packId));
    scene.setTheme({ skins, enemies: findPack('enemies', settings.enemyTheme), rest: findPack('rest', settings.restTheme), backdrop: findPack('backdrop', settings.backdropTheme) });
  }
  let realData = null;
  let lastMetrics = null;
  let devOpen = false; // 미리보기(?open=1)에서만 패널을 계속 열어 둠
  let hovering = false;
  let hideTimer = null;
  const loginPending = {};

  // ───────── 데이터 계산 ─────────
  // 스냅샷 형태: { providers: [{ id, name, color, loginLabel }], data: { id: { ok, windows: [{ key, label, usedPercent, resetsAt }], ... } } }
  const clamp = (v) => Math.max(0, Math.min(100, v));
  const rem = (w) => (w && typeof w.usedPercent === 'number' ? clamp(100 - w.usedPercent) : null);
  // HP·피격·부활 시각은 서비스 전체 한도로만 판단 (Opus·Sonnet 전용 주간 한도는 그 모델만 막힌 것이라 제외. 패널에는 계속 보임)
  const minutesOf = (w) => w.windowMinutes || (w.key === 'fiveHour' ? 300 : /^weekly/.test(w.key || '') ? 10080 : 43200);
  const tagOf = (w) => (minutesOf(w) <= 600 ? '5H' : minutesOf(w) <= 20160 ? 'WK' : 'MO'); // HP가 어느 한도 기준인지 (도트 글꼴이라 영문)
  const basisOf = (id) => (typeof settings.hpBasis === 'string' ? settings.hpBasis : (settings.hpBasis && settings.hpBasis[id]) || 'auto');
  const hpWins = (ws, id) => {
    const all = ws || [];
    const main = all.filter((w) => !/^weekly(Opus|Sonnet)$/.test(w.key));
    const base = main.length ? main : all;
    const b = basisOf(id);
    if (b === 'fiveHour' || b === 'weekly') { const pick = base.filter((w) => (minutesOf(w) <= 600) === (b === 'fiveHour')); if (pick.length) return pick; }
    return base;
  };
  const metaOf = (d, id) => (d.providers || []).find((p) => p.id === id) || { id, name: id, color: '#999' };

  // 표시 규칙: 직접 끈 건 숨김, 직접 켠 건 표시, 나머지는 최근 30일 안에 쓴 것만 자동 표시
  function visibleSvcs(d) {
    return (d.providers || [])
      .map((p) => p.id)
      .filter((id) => {
        const x = d.data[id];
        if (!x || x.error === 'not-installed') return false;
        if (settings.show[id] === false) return false;
        if (settings.show[id] === true) return true;
        return !!x.active;
      });
  }

  function metrics(d) {
    const m = {};
    for (const p of d.providers || []) {
      const x = d.data[p.id];
      if (!x || !x.ok || !x.windows) continue;
      for (const w of x.windows) m[`${p.id}.${w.key}`] = rem(w);
    }
    return m;
  }

  // 한 서비스의 실질적인 남은 양 = 모든 한도 창 중 가장 적게 남은 것
  function effective(d, id) {
    const x = d.data[id];
    if (!x || !x.ok || !x.windows) return null;
    const vals = hpWins(x.windows, id).map(rem).filter((v) => v != null);
    return vals.length ? Math.min(...vals) : null;
  }

  function energyOf(d) {
    const svcs = settings.driver === 'min' ? visibleSvcs(d) : [settings.driver];
    const vals = svcs.map((id) => effective(d, id)).filter((v) => v != null);
    return vals.length ? Math.min(...vals) / 100 : null;
  }

  // ───────── 화면 갱신 ─────────
  function onData(d) {
    const svcs = visibleSvcs(d);
    scene.setHeroes(svcs.map((id) => metaOf(d, id)));
    const now = Date.now();
    for (const id of svcs) {
      const x = d.data[id] || {};
      const hp = effective(d, id);
      // 한도 창(5시간/주간/월간…) 중 하나라도 줄면 맞음, 크게 늘면 회복
      if (lastMetrics && x.ok && x.windows) {
        let drop = 0, gain = 0;
        for (const w of hpWins(x.windows, id)) {
          const k = `${id}.${w.key}`, a = lastMetrics[k], b = rem(w);
          if (a == null || b == null) continue;
          drop = Math.max(drop, a - b);
          gain = Math.max(gain, b - a);
        }
        if (drop > 0.05) { lastDrop[id] = now; scene.hit(id, drop); }
        else if (gain >= 5) scene.heal(id, Math.round(gain));
      }
      // 가장 적게 남은 한도 창의 리셋 시각 (GAME OVER 때 "부활까지")
      let resetAt = null, hpTag = null;
      if (x.ok && x.windows && x.windows.length) {
        const worst = hpWins(x.windows, id).reduce((a, w) => (rem(w) < rem(a) ? w : a));
        resetAt = worst.resetsAt || null;
        hpTag = tagOf(worst);
      }
      scene.setState(id, {
        hp,
        busy: !!x.busy || (!x.watched && lastDrop[id] && now - lastDrop[id] < (settings.demo ? 9000 : BUSY_MS)),
        alert: !!x.needsLogin,
        question: !x.ok && !x.needsLogin && x.error !== 'loading' && x.error !== 'no-plan',
        // 플랜에 포함된 사용량이 없음(구독 종료 · 무료): 고장(?)이 아니라 휴무로 보여 준다
        offDuty: !x.ok && x.error === 'no-plan',
        resetAt,
        hpTag,
        level: x.level,
        levelProgress: x.levelProgress,
        burning: !!x.burning,
        eta: x.forecast && x.forecast.beforeReset ? x.forecast.etaMs : null,
      });
    }
    renderPanel(d);
    lastMetrics = metrics(d);
  }

  function fmtDur(ms) {
    if (ms <= 60000) return T('곧');
    const min = Math.floor(ms / 60000);
    const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), mm = min % 60;
    if (d) return T('{d}일 {h}시간', { d, h });
    if (h) return T('{h}시간 {m}분', { h, m: mm });
    return T('{m}분', { m: mm });
  }
  function fmtReset(w) {
    if (!w) return '';
    if (w.resetPassed) return T('리셋됨 · 다시 쓰면 새로 표시돼요');
    if (!w.resetsAt) return '';
    const left = w.resetsAt - Date.now();
    const at = new Date(w.resetsAt);
    const loc = (window.TSI18N && window.TSI18N.getLang() === 'en') ? 'en-US' : 'ko-KR';
    const hhmm = at.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' });
    const day = left > 20 * 3600e3 ? `${at.getMonth() + 1}/${at.getDate()} ` : '';
    return left <= 60000 ? T('곧 리셋') : T('{dur} 후 리셋 · {at}', { dur: fmtDur(left), at: `${day}${hhmm}` });
  }
  function fmtAgo(t) {
    if (!t) return '';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return T('방금');
    if (s < 3600) return T('{n}분 전', { n: Math.floor(s / 60) });
    if (s < 86400) return T('{n}시간 전', { n: Math.floor(s / 3600) });
    return T('{n}일 전', { n: Math.floor(s / 86400) });
  }
  function barColor(r) {
    return r > 50 ? '#4ADE80' : r > 20 ? '#FACC15' : r > 5 ? '#FB923C' : '#EF4444';
  }
  const T = (ko, vars) => (window.TSI18N ? window.TSI18N.tr(ko, vars) : ko);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function row(w) {
    const r = rem(w);
    if (r == null) return '';
    return `<div class="row"><span class="rl">${esc(T(w.label || ''))}</span>
      <div class="pbar"><div style="width:${r}%;background:${barColor(r)}"></div></div>
      <span class="rv">${T('<b>{n}%</b> 남음', { n: Math.round(r) })}</span>
      <span class="rs">${esc(fmtReset(w))}</span></div>`;
  }

  // 같은 리셋 시각을 가진 창이 여러 개면(예: Cursor 월간/Auto/API) 리셋 문구는 한 번만
  function rows(wins) {
    let lastReset = null;
    return wins.map((w) => {
      const same = w.resetsAt && w.resetsAt === lastReset;
      lastReset = w.resetsAt;
      return row(same ? { ...w, resetsAt: null } : w);
    }).join('');
  }

  function renderPanel(d) {
    const parts = [];
    for (const id of visibleSvcs(d)) {
      const meta = metaOf(d, id);
      const x = d.data[id] || {};
      let sub = '';
      if (x.ok) sub = x.observedAt ? T('{ago} 기록', { ago: fmtAgo(x.observedAt) }) : x.stale ? T('연결 끊김 · 마지막 값') : (x.plan ? String(x.plan) : '');
      let body = '';
      if (x.ok) body = rows(x.windows || []);
      if (x.forecast && x.forecast.beforeReset) {
        const f = x.forecast;
        body = `<div class="fc">⏳ ${T('이 속도면 <b>{eta}</b> 뒤 바닥', { eta: fmtDur(f.etaMs) })}${f.resetInMs ? ` · ${T('리셋 {reset} 뒤', { reset: fmtDur(f.resetInMs) })}` : ''} <span>${T('(시간당 {n}%)', { n: f.ratePerHour })}</span></div>` + body;
      } else if (x.forecast && x.busy) {
        body = `<div class="fc ok">✅ ${T('지금 속도면 리셋까지 버텨요')} <span>${T('(시간당 {n}%)', { n: x.forecast.ratePerHour })}</span></div>` + body;
      }
      if (x.burning) {
        const mins = Math.max(1, Math.round(x.burning.msLeft / 60000));
        const left = mins >= 120 ? T('{n}시간', { n: Math.round(mins / 60) }) : T('{n}분', { n: mins });
        body = `<div class="burn">🔥 BURNING TIME · ${T('리셋까지 {left}, {n}% 남음 · 경험치 2배', { left, n: x.burning.remaining })}</div>` + body;
      }
      // 레벨 · 전투 상태를 한 줄로 (패널이 길어지지 않게)
      const lvTxt = x.level != null ? `<span class="lv">${T('Lv.{lv} · 다음까지 {n}%', { lv: x.level, n: Math.round((1 - (x.levelProgress || 0)) * 100) })}</span>` : '';
      const liveTxt = `${x.busy ? T('⚔️ 전투') : T('🔥 휴식')}${x.activityAt ? ` · ${T('{ago} 감지', { ago: fmtAgo(x.activityAt) })}` : ''}`;
      body += `<div class="meta">${lvTxt}<span class="live">${liveTxt}</span></div>`;
      if (x.ok && x.needsLogin) body = `<div class="msg warn">${esc(T(x.loginMessage || '로그인이 필요해요'))} · ${T('아래는 마지막 기록이에요')}</div>` + body;
      if (!x.ok) body = `<div class="msg">${esc(T(x.message || '정보 없음'))}</div>`;
      if (x.needsLogin) {
        body += (loginPending[id] || 0) > Date.now()
          ? `<button class="login-btn" disabled>${T('로그인을 기다리는 중…')}</button>`
          : `<button class="login-btn" data-login="${id}" style="background:${meta.color}">${esc(meta.name)} ${esc(T(meta.loginLabel === 'Cursor 열기' ? '열어서 로그인' : '로그인하기'))}</button>`;
      }
      parts.push(`<div class="svc"><div class="svc-h"><span class="dot" style="background:${meta.color}"></span>${esc(meta.name)}<span class="sub">${esc(sub)}</span></div>${body}</div>`);
    }
    if (!parts.length) parts.push(`<div class="msg">${T('최근 30일 안에 쓴 서비스가 없어요. 트레이 메뉴의 "표시할 서비스"에서 직접 켤 수 있어요.')}</div>`);
    const foot = `<div class="foot"><span>${settings.demo ? `<span class="demo-tag">${T('데모 모드')}</span>` : T('오른쪽 클릭: 메뉴 · 드래그: 이동')}</span><span>${new Date().toLocaleTimeString((window.TSI18N && window.TSI18N.getLang() === 'en') ? 'en-US' : 'ko-KR', { hour: '2-digit', minute: '2-digit' })}</span></div>`;
    panel.innerHTML = parts.join('') + foot;
  }

  // 로그인하기 버튼
  panel.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-login]');
    if (!b) return;
    bridge.login(b.dataset.login);
    loginPending[b.dataset.login] = Date.now() + 20000;
    b.textContent = T('로그인을 기다리는 중…');
    b.disabled = true;
  });

  // ───────── 패널 열기/닫기 ─────────
  // ───────── 추억 카드 ─────────
  const memoryEl = document.getElementById('memory');
  let memoryTimer = null;
  let memoryReadyAt = 0; // 카드가 뜬 직후 잠깐은 눌러도 닫히지 않는다 (용사를 연타하던 클릭이 카드로 들어가는 일 방지)
  function hideMemory() {
    clearTimeout(memoryTimer);
    root.classList.remove('memory');
  }
  function showMemory(hero) {
    const mem = hero && hero.skin && hero.skin.memory;
    if (!mem) return;
    const caps = Array.isArray(mem.captions) && mem.captions.length ? mem.captions : null;
    let idx = 0;
    const key = `ts.memory.${hero.skin.id}`;
    try { idx = Number(localStorage.getItem(key)) || 0; localStorage.setItem(key, String((idx + 1) % (caps ? caps.length : 1))); } catch {}
    const cap = caps ? caps[idx % caps.length] : '';
    memoryEl.innerHTML = (mem.photo ? `<img alt="" src="${mem.photo}">` : '') + (cap ? `<div class="cap">${esc(cap)}</div>` : '') + '<div class="sub">' + T('눌러서 닫기') + '</div>';
    root.classList.add('memory');
    clearTimeout(memoryTimer);
    memoryReadyAt = Date.now() + 1800;
    memoryTimer = setTimeout(hideMemory, 10000);
  }
  memoryEl.addEventListener('click', () => { if (Date.now() >= memoryReadyAt) hideMemory(); });

  function setOpen(open) {
    const was = root.classList.contains('open');
    root.classList.toggle('open', open);
    if (open && !was && !settings.demo && bridge.event) bridge.event('panel');
  }
  function onEnter() {
    hovering = true;
    clearTimeout(hideTimer);
    setOpen(true);
  }
  function onLeave() {
    hovering = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!hovering && !devOpen) setOpen(false); }, 350);
  }

  // 투명한 부분은 클릭이 뒤 창으로 통과하도록, 캐릭터·게이지·패널 위에서만 마우스를 받는다
  let interactive = false;
  function hitTest(target) {
    if (!target || !target.closest) return null;
    const el = target.closest('.hit');
    if (el === panel && !root.classList.contains('open')) return null;
    if (el === memoryEl && !root.classList.contains('memory')) return null;
    return el;
  }
  document.addEventListener('mousemove', (e) => {
    // 버튼을 뗐는데 pointerup을 못 받은 경우(창 밖에서 뗌 · 메뉴가 뜸 · 모니터 전환 등) 끌기가 끝나지 않고 위젯이 마우스를 계속 따라다닌다
    if (down && e.buttons === 0) endPointer(e);
    const el = hitTest(e.target);
    const now = !!el;
    if (now !== interactive) {
      interactive = now;
      bridge.setInteractive(now);
      now ? onEnter() : onLeave();
    }
  });
  document.addEventListener('mouseleave', () => {
    if (interactive) { interactive = false; bridge.setInteractive(false); }
    onLeave();
  });

  // ───────── 드래그 / 클릭 ─────────
  let down = null;
  function startPointer(e) {
    if (e.button !== 0) return;
    down = { x: e.screenX, y: e.screenY, moved: false, id: e.pointerId, el: e.currentTarget };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    bridge.dragStart();
  }
  function movePointer(e) {
    if (!down) return;
    if (!down.moved && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
      down.moved = true;
      canvas.classList.add('dragging');
    }
  }
  function endPointer(e) {
    if (!down) return;
    const wasClick = !down.moved;
    try { down.el.releasePointerCapture(down.id); } catch {}
    down = null;
    canvas.classList.remove('dragging');
    bridge.dragEnd(wasClick);
    if (wasClick) {
      // 용사를 누르면 쓰다듬기 (패널은 마우스를 올렸을 때만 열림)
      const r = canvas.getBoundingClientRect();
      const hero = scene.heroAt(e.clientX - r.left, e.clientY - r.top);
      if (hero) {
        const kind = scene.poke(hero);
        if (kind === 'memory') showMemory(hero);
        if (!settings.demo && bridge.pet) bridge.pet(hero.id, kind === 'memory' ? 'pet' : kind);
        return;
      }
      bridge.refresh();
    }
  }
  // 오른쪽 클릭: 메뉴바(트레이) 메뉴와 같은 메뉴 (노치에 아이콘이 가려져도 쓸 수 있게)
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (bridge.openMenu) bridge.openMenu();
  });
  for (const el of [canvas]) {
    el.addEventListener('pointerdown', startPointer);
    el.addEventListener('pointermove', movePointer);
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);
  }

  // ───────── 데모 모드 ─────────
  const DEMO_PROVIDERS = [
    { id: 'claude', name: 'Claude', color: '#E07A5F' },
    { id: 'codex', name: 'Codex', color: '#6C8CFF' },
    { id: 'cursor', name: 'Cursor', color: '#B98CFF' },
  ];
  const demo = {
    timer: null,
    data: null,
    start() {
      const now = Date.now();
      this.data = {
        providers: DEMO_PROVIDERS,
        data: {
          claude: { ok: true, active: true, level: 7, levelProgress: 0.55, burning: { remaining: 60, msLeft: 2400000 }, windows: [{ key: 'fiveHour', label: '5시간', usedPercent: 12, resetsAt: now + 3.2 * 3600e3 }, { key: 'weekly', label: '주간', usedPercent: 35, resetsAt: now + 4.5 * 86400e3 }] },
          codex: { ok: true, active: true, level: 3, levelProgress: 0.2, windows: [{ key: 'fiveHour', label: '5시간', usedPercent: 30, resetsAt: now + 1.4 * 3600e3 }, { key: 'weekly', label: '주간', usedPercent: 18, resetsAt: now + 2.1 * 86400e3 }], observedAt: now },
          cursor: { ok: true, active: true, level: 12, levelProgress: 0.8, plan: 'pro', windows: [{ key: 'monthly', label: '월간', usedPercent: 22, resetsAt: now + 12 * 86400e3 }] },
        },
      };
      onData(this.data);
      clearInterval(this.timer);
      this.timer = setInterval(() => this.step(), 2200);
    },
    step() {
      const d = JSON.parse(JSON.stringify(this.data));
      const ids = Object.keys(d.data);
      // 한 명은 계속 쉬게 두고, 나머지가 번갈아 싸움
      const id = ids[Math.floor(Math.random() * (ids.length - 1))];
      const x = d.data[id];
      const w = x.windows[0];
      if (w.usedPercent >= 100) {
        x.deadSteps = (x.deadSteps || 0) + 1;
        if (x.deadSteps > 3) { w.usedPercent = 5; x.deadSteps = 0; w.resetsAt = Date.now() + 5 * 3600e3; }
      } else {
        const inc = 3 + Math.random() * 12;
        w.usedPercent = Math.min(100, w.usedPercent + inc);
        const w2 = x.windows[1];
        if (w2) w2.usedPercent = Math.min(99, w2.usedPercent + inc / 8);
        if (w2 && w2.usedPercent > w.usedPercent) w2.usedPercent = w.usedPercent - 1;
      }
      if (x.observedAt) x.observedAt = Date.now();
      // 데모: 쓴 만큼 경험치
      if (x.level != null) { x.levelProgress += 0.18; if (x.levelProgress >= 1) { x.levelProgress -= 1; x.level += 1; } }
      this.data = d;
      onData(d);
    },
    stop() { clearInterval(this.timer); this.timer = null; },
  };

  // ───────── 메인 프로세스와 연결 ─────────
  if (bridge.onPacks) bridge.onPacks((list) => { packs = list; applyTheme(); });
  bridge.onSettings((s) => {
    const wasDemo = settings.demo;
    settings = { ...settings, ...s };
    if (window.TSI18N && settings.lang) window.TSI18N.setLang(settings.lang);
    applyTheme();
    lastMetrics = null; // 설정이 바뀌면 효과 없이 새로 그림
    if (settings.demo && !wasDemo) demo.start();
    if (!settings.demo && wasDemo) { demo.stop(); if (realData) onData(realData); }
    if (!settings.demo && realData) onData(realData);
    if (settings.demo && demo.data) onData(demo.data);
  });
  bridge.onUsage((d) => {
    realData = d;
    if (!settings.demo) onData(d);
  });
  bridge.onLayout((l) => {
    root.classList.toggle('flipped', !!l.flipped);
    scene.resize(); // 크기 설정(확대) 바뀌면 화면 픽셀 기준을 다시 잡음
  });
  // 해상도가 다른 모니터로 옮겨도 다시 맞춤
  const watchDpr = () => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => { scene.resize(); watchDpr(); }, { once: true });
  };
  watchDpr();
  bridge.onCommand(() => {});

  // 업적 달성 토스트
  const toast = document.getElementById('toast');
  let toastTimer = null;
  function showToast(html) {
    toast.innerHTML = html;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
  }
  if (bridge.onAchievement) bridge.onAchievement((a) => showToast(`<b>${esc(a.icon)} ${T('업적 달성')}</b> · ${esc(T(a.name))}<br><span>${esc(T(a.desc))}</span>`));

  // 주간 기록 카드 그리기 요청 → PNG로 돌려줌
  if (bridge.onMakeCard) bridge.onMakeCard((payload) => {
    try { bridge.cardDone(window.renderCard(payload, packs.map((p) => (p.type === 'hero' ? resolveHero(p) : p)))); } catch (e) { console.error(e); }
  });

  // 패널의 "N분 후 리셋" 표시를 주기적으로 갱신
  setInterval(() => {
    const d = settings.demo ? demo.data : realData;
    if (d && root.classList.contains('open')) renderPanel(d);
  }, 15000);

  // ───────── 애니메이션 루프 ─────────
  // 화면 주사율(60·120Hz)만큼 다 그리면 GPU를 계속 쓴다. 싸울 때 30fps, 쉴 때 8fps로 제한
  const ACTIVE_MS = 1000 / 30, IDLE_MS = 1000 / 8;
  let last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    const need = scene.isActive() ? ACTIVE_MS : IDLE_MS;
    if (now - last < need - 2) return;
    scene.frame((now - last) / 1000);
    last = now;
  }
  requestAnimationFrame(loop);
  window.addEventListener('resize', () => scene.resize());
  // ⌥(Option)+스크롤: 위젯 위에서 바로 키우고 줄이기 (위로 굴리면 커짐)
  window.addEventListener('wheel', (e) => {
    if (!e.altKey || !bridge.scaleBy) return;
    e.preventDefault();
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    bridge.scaleBy(-d * 0.002);
  }, { passive: false });

  bridge.ready();

  // 테스트/미리보기용 훅
  window.__slayer = { scene, onData, setOpen, demo, root, showToast, getPacks: () => packs };

  function makeMockBridge() {
    const q = new URLSearchParams(location.search);
    const cbs = {};
    return {
      setInteractive() {}, dragStart() {}, dragEnd() {}, refresh() {}, login() {},
      onSettings(cb) { cbs.settings = cb; },
      onUsage(cb) { cbs.usage = cb; },
      onLayout(cb) { cbs.layout = cb; },
      onCommand(cb) { cbs.command = cb; },
      ready() {
        cbs.layout && cbs.layout({ flipped: q.get('flipped') === '1' });
        const skins = { claude: 'knight', codex: 'wizard', cursor: 'archer' };
        for (const kv of (q.get('skins') || '').split(',').filter(Boolean)) { const [k, v] = kv.split(':'); skins[k] = v; }
        cbs.settings && cbs.settings({ demo: !q.get('static'), skins, unlocked: q.get('unlock') === '1', enemyTheme: q.get('enemies') || 'code', restTheme: q.get('rest') || 'campfire', backdropTheme: q.get('backdrop') || 'night', hpBasis: q.get('basis') ? { claude: q.get('basis') } : {}, heroRes: q.get('res') === 'hd' ? 'hd' : 'classic', lang: q.get('lang') === 'en' ? 'en' : 'ko' });
        if (q.get('open') === '1') { devOpen = true; setOpen(true); }
      },
    };
  }
})();
