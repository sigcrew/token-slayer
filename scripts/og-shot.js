// _site/og.html → _site/og.png (1200x630 링크 미리보기 이미지). playwright가 필요해서 CI에서만 실행
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const dir = path.join(__dirname, '..', '_site');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(dir, 'og.html'));
  await page.waitForSelector('body[data-ready="1"]', { timeout: 20000 });
  await page.screenshot({ path: path.join(dir, 'og.png') });
  await browser.close();
  if (errors.length) { console.error(errors); process.exit(1); }
  console.log('og.png 생성');
})();
