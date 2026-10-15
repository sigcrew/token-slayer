// 자동 업데이트 (외부 라이브러리 없이)
// GitHub Releases에서 새 버전을 확인 → 이 컴퓨터에 맞는 파일을 내려받고 SHA-256으로 확인 → 재시작할 때 설치.
//  - 맥: zip을 풀어 둔 새 앱을, 앱이 꺼진 뒤 작은 스크립트가 원래 자리에 바꿔 넣고 다시 연다.
//  - 윈도우: 설치 파일을 조용히(/S) 실행하면 설치 후 다시 켜진다.
//  - 바꿔 넣을 수 없는 곳에서 실행 중이면(디스크 이미지, 소스 실행 등) 다운로드 페이지만 알려 준다.
const { tr } = require('../renderer/i18n');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { spawn, execFile, execFileSync } = require('child_process');

// 설치 파일은 코드 저장소(비공개)가 아니라 배포 전용 공개 저장소에 올린다
const REPO = 'sigcrew/token-slayer-releases';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_EVERY = 3600e3;
const FIRST_CHECK_MS = 30e3;

// 폴더 통째로 지우기. Electron의 fs는 app.asar를 '폴더'처럼 다뤄서, 받아 둔 새 앱(…/Contents/Resources/app.asar)이 들어 있는
// 폴더를 그냥 지우면 ENOTDIR로 실패한다 → asar 처리를 잠깐 끄고 지우고, 그래도 안 되면 운영체제 명령으로 지운다
function removeDir(dir) {
  const prev = process.noAsar;
  process.noAsar = true;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    if (!fs.existsSync(dir)) return;
  } catch {} finally { process.noAsar = prev; }
  try {
    if (process.platform === 'win32') execFileSync('cmd', ['/c', 'rmdir', '/s', '/q', dir], { stdio: 'ignore' });
    else execFileSync('/bin/rm', ['-rf', dir], { stdio: 'ignore' });
  } catch {}
}

// ── 순수 함수 (테스트용) ──
function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  return { nums: [+m[1], +m[2], +m[3]], pre: m[4] || null };
}

// a > b 이면 1, 같으면 0, 작으면 -1 (정식 버전 > 같은 번호의 미리보기 버전)
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

// 이 컴퓨터에 맞는 파일 고르기. 이름 규칙은 package.json의 artifactName과 맞춘다.
//   맥: TokenSlayer-0.20.0-mac-arm64.zip   윈도우: TokenSlayer-Setup-0.20.0-x64.exe
function pickAsset(assets, platform = process.platform, arch = process.arch) {
  const list = (assets || []).filter((a) => a && a.name && a.browser_download_url);
  const archRe = arch === 'arm64' ? /arm64/i : /x64|x86_64|amd64/i;
  if (platform === 'darwin') {
    return list.find((a) => /-mac-/i.test(a.name) && /\.zip$/i.test(a.name) && archRe.test(a.name)) || null;
  }
  if (platform === 'win32') {
    return list.find((a) => /Setup/i.test(a.name) && /\.exe$/i.test(a.name) && archRe.test(a.name)) || null;
  }
  return null;
}

// 다운로드 페이지에 걸어 둘 설치 파일 (맥은 dmg)
function pickInstaller(assets, platform = process.platform, arch = process.arch) {
  const list = assets || [];
  const archRe = arch === 'arm64' ? /arm64/i : /x64/i;
  if (platform === 'darwin') return list.find((a) => /\.dmg$/i.test(a.name) && archRe.test(a.name)) || null;
  return pickAsset(list, platform, arch);
}

function digestOf(asset) {
  const d = asset && asset.digest;
  const m = typeof d === 'string' && d.match(/^sha256:([0-9a-f]{64})$/i);
  return m ? m[1].toLowerCase() : null;
}

// 릴리스 본문에서 SHA256SUMS 파일 내용 읽기 ("해시  파일이름" 줄)
function parseSums(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m) out[m[2].trim()] = m[1].toLowerCase();
  }
  return out;
}

