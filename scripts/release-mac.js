// 맥 릴리스 빌드: 서명 인증서가 있으면 Developer ID 서명 + 공증, 없으면 지금처럼 로컬 서명(ad-hoc)
//
// 서명: CSC_LINK(.p12 base64 또는 경로) + CSC_KEY_PASSWORD
// 공증 (둘 중 하나):
//   APPLE_API_KEY(.p8 파일 경로) + APPLE_API_KEY_ID + APPLE_API_ISSUER
//   APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
const { build, Platform, Arch } = require('electron-builder');
const pkg = require('../package.json');

const env = process.env;
const has = (...k) => k.every((x) => !!env[x]);
const sign = has('CSC_LINK') || env.MAC_SIGN === '1'; // MAC_SIGN: 워크플로가 키체인에 인증서를 미리 넣어 둠
const notarize = sign && (has('APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER') || has('APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'));

const config = JSON.parse(JSON.stringify(pkg.build));
if (sign) {
  // CSC_NAME(예: "SIG Inc. (867RGMZD7Y)")이 있으면 그 인증서, 없으면 자동으로 찾는다
  config.mac.hardenedRuntime = true;
  config.mac.gatekeeperAssess = false;
  config.mac.notarize = notarize;
} else {
  delete env.CSC_NAME;
  config.mac.identity = '-'; // 로컬 서명(ad-hoc): 애플 실리콘에서 실행되려면 최소한 이건 필요
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
}

console.log(`[release-mac] 서명: ${sign ? 'Developer ID' : 'ad-hoc'} · 공증: ${notarize ? '예' : '아니오'}`);
if (sign && !notarize) console.log('[release-mac] 공증 키가 없어서 서명만 해요. 받은 사람에게는 여전히 경고가 떠요.');

build({
  targets: Platform.MAC.createTarget(['dmg', 'zip'], Arch.arm64, Arch.x64),
  config,
  publish: 'never',
}).then(() => console.log('[release-mac] 완료')).catch((e) => { console.error(e); process.exit(1); });
