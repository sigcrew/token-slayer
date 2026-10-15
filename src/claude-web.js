// claude.ai 로그인 창과 그 세션으로 하는 사용량 조회 (Electron 메인 프로세스 전용).
// 로그인 정보는 Token Slayer 전용 세션(partition)에만 저장되고, 다른 앱의 로그인은 건드리지 않는다.
const { session, net, BrowserWindow } = require('electron');
const { tr } = require('../renderer/i18n');

const PARTITION = 'persist:token-slayer-claude'; // 예전 이름(token-buddy-claude) 저장소는 실행할 때 이 이름으로 옮겨 온다 (src/legacy.js)
const ORIGIN = 'https://claude.ai';

let ses = null;
function getSession() {
  if (!ses) {
    ses = session.fromPartition(PARTITION);
    // 일반 Chrome처럼 보이게 (Electron 표시가 있으면 로그인·보안 확인이 막히는 경우가 있음)
    ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|token-buddy|token-slayer|Token Buddy|Token Slayer)\/\S+/gi, ''));
  }
  return ses;
}

async function cookie(name) {
  const c = await getSession().cookies.get({ url: ORIGIN, name });
  return c.length ? c[0].value : null;
}

async function hasSession() {
  return !!(await cookie('sessionKey'));
}

// 세션 쿠키를 붙여 GET 요청
function request(path) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url: ORIGIN + '/api' + path, session: getSession(), useSessionCookies: true });
    req.setHeader('Accept', 'application/json');
    let body = '';
    const timer = setTimeout(() => { try { req.abort(); } catch {} reject(new Error('timeout')); }, 15000);
    req.on('response', (res) => {
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        clearTimeout(timer);
        let json = null;
        try { json = JSON.parse(body); } catch {}
        const ct = String(res.headers['content-type'] || '');
        resolve({ status: res.statusCode, json, challenge: !json && /text\/html/.test(ct) && /just a moment|challenge/i.test(body) });
      });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

// 보안 확인(Cloudflare) 화면이 나오면, 숨은 창에서 실제 브라우저처럼 열어 통과한 뒤 읽는다
let hidden = null;
async function viaWindow(path) {
  if (!hidden || hidden.isDestroyed()) {
    hidden = new BrowserWindow({ show: false, webPreferences: { partition: PARTITION, sandbox: true } });
  }
  await hidden.loadURL(ORIGIN + '/api' + path);
  for (let i = 0; i < 8; i++) {
    const text = await hidden.webContents.executeJavaScript('document.body ? document.body.innerText : ""');
    try { return { status: 200, json: JSON.parse(text) }; } catch {}
    if (/401|unauthorized|permission/i.test(text) && text.length < 400) return { status: 401, json: null };
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { status: 403, json: null };
}

async function get(path) {
  const r = await request(path);
  if (r.challenge) return viaWindow(path);
  return r;
}

// 로그인 창: 로그인이 끝나(sessionKey 쿠키가 생기고 로그인 페이지를 벗어나면) 자동으로 닫힌다
let loginWin = null;
function openLogin(onDone) {
  if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return; }
  loginWin = new BrowserWindow({
    width: 480,
    height: 720,
    title: tr('Claude 로그인 · Token Slayer'),
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true },
  });
  const w = loginWin;
  // 로그인 과정의 팝업(구글 등)도 같은 세션의 창으로 연다
  w.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { width: 480, height: 640, autoHideMenuBar: true, webPreferences: { partition: PARTITION, sandbox: true } },
  }));
  // 로그인 페이지 위에 안내 한 줄
  w.webContents.on('did-finish-load', () => {
    const url = w.webContents.getURL();
    if (!/claude\.ai\/(login|magic-link)/.test(url)) return;
    w.webContents.executeJavaScript(`(() => {
      if (document.getElementById('tb-hint')) return;
      const d = document.createElement('div');
      d.id = 'tb-hint';
      d.innerHTML = ${JSON.stringify(tr('Token Slayer: 사용량을 보려고 로그인해요.<br>Google 로그인이 막히면, Google 계정의 <b>Gmail 주소를 이메일 칸에</b> 넣으세요. 같은 계정으로 로그인 코드가 와요.'))};
      d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:10px 14px;background:#26222B;color:#fff;font:13px/1.5 -apple-system,system-ui,sans-serif;text-align:center';
      document.body.appendChild(d);
    })()`).catch(() => {});
  });
  w.loadURL(ORIGIN + '/login');

  let finished = false;
  const timer = setInterval(async () => {
    if (w.isDestroyed()) return;
    let path = '';
    try { path = new URL(w.webContents.getURL()).pathname; } catch {}
    if (await hasSession() && !/^\/(login|magic-link|oauth|auth)/.test(path)) {
      finished = true;
      clearInterval(timer);
      w.close();
    }
  }, 1000);
  w.on('closed', () => {
    clearInterval(timer);
    loginWin = null;
    onDone && onDone(finished);
  });
}

async function logout() {
  await getSession().clearStorageData();
}

module.exports = { hasSession, get, cookie, openLogin, logout, PARTITION };
