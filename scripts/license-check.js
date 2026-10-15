// 라이선스 서버 검증 (개발용): 실제 Lemon Squeezy 서버로 활성화 · 검증 · 2대 한도 · 해제를 차례로 확인한다.
//   TOKEN_SLAYER_STORE_ID=… TOKEN_SLAYER_PRODUCT_ID=… node scripts/license-check.js <라이선스 키>
//   (테스트 모드 키는 테스트 모드의 스토어·상품 ID와 함께 써야 통과한다. 앱 배포 파일에는 들어가지 않는다)
const fs = require('fs');
const os = require('os');
const path = require('path');
const licLib = require('../src/license');

const key = process.argv[2];
if (!key) { console.error('사용법: node scripts/license-check.js <라이선스 키>'); process.exit(1); }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ts-licchk-'));
const line = (ok, msg) => console.log(`${ok ? '✅' : '❌'} ${msg}`);

(async () => {
  const cfg = require('../src/license-config');
  console.log(`스토어 ${cfg.STORE_ID || '(없음)'} · 상품 ${cfg.PRODUCT_ID || '(없음)'}`);
  const a = licLib.create(tmp()), b = licLib.create(tmp()), c = licLib.create(tmp());
  const r1 = await a.activate(key);
  line(r1.ok, `1번째 컴퓨터 활성화: ${r1.ok ? '성공' : `${r1.reason} · ${r1.message}`}`);
  if (!r1.ok) process.exit(2);
  line(a.isValid(), '  앱에서 유효로 판단');
  const v = await a.revalidate({ force: true });
  line(!v.changed && a.isValid(), '  서버 재확인(validate): 유효 유지');
  const r2 = await b.activate(key);
  line(r2.ok, `2번째 컴퓨터 활성화: ${r2.ok ? '성공' : `${r2.reason} · ${r2.message}`}`);
  const r3 = await c.activate(key);
  line(!r3.ok, `3번째 컴퓨터는 한도(2대)로 거절돼야 함: ${r3.ok ? '통과해 버림 ⚠️' : `거절 · ${r3.message}`}`);
  await b.deactivate();
  const r4 = await c.activate(key);
  line(r4.ok, `2번째 해제 뒤 3번째 활성화(자리 반납 확인): ${r4.ok ? '성공' : `${r4.reason} · ${r4.message}`}`);
  await c.deactivate(); await a.deactivate();
  line(!a.isValid(), '모두 해제하고 정리 완료');
})().catch((e) => { console.error('오류', e); process.exit(3); });
