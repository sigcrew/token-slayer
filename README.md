# Token Slayer ⚔️

**한국어** · [English](README.en.md)

Claude · Codex · Cursor · Antigravity 같은 AI 에이전트의 **남은 사용량을 HP로 가진 도트 용사들**이 화면 구석에서 날아오는 코드를 베며 싸우는 데스크톱 위젯이에요. macOS와 Windows에서 동작해요.

> 이전 이름: Token Buddy. 처음 실행하면 예전 레벨·업적·설정·claude.ai 로그인을 자동으로 옮겨 와요.

- 에이전트(Claude · Codex · Cursor · Antigravity)마다 **용사**가 한 명씩 나와요. 투구 색으로 구분하고, 남은 사용량이 곧 **HP**예요.
- 토큰을 쓰는 중이면 오른쪽에서 코드 조각이 날아오고 용사가 칼로 베어요. 안 쓰는 중이면 칼을 꽂고 **모닥불** 앞에서 쉬어요.
- 사용량이 줄어드는 순간 코드 하나가 방어를 뚫고 용사를 때려요 (`-5%`). HP바에는 빨간 잔상이 남았다가 따라 줄어요.
- HP가 0%가 되면 용사가 쓰러지고 **GAME OVER**와 부활(리셋)까지 남은 시간이 떠요.
- 한도가 다시 채워지면 **HP 포션**을 마시고 기운을 차려요 (`+100%`).
- 캐릭터에 마우스를 올리면 5시간/주간 남은 양과 리셋까지 남은 시간이 나와요. 마우스를 떼면 닫혀요.
- **⌘⌥S**(윈도우는 Ctrl+Alt+S)로 어디서든 숨기고 다시 보이게 할 수 있어요. 메뉴바 아이콘이 노치에 가려져도 쓸 수 있어요.
- **크기**는 트레이 메뉴 **크기 → 크기 조절…** 슬라이더로 0.5~1.75배까지 자유롭게 맞출 수 있고, 위젯 위에서 **⌥(Option)+스크롤**로도 바로 키우고 줄일 수 있어요.
- 드래그로 옮길 수 있어요. 화면 위쪽에 두면 패널이 아래로 열려요.
- 투명한 부분은 클릭이 뒤에 있는 창으로 그대로 통과해요.

## 어디에 접속하나요 · 토큰은 어디로 가나요

토큰 슬레이어는 사용량을 보려고 각 도구의 **로그인 토큰을 이 컴퓨터에서 읽어요**. 토큰은 아래 주소(각 서비스의 공식 도메인)로만 보내고, 제 서버는 없어요. 앱은 분석·통계를 수집하지 않아요.

| 접속하는 곳 | 무엇을 | 코드 |
|---|---|---|
| `api.anthropic.com/api/oauth/usage` | Claude 사용량 조회 (Claude Code 로그인 토큰) | `src/claude.js` |
| `platform.claude.com` · `console.anthropic.com` `/v1/oauth/token` | Claude 토큰이 만료됐을 때 갱신 | `src/claude.js` |
| `claude.ai` | Claude Code가 없을 때 앱 안 claude.ai 로그인 창으로 사용량 조회 | `src/claude-web.js` |
| `chatgpt.com/backend-api/wham/usage` | Codex 사용량 조회 (`~/.codex/auth.json`, 읽기만 함) | `src/codex.js` |
| `cursor.com/api/usage-summary` | Cursor 사용량 조회 (Cursor 설정 DB의 토큰, 읽기만 함) | `src/cursor.js` |
| (네트워크 아님) Antigravity 공식 CLI `agy -p /usage` 실행 | Antigravity 사용량 보고. 접속과 로그인은 agy가 하고 앱은 토큰을 읽지 않음 | `src/antigravity.js` |
| `api.github.com` (sigcrew/token-slayer-releases) | 업데이트 확인 | `src/updater.js` |
| `api.lemonsqueezy.com/v1/licenses` | 꾸미기 팩 라이선스 키 확인 (구매한 경우만) | `src/license.js` |

- 조회 요청은 앱의 쿠키를 싣지 않아요(`src/nocookie.js`).
- 에이전트가 일하는지는 파일이 바뀐 **시각과 크기**, Cursor 대화 기록의 **마지막 줄 종류**만 보고 대화 내용은 읽지 않아요(`src/watch.js`, `src/cursor.js`).
- 오류 기록(`errors.log`)은 이 컴퓨터에만 남기고 토큰·이메일은 지운 뒤 저장해요(`src/errlog.js`).
- 직접 확인하고 싶다면 Little Snitch 같은 네트워크 모니터로 앱의 접속을 볼 수 있어요.

