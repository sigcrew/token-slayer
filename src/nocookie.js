// 사용량 조회 요청에서 앱 공용 쿠키 보관함을 쓰지 않게 감싼다.
//  Electron의 net.fetch는 기본으로 앱 전체가 공유하는 쿠키 보관함(defaultSession)을 쓴다. 서버가 한 번 내려 준 쿠키(예: Vercel 보안 쿠키)가
//  거기에 남으면, 헤더로 직접 인증하는 우리 요청에 같이 실려서 서버가 거절(401)하는 일이 있었다 (같은 요청을 쿠키 없이 보내면 200).
//  Cursor · Codex · Claude는 모두 요청 헤더로 직접 인증하므로 쿠키가 필요 없다. (Claude 웹 로그인은 전용 세션을 따로 쓴다)
function omitCookies(fetchFn) {
  return (url, opts = {}) => fetchFn(url, { ...opts, credentials: 'omit' });
}
module.exports = { omitCookies };