// 맥 앱 번들 경로 (…/Token Slayer.app)
function macBundlePath(exePath) {
  const i = exePath.indexOf('.app/Contents/MacOS/');
  return i < 0 ? null : exePath.slice(0, i + 4);
}

// 바꿔 넣을 수 있는 자리에서 실행 중인지
function canSelfInstall({ platform, isPackaged, exePath, writable }) {
  if (!isPackaged) return { ok: false, why: 'source' };
  if (platform === 'darwin') {
    const b = macBundlePath(exePath);
    if (!b) return { ok: false, why: 'unknown' };
    if (b.startsWith('/Volumes/')) return { ok: false, why: 'dmg' };
    if (b.includes('/AppTranslocation/')) return { ok: false, why: 'translocated' };
    if (!writable(path.dirname(b))) return { ok: false, why: 'readonly' };
    return { ok: true, bundle: b };
  }
  if (platform === 'win32') {
    if (process.env.PORTABLE_EXECUTABLE_FILE) return { ok: false, why: 'portable' };
    return { ok: true };
  }
  return { ok: false, why: 'platform' };
}

// ── 업데이터 ──
class Updater extends EventEmitter {
  // opts: { app, net, shell, fetchJson?, now? }
  constructor(opts) {
    super();
    this.app = opts.app;
    this.net = opts.net;
    this.shell = opts.shell;
    this.dir = path.join(this.app.getPath('userData'), 'updates');
    this.state = { status: 'idle', current: this.app.getVersion(), latest: null, error: null, progress: 0, checkedAt: 0 };
    this.release = null;
    this.ready = null; // { version, kind, path }
    this.timer = null;
    this.busy = false;
  }

  set(patch) { Object.assign(this.state, patch); this.emit('state', { ...this.state }); }

  start() {
    this.cleanup();
    setTimeout(() => this.check(), FIRST_CHECK_MS);
    this.timer = setInterval(() => this.check(), CHECK_EVERY);
  }

  stop() { clearInterval(this.timer); }

  cleanup() { removeDir(this.dir); }

  async fetchJson(url) {
    const r = await this.net.fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'token-slayer-updater' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  // manual: 메뉴에서 직접 누른 경우 (결과를 알려 줌)
  async check({ manual = false } = {}) {
    if (this.busy) return this.state;
    if (this.ready) { if (manual) this.emit('ready', { ...this.ready, manual }); return this.state; }
    this.busy = true;
    this.set({ status: 'checking', error: null });
    try {
      const rel = await this.fetchJson(API);
      const latest = String(rel.tag_name || '').replace(/^v/i, '');
      this.release = rel;
      if (!latest || rel.draft || rel.prerelease || compareVersions(latest, this.state.current) <= 0) {
        this.set({ status: 'latest', latest: latest || null, checkedAt: Date.now() });
        if (manual) this.emit('uptodate', this.state);
        return this.state;
      }
      this.set({ latest, checkedAt: Date.now() });
      const where = canSelfInstall({
        platform: process.platform, isPackaged: this.app.isPackaged, exePath: this.app.getPath('exe'),
        writable: (d) => { try { fs.accessSync(d, fs.constants.W_OK); return true; } catch { return false; } },
      });
      const asset = pickAsset(rel.assets);
      if (!where.ok || !asset) {
        this.set({ status: 'available' });
        this.emit('available', { version: latest, url: rel.html_url, manual, why: where.ok ? 'no-asset' : where.why, installer: pickInstaller(rel.assets) });
        return this.state;
      }
      await this.download(rel, asset, latest, where, manual);
      return this.state;
    } catch (e) {
      this.set({ status: 'error', error: String(e.message || e) });
      if (manual) this.emit('failed', this.state);
      return this.state;
    } finally {
      this.busy = false;
    }
  }

  async expectedHash(rel, asset) {
    const d = digestOf(asset);
    if (d) return d;
    const sums = (rel.assets || []).find((a) => /^SHA256SUMS/i.test(a.name));
    if (!sums) return null;
    const r = await this.net.fetch(sums.browser_download_url, { headers: { 'User-Agent': 'token-slayer-updater' } });
    if (!r.ok) return null;
    return parseSums(await r.text())[asset.name] || null;
  }

  async download(rel, asset, version, where, manual = false) {
    this.set({ status: 'downloading', progress: 0 });
    const want = await this.expectedHash(rel, asset);
    if (!want) throw new Error(tr('파일 확인값(SHA-256)이 없어서 설치하지 않았어요'));
    removeDir(this.dir);
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, asset.name.replace(/[^\w.-]/g, '_'));
    const r = await this.net.fetch(asset.browser_download_url, { headers: { 'User-Agent': 'token-slayer-updater' } });
    if (!r.ok || !r.body) throw new Error(tr('다운로드 실패 (HTTP {n})', { n: r.status }));
    const total = +r.headers.get('content-length') || asset.size || 0;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(file);
    let got = 0, lastEmit = 0;
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      hash.update(buf);
      if (!out.write(buf)) await new Promise((res) => out.once('drain', res));
      got += buf.length;
      if (total && Date.now() - lastEmit > 500) { lastEmit = Date.now(); this.set({ progress: Math.round((got / total) * 100) }); }
    }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    if (hash.digest('hex') !== want) { fs.rmSync(file, { force: true }); throw new Error(tr('내려받은 파일이 확인값과 달라서 버렸어요')); }

