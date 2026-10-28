// Token Slayer — Claude / Codex / Cursor 남은 사용량을 화면에 떠 있는 캐릭터로 보여주는 앱
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, net, shell, Notification, clipboard, dialog, globalShortcut, utilityProcess } = require('electron');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const settingsStore = require('./src/settings');
const { UsageService, watchTargets, hpWindows, basisFor, hasBasisChoice } = require('./src/usage');
const { ActivityWatcher } = require('./src/watch');
const claudeWeb = require('./src/claude-web');
const { loadPacks, DEFAULT_SKINS } = require('./src/packs');
const progressStore = require('./src/progress');
const achievements = require('./src/achievements');
const { Updater } = require('./src/updater');
const licenseStore = require('./src/license');
const licenseConfig = require('./src/license-config');
const { SERIES, planSeries } = require('./src/series');
const I18N = require('./renderer/i18n');
const { showOnLaunch } = require('./src/launch');
const errlogLib = require('./src/errlog');
const { omitCookies } = require('./src/nocookie');
const { createReaderLogger } = require('./src/readerlog');
const { tr, trMenu } = I18N;

const BASE_W = 240;
const CHAR_H = 180;
const PANEL_H = 460;
const IS_MAC = process.platform === 'darwin';

// 로컬 오류 기록 (이 컴퓨터의 errors.log에만 남고 전송하지 않는다 · 토큰·이메일·사용자 이름은 지운 뒤 저장)
let errlog = null;
function logErr(kind, message, extra) {
  try { if (!errlog) errlog = errlogLib.create(app.getPath('userData')); errlog.add(kind, message, extra); } catch {}
}
process.on('uncaughtException', (e) => logErr('crash', e));
process.on('unhandledRejection', (e) => logErr('error', e));
app.on('child-process-gone', (_e, d) => logErr('crash', `${d.type} process gone: ${d.reason}`, { exitCode: d.exitCode }));

let win = null;
let tray = null;
let usage = null;
let store = null;
let flipped = false;
let drag = null;
let interactive = false;
let lastMenuSig = '';
let watcherRef = null;
let packs = [];
let updater = null;
let license = null;
let trayMenu = null; // 트레이 메뉴와 같은 메뉴를 용사 오른쪽 클릭으로도 연다 (맥북 노치에 아이콘이 가려질 때)
const userPackDir = () => path.join(app.getPath('userData'), 'packs');
// TOKEN_SLAYER_UNLOCK_ALL=1 은 개발용 (소스로 실행할 때만). 설치본에서는 환경변수 하나로 무료 해금되지 않게 무시한다
const devUnlockAll = () => !app.isPackaged && process.env.TOKEN_SLAYER_UNLOCK_ALL === '1';
const unlocked = () => !!((license && license.isValid()) || devUnlockAll());
let progress = null;
const maxLevel = () => (progress ? progress.maxLevel() : 1);
// 프리미엄 팩: 결제(잠금 해제)했거나, 어느 용사든 해금 레벨에 도달하면 사용 가능
const packOpen = (p) => p.tier !== 'premium' || unlocked() || (p.unlockLevel && maxLevel() >= p.unlockLevel);

// 업적 확인: 새로 달성하면 알림 + 화면 토스트
function checkAchievements() {
  if (!progress || !usage) return;
  const states = Object.values(usage.state);
  const fightingNow = states.filter((x) => x && x.busy).length;
  const deadNow = Object.entries(usage.state).filter(([id, x]) => x && x.ok && x.windows && x.windows.length && Math.min(...hpWindows(x.windows, basisFor(cfg().hpBasis, id)).map((w) => 100 - w.usedPercent)) <= 0.5).length;
  const userPacks = packs.filter((p) => p.source === 'user').length;
  const got = achievements.evaluate(progress, { fightingNow, deadNow, userPacks });
  for (const a of got) {
    if (a.quiet) continue; // 낭비 배지는 알림·토스트 없이 업적 목록에만 조용히 나옴
    notify(tr('🏆 업적 달성 · {name}', { name: tr(a.name) }), tr(a.desc));
    if (win) win.webContents.send('achievement', { id: a.id, icon: a.icon, name: a.name, desc: a.desc });
  }
  if (got.length) buildMenu();
}

// ── 주간 기록 카드 ──
function weekPayload() {
  const keys = [];
  for (let i = 6; i >= 0; i--) keys.push(progressStore.dayKey(Date.now() - i * 86400e3));
  const days = progress.stats().days || {};
  const skins = { ...DEFAULT_SKINS, ...(cfg().skins || {}) };
  const provs = usage.meta().map((m) => {
    const daily = keys.map((k) => (days[k] && days[k][m.id]) || 0);
    const info = progressStore.levelInfo(progress.get(m.id).xp || 0);
    return { id: m.id, name: m.name, color: m.color, skin: skins[m.id], level: info.level, daily, total: Math.round(daily.reduce((a, b) => a + b, 0)) };
  }).filter((p) => p.total > 0 || (usage.state[p.id] && usage.state[p.id].active));
  const sum = achievements.summarize(progress);
  return {
    days: keys,
    providers: provs.slice(0, 3),
    achievements: { got: Object.keys(progress.achievements()).length, total: achievements.LIST.length },
    gameOvers: sum.gameOvers,
    streak: sum.streak,
    openPacks: packs.filter(packOpen).map((p) => `${p.type}:${p.id}`),
  };
}

function makeCard() {
  if (!win) return;
  win.webContents.send('make-card', weekPayload());
}

ipcMain.on('card-done', (_e, dataUrl) => {
  try {
    const img = nativeImage.createFromDataURL(dataUrl);
    const file = path.join(app.getPath('downloads'), `token-slayer-week-${progressStore.dayKey()}.png`);
    fs.writeFileSync(file, img.toPNG());
    clipboard.writeImage(img);
    if (progress) { progress.count('cards'); checkAchievements(); }
    shell.openPath(file);
    notify('📜 주간 기록 카드', '다운로드 폴더에 저장하고 클립보드에 복사했어요. 바로 붙여넣어 공유할 수 있어요.');
  } catch (e) {
    notify('기록 카드를 만들지 못했어요', String(e.message || e));
  }
});

// 화면에서 일어난 일 (숨은 업적용)
ipcMain.on('event', (_e, name) => {
  if (!progress || cfg().demo) return; // 데모 모드의 가짜 장면으로는 업적·알림을 주지 않음
  if (name === 'dragon') progress.flag('dragonSlain');
  if (name === 'dragonAppear') notify('🐉 전설의 DRAGON 출현!', '용사가 맞서 싸우는 중이에요. 눌러서 바로 보기!', revealWidget);
  if (name === 'panel') progress.count('panelOpens');
  checkAchievements();
});

// 메뉴를 1분 안에 5번 열면 '떠나지 마'
let menuOpens = [];
function onMenuShow() {
  const now = Date.now();
  menuOpens = menuOpens.filter((t) => now - t < 60000).concat(now);
  if (menuOpens.length >= 5 && progress) { progress.flag('menuSpam'); menuOpens = []; setTimeout(checkAchievements, 1500); }
}

ipcMain.on('open-menu', () => {
  if (!trayMenu || !win || win.isDestroyed()) return;
  trayMenu.popup({ window: win });
});

ipcMain.on('pet', (_e, id, kind) => {
  if (!progress || cfg().demo) return;
  progress.count('pets');
  if (kind === 'angry') progress.flag('angry');
  if (kind === 'boo') progress.flag('boo');
  checkAchievements();
});

// ── 첫 실행 안내 ──
let onbWin = null;
function openOnboarding() {
  if (onbWin && !onbWin.isDestroyed()) { onbWin.focus(); return; }
  onbWin = new BrowserWindow({
    width: 540, height: 660, resizable: false, title: tr('Token Slayer 시작하기'), backgroundColor: '#141626',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload-onboarding.js'), contextIsolation: true, sandbox: true },
  });
  onbWin.loadFile(path.join(__dirname, 'renderer', 'onboarding.html'), { query: { lang: I18N.getLang() } });
  if (IS_MAC) focusApp();
  onbWin.on('closed', () => {
    onbWin = null;
    // 안내를 그냥 닫아도 용사는 보여줌 (다음 실행 때 다시 안내하지 않음)
    if (!cfg().onboarded) { store.set({ onboarded: true }); toggleVisible(true); }
  });
}

