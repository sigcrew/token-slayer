// "최근에 실제로 썼는지" 판단용: 서비스가 쓰는 파일·폴더의 마지막 수정 시각을 모은다.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ACTIVE_DAYS = 30;

async function mtime(p) {
  try { return (await fs.promises.stat(p)).mtimeMs; } catch { return null; }
}

// 폴더 자신 + 바로 아래 항목들(최대 limit개)의 수정 시각 중 가장 최근
async function newestIn(dir, limit = 300) {
  let best = await mtime(dir);
  let names = [];
  try { names = await fs.promises.readdir(dir); } catch { return best; }
  for (const n of names.slice(0, limit)) {
    const t = await mtime(path.join(dir, n));
    if (t && (!best || t > best)) best = t;
  }
  return best;
}

async function newest(list) {
  let best = null;
  for (const item of list) {
    const t = item.dir ? await newestIn(item.dir) : await mtime(item);
    if (t && (!best || t > best)) best = t;
  }
  return best;
}

function appSupport(name) {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', name);
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), name);
  return path.join(home, '.config', name);
}

const isActive = (t, now = Date.now()) => !!t && now - t <= ACTIVE_DAYS * 86400e3;

module.exports = { newest, newestIn, mtime, appSupport, isActive, ACTIVE_DAYS };
