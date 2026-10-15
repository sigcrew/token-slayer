// 앱을 켰을 때 위젯을 보여 줄지 정한다 (순수 함수).
//  - 사용자가 직접 연 경우(Finder 더블 클릭 · Spotlight · Dock)에는 항상 보여 준다.
//    위젯을 숨긴 채 종료했더라도, 직접 열었는데 아무것도 안 보이면 "안 열린다"고 느끼기 때문이다 (맥북은 메뉴바 아이콘이 노치에 가려지기도 한다).
//  - 로그인할 때 저절로 켜진 경우에는 사용자가 숨겨 둔 상태를 그대로 따른다.
//  - 처음 안내가 아직 안 끝났으면 안내 창이 위젯을 대신한다.
function showOnLaunch({ visible, onboarded }, { wasOpenedAtLogin = false, platform = process.platform } = {}) {
  if (!onboarded) return false;
  if (visible !== false) return true;
  // 숨겨 둔 상태로 종료했다면: 맥에서만 "로그인으로 켜졌는지"를 알 수 있다. 그 밖의 경우는 직접 열었다고 본다
  return !(platform === 'darwin' && wasOpenedAtLogin);
}
module.exports = { showOnLaunch };