ipcMain.handle('onb:state', () => usage.snapshot());

ipcMain.on('onb:finish', (_e, c) => {
  const patch = { onboarded: true, notify: c.notify !== false, wantAutostart: !!c.autostart };
  if (c.show && typeof c.show === 'object') patch.show = { ...(cfg().show || {}), ...c.show };
  store.set(patch);
  // 개발 실행(npm start)에서는 자동 실행을 등록하지 않음 — 설치한 앱에서 적용
  if (app.isPackaged) { app.setLoginItemSettings({ openAtLogin: !!c.autostart }); store.set({ autoLaunchSet: true }); }
  sendSettings();
  buildMenu();
  toggleVisible(true);
  if (onbWin && !onbWin.isDestroyed()) onbWin.close();
});

// 진단 창: 서비스별 요약(한 줄씩) + 실시간 감시 상세. 스크롤이 유지되도록 내용만 갈아끼움
let diagWin = null;
function diagData() {
  const w = watcherRef ? watcherRef.diag() : {};
  const t = (v) => (v ? new Date(v).toLocaleTimeString() : '-');
  const lines = usage.meta().map((m) => {
    const x = usage.state[m.id] || {};
    const d = w[m.id] || {};
    return `${m.name.padEnd(7)} ${x.busy ? '⚔️ fighting' : '🔥 resting'}  why: ${(x.busyWhy || []).join(', ') || '-'}\n`
      + `        watch events ${d.rawEvents || 0} (accepted ${d.matchedEvents || 0}, probed ${d.probeHits || 0}, last ${d.lastAt || '-'})  · observed ${t(x.observedAt)} · fetch ${x.ok ? 'OK' : (x.message || x.error || '-')}`;
  });
  const tl = w.claude && w.claude.timeline && w.claude.timeline.length ? `\n\n[Claude recent signals]\n${w.claude.timeline.slice(-15).join('\n')}` : '';
  return { summary: lines.join('\n\n') + tl, detail: JSON.stringify(w, null, 2), at: new Date().toLocaleTimeString() };
}
// 지원용 진단 텍스트 (개인 정보 · 토큰 · 사용량 숫자 없이 상태만): 문의할 때 복사해서 붙여 넣는다
async function supportReport() {
  const c = cfg();
  const lines = [`Token Slayer v${app.getVersion()} · ${process.platform}-${process.arch} · Electron ${process.versions.electron}`];
  lines.push(`widget scale ${c.scale} · pixel res ${c.heroRes || 'classic'} · language ${I18N.getLang()} · notifications ${c.notify === false ? 'off' : 'on'} · premium ${unlocked() ? 'unlocked' : 'locked'}`);
  lines.push(`packs: ${packs.filter((p) => p.source === 'builtin').length} built-in · ${packs.filter((p) => p.source === 'user').length} user`);
  for (const m of usage.meta()) {
    const x = usage.state[m.id] || {};
    const l = [`[${m.name}] ${x.ok ? 'fetch OK' : `fetch failed (${x.error || '-'})`}${x.needsLogin ? ' · shows login needed' : ''}${x.stale ? ' · showing last value' : ''}${x.source ? ` · source ${x.source}` : ''}`];
    if (!x.ok && x.message) l.push(`  message: ${x.message}`);
    if (m.id === 'codex') { const r = usage.provider('codex').reader; l.push(`  server lookup: ${cfg().codexServer === false ? 'off (setting)' : (r.serverNote || 'not tried yet')}`); }
    try {
      const r = usage.provider(m.id).reader;
      if (r.diagnose) l.push(`  login state: ${JSON.stringify(await r.diagnose())}`);
    } catch (e) { l.push(`  diagnose failed: ${e && e.message}`); }
    lines.push(l.join('\n'));
  }
  try {
    const recent = errlog ? errlog.recent(12) : errlogLib.create(app.getPath('userData')).recent(12);
    lines.push(`recent log (this computer only · tokens, emails and user names are removed):${recent.length ? '\n  ' + recent.join('\n  ') : ' none'}`);
  } catch {}
  return lines.join('\n');
}

function showDiag() {
  if (!diagWin || diagWin.isDestroyed()) {
    diagWin = new BrowserWindow({ width: 620, height: 760, title: 'Token Slayer diagnostics' });
    const html = `<html><body style="background:#141626;color:#E8E8F0;font:12px Menlo,monospace;padding:12px;white-space:pre-wrap">
<b>Token Slayer diagnostics · <span id="at"></span></b>

<b>요약</b>
<div id="sum"></div>

<b>실시간 감시 상세</b>
<div id="det"></div></body></html>`;
    diagWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const push = () => {
      if (!diagWin || diagWin.isDestroyed()) return;
      const d = diagData();
      diagWin.webContents.executeJavaScript(`document.getElementById('at').textContent=${JSON.stringify(d.at)};document.getElementById('sum').textContent=${JSON.stringify(d.summary)};document.getElementById('det').textContent=${JSON.stringify(d.detail)};`).catch(() => {});
    };
    diagWin.webContents.on('did-finish-load', push);
    const timer = setInterval(push, 2000);
    diagWin.on('closed', () => clearInterval(timer));
  }
  if (IS_MAC) focusApp();
  diagWin.show();
}

// 앱이 스스로 포커스를 가져올 때(안내 창 · 크기 조절 창 등) 생기는 'activate'는 사용자가 앱을 다시 연 것이 아니다
let selfFocusUntil = 0;
function focusApp() { selfFocusUntil = Date.now() + 2000; app.focus({ steal: true }); }

