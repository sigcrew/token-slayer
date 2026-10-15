// packs/*.json → renderer/builtin-packs.js (브라우저 미리보기용; 앱에서는 main이 직접 읽어서 보냄)
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'packs');
const packs = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
fs.writeFileSync(path.join(__dirname, '..', 'renderer', 'builtin-packs.js'),
  `// 자동 생성 파일 — scripts/build-packs.js\nwindow.BUILTIN_PACKS = ${JSON.stringify(packs)};\n`);
console.log(`packs: ${packs.length}`);