    if (process.platform === 'darwin') {
      const unpack = path.join(this.dir, 'app');
      await new Promise((res, rej) => execFile('/usr/bin/ditto', ['-x', '-k', file, unpack], (e) => (e ? rej(e) : res())));
      const name = fs.readdirSync(unpack).find((n) => n.endsWith('.app'));
      if (!name) throw new Error(tr('업데이트 파일 안에 앱이 없어요'));
      this.ready = { version, kind: 'mac', path: path.join(unpack, name), bundle: where.bundle };
    } else {
      this.ready = { version, kind: 'win', path: file };
    }
    this.set({ status: 'ready', progress: 100 });
    this.emit('ready', { ...this.ready, manual });
  }

  // 앱을 끄고 새 버전으로 바꿔 넣은 뒤 다시 켠다
  installAndRestart() {
    return this.install({ relaunch: true, quit: true });
  }

  // 사용자가 그냥 종료할 때: 꺼진 뒤에 조용히 바꿔 넣기만 하고 다시 켜지 않는다
  installOnQuit() {
    return this.install({ relaunch: false, quit: false });
  }

  install({ relaunch, quit }) {
    const u = this.ready;
    if (!u || this.installing) return false;
    this.installing = true;
    if (u.kind === 'mac') {
      const script = path.join(os.tmpdir(), `token-slayer-update-${process.pid}.sh`);
      fs.writeFileSync(script, [
        '#!/bin/bash',
        'PID="$1"; NEW="$2"; DEST="$3"; RELAUNCH="$4"',
        'for i in $(seq 1 100); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done',
        'rm -rf "$DEST.old"',
        'if mv "$DEST" "$DEST.old" && /usr/bin/ditto "$NEW" "$DEST"; then rm -rf "$DEST.old"; else rm -rf "$DEST"; mv "$DEST.old" "$DEST"; fi',
        '/usr/bin/xattr -dr com.apple.quarantine "$DEST" 2>/dev/null',
        '[ "$RELAUNCH" = "1" ] && /usr/bin/open "$DEST"',
        'rm -rf "$(dirname "$NEW")"; rm -f "$0"',
      ].join('\n'), { mode: 0o755 });
      spawn('/bin/bash', [script, String(process.pid), u.path, u.bundle, relaunch ? '1' : '0'], { detached: true, stdio: 'ignore' }).unref();
    } else {
      // electron-builder NSIS: /S 조용히 설치, --force-run 설치 후 다시 실행
      spawn(u.path, relaunch ? ['/S', '--updated', '--force-run'] : ['/S', '--updated'], { detached: true, stdio: 'ignore' }).unref();
    }
    if (quit) this.app.quit();
    return true;
  }
}

module.exports = { removeDir, Updater, compareVersions, parseVersion, pickAsset, pickInstaller, digestOf, parseSums, macBundlePath, canSelfInstall, REPO };
