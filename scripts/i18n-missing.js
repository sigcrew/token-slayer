// 소스의 한글 문자열 리터럴 중 영어 사전에 없는 것을 찾는다 (개발용)
const fs = require('fs'), path = require('path');
const EN = require('../renderer/i18n-en');
const files = process.argv.slice(2);
const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*[가-힣](?:\\.|(?!\1)[^\\\n])*)\1/g;
const seen = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8').split('\n');
  src.forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return;
    const code = line.replace(/\s\/\/.*$/, (m) => (/['"`]/.test(m) ? m : ''));
    let m;
    while ((m = re.exec(code))) {
      const s = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
      if (EN[s] !== undefined || seen.has(s)) continue;
      seen.add(s);
      console.log(`${path.basename(f)}:${i + 1}\t${s}`);
    }
  });
}
