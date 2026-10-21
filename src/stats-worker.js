// 사용 통계 계산 전용 프로세스 (Electron utilityProcess).
// 기록 파일이 수 GB라 처음 계산은 수십 초 걸린다. 메인 프로세스에서 하면 위젯과 창이 멈추므로 여기서 한다.
// 받는 것: { cachePath } · 보내는 것: { type: 'progress', done, total } · { type: 'done', ok }
const fs = require('fs');
const stats = require('./stats');

process.parentPort.on('message', async (e) => {
  const { cachePath } = (e && e.data) || {};
  let cache = null;
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch {}
  try {
    const next = await stats.scan(cache, (done, total) => process.parentPort.postMessage({ type: 'progress', done, total }));
    fs.writeFileSync(cachePath, JSON.stringify(next));
    process.parentPort.postMessage({ type: 'done', ok: true });
  } catch (err) {
    process.parentPort.postMessage({ type: 'done', ok: false, error: String((err && err.message) || err) });
  }
});
