// 서비스(Claude · Codex · Cursor) 조회 상태가 바뀔 때만 오류 기록에 한 줄 남긴다.
//  - 계속 실패해도 같은 상태면 다시 쓰지 않는다 (기록이 넘치지 않게)
//  - 로그인 필요 · 미설치 · 불러오는 중은 오류가 아니므로 적지 않는다 (다음 진짜 오류나 회복을 비교하는 기준으로만 기억)
//  - 마지막 값을 유지 중이면 왜 그런지(거절 · 네트워크 · 제한 등)도 함께 적는다
function createReaderLogger(log) {
  const last = {};
  return function onUpdate(snap) {
    for (const p of snap.providers || []) {
      const x = (snap.data && snap.data[p.id]) || {};
      if (x.error === 'loading') continue;
      if (x.error === 'not-installed' || x.needsLogin) { last[p.id] = x.needsLogin ? 'login' : 'not-installed'; continue; }
      const kind = x.ok && !x.stale ? 'ok' : (x.stale ? `showing-last-value:${x.staleReason || 'unknown'}` : String(x.error || 'error'));
      if (last[p.id] === kind) continue;
      const before = last[p.id];
      last[p.id] = kind;
      if (kind === 'ok') { if (before && before !== 'ok') log('reader', `${p.name}: recovered`); continue; }
      const msg = x.stale ? x.staleMessage : x.message;
      log('reader', `${p.name}: ${x.stale ? `showing last value (${x.staleReason || 'unknown'})` : kind}${msg ? ` — ${msg}` : ''}`);
    }
  };
}
module.exports = { createReaderLogger };