## 실행

Node.js 20 이상이 필요해요.

```bash
cd token-slayer
npm install
npm start
```

데이터 없이 효과부터 보고 싶다면, 메뉴바/트레이 아이콘에서 **데모 모드**를 켜세요.

처음 실행하면 안내 창이 떠요: 소개 → 무엇을 읽는지(서버 없음) → 데려갈 용사(서비스) 고르기·로그인 → 알림·자동 실행. 다시 보려면 트레이 메뉴 **처음 안내 다시 보기**.

## 설치하기

소개 페이지: **https://token-slayer.vercel.app** (내 컴퓨터에 맞는 받기 버튼이 먼저 나와요)

설치 파일과 업데이트는 배포 전용 공개 저장소 [sigcrew/token-slayer-releases](https://github.com/sigcrew/token-slayer-releases/releases)에 올라가요. 이 코드 저장소는 비공개예요.

| 컴퓨터 | 바로 받기 (항상 최신) |
|---|---|
| 맥 (애플 실리콘 M1~) | [TokenSlayer-mac-arm64.dmg](https://github.com/sigcrew/token-slayer-releases/releases/latest/download/TokenSlayer-mac-arm64.dmg) |
| 맥 (인텔) | [TokenSlayer-mac-x64.dmg](https://github.com/sigcrew/token-slayer-releases/releases/latest/download/TokenSlayer-mac-x64.dmg) |
| 윈도우 | [TokenSlayer-Setup-x64.exe](https://github.com/sigcrew/token-slayer-releases/releases/latest/download/TokenSlayer-Setup-x64.exe) · [ARM](https://github.com/sigcrew/token-slayer-releases/releases/latest/download/TokenSlayer-Setup-arm64.exe) · [포터블](https://github.com/sigcrew/token-slayer-releases/releases/latest/download/TokenSlayer-Portable-x64.exe) |

- **맥:** dmg를 열어 앱을 **응용 프로그램** 폴더로 옮기고 열어요. Apple 공증을 받아서 경고 없이 열려요.
- **윈도우:** 아직 코드 서명이 없어서 "Windows의 PC 보호" 창이 떠요. **추가 정보 → 실행**.

### 자동 업데이트

설치한 앱은 1시간마다 새 버전을 확인해요. 새 버전이 있으면 내려받고, GitHub가 알려 주는 SHA-256 확인값과 맞는지 확인한 뒤 알림을 줘요. 알림이나 트레이 메뉴 **재시작해서 업데이트**를 누르면 바꿔 넣고 다시 켜져요. 레벨·업적·설정은 그대로예요. 트레이 메뉴에서 **업데이트 확인**으로 직접 확인하거나 **자동 업데이트**를 끌 수 있어요.

- 맥은 앱이 **응용 프로그램** 폴더(쓸 수 있는 곳)에 있어야 해요. dmg 안에서 바로 실행하면 다운로드 페이지만 알려 줘요.
- 윈도우 포터블 버전과 소스 실행(`npm start`)도 새 버전 알림만 줘요.

### 맥 서명·공증 (관리자용)

저장소 Settings → Secrets and variables → Actions에 아래를 넣으면 다음 릴리스부터 Developer ID 서명 + 공증된 맥 앱이 나와요. 없으면 지금처럼 로컬 서명(ad-hoc)으로 빌드돼요.

| 이름 | 값 |
|---|---|
| `CSC_LINK` | Developer ID Application 인증서 .p12를 base64로 (`base64 -i cert.p12 \| pbcopy`) |
| `CSC_KEY_PASSWORD` | .p12 비밀번호 |
| `APPLE_API_KEY` · `APPLE_API_KEY_ID` · `APPLE_API_ISSUER` | App Store Connect API 키(.p8 내용)·키 ID·Issuer ID |
| 또는 `APPLE_ID` · `APPLE_APP_SPECIFIC_PASSWORD` | Apple 계정·앱 암호 (팀 ID 867RGMZD7Y는 워크플로에 들어 있음) |

### 소개 페이지 (Vercel)

`site/index.html`이 본문이고, `node scripts/build-site.js`가 용사 화면 스크립트와 합쳐 `_site/`를 만들어요. main에 푸시하면 GitHub Actions(`site.yml`)가 이걸 공개 저장소 `sigcrew/token-slayer-releases`의 `web/` 폴더로 복사하고, Vercel은 그 공개 저장소의 `web/`을 배포해요. 비공개 코드 저장소는 Vercel에 연결하지 않아요.

### 직접 빌드하기

```bash
npm run dist:mac:all   # 맥에서 → dist/TokenSlayer-<버전>-mac-{arm64,x64}.{dmg,zip}
npm run dist:win       # 윈도우에서 → dist/TokenSlayer-Setup-<버전>-{x64,arm64}.exe
```

### 새 버전 내보내기 (관리자용)

`package.json`의 `version`을 올려 main에 푸시하면 (Secrets의 `RELEASES_TOKEN`으로 `sigcrew/token-slayer-releases`에 올림, 없으면 이 저장소에) GitHub Actions가 테스트 → 맥·윈도우 빌드 → Releases 업로드(SHA256SUMS 포함, `v<버전>` 태그 자동 생성)를 해요. 이미 있는 버전이면 건너뛰어요.

```bash
npm version 0.21.0 --no-git-tag-version
git commit -am "v0.21.0" && git push
```

설치한 앱을 처음 실행하면 **로그인 시 자동 실행**이 켜져요. 트레이 메뉴에서 끌 수 있어요.

## 사용량을 어디서 가져오나요

| 서비스 | 출처 | 갱신 주기 |
|---|---|---|
| **Codex** | ① Codex 로그인이 있으면 ChatGPT 사용량 조회(서버 값: 다른 기기·웹·클라우드에서 쓴 것까지 반영), ② 못 쓰면 `~/.codex/sessions/**/rollout-*.jsonl`에 Codex가 기록하는 `rate_limits` (5시간/주간 사용 %) | 5초 (서버는 45초마다) |
| **Claude** | ① Claude Code 로그인이 있으면 그 토큰으로, ② 없으면 앱 안의 **claude.ai 로그인 창**으로 한 번 로그인한 세션으로 조회 (claude.ai 설정의 사용량과 같은 데이터) | 1분 |
| **Cursor** | Cursor 앱 설정 DB(`state.vscdb`)의 로그인 토큰으로 조회하는 대시보드 사용량 (`cursor.com/api/usage-summary`) | 2분 |
| **Antigravity** | 공식 CLI의 사용량 보고 `agy -p /usage --output-format json` (Gemini 모델 · Claude·GPT 모델의 주간 남은 비율). 모델에 질문을 보내지 않아 한도를 쓰지 않음. 개인 Google 계정의 Gemini 한도는 이제 여기서 관리돼요 | 5분 |

**최근 30일 안에 실제로 쓴 서비스만** 자동으로 게이지가 생겨요.

| 서비스 | "썼다"고 보는 기준 |
|---|---|
| Claude | Claude Code 기록(`~/.claude`) 또는 Claude 데스크톱 앱 데이터 폴더가 30일 안에 바뀌었거나, 이번 5시간/주간 사용량이 0%보다 큼 |
| Codex | `~/.codex/sessions`의 최신 세션 파일이 30일 이내 |
| Cursor | Cursor 설정 DB가 30일 안에 바뀌었거나(= Cursor를 열었음), 이번 달 사용량이 0%보다 큼 |
| Antigravity | `~/.gemini/antigravity-cli`의 대화 기록이 30일 안에 바뀌었음 (agy가 없으면 표시 안 함) |

트레이 메뉴의 **표시할 서비스**에서 직접 켜거나 끌 수 있고, **자동으로 되돌리기**를 누르면 다시 30일 기준으로 돌아가요.

- **Cursor**는 월간 사용량(%)과 Auto/API 사용량, 결제 주기 리셋일을 보여줘요. 토큰은 읽기만 하고, 만료되면 Cursor 앱을 한 번 열면 앱이 갱신해요. 패널의 **Cursor 열어서 로그인** 버튼이 Cursor를 열어 줘요.

- **Codex**는 CLI, IDE 확장, 앱 모두 같은 폴더에 기록해요. 기록 파일은 이 컴퓨터에서 대화가 끝날 때만 갱신돼서, 웹·클라우드·다른 기기에서 쓴 양은 반영되지 않아요. 그래서 로그인 토큰(`~/.codex/auth.json`, 읽기만 해요)으로 사용량을 서버에 물어봐요. 실패하면 마지막 기록 값으로 돌아가요. 트레이 메뉴의 **Codex 사용량을 서버에서 조회**로 끌 수 있어요(끄면 네트워크 요청 없이 기록만 읽어요).
- **Claude**는 Claude Code가 없어도 돼요. 말풍선의 **Claude 로그인하기**를 누르면 claude.ai 로그인 창이 뜨고, 로그인하면 창이 자동으로 닫혀요. 이 로그인은 Token Slayer 전용 저장소에만 남아요(트레이 메뉴에서 로그아웃 가능). Google 로그인이 막히면 이메일로 로그인하세요.
- Claude Code를 쓰는 경우에는 그 로그인을 먼저 써요. 로그인 토큰은 macOS에서는 키체인(`Claude Code-credentials`)에서, Windows에서는 `%USERPROFILE%\.claude\.credentials.json`에서 읽어요.
  - macOS에서 처음 실행할 때 키체인 접근 창이 뜨면 **항상 허용**을 누르세요.
  - Claude 한도는 claude.ai, 데스크톱 앱, Claude Code가 함께 쓰기 때문에, 웹이나 앱에서 쓴 양도 여기 반영돼요.
  - 토큰은 몇 시간마다 만료돼요. 데스크톱 앱만 써도 끊기지 않게, 만료되면 이 앱이 직접 갱신하고 새 토큰을 원래 자리(키체인/파일)에 저장해요. 그래서 Claude Code 로그인도 그대로 유지돼요.
  - 오래 안 써서 갱신까지 거절되면 "로그인이 풀렸어요"가 떠요. 이때는 터미널에서 `claude` 실행 후 `/login`을 한 번 해 주세요.
- ⚠️ 두 출처 모두 **공식 공개 API가 아니에요**. Claude나 Codex가 업데이트되면서 형식이 바뀌면 표시가 멈출 수 있어요. 그때는 `src/claude.js`, `src/codex.js`만 고치면 돼요.

## 로그인이 필요할 때

Claude나 Codex 로그인이 없거나 풀리면 캐릭터 머리 위에 빨간 느낌표 말풍선이 떠요. 패널의 **로그인하기** 버튼을 누르면 터미널이 열리고 `claude`(Claude) 또는 `codex login`(Codex)이 실행돼요. 로그인이 끝나면 자동으로 다시 조회해요.

Codex 로그인 여부는 `~/.codex/auth.json`(또는 설정에 따라 키체인의 `Codex Auth` 항목)이 있는지만 확인해요. 로그아웃돼 있어도 마지막으로 기록된 사용량은 계속 보여줘요.

## 트레이 메뉴

용사를 **오른쪽 클릭**해도 같은 메뉴가 떠요. 맥북에서 메뉴바 아이콘이 노치 뒤에 가려졌을 때 쓰면 돼요.

보이기/숨기기 · 지금 새로고침 · 캐릭터 기준(둘 중 적게 남은 쪽 / Claude / Codex) · 표시할 서비스 · 크기 · 클릭 통과 · 위치 초기화 · 데모 모드 · 로그인 시 자동 실행 · 종료

## 바닥 예측 · HP 경고

- 최근 30분 사용 속도로 한도마다 "이 속도면 언제 0%가 되는지" 계산해요. 리셋보다 먼저 바닥나면 패널에 **⏳ 이 속도면 1시간 20분 뒤 바닥 · 리셋 2시간 30분 뒤**, 용사 줄에는 빨간 `OUT 1H20`이 떠요 (30분 미만이면 깜빡임). 리셋까지 버틸 속도면 **✅ 지금 속도면 리셋까지 버텨요**.
- 3분 이상 쌓인 기록이 있고 시간당 0.5%p 이상 쓸 때만 예측해요. 리셋되면 기록을 새로 시작해요.
- 남은 사용량이 **20%·10%**가 되면 알림을 보내요. 예측이 있으면 함께 알려 주고, 알림을 누르면 용사 창이 앞으로 와요. 리셋으로 30% 넘게 회복하면 다시 경고할 수 있어요.

## 실시간 반응

용사의 움직임(전투 ↔ 휴식)은 에이전트가 일할 때 쓰는 파일을 **실시간 감시**해서 1~2초 안에 따라가요. 30초 동안 조용하면 모닥불로 돌아가요.

| 에이전트 | 감시하는 곳 |
|---|---|
| Codex | `~/.codex/sessions` (세션 기록) |
| Claude | Claude 데스크톱 앱 대화 저장소, `~/.claude/projects` (Claude Code 대화 기록) |
| Cursor | 에이전트 대화 기록(`~/.cursor/projects/*/agent-transcripts`)의 마지막 줄이 `turn_ended`가 아니면 일하는 중 + Cursor 설정 DB (15초 안에 3번 이상 바뀔 때) |
| Antigravity | `~/.gemini/antigravity-cli`의 대화 기록(`transcript.jsonl`)과 대화 DB |

HP 수치는 서버 값이라 조회 주기(Claude 20초~1분, Cursor 40초~2분)만큼 늦을 수 있어요. 일을 시작하면 곧바로 한 번 조회해요.

## 레벨 · BURNING TIME

- 쓴 만큼 용사가 성장해요. 한도 창이 길수록 1%가 더 많은 작업이라, 서비스끼리 공평하게 **1%당 경험치를 다르게** 줘요.
  | 한도 창 | 1%당 경험치 | 예 |
  |---|---|---|
  | 5시간 | 100 | Claude 5시간, Codex 5시간 |
  | 주간 | 400 | Claude 주간, Codex 주간 |
  | 월간 | 1,500 | Cursor 월간 |
  한 번에 여러 창이 늘면 (늘어난 % × 가중치)가 가장 큰 창 하나만 쳐요. 레벨 L까지 누적 경험치는 `500 × L × (L−1)` (Lv2 1,000 · Lv5 10,000 · Lv10 45,000).
- 용사 발 아래 `LV7`, HP바 아래 금색 줄이 경험치예요. 레벨이 오르면 **LEVEL UP!** 연출과 알림이 떠요.
- **BURNING TIME 🔥**: 리셋이 가까운데 한도가 많이 남았을 때 켜져요. 이때 쓰면 **경험치 2배**, 적도 더 자주 와요.
  - 주간: 리셋 12시간 이내 + 20% 이상 남음 (5시간 창은 하루에도 여러 번 리셋돼서 버닝 없음)
  - 월간(Cursor): 리셋 3일 이내 + 20% 이상 남음
- 프리미엄 팩은 레벨로도 열려요 (가장 높은 용사 기준): 던전 배경 Lv10 · 달밤 묘지 11 · 신사 야경 12 · 단풍 산사 13 · 던전 몬스터 14 · 유령과 친구들 15 · 요괴 16 · 한양의 잡귀들 17 · 용암 18 · 호박 랜턴 19 · 별밤 랜턴 20 · 정자 달밤 21 · 횃불 야영 22 · 호박밭 23 · 사이버펑크 24 · 경복궁 야경 25 · 용암 온천 26 · 도깨비 27 · 성기사 28 · 무사 29 · 레거시 코드 30 · 마녀 31 · 서버실 32 · 흡혈귀 33 · 사무라이 34 · 사이버 공격 35 · 악마 36 · 야간 코딩 책상 37 · 회의 지옥 38 · 해커 39 · 닌자 40 · 구미호 41 · 머지 대기열 42 · 퇴근길 지하철 43 · 판교 야경 44 · 개발자 45 · 해골 기사 46 · 좀비 직장인 47 · 도적 48 · 안드로이드 49. 한도를 매주 다 채워 써도 첫 팩까지 약 1주, 닌자까지 약 4~5개월이 걸려요.
- 알림은 트레이 메뉴의 **알림 (BURNING TIME · 레벨업)** 으로 끌 수 있어요.

## 업적 · 쓰다듬기 · 주간 기록 카드

- **업적 67개** (성장 · 사용량 · 시간·연속 · GAME OVER · 소진율 · 낭비 배지 · BURNING TIME · 교감 · 꾸미기·기록 · 숨은 업적): 에이전트별 마스터(Lv.25), 한도를 남기지 않고 다 쓰는 **소진율** 업적(알뜰 살림 · 3주 연속 알뜰 · 월말 정산 · 딱 맞춰 씀 · 리셋 사냥꾼), 1주년, 천 퍼센트 클럽, 정확히 100, 공평한 리더, 불금 전사, 크리스마스·명절에도 출근, 느긋한 용사, 스피드런, 얼음 용사, 부활 3연속, BURNING TIME 개근 등. 숨은 업적 3개는 달성 전까지 ???로 보여요. **낭비 배지**(얼음 용사 · 유통기한 만료 · 월말의 후회 · 동면)는 한도를 남기고 버린 걸 놀리는 업적이라 알림 없이 목록에만 조용히 나와요. 나머지는 달성하면 알림과 화면 토스트가 뜨고, 트레이 메뉴 **업적**에서 분류별 목록을 볼 수 있어요.
- **용사 클릭**: 용사를 누르면 반응해요. 인사하며 하트를 뿜고, 자고 있으면 깜짝 놀라고(?!), 쓰러져 있으면 유령이 BOO!, 2초 안에 다섯 번 누르면 화내요(STOP!).
- **주간 기록 카드**: 트레이 메뉴 **이번 주 기록 카드 만들기** → 도트 스타일 PNG를 다운로드 폴더에 저장하고 클립보드에 복사해요. 요일별 사용량, 레벨, 연속 전투 일수, 업적, GAME OVER 횟수가 들어가요.

## 꾸미기 팩

트레이 메뉴 **꾸미기**에서 서비스마다 용사 직업을 고르고, 날아오는 적·쉬는 장면·배경을 바꿀 수 있어요. **시리즈 적용**을 누르면 🎌 일본풍 · 🐯 한국풍 · 🔥 야근 지옥 · 🏰 던전 · 🎃 할로윈 · 🌃 사이버 · ☕ 개발자 일상 세계관의 배경·적·쉬는 장면·용사를 한 번에 바꿔요 (잠긴 팩은 건너뛰고, 일본풍·사이버는 무료 배경으로 맛볼 수 있어요).

| 종류 | 기본(무료) | 프리미엄 |
|---|---|---|
| 용사 직업 | 용사(칼) · 마법사(지팡이) · 궁수(활) · 해적(권총) · 요리사(국자) · 우주인(광선총) · 고양이(발톱) · 바이킹(도끼) · 강아지(뼈다귀) | 사무라이(카타나) · 닌자(수리검) · 무사(환도) · 도깨비(방망이) · 구미호(여우불) · 개발자(고무 오리) · 악마(삼지창) · 좀비 직장인(발톱) · 성기사(전투 망치) · 도적(단검) · 해커(키보드) · 안드로이드(광선총) · 해골 기사(낫) |
| 날아오는 적 | 코드 조각 · 버그 떼 · 커밋 로그 · 알림 폭탄 · 타입 에러 · 사탕 대소동 | 레거시 코드 · 회의 지옥 · 요괴 · 던전 몬스터 · 사이버 공격 · 한양의 잡귀들 · 머지 대기열 |
| 쉬는 장면 | 모닥불 · 커피 타임 · 야식 라면 · 야식 치킨 · 휴대용 게임기 | 별밤 랜턴 · 정자 달밤 · 용암 온천 · 횃불 야영 · 야간 코딩 책상 · 퇴근길 지하철 |
| 배경 | 기본 밤하늘 · 벚꽃 · 터미널 · 비 오는 밤 | 던전 · 신사 야경 · 경복궁 야경 · 단풍 산사 · 용암 · 사이버펑크 · 서버실 · 판교 야경 |

프리미엄을 열면 **꾸미기 → 도트 해상도 → 고해상도(24칸)** 로 모든 용사를 더 섬세한 도트로 바꿀 수 있어요 (내 팩의 `hires` 용사는 해상도 설정과 상관없이 고해상도로 나와요). 12칸 용사 팩에 `hd`(24칸 그림 · 표정)를 붙이는 형식이고, `python3 scripts/make-hd.py`가 기본 용사의 hd 그림을 만들어 줘요.

프리미엄 팩은 라이선스 키로 열려요 (Lemon Squeezy). 꾸미기 메뉴 → **프리미엄 팩 구매하기…** → 받은 키를 복사 → **복사한 라이선스 키로 잠금 해제**. 하루 한 번 키를 다시 확인하고, 환불되면 다시 잠겨요 (오프라인이어도 30일은 유지). 다른 컴퓨터로 옮길 땐 **이 컴퓨터에서 라이선스 해제**.

- 결제 설정은 `src/license-config.js` (또는 환경변수 `TOKEN_SLAYER_CHECKOUT_URL` · `TOKEN_SLAYER_STORE_ID` · `TOKEN_SLAYER_PRODUCT_ID`). 비어 있으면 "준비 중"으로 보여요.
- 개발 중에는 `TOKEN_SLAYER_UNLOCK_ALL=1 npm start`로 전부 열어 볼 수 있어요 (설치본에서는 무시돼요).
- 라이선스를 켤 때 결제 서비스로는 키와 `운영체제-CPU 종류 + 무작위 번호`만 보내요. 컴퓨터 이름은 보내지 않아요.

**직접 만들기:** 꾸미기 → **내 팩 폴더 열기**에 JSON 파일을 넣고 **팩 다시 불러오기**를 누르면 돼요. 형식은 `packs/` 폴더의 기본 팩을 참고하세요.

```jsonc
// 용사: 12x12 문자 그리드. o=외곽선 w=얼굴 s=그늘 c/C=서비스 색(밝게/어둡게), 그 외 문자는 palette로 색 지정
{ "id": "pirate", "type": "hero", "name": "해적", "weapon": "sword",   // sword | katana | hwando | club | staff | bow | shuriken | trident | hammer | terminal | ladle | axe | raygun | claw | keyboard | pistol
  "grid": ["....oooo....", "...", "(12줄)"], "palette": { "K": "#2E2B3A" } }
// 용사에 넣을 수 있는 선택 항목 (프리미엄 용사들이 쓰는 것):
//   "face":   { "eyeColor": "#FFE066", "eyes": "closed|slant", "brows": "angry", "mouth": "fang", "visor": { "color": "#22E6FF" } }
//   "extras": ["tail", "hornFlames", "halo", "headset", "scarf", "headband"]   // 몸 밖에 덧붙이는 것
//   "fx":     { "glitch": true, "afterimage": true, "slash": true, "kill": { "kind": "fire|bits|cross|smoke|petals", "colors": ["#FF5A1F"] } }
//   "noCape": true   // 서비스 색 망토를 그리지 않음
// 적: 날아오는 글자와 색, 맞을 때 글자
{ "id": "css", "type": "enemies", "name": "CSS 지옥", "texts": ["!IMPORTANT", "Z-INDEX"], "colors": ["#7CC7FF"], "fatal": ["FLEXBOX"] }
// 쉬는 장면: 애니메이션 프레임(같은 크기 그리드 여러 장) + palette, glow(빛 색), embers(불티), steam(김)
{ "id": "tea", "type": "rest", "name": "차 한잔", "frames": [["..."]], "palette": {}, "glow": null, "steam": true }
```

## 서비스 추가하기

`src/usage.js`의 `PROVIDERS`에 한 줄을 넣고, `read()`가 아래 형태를 돌려주는 reader 파일을 하나 만들면 돼요. 게이지·패널·트레이 메뉴는 자동으로 생겨요.

```js
{ ok: true, windows: [{ key: 'monthly', label: '월간', usedPercent: 33, resetsAt: 1790000000000 }] }
// 실패: { ok: false, error: 'not-installed' | 'network' | ..., message: '...', needsLogin: true }
```

## 구조

```
main.js            창(투명·항상 위), 드래그, 트레이 메뉴
preload.js         렌더러와 메인 사이 IPC
src/codex.js       Codex 세션 로그 파서 (.jsonl / .jsonl.zst)
src/claude.js      Claude 사용량 조회
src/cursor.js      Cursor 사용량 조회
src/antigravity.js Antigravity 사용량 조회 (agy 사용량 보고)
src/usage.js       주기적 폴링
renderer/          캐릭터(canvas), 게이지, 패널
test/run.js        파서 테스트 (npm test)
```

`renderer/index.html`을 브라우저에서 바로 열어도 데모 모드로 캐릭터를 볼 수 있어요.

## 라이선스

[PolyForm Noncommercial 1.0.0](LICENSE). 코드와 꾸미기 팩을 보고, 고치고, 개인·비상업적으로 쓰는 건 자유예요. 상업적으로 쓰거나 재판매하는 건 허용하지 않아요. 설치 파일은 [sigcrew/token-slayer-releases](https://github.com/sigcrew/token-slayer-releases/releases)에서 받을 수 있어요.

Copyright (c) 2026 SIG Inc.
