// 결제 설정 — Lemon Squeezy 라이브 상품 (Products → Share, Settings → Stores)
//  CHECKOUT_URL : 상품의 구매 링크
//  STORE_ID     : 스토어 ID (tokenslayer.lemonsqueezy.com)
//  PRODUCT_ID   : 라이브 상품 ID
// 개발 중(npm start · 테스트 · 스크립트)에는 환경 변수로 테스트 모드 값을 덮어쓸 수 있다:
//   TOKEN_SLAYER_CHECKOUT_URL / TOKEN_SLAYER_STORE_ID / TOKEN_SLAYER_PRODUCT_ID
// 설치된 앱(패키지)에서는 환경 변수를 읽지 않는다 (다른 스토어의 키로 프리미엄을 여는 우회를 막기 위해).
const dev = (() => {
  try { const { app } = require('electron'); return !(app && app.isPackaged); } catch { return true; }
})();
const env = (name) => (dev ? process.env[name] : undefined);

module.exports = {
  CHECKOUT_URL: env('TOKEN_SLAYER_CHECKOUT_URL') || 'https://tokenslayer.lemonsqueezy.com/checkout/buy/6c4b6ac3-9c88-4e7d-bd0e-4a446d47badd',
  STORE_ID: Number(env('TOKEN_SLAYER_STORE_ID')) || 486244,
  PRODUCT_ID: Number(env('TOKEN_SLAYER_PRODUCT_ID')) || 1414646,
};