// 앱 안내창: 앱 아이콘을 직접 지정 (소스로 실행할 때 Electron 기본 아이콘이 나오지 않게)
function messageBox(opts) {
  const o = { ...opts };
  for (const k of ['message', 'detail', 'title']) if (typeof o[k] === 'string') o[k] = tr(o[k]);
  if (Array.isArray(o.buttons)) o.buttons = o.buttons.map((b) => tr(b));
  return dialog.showMessageBox({ icon: nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')), ...o });
}

// 추억 팩의 편지(memory.welcome): 그 팩의 용사를 처음 쓸 때 한 번만 보여 준다 (사진이 있으면 아이콘으로)
async function maybeWelcome() {
  const c = cfg();
  const shown = Array.isArray(c.welcomeShown) ? c.welcomeShown : [];
  for (const id of Object.values({ ...DEFAULT_SKINS, ...(c.skins || {}) })) {
    const p = packs.find((x) => x.type === 'hero' && x.id === id);
    const w = p && p.memory && p.memory.welcome;
    if (!w || shown.includes(p.id)) continue;
    store.set({ welcomeShown: [...shown, p.id] }); // 닫아도 다시 뜨지 않게 먼저 기록
    let icon;
    try {
      if (p.memory.photo) { const img = nativeImage.createFromDataURL(p.memory.photo); if (!img.isEmpty()) icon = img.resize({ width: 128 }); }
    } catch {}
    await messageBox({ type: 'none', title: 'Token Slayer', message: w.title, detail: w.body, buttons: [w.button || '고마워요'], ...(icon ? { icon } : {}) });
    return;
  }
}

// 추억 팩의 알림 한마디 (memory.notify[종류]에서 무작위로 하나)
function memoryLine(serviceId, kind) {
  const skinId = { ...DEFAULT_SKINS, ...(cfg().skins || {}) }[serviceId];
  const p = packs.find((x) => x.type === 'hero' && x.id === skinId);
  const list = p && p.memory && p.memory.notify && p.memory.notify[kind];
  return list && list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

function notify(title, body, onClick) {
  if (cfg().notify === false || !Notification.isSupported()) return;
  try {
    const n = new Notification({ title: tr(title), body: tr(body), silent: false });
    if (onClick) n.on('click', onClick);
    n.show();
  } catch {}
}

// 알림을 누르면 용사 창을 보이게 하고 맨 앞으로
function revealWidget() {
  if (!win) return;
  if (!cfg().visible) toggleVisible(true);
  win.showInactive();
  win.setAlwaysOnTop(true, IS_MAC ? 'floating' : 'screen-saver');
  win.flashFrame && win.flashFrame(true);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const cfg = () => store.get();

function dims() {
  const s = cfg().scale || 1;
  return { w: Math.round(BASE_W * s), charH: Math.round(CHAR_H * s), panelH: Math.round(PANEL_H * s) };
}

function defaultPos() {
  const wa = screen.getPrimaryDisplay().workArea;
  const { w, charH } = dims();
  return { x: wa.x + wa.width - w - 16, y: wa.y + wa.height - charH - 16 };
}

// 캐릭터 영역 위치(cfg.pos)를 화면 안으로 맞추고, 위쪽 공간이 모자라면 패널을 아래로 뒤집는다
function applyBounds(send = true) {
  const { w, charH, panelH } = dims();
  let pos = cfg().pos || defaultPos();
  const d = screen.getDisplayNearestPoint({ x: Math.round(pos.x + w / 2), y: Math.round(pos.y + charH / 2) }).workArea;
  pos = {
    x: Math.min(Math.max(pos.x, d.x - w / 3), d.x + d.width - (w * 2) / 3),
    y: Math.min(Math.max(pos.y, d.y), d.y + d.height - charH),
  };
  pos = { x: Math.round(pos.x), y: Math.round(pos.y) };
  store.set({ pos });
  flipped = pos.y - d.y < panelH;
  win.setBounds({ x: pos.x, y: flipped ? pos.y : pos.y - panelH, width: w, height: charH + panelH });
  if (send) win.webContents.send('layout', { flipped });
}

function setIgnore() {
  if (!win) return;
  const ignore = cfg().clickThrough || !interactive;
  win.setIgnoreMouseEvents(ignore, { forward: true });
}

// 서비스별 표시 설정: true(직접 켬) / false(직접 끔) / 없음(최근 30일 사용 여부로 자동)
function showMap() {
  const c = cfg();
  return { ...(c.show || {}) };
}

// 지금 실제로 보이는지 (메뉴 체크 표시용)
function effectiveShow(id) {
  const x = usage.state[id];
  const s = showMap()[id];
  if (!x || x.error === 'not-installed') return false;
  if (s === false) return false;
  if (s === true) return true;
  return !!x.active;
}

// 언어: 설정(자동 · 한국어 · English)과 시스템 언어로 실제 언어를 정해 번역기에 알린다
function applyLang() {
  I18N.setLang(I18N.resolveLang(cfg().lang, app.getLocale()));
}

function sendSettings() {
  if (!win) return;
  const c = cfg();
  win.webContents.send('settings', {
    show: showMap(), demo: c.demo, clickThrough: c.clickThrough,
    skins: { ...DEFAULT_SKINS, ...(c.skins || {}) }, enemyTheme: c.enemyTheme || 'code', restTheme: c.restTheme || 'campfire', backdropTheme: c.backdropTheme || 'night', hpBasis: c.hpBasis || {}, heroRes: c.heroRes === 'hd' ? 'hd' : 'classic',
    unlocked: unlocked(), lang: I18N.getLang(),
    openPacks: packs.filter(packOpen).map((p) => `${p.type}:${p.id}`),
  });
}

function createWindow() {
  const { w, charH, panelH } = dims();
  win = new BrowserWindow({
    width: w,
    height: charH + panelH,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    acceptFirstMouse: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, IS_MAC ? 'floating' : 'screen-saver');
  if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(cfg().scale || 1);
  });

  // 위젯 화면이 멈추거나 죽으면 기록하고, 죽었으면 한 번 다시 불러온다 (1분에 3번까지)
  let reloads = [];
  win.webContents.on('render-process-gone', (_e, d) => {
    logErr('crash', `widget renderer gone: ${d.reason}`, { exitCode: d.exitCode });
    const now = Date.now();
    reloads = reloads.filter((t) => now - t < 60000);
    if (d.reason !== 'clean-exit' && reloads.length < 3 && win && !win.isDestroyed()) { reloads.push(now); try { win.reload(); } catch {} }
  });
  win.on('unresponsive', () => logErr('error', 'widget window unresponsive'));
  win.webContents.on('did-fail-load', (_e, code, desc) => logErr('error', `widget load failed: ${desc}`, { code }));

  win.once('ready-to-show', () => {
    applyBounds();
    // 직접 연 경우에는 숨겨 둔 채 종료했더라도 보여 준다 (로그인으로 저절로 켜진 경우만 숨김 상태를 따른다)
    const show = showOnLaunch(cfg(), { wasOpenedAtLogin: IS_MAC && app.getLoginItemSettings().wasOpenedAtLogin });
    const wasHidden = cfg().visible === false;
    if (show && wasHidden) store.set({ visible: true });
    if (show) win.showInactive();
    logErr('launch', `v${app.getVersion()} ${process.platform}-${process.arch} electron ${process.versions.electron}`, {
      shown: show, wasHidden, displays: screen.getAllDisplays().length, scale: cfg().scale, atLogin: IS_MAC ? app.getLoginItemSettings().wasOpenedAtLogin : null,
    });
  });

  // 다른 창이 위로 올라와도 다시 맨 위로
  win.on('blur', () => win && win.setAlwaysOnTop(true, IS_MAC ? 'floating' : 'screen-saver'));
}

// ───────── IPC ─────────
function reloadPacks() {
  packs = loadPacks(userPackDir());
  if (win) win.webContents.send('packs', packs);
}

ipcMain.on('ready', () => {
  reloadPacks();
  sendSettings();
  applyBounds();
  win.webContents.send('usage', usage.snapshot());
});

ipcMain.on('set-interactive', (_e, v) => {
  interactive = v;
  setIgnore();
});

ipcMain.on('drag-start', () => {
  if (cfg().clickThrough) return;
  const start = screen.getCursorScreenPoint();
  const pos = cfg().pos || defaultPos();
  const { panelH, w, charH } = dims();
  clearInterval(drag && drag.timer);
  drag = {
    timer: setInterval(() => {
      const cur = screen.getCursorScreenPoint();
      const x = pos.x + cur.x - start.x;
      const y = pos.y + cur.y - start.y;
      drag.last = { x, y };
      win.setBounds({ x, y: flipped ? y : y - panelH, width: w, height: charH + panelH });
    }, 16),
    last: null,
  };
});

ipcMain.on('drag-end', () => {
  if (!drag) return;
  clearInterval(drag.timer);
  if (drag.last) {
    store.set({ pos: drag.last });
    applyBounds();
  }
  drag = null;
});

ipcMain.on('refresh', () => usage.refresh());

// 로그인 버튼: 터미널에서 로그인 명령을 실행하거나, 해당 앱을 연다
function openLogin(id) {
  const p = usage.provider(id);
  const L = p && p.login;
  if (!L) return;
  if (L.type === 'web') {
    if (IS_MAC) focusApp(); // Dock 아이콘이 없는 앱이라 창에 입력 포커스를 가져옴
    claudeWeb.openLogin(() => usage.poll(id));
    return;
  }
  if (L.type === 'app') {
    if (IS_MAC) spawn('open', ['-a', L.app], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'win32') {
      const exe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor', 'Cursor.exe');
      if (fs.existsSync(exe)) spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
      else shell.openExternal('cursor://');
    } else spawn(L.app.toLowerCase(), [], { detached: true, stdio: 'ignore' }).unref();
    usage.watchLogin(id);
    return;
  }
  const bin = L.cmd.split(' ')[0];
  if (IS_MAC) {
    // .command 파일은 터미널에서 바로 실행된다 (별도 자동화 권한 필요 없음)
    const file = path.join(app.getPath('temp'), `token-slayer-${id}-login.command`);
    const script = [
      '#!/bin/sh',
      'clear',
      `echo "${tr('Token Slayer: {name} 로그인을 시작해요.', { name: p.name })}"`,
      `echo "${tr(L.hint)}"`,
      `echo "${tr('로그인이 끝나면 이 창은 닫아도 돼요.')}"`,
      'echo',
      // PATH에 없더라도 흔한 설치 위치를 먼저 찾아본다
      `export PATH="$HOME/.local/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:$HOME/.npm-global/bin:$PATH"`,
      `exec "\${SHELL:-/bin/zsh}" -ilc 'export PATH="'"$PATH"':$PATH"; if command -v ${bin} >/dev/null 2>&1; then ${L.cmd}; else echo "${tr('{bin} 명령을 찾지 못했어요.', { bin })} ${tr(L.install)}"; fi; exec "\${SHELL:-/bin/zsh}" -il'`,
      '',
    ].join('\n');
    fs.writeFileSync(file, script, { mode: 0o755 });
    shell.openPath(file);
  } else if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', `"${tr('{name} 로그인', { name: p.name })}"`, 'cmd.exe', '/k', `echo ${tr(L.hint)} & ${L.cmd}`], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  } else {
    spawn('x-terminal-emulator', ['-e', L.cmd], { detached: true, stdio: 'ignore' }).unref();
  }
  usage.watchLogin(id);
}

ipcMain.on('login', (_e, id) => openLogin(id));

// ───────── 트레이 ─────────
function trayImage() {
  if (IS_MAC) {
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
}

// Codex 사용량을 서버에서 조회할지 (기본 켬). 끄면 예전처럼 로컬 기록 파일만 읽고 네트워크에는 묻지 않는다
function applyCodexServer() {
  try { const p = usage && usage.provider('codex'); if (p && p.reader) p.reader.serverEnabled = cfg().codexServer !== false; } catch {}
}

function update(patch) {
  store.set(patch);
  if ('lang' in patch) { applyLang(); if (usage) usage.refresh(); }
  if ('codexServer' in patch) { applyCodexServer(); if (usage) usage.refresh(); }
  if ('hpBasis' in patch && usage) usage.hpBasis = cfg().hpBasis || {};
  if ('skins' in patch) setTimeout(() => maybeWelcome().catch(() => {}), 800);
  sendSettings();
  buildMenu();
  if (progress && ('skins' in patch || 'enemyTheme' in patch || 'restTheme' in patch || 'backdropTheme' in patch)) { noteTriedPacks(); checkAchievements(); }
}

// 지금 쓰는 팩을 "써 본 팩"에 기록 (시리즈 완주 업적용)
function noteTriedPacks() {
  if (!progress) return;
  const c = cfg();
  for (const id of Object.values({ ...DEFAULT_SKINS, ...(c.skins || {}) })) progress.addToSet('packsTried', `hero:${id}`);
  progress.addToSet('packsTried', `enemies:${c.enemyTheme || 'code'}`);
  progress.addToSet('packsTried', `rest:${c.restTheme || 'campfire'}`);
  progress.addToSet('packsTried', `backdrop:${c.backdropTheme || 'night'}`);
}

// 위젯 크기: 메뉴의 단계 선택, 크기 조절 창의 슬라이더, ⌥+스크롤이 모두 여기로 온다.
// commit=false는 슬라이더를 끌거나 스크롤하는 중이라 메뉴는 나중에(끝났을 때) 다시 만든다
let scaleExact = null;      // 스크롤로 조금씩 바꿀 때 반올림 때문에 멈추지 않게 정확한 값을 따로 들고 있음
let scaleCommitTimer = null;
function setScale(v, { commit = true } = {}) {
  scaleExact = Math.min(settingsStore.SCALE_MAX, Math.max(settingsStore.SCALE_MIN, Number(v) || 1));
  const scale = settingsStore.clampScale(scaleExact);
  store.set({ scale });
  win.webContents.setZoomFactor(scale);
  applyBounds();
  if (scaleWin && !scaleWin.isDestroyed()) scaleWin.webContents.send('scale-changed', scale);
  if (commit) buildMenu();
}

// ── 사용 통계 창 ──
// 에이전트들이 이 컴퓨터에 남긴 기록에서 토큰 수 · 시각 · 모델 · 폴더 이름만 읽어 집계한다 (src/stats.js).
// 처음 한 번은 기록을 다 읽고(수십 초), 그 뒤로는 바뀐 파일만 이어 읽는다. 결과 캐시는 이 컴퓨터의 stats-cache.json에만 둔다
const statsLib = require('./src/stats');
let statsWin = null, statsCache = null, statsScan = null;
const statsCachePath = () => path.join(app.getPath('userData'), 'stats-cache.json');
function loadStatsCache() {
  if (statsCache) return statsCache;
  try { statsCache = JSON.parse(fs.readFileSync(statsCachePath(), 'utf8')); } catch { statsCache = null; }
  return statsCache;
}
function refreshStats(force) {
  if (statsScan) return statsScan;
  const c = loadStatsCache();
  if (!force && c && c.v === statsLib.CACHE_VERSION && Date.now() - (c.at || 0) < 60000) return Promise.resolve(c);
  const send = (v) => { if (statsWin && !statsWin.isDestroyed()) statsWin.webContents.send('stats:progress', v); };
  const fallback = () => c || { v: statsLib.CACHE_VERSION, at: Date.now(), files: {} };
  statsScan = new Promise((resolve) => {
    // 계산은 별도 프로세스에서 (메인에서 하면 수십 초 동안 위젯과 창이 멈춘다)
    let child;
    try { child = utilityProcess.fork(path.join(__dirname, 'src', 'stats-worker.js'), [], { serviceName: 'Token Slayer stats' }); }
    catch (e) { logErr('stats', String((e && e.message) || e)); resolve(fallback()); return; }
    let finished = false;
    const end = (cache) => { if (finished) return; finished = true; try { child.kill(); } catch {} resolve(cache); };
    child.on('message', (m) => {
      if (!m) return;
      if (m.type === 'progress') send({ done: m.done, total: m.total });
      if (m.type === 'done') {
        if (!m.ok) logErr('stats', m.error || 'scan failed');
        statsCache = null;
        end(loadStatsCache() || fallback());
      }
    });
    child.on('exit', () => end(loadStatsCache() || fallback()));
    child.postMessage({ cachePath: statsCachePath() });
  }).finally(() => { statsScan = null; });
  return statsScan;
}
ipcMain.handle('stats:get', async (_e, opts = {}) => {
  const c = await refreshStats(!!opts.refresh);
  const days = Number.isFinite(opts.days) ? opts.days : 30;
  return { summary: statsLib.summarize(c, { days }), scannedAt: c.at, files: Object.keys(c.files || {}).length };
});
// 통계 공유 카드: 통계 창이 보낸 기간 요약을 위젯 창(도트 글꼴 · 용사 그림이 있는 곳)이 PNG로 그려서 돌려준다
let statsCardWait = null;
ipcMain.handle('stats:card', (_e, data) => new Promise((resolve) => {
  if (!win || win.isDestroyed() || !data) { resolve({ ok: false }); return; }
  if (statsCardWait) statsCardWait({ ok: false });
  const skins = { ...DEFAULT_SKINS, ...(cfg().skins || {}) };
  const top = Array.isArray(data.agents) && data.agents[0];
  statsCardWait = resolve;
  win.webContents.send('make-stats-card', { ...data, hero: top ? { skin: skins[top.id] || 'knight', color: top.color } : null, openPacks: packs.filter(packOpen).map((p) => `${p.type}:${p.id}`) });
  setTimeout(() => { if (statsCardWait === resolve) { statsCardWait = null; resolve({ ok: false }); } }, 15000);
}));
ipcMain.on('stats-card-done', (_e, dataUrl) => {
  const done = statsCardWait; statsCardWait = null;
  try {
    const img = nativeImage.createFromDataURL(dataUrl);
    const file = path.join(app.getPath('downloads'), `token-slayer-stats-${progressStore.dayKey()}.png`);
    fs.writeFileSync(file, img.toPNG());
    clipboard.writeImage(img);
    if (progress) { progress.count('cards'); checkAchievements(); }
    shell.openPath(file);
    if (done) done({ ok: true, file });
  } catch (e) {
    logErr('stats-card', String((e && e.message) || e));
    if (done) done({ ok: false });
  }
});
// 통계 창이 기록을 읽는 동안 놀이 화면에 나올 용사들 (위젯에 지금 보이는 서비스, 꾸미기 그대로)
ipcMain.handle('stats:heroes', () => {
  const c = cfg();
  const skins = { ...DEFAULT_SKINS, ...(c.skins || {}) };
  const hd = c.heroRes === 'hd' && unlocked();
  const find = (id) => packs.find((p) => p.type === 'hero' && p.id === id && packOpen(p)) || packs.find((p) => p.type === 'hero' && p.id === 'knight');
  return usage.meta().filter((m) => effectiveShow(m.id)).slice(0, 4).map((m) => {
    let p = find(skins[m.id]);
    if (p && hd && p.hd && !p.hires) p = { ...p, hires: true, grid: p.hd.grid, faces: p.hd.faces, palette: { ...(p.palette || {}), ...(p.hd.palette || {}) } };
    return { id: m.id, color: m.color, skin: p || null };
  });
});
function openStatsWindow() {
  if (statsWin && !statsWin.isDestroyed()) { statsWin.show(); statsWin.focus(); return; }
  statsWin = new BrowserWindow({
    width: 760, height: 860, minWidth: 560, minHeight: 600, title: tr('사용 통계'), backgroundColor: '#141626', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload-stats.js'), contextIsolation: true, sandbox: true },
  });
  statsWin.loadFile(path.join(__dirname, 'renderer', 'stats.html'), { query: { lang: I18N.getLang() } });
  if (IS_MAC) focusApp();
  statsWin.on('closed', () => { statsWin = null; });
}

// ── 크기 조절 창 (슬라이더) ──
let scaleWin = null;
function openScaleWindow() {
  if (scaleWin && !scaleWin.isDestroyed()) { scaleWin.show(); scaleWin.focus(); return; }
  scaleWin = new BrowserWindow({
    width: 320, height: 190, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, title: tr('크기 조절'), backgroundColor: '#141626', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload-scale.js'), contextIsolation: true, sandbox: true },
  });
  scaleWin.loadFile(path.join(__dirname, 'renderer', 'scale.html'), { query: { lang: I18N.getLang() } });
  if (IS_MAC) focusApp();
  scaleWin.on('closed', () => { scaleWin = null; buildMenu(); });
}
ipcMain.handle('scale-get', () => ({ scale: cfg().scale || 1, min: settingsStore.SCALE_MIN, max: settingsStore.SCALE_MAX }));
ipcMain.on('scale-set', (_e, v) => { if (win) setScale(v, { commit: false }); });
ipcMain.on('scale-commit', () => buildMenu());
ipcMain.on('scale-reset', () => { if (win) setScale(1); });
// ⌥(Option)+스크롤: 위젯 위에서 바로 키우고 줄이기
ipcMain.on('scale-by', (_e, delta) => {
  if (!win || !Number.isFinite(delta)) return;
  setScale((scaleExact != null ? scaleExact : (cfg().scale || 1)) + delta, { commit: false });
  clearTimeout(scaleCommitTimer);
  scaleCommitTimer = setTimeout(buildMenu, 400);
});

// 어디서든 위젯을 숨기고 보이는 단축키 (맥 ⌘⌥S · 윈도우 Ctrl+Alt+S). 노치에 메뉴바 아이콘이 가려져도 쓸 수 있음
const TOGGLE_KEY = 'CommandOrControl+Alt+S';
let toggleKeyOk = false;
function registerToggleKey() {
  try {
    toggleKeyOk = globalShortcut.register(TOGGLE_KEY, () => {
      if (!win || !cfg().onboarded) return; // 처음 안내 중에는 무시
      toggleVisible(!cfg().visible);
    });
  } catch { toggleKeyOk = false; }
  buildMenu();
}

function toggleVisible(v) {
  store.set({ visible: v });
  if (v) win.showInactive(); else win.hide();
  // 숨겨 둔 동안은 그리기를 멈춘다 (평소에는 다른 창에 가려져도 계속 움직이게 스로틀링 끔)
  try { win.webContents.setBackgroundThrottling(!v); } catch {}
  buildMenu();
}

function achievementsMenu() {
  const got = progress ? progress.achievements() : {};
  const n = Object.keys(got).length;
  return {
    label: tr('업적 ({n}/{total})', { n, total: achievements.LIST.length }),
    submenu: achievements.LIST.flatMap((a, i, arr) => {
      const head = i === 0 || arr[i - 1].group !== a.group
        ? [...(i ? [{ type: 'separator' }] : []), { label: tr(a.group), enabled: false }]
        : [];
      const label = got[a.id] ? `${a.icon} ${tr(a.name)} — ${tr(a.desc)}` : a.hidden ? tr('❓ ??? — 숨은 업적') : `🔒 ${tr(a.name)} — ${tr(a.desc)}`;
      return [...head, { label, enabled: !!got[a.id] }];
    }),
  };
}

// 꾸미기 메뉴: 서비스별 용사 직업, 적 테마, 휴식 장면. 프리미엄 팩은 잠금 표시
function customizeMenu() {
  const c = cfg();
  const skins = { ...DEFAULT_SKINS, ...(c.skins || {}) };
  const open = unlocked();
  const item = (p, checked, onPick) => ({
    label: !packOpen(p) ? tr('🔒 {name} (Lv.{lv} 달성 또는 프리미엄)', { name: tr(p.name), lv: p.unlockLevel || '?' }) : `${tr(p.name)}${p.source === 'user' ? tr(' (내 팩)') : ''}`,
    type: 'radio', checked, enabled: packOpen(p), click: onPick,
  });
  const of = (type) => packs.filter((p) => p.type === type);
  const has = (type, id) => { const p = packs.find((x) => x.type === type && x.id === id); return !!p && packOpen(p); };
  const serviceIds = usage.meta().map((m) => m.id);
  return [
    {
      label: '시리즈 적용 (배경 · 적 · 쉬는 장면 · 용사)',
      submenu: SERIES.map((sr) => {
        const plan = planSeries(sr, has, skins, serviceIds);
        return {
          label: `${sr.icon} ${tr(sr.name)}  ${tr('({open}/{total} 열림)', { open: plan.open, total: plan.total })}`,
          enabled: plan.changes > 0,
          click: () => applySeries(sr),
        };
      }),
    },
    { type: 'separator' },
    ...usage.meta().map((m) => ({
      label: tr('{name} 용사', { name: m.name }),
      submenu: of('hero').map((p) => item(p, skins[m.id] === p.id, () => {
        update({ skins: { ...(cfg().skins || {}), [m.id]: p.id } });
        if (progress) { for (const v of Object.values({ ...DEFAULT_SKINS, ...(cfg().skins || {}) })) progress.addToSet('skinsTried', v); checkAchievements(); }
      })),
    })),
    {
      label: '도트 해상도',
      submenu: [
        { label: '기본 (12칸)', type: 'radio', checked: !(c.heroRes === 'hd' && open), click: () => update({ heroRes: 'classic' }) },
        { label: open ? tr('고해상도 (24칸)') : tr('🔒 고해상도 (24칸, 프리미엄 팩)'), type: 'radio', checked: c.heroRes === 'hd' && open, enabled: open, click: () => update({ heroRes: 'hd' }) },
      ],
    },
    { type: 'separator' },
    { label: '날아오는 적', submenu: of('enemies').map((p) => item(p, (c.enemyTheme || 'code') === p.id, () => update({ enemyTheme: p.id }))) },
    { label: '쉬는 장면', submenu: of('rest').map((p) => item(p, (c.restTheme || 'campfire') === p.id, () => update({ restTheme: p.id }))) },
    { label: '배경', submenu: of('backdrop').map((p) => item(p, (c.backdropTheme || 'night') === p.id, () => update({ backdropTheme: p.id }))) },
    { type: 'separator' },
    ...premiumMenu(open),
    { label: '내 팩 폴더 열기', click: () => { fs.mkdirSync(userPackDir(), { recursive: true }); shell.openPath(userPackDir()); } },
    { label: '팩 다시 불러오기', click: () => { reloadPacks(); sendSettings(); buildMenu(); checkAchievements(); } },
  ];
}

// 시리즈 적용: 열려 있는 팩만 골라 배경 · 적 · 쉬는 장면 · 용사를 한 번에 바꾼다
function applySeries(sr) {
  const has = (type, id) => { const p = packs.find((x) => x.type === type && x.id === id); return !!p && packOpen(p); };
  const plan = planSeries(sr, has, { ...DEFAULT_SKINS, ...(cfg().skins || {}) }, usage.meta().map((m) => m.id));
  if (!plan.changes) return;
  update(plan.patch);
  if (progress) { for (const v of Object.values({ ...DEFAULT_SKINS, ...(cfg().skins || {}) })) progress.addToSet('skinsTried', v); checkAchievements(); }
  if (plan.locked.length) notify(tr('{icon} {name} 시리즈 적용', { icon: sr.icon, name: tr(sr.name) }), tr('열려 있는 팩만 적용했어요. 잠긴 팩 {n}개는 레벨을 올리거나 프리미엄으로 열 수 있어요.', { n: plan.locked.length }));
}

// 프리미엄 팩 결제: 구매 페이지 열기 → 받은 키를 복사 → 메뉴에서 활성화
function premiumMenu(open) {
  if (open) {
    return [
      { label: '✅ 프리미엄 팩 사용 중', enabled: false },
      ...(license && license.info() ? [{ label: '이 컴퓨터에서 라이선스 해제 (다른 곳에서 쓰기)', click: () => deactivateLicense() }] : []),
    ];
  }
  const buyable = !!(licenseConfig.CHECKOUT_URL && licenseConfig.STORE_ID && licenseConfig.PRODUCT_ID);
  return [
    buyable
      ? { label: '프리미엄 팩 구매하기…', click: () => shell.openExternal(licenseConfig.CHECKOUT_URL) }
      : { label: '프리미엄 팩 구매 (준비 중)', enabled: false },
    { label: '복사한 라이선스 키로 잠금 해제', enabled: buyable, click: () => activateFromClipboard() },
  ];
}

async function activateFromClipboard() {
  const r = await license.activate(clipboard.readText());
  if (r.ok) {
    sendSettings(); buildMenu();
    messageBox({ type: 'info', message: '프리미엄 팩이 열렸어요!', detail: '꾸미기 → 시리즈 적용에서 일본풍·한국풍·야근 지옥·던전·할로윈·사이버 세계관을 한 번에 입혀 보세요. 후원해 줘서 고마워요.' });
  } else {
    messageBox({ type: 'warning', message: '잠금 해제에 실패했어요', detail: `${tr(r.message)}\n\n${tr('구매 후 받은 라이선스 키를 복사한 다음 다시 눌러 주세요.')}` });
  }
}

async function deactivateLicense() {
  const r = await license.deactivate();
  if (!r.ok) { messageBox({ type: 'warning', message: '해제하지 못했어요', detail: tr(r.message) }); return; }
  sendSettings(); buildMenu();
}

function buildMenu() {
  const c = cfg();
  const login = app.getLoginItemSettings().openAtLogin;
  const menu = Menu.buildFromTemplate(trMenu([
    { label: 'Token Slayer 보이기', type: 'checkbox', checked: c.visible, accelerator: toggleKeyOk ? TOGGLE_KEY : undefined, registerAccelerator: false, click: (i) => toggleVisible(i.checked) },
    ...(toggleKeyOk ? [] : [{ label: '숨기기 단축키를 쓸 수 없어요 (다른 앱이 쓰는 중)', enabled: false }]),
    { label: '지금 새로고침', click: () => usage.refresh() },
    { type: 'separator' },
    {
      label: '표시할 서비스',
      submenu: [
        ...usage.meta().map((p) => {
          const x = usage.state[p.id] || {};
          const s = showMap()[p.id];
          const how = x.error === 'not-installed' ? tr(' (설치 안 됨)') : s == null ? (x.active ? tr(' (자동 · 최근 사용)') : tr(' (자동 · 30일간 안 씀)')) : '';
          return {
            label: p.name + how, type: 'checkbox', checked: effectiveShow(p.id), enabled: x.error !== 'not-installed',
            click: (i) => update({ show: { ...showMap(), [p.id]: i.checked } }),
          };
        }),
        { type: 'separator' },
        { label: '자동으로 되돌리기 (최근 30일 사용한 것만)', click: () => update({ show: {} }) },
      ],
    },
    {
      label: tr('크기 (×{n})', { n: (c.scale || 1).toFixed(2).replace(/\.?0+$/, '') }),
      submenu: [
        { label: '크기 조절… (슬라이더 · 위젯 위에서 ⌥+스크롤)', click: () => openScaleWindow() },
        { type: 'separator' },
        ...[[0.8, '작게'], [1, '보통'], [1.25, '크게'], [1.5, '아주 크게']]
          .map(([v, l]) => ({ label: l, type: 'radio', checked: (c.scale || 1) === v, click: () => setScale(v) })),
      ],
    },
    // HP 기준은 5시간·주간처럼 창이 둘 이상인 서비스에만 (지금은 Claude). 서비스 이름을 붙여서 전체 설정으로 오해하지 않게
    ...usage.meta().filter((m) => usage.state[m.id] && usage.state[m.id].ok && hasBasisChoice(usage.state[m.id].windows)).map((m) => ({
      label: tr('{name} HP 기준', { name: m.name }),
      submenu: [['auto', '가장 적은 것 (자동)'], ['fiveHour', '5시간 한도'], ['weekly', '주간·월간 한도']]
        .map(([v, l]) => ({ label: l, type: 'radio', checked: basisFor(c.hpBasis, m.id) === v, click: () => update({ hpBasis: { ...(typeof c.hpBasis === 'object' && c.hpBasis || {}), [m.id]: v } }) })),
    })),
    { label: '꾸미기', submenu: customizeMenu() },
    achievementsMenu(),
    { label: '이번 주 기록 카드 만들기', click: () => makeCard() },
    { label: '사용 통계 보기…', click: () => openStatsWindow() },
    { label: '클릭 통과 (마우스 무시)', type: 'checkbox', checked: c.clickThrough, click: (i) => { store.set({ clickThrough: i.checked }); setIgnore(); buildMenu(); } },
    { label: 'Claude 계정 로그인…', click: () => openLogin('claude') },
    { label: 'Claude 계정 로그아웃 (이 앱에서만)', click: async () => { await claudeWeb.logout(); usage.provider('claude').reader.orgId = null; usage.poll('claude'); } },
    { type: 'separator' },
    {
      label: '언어 · Language',
      submenu: [['auto', '자동 (Auto)'], ['ko', '한국어'], ['en', 'English']]
        .map(([v, l]) => ({ label: l, type: 'radio', checked: (c.lang || 'auto') === v, click: () => update({ lang: v }) })),
    },
    { label: '처음 안내 다시 보기', click: () => openOnboarding() },
    { label: '진단 정보 보기', click: () => showDiag() },
    {
      label: '도움말 · 문의',
      submenu: [
        { label: '문의 · 버그 제보 (GitHub)', click: () => shell.openExternal('https://github.com/sigcrew/token-slayer-releases/issues') },
        { label: tr('이메일로 문의 ({mail})', { mail: 'yong@sigcrew.com' }), click: () => shell.openExternal('mailto:yong@sigcrew.com?subject=' + encodeURIComponent('Token Slayer ' + tr('문의'))) },
        { label: '구매 내역 · 라이선스 키 다시 받기', click: () => shell.openExternal('https://app.lemonsqueezy.com/my-orders') },
        { label: '진단 정보 복사 (문의할 때 붙여 넣기)', click: async () => { try { clipboard.writeText(await supportReport()); notify('진단 정보를 복사했어요', '문의할 때 붙여 넣어 주세요. 토큰이나 개인 정보는 들어 있지 않아요.'); } catch (e) { notify('진단 정보를 만들지 못했어요', String((e && e.message) || e)); } } },
        { type: 'separator' },
        { label: 'Token Slayer 사이트 열기', click: () => shell.openExternal('https://token-slayer.vercel.app') },
      ],
    },
    { label: '위치 초기화', click: () => { store.set({ pos: null }); applyBounds(); } },
    { type: 'separator' },
    { label: '데모 모드 (효과 미리보기)', type: 'checkbox', checked: c.demo, click: (i) => update({ demo: i.checked }) },
    { label: 'Codex 사용량을 서버에서 조회 (더 정확 · 끄면 이 컴퓨터 기록만 사용)', type: 'checkbox', checked: c.codexServer !== false, click: (i) => update({ codexServer: i.checked }) },
    { label: '알림 (BURNING TIME · 레벨업 · 한도 리셋)', type: 'checkbox', checked: c.notify !== false, click: (i) => { store.set({ notify: i.checked }); buildMenu(); } },
    { label: '로그인 시 자동 실행', type: 'checkbox', checked: login, click: (i) => { app.setLoginItemSettings({ openAtLogin: i.checked }); buildMenu(); } },
    { type: 'separator' },
    ...updateMenu(),
    { label: '종료', role: 'quit' },
  ]));
  menu.on('menu-will-show', onMenuShow);
  trayMenu = menu;
  tray.setContextMenu(menu);
}

// ───────── 업데이트 ─────────
function updateMenu() {
  if (!updater) return [];
  const st = updater.state;
  const items = [];
  if (updater.ready) items.push({ label: tr('⬆️ 재시작해서 v{v}로 업데이트', { v: updater.ready.version }), click: () => updater.installAndRestart() });
  else if (st.status === 'downloading') items.push({ label: tr('업데이트 내려받는 중… {n}%', { n: st.progress || 0 }), enabled: false });
  else if (st.status === 'checking') items.push({ label: '업데이트 확인 중…', enabled: false });
  else items.push({ label: tr('업데이트 확인 (지금 v{v})', { v: st.current }), click: () => updater.check({ manual: true }) });
  items.push({ label: '자동 업데이트', type: 'checkbox', checked: cfg().autoUpdate !== false, click: (i) => { store.set({ autoUpdate: i.checked }); if (i.checked) updater.check(); buildMenu(); } });
  items.push({ type: 'separator' });
  return items;
}

function setupUpdater() {
  updater = new Updater({ app, net, shell });
  let lastStatus = '';
  updater.on('state', (st) => { if (st.status !== lastStatus) { lastStatus = st.status; buildMenu(); if (st.status === 'error') logErr('updater', st.error || 'update failed'); } });
  updater.on('ready', (u) => {
    buildMenu();
    // 윈도우: 지난번에 받아 두고 설치하지 못한 업데이트(PC를 끄면서 앱이 그냥 꺼진 경우)는 이번에 켜질 때 바로 설치한다.
    // 한 버전에 한 번만 시도해서, 설치가 실패해도 켤 때마다 앱이 꺼지지 않게 한다
    if (process.platform === 'win32' && !u.manual && cfg().autoUpdate !== false && updater.shouldInstallNow()) {
      logErr('updater', `installing v${u.version} downloaded in an earlier session`);
      updater.installAndRestart();
      return;
    }
    if (u.manual) {
      messageBox({ type: 'info', message: tr('v{v} 업데이트가 준비됐어요', { v: u.version }), detail: '지금 재시작하면 새 버전으로 바뀌어요. 레벨·업적·설정은 그대로예요.', buttons: ['지금 재시작', '나중에'], defaultId: 0, cancelId: 1 })
        .then((r) => { if (r.response === 0) updater.installAndRestart(); });
      return;
    }
    notify(tr('⬆️ Token Slayer v{v} 준비됐어요', { v: u.version }), '알림을 누르거나 트레이 메뉴에서 재시작하면 업데이트돼요.', () => updater.installAndRestart());
  });
  updater.on('available', (u) => {
    if (cfg().updateSeen === u.version && !u.manual) return;
    store.set({ updateSeen: u.version });
    const msg = {
      source: '소스에서 실행 중이에요. 터미널에서 git pull && npm start 로 받아요.',
      dmg: '디스크 이미지에서 실행 중이에요. 앱을 응용 프로그램 폴더로 옮기면 다음부터 자동으로 업데이트돼요.',
      translocated: '앱을 응용 프로그램 폴더로 옮기면 다음부터 자동으로 업데이트돼요.',
      readonly: '앱이 있는 폴더에 쓸 수 없어서 직접 받아야 해요. 누르면 다운로드 페이지가 열려요.',
      portable: '포터블 버전은 직접 받아야 해요. 누르면 다운로드 페이지가 열려요.',
    }[u.why] || '누르면 다운로드 페이지가 열려요.';
    // (문구는 notify · messageBox가 번역)
    if (u.manual) {
      messageBox({ type: 'info', message: tr('v{v}이 나왔어요', { v: u.version }), detail: msg, buttons: ['다운로드 페이지 열기', '닫기'], defaultId: 0, cancelId: 1 })
        .then((r) => { if (r.response === 0) shell.openExternal(u.url); });
      return;
    }
    notify(tr('⬆️ Token Slayer v{v} 나왔어요', { v: u.version }), msg, () => shell.openExternal(u.url));
  });
  updater.on('uptodate', (st) => {
    messageBox({ type: 'info', message: '최신 버전이에요', detail: tr('지금 버전 v{v}', { v: st.current }), buttons: ['확인'] });
  });
  updater.on('failed', (st) => {
    messageBox({ type: 'warning', message: '업데이트를 확인하지 못했어요', detail: st.error || '', buttons: ['확인'] });
  });
  if (cfg().autoUpdate !== false) updater.start();
  else updater.cleanup();
}

function trayTooltip(snap) {
  const parts = [];
  for (const p of snap.providers) {
    const x = snap.data[p.id];
    if (x && x.ok && x.windows && x.windows.length) {
      const rem = Math.min(...hpWindows(x.windows, basisFor(cfg().hpBasis, p.id)).map((w) => 100 - w.usedPercent));
      parts.push(`${p.name} ${Math.round(rem)}%`);
    }
  }
  return parts.length ? tr('남은 사용량 · {parts}', { parts: parts.join(' · ') }) : 'Token Slayer';
}

// ───────── 시작 ─────────
// 이미 켜져 있는 앱을 다시 열었을 때(Finder 더블 클릭 · Spotlight · Dock) 위젯이 안 보이면 보여 준다.
//  맥은 이미 실행 중인 앱을 다시 열면 새 프로세스를 띄우지 않고 'activate'만 보낸다. 명령줄로 다시 켠 경우는 'second-instance'
function bringBack() {
  if (!win || win.isDestroyed()) return;
  if (!cfg().onboarded) { openOnboarding(); return; }
  toggleVisible(true);          // 숨겨 둔 상태였으면 다시 보이게 (설정도 보임으로)
  applyBounds();                // 연결을 뺀 모니터 밖에 있었다면 화면 안으로
  win.showInactive();
  win.setAlwaysOnTop(true, IS_MAC ? 'floating' : 'screen-saver');
}
app.on('second-instance', bringBack);
app.on('activate', (_e, hasVisibleWindows) => {
  if (!store || !win || Date.now() < selfFocusUntil) return;
  if (!hasVisibleWindows) bringBack();     // 보이는 창이 하나도 없을 때 다시 열었다 = 위젯을 찾는 중
  else if (cfg().visible) applyBounds();   // 보이고는 있는데 모니터 밖으로 밀려났을 수 있으니 화면 안으로
});

// 이름 변경(Token Buddy → Token Slayer) 전 기록 옮기기: 레벨·업적·설정·claude.ai 로그인
function migrateFromTokenBuddy() {
  try {
    const newDir = app.getPath('userData');
    const oldDir = path.join(app.getPath('appData'), 'Token Buddy');
    if (!fs.existsSync(oldDir) || fs.existsSync(path.join(newDir, 'progress.json')) || fs.existsSync(path.join(newDir, 'settings.json'))) return;
    fs.mkdirSync(newDir, { recursive: true });
    for (const name of ['settings.json', 'progress.json', 'packs', 'Partitions']) {
      const from = path.join(oldDir, name);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(newDir, name), { recursive: true });
    }
  } catch {}
}
migrateFromTokenBuddy();
require('./src/legacy').renameClaudePartition(app.getPath('userData')); // 옛 이름의 claude.ai 세션 저장소를 새 이름으로

app.whenReady().then(() => {
  if (IS_MAC && app.dock) app.dock.hide();
  store = settingsStore.create(app.getPath('userData'));
  applyLang();
  license = licenseStore.create(app.getPath('userData'), { fetchFn: omitCookies((url, opts) => net.fetch(url, opts)) });
  const checkLicense = async () => { const r = await license.revalidate(); if (r.changed) { sendSettings(); buildMenu(); notify('프리미엄 라이선스가 해제됐어요', '환불되었거나 비활성화된 키예요.'); } };
  setTimeout(checkLicense, 8000);
  setInterval(checkLicense, 6 * 3600e3);

  progress = progressStore.createStore(app.getPath('userData'));
  noteTriedPacks();
  // 경험치 공평화 이전에 쌓인 Codex(주간)·Cursor(월간) 사용량을 새 가중치로 한 번 보정
  const st = progress.stats();
  if (!st.xpWeightV2) {
    const extra = { codex: 400 - 100, cursor: 1500 - 100 };
    for (const [id, add] of Object.entries(extra)) {
      const pct = Object.values(st.days || {}).reduce((a, d) => a + (d[id] || 0), 0);
      if (pct > 0) progress.addXp(id, pct * add);
    }
    progress.flag('xpWeightV2');
  }
  const watcher = new ActivityWatcher(watchTargets());
  watcherRef = watcher;
  usage = new UsageService(omitCookies((url, opts) => net.fetch(url, opts)), { claudeWeb, progress, watcher });
  applyCodexServer();
  usage.on('burning', (b) => {
    const mins = Math.max(1, Math.round(b.msLeft / 60000));
    const left = mins >= 120 ? tr('{n}시간', { n: Math.round(mins / 60) }) : tr('{n}분', { n: mins });
    const line = memoryLine(b.id, 'burning');
    notify(`🔥 BURNING TIME · ${b.name}`, `${tr('리셋까지 {left}, 한도가 {n}% 남았어요. 지금 쓰면 경험치 2배!', { left, n: b.remaining })}${line ? `\n${line}` : ''}`);
  });
  usage.hpBasis = cfg().hpBasis || {};
  usage.on('stats', () => checkAchievements());
  usage.on('hpwarn', (e) => {
    const dur = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m >= 120 ? tr('{h}시간 {m}분', { h: Math.floor(m / 60), m: m % 60 }) : m >= 60 ? tr('1시간 {m}분', { m: m - 60 }) : tr('{m}분', { m }); };
    let body = tr('남은 사용량이 {n}%예요.', { n: e.remaining });
    const f = e.forecast;
    if (f && f.beforeReset) body += ` ${tr('이 속도면 {eta} 뒤 바닥나요', { eta: dur(f.etaMs) })}${f.resetInMs ? ` ${tr('(리셋은 {reset} 뒤)', { reset: dur(f.resetInMs) })}` : ''}.`;
    else if (f) body += ` ${tr('지금 속도면 리셋 전까지는 버틸 수 있어요.')}`;
    const line = memoryLine(e.id, 'warn');
    notify(`${e.threshold === 10 ? '🚨' : '⚠️'} ${tr('{name} 용사 HP {n}%', { name: e.name, n: e.threshold })}`, line ? `${body}\n${line}` : body, revealWidget);
  });
  usage.on('update', () => {
    // 파티 결성(셋이 동시에 전투) 같은 업적은 상태만으로 판단
    const fighting = Object.values(usage.state).filter((x) => x && x.busy).length;
    if (fighting >= 3) checkAchievements();
  });
  // 서비스 조회 상태가 바뀔 때만 오류 기록에 남긴다 ("왜 안 나오지?"를 나중에 볼 수 있게)
  usage.on('update', createReaderLogger(logErr));
  usage.on('anomaly', (a) => logErr('reader', a.kind === 'drop' ? `${a.name}: ignored a suspicious drop once (${a.key} ${a.from}% -> ${a.to}%, same cycle)` : `${a.name}: ignored an implausible usage jump (+${a.delta} points in one step) for XP`));
  usage.on('reset', (e) => {
    const line = memoryLine(e.id, 'reset');
    notify(tr('🧪 한도가 리셋됐어요 · {name}', { name: e.name }), `${tr('남은 사용량 {before}% → {after}%. 다시 달릴 시간이에요!', { before: e.before, after: e.after })}${line ? `\n${line}` : ''}`, revealWidget);
  });
  usage.on('levelup', (e) => {
    const line = memoryLine(e.id, 'levelup');
    notify(`⚔️ LEVEL UP · ${tr('{name} 용사 Lv.{lv}', { name: e.name, lv: e.level })}`, line ? `${line}\n${tr('새로 열린 꾸미기가 있는지 확인해 보세요.')}` : '새로 열린 꾸미기가 있는지 확인해 보세요.');
    sendSettings();
    buildMenu();
    checkAchievements();
  });
  usage.on('update', (snap) => {
    if (onbWin && !onbWin.isDestroyed()) onbWin.webContents.send('onb:state', snap);
    if (win && !win.isDestroyed()) win.webContents.send('usage', snap);
    if (tray) {
      tray.setToolTip(trayTooltip(snap));
      const sig = snap.providers.map((p) => `${p.id}:${snap.data[p.id].active ? 1 : 0}:${snap.data[p.id].error === 'not-installed' ? 1 : 0}:${snap.data[p.id].ok && hasBasisChoice(snap.data[p.id].windows) ? 1 : 0}`).join(',');
      if (sig !== lastMenuSig) { lastMenuSig = sig; buildMenu(); }
    }
  });

  packs = loadPacks(userPackDir());
  createWindow();
  setTimeout(() => maybeWelcome().catch(() => {}), 6000);
  tray = new Tray(trayImage());
  tray.setToolTip('Token Slayer');
  buildMenu();
  if (!IS_MAC) tray.on('click', () => toggleVisible(!cfg().visible));
  registerToggleKey();

  // 설치한 앱으로 처음 실행되면 로그인 시 자동 실행을 켜 둔다 (트레이 메뉴에서 끌 수 있음)
  if (app.isPackaged && !cfg().autoLaunchSet && cfg().onboarded) {
    app.setLoginItemSettings({ openAtLogin: cfg().wantAutostart !== false });
    store.set({ autoLaunchSet: true });
    buildMenu();
  }

  usage.start();
  setupUpdater();
  buildMenu();
  if (!cfg().onboarded) {
    store.set({ visible: false });
    if (win) win.hide();
    setTimeout(openOnboarding, 600);
  }
  setTimeout(checkAchievements, 8000);
  setInterval(checkAchievements, 3600e3); // 시간이 지나야 받는 업적(동면 등)은 이벤트 없이도 확인

  screen.on('display-removed', () => applyBounds());
  screen.on('display-metrics-changed', () => applyBounds());
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });
app.on('before-quit', () => {
  if (usage) usage.stop();
  if (updater) {
    updater.stop();
    // 받아 둔 업데이트가 있으면 종료하면서 바꿔 넣는다 (자동 업데이트를 껐으면 하지 않음)
    if (updater.ready && cfg().autoUpdate !== false) { try { updater.installOnQuit(); } catch {} }
  }
});
