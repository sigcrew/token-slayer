// 로컬 오류 기록: 앱이 겪은 오류와 충돌을 이 컴퓨터의 파일(errors.log)에만 남긴다. 어디로도 전송하지 않는다.
//  - 문의할 때 "진단 정보 복사"에 최근 기록이 함께 들어가서, 사용자가 직접 붙여 넣어 보낼 때만 개발자가 볼 수 있다
//  - 토큰·키 · 이메일 · 홈 폴더 이름은 기록하기 전에 지운다
//  - 한 줄에 하나(JSON), 크기가 커지면 오래된 줄부터 버린다
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BYTES = 200 * 1024;   // 이보다 커지면 최근 KEEP_LINES줄만 남긴다
const KEEP_LINES = 200;
const MAX_MSG = 600;            // 한 항목의 글자 수 상한 (스택이 길어도 앞부분만)

// 기록하기 전에 개인 정보가 될 만한 것을 지운다
function scrub(text, home = os.homedir()) {
  let s = String(text == null ? '' : text);
  if (home && home.length > 1) s = s.split(home).join('~');
  s = s.replace(/\/Users\/[^/\s'"]+/g, '/Users/~').replace(/\\Users\\[^\\\s'"]+/gi, '\\Users\\~');
  s = s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>');
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 <token>');
  s = s.replace(/\b(sk|pk|rk|ghp|gho|xox[abp]|AIza|ya29)[-_A-Za-z0-9.]{10,}/g, '<key>');
  s = s.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, '<jwt>');
  s = s.replace(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, '<uuid>'); // 라이선스 키 모양
  s = s.replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '<secret>'); // 아주 긴 토큰 모양
  return s.length > MAX_MSG ? s.slice(0, MAX_MSG) + '…' : s;
}

function create(dir, { now = () => Date.now(), home = os.homedir() } = {}) {
  const file = path.join(dir, 'errors.log');

  function trim() {
    try {
      if (fs.statSync(file).size <= MAX_BYTES) return;
      const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      fs.writeFileSync(file, rows.slice(-KEEP_LINES).join('\n') + '\n');
    } catch {}
  }

  // kind: 'launch' | 'crash' | 'error' | 'updater' ... 무엇이 일어났는지 짧은 이름
  function add(kind, message, extra) {
    try {
      const row = { t: new Date(now()).toISOString(), kind: String(kind), msg: scrub(message && message.stack ? message.stack : message, home) };
      if (extra && typeof extra === 'object') row.extra = JSON.parse(scrub(JSON.stringify(extra), home));
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(file, JSON.stringify(row) + '\n');
      trim();
    } catch { /* 기록에 실패해도 앱은 계속 돈다 */ }
  }

  // 최근 n줄을 사람이 읽는 글로
  function recent(n = 10, { kinds } = {}) {
    try {
      const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const pick = kinds ? rows.filter((r) => kinds.includes(r.kind)) : rows;
      return pick.slice(-n).map((r) => `${r.t.replace('T', ' ').slice(0, 19)}Z [${r.kind}] ${String(r.msg).split('\n')[0]}${r.extra ? ' ' + JSON.stringify(r.extra) : ''}`);
    } catch { return []; }
  }

  return { add, recent, file, scrub };
}

module.exports = { create, scrub, MAX_BYTES, KEEP_LINES };
