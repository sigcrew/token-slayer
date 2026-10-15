// 첫 실행 안내: 소개 → 읽는 것 → 서비스 선택 → 알림·자동 실행
(function () {
  const $ = (s) => document.querySelector(s);
  const T = (ko, vars) => window.TSI18N.tr(ko, vars);
  const steps = [...document.querySelectorAll('section[data-step]')];
  const dots = [...document.querySelectorAll('.dots i')];
  let step = 0;

  // 브라우저에서 열어 볼 때 쓰는 가짜 연결
  const bridge = window.onboard || {
    getState: async () => ({
      providers: [
        { id: 'claude', name: 'Claude', color: '#E07A5F' },
        { id: 'codex', name: 'Codex', color: '#6C8CFF' },
        { id: 'cursor', name: 'Cursor', color: '#B98CFF' },
      ],
      data: {
        claude: { ok: false, needsLogin: true, error: 'expired' },
        codex: { ok: true, active: true, windows: [{ usedPercent: 56 }] },
        cursor: { ok: true, active: false, windows: [{ usedPercent: 12 }] },
      },
    }),
    login: () => {},
    finish: () => {},
    onState: () => {},
  };

  // ── 1단계: 용사 미리보기 ──
  const scene = new window.Scene($('#hero'));
  const packs = window.BUILTIN_PACKS || [];
  const find = (id) => packs.find((p) => p.type === 'hero' && p.id === id);
  scene.setHeroes([
    { id: 'claude', name: 'Claude', color: '#E07A5F' },
    { id: 'codex', name: 'Codex', color: '#6C8CFF' },
    { id: 'cursor', name: 'Cursor', color: '#B98CFF' },
  ]);
  scene.setTheme({ skins: { claude: find('knight'), codex: find('wizard'), cursor: find('archer') } });
  scene.setState('claude', { hp: 82, busy: true, level: 7, levelProgress: 0.4 });
  scene.setState('codex', { hp: 44, busy: true, level: 4, levelProgress: 0.7 });
  scene.setState('cursor', { hp: 58, busy: false, level: 2, levelProgress: 0.2 });
  let last = performance.now();
  (function loop(now) { scene.frame((now - last) / 1000); last = now; requestAnimationFrame(loop); })(last);
  setInterval(() => { scene.hit('claude', 1); }, 5000);

  // ── 3단계: 서비스 목록 ──
  const choices = {};
  let state = null;

  function statusOf(x) {
    if (!x || x.error === 'loading') return { text: T('확인 중…'), cls: '' };
    if (x.error === 'not-installed') return { text: T('이 컴퓨터에 설치되어 있지 않아요'), cls: '' };
    if (x.needsLogin) return { text: T('로그인이 필요해요'), cls: 'warn' };
    if (x.ok) {
      const hp = x.windows && x.windows.length ? Math.round(Math.min(...x.windows.map((w) => 100 - w.usedPercent))) : null;
      return { text: `${x.active ? T('최근 30일 안에 사용') : T('30일간 사용 기록 없음')}${hp != null ? ` · HP ${hp}%` : ''}`, cls: x.active ? 'good' : '' };
    }
    return { text: T(x.message || '사용량을 가져오지 못했어요'), cls: 'warn' };
  }

  const LOGIN_LABEL = { claude: T('claude.ai 로그인'), codex: T('로그인'), cursor: T('Cursor 열기') };

  function renderSvcs() {
    if (!state) return;
    const box = $('#svcs');
    box.innerHTML = '';
    for (const p of state.providers) {
      const x = state.data[p.id] || {};
      const installed = x.error !== 'not-installed';
      if (choices[p.id] === undefined && x.error !== 'loading') choices[p.id] = installed && (!!x.active || !!x.needsLogin);
      const st = statusOf(x);
      const row = document.createElement('div');
      row.className = `svc${installed ? '' : ' off'}`;
      row.innerHTML = `<span class="dot" style="background:${p.color}"></span>
        <div class="info"><div class="name"></div><div class="st ${st.cls}"></div></div>`;
      row.querySelector('.name').textContent = T('{name} 용사', { name: p.name });
      row.querySelector('.st').textContent = st.text;
      if (x.needsLogin) {
        const b = document.createElement('button');
        b.className = 'sec login';
        b.textContent = LOGIN_LABEL[p.id] || '로그인';
        b.onclick = () => { bridge.login(p.id); b.textContent = T('로그인 기다리는 중…'); b.disabled = true; };
        row.appendChild(b);
      }
      const sw = document.createElement('label');
      sw.className = 'sw';
      sw.innerHTML = '<input type="checkbox"><span></span>';
      const input = sw.querySelector('input');
      input.checked = !!choices[p.id];
      input.disabled = !installed;
      input.onchange = () => { choices[p.id] = input.checked; };
      row.appendChild(sw);
      box.appendChild(row);
    }
  }

  bridge.getState().then((s) => { state = s; renderSvcs(); });
  bridge.onState((s) => { state = s; renderSvcs(); });

  // ── 단계 이동 ──
  function show(i) {
    step = i;
    steps.forEach((el, k) => { el.hidden = k !== i; });
    dots.forEach((d, k) => d.classList.toggle('on', k <= i));
    $('#back').disabled = i === 0;
    $('#next').textContent = i === steps.length - 1 ? T('시작하기 ⚔️') : T('다음');
  }
  $('#back').onclick = () => show(Math.max(0, step - 1));
  $('#next').onclick = () => {
    if (step < steps.length - 1) return show(step + 1);
    const show_ = {};
    if (state) for (const p of state.providers) if (choices[p.id] !== undefined) show_[p.id] = !!choices[p.id];
    bridge.finish({ show: show_, notify: $('#notify').checked, autostart: $('#autostart').checked });
  };
  show(0);

  window.__onb = { show, scene };
})();
