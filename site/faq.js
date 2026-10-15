// 자주 묻는 질문: 화면에 보이는 FAQ와 검색용 구조화 데이터(JSON-LD)가 같은 내용을 쓰도록 한 곳에서 관리한다.
// [질문, 답] 한국어·영어. 답은 일반 글(태그 없음)이라 JSON-LD에도 그대로 들어간다.
// 사실만 적는다: 앱이 실제로 하는 일과 한계(비공식 조회)를 숨기지 않는다.
module.exports = [
  {
    ko: ['Claude Code 남은 사용량(5시간·주간 한도)은 어떻게 확인하나요?', 'Token Slayer를 설치하면 Claude Code 로그인(또는 앱 안의 claude.ai 로그인)으로 5시간·주간 한도를 조회해서, 화면 구석에 있는 도트 용사의 HP로 보여 줘요. 한도를 보려고 매번 페이지를 열 필요가 없어요.'],
    en: ['How can I check my remaining Claude Code usage (5-hour and weekly limits)?', 'Install Token Slayer and it reads your 5-hour and weekly limits using your Claude Code login (or a claude.ai login inside the app), then shows them as a pixel hero\'s HP in a corner of your screen. No need to open a page every time you want to check.'],
  },
  {
    ko: ['Codex의 남은 한도도 볼 수 있나요?', '네. Codex의 5시간·주간 한도를 보여 줘요. 이 컴퓨터에 남은 기록을 읽고, Codex에 로그인돼 있으면 서버에도 사용량을 물어봐서 웹이나 다른 기기에서 쓴 양까지 반영해요(메뉴에서 끌 수 있어요).'],
    en: ['Can it show my remaining Codex limit too?', 'Yes. It shows your Codex 5-hour and weekly limits. It reads the records on this computer and, if you are logged in to Codex, also asks the server for usage so that usage from the web or other devices is included (you can turn this off in the menu).'],
  },
  {
    ko: ['Cursor 월간 사용량도 확인되나요?', '네. Cursor 앱에 저장된 로그인으로 월간 사용량(Auto · API 포함)과 리셋 시점을 보여 줘요. Cursor 앱에 로그인돼 있기만 하면 돼요.'],
    en: ['Does it also track my Cursor monthly usage?', 'Yes. It uses the login saved by the Cursor app to show your monthly usage (including Auto and API) and the reset time. You only need to be logged in to the Cursor app.'],
  },
  {
    ko: ['한도가 바닥나기 전에 알려 주나요?', '네. 최근 30분의 사용 속도로 언제 0%가 되는지 예측해서 보여 주고, 남은 양이 20%와 10%가 되면 알림을 보내요. 리셋이 가까운데 한도가 많이 남았을 때도 알려 줘요.'],
    en: ['Does it warn me before I run out?', 'Yes. It forecasts when you will hit 0% based on your last 30 minutes of usage, and sends a notification at 20% and 10% remaining. It also tells you when a reset is near and plenty of your limit is left.'],
  },
  {
    ko: ['대화 내용이나 개인정보를 수집하나요?', '아니요. 앱은 따로 운영하는 서버가 없고 아무것도 수집하지 않아요. 이미 로그인해 둔 정보로 각 서비스에 사용량만 물어보고, 대화 내용은 읽지 않아요. 이 소개 사이트는 쿠키 없이 방문자 수만 집계해요.'],
    en: ['Does it collect my conversations or personal data?', 'No. The app has no server of its own and collects nothing. It uses the logins you already have to ask each service for usage only, and never reads your conversations. This website counts visitors without cookies.'],
  },
  {
    ko: ['무료인가요? 윈도우에서도 되나요? 깨질 수도 있나요?', '앱은 무료이고 맥과 윈도우에서 동작해요(꾸미기 팩만 선택 결제예요). 다만 Claude와 Cursor의 사용량 조회는 공식 공개 API가 아니라서, 서비스가 바뀌면 일시적으로 표시가 안 될 수 있어요. 그때는 앱 업데이트로 고쳐요.'],
    en: ['Is it free? Does it work on Windows? Can it break?', 'The app is free and runs on macOS and Windows (only the cosmetic packs are an optional purchase). Note that Claude and Cursor usage lookups are not official public APIs, so the display may stop temporarily if those services change; app updates fix that.'],
  },
];
