// 소개 페이지 만들기: site/index.html(본문) + 용사 화면 스크립트 → _site/ (Vercel이 이 폴더를 올림)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, '_site');

require('./build-packs.js');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const SITE = (process.env.SITE_URL || 'https://token-slayer.vercel.app').replace(/\/$/, '');
const title = 'Token Slayer — 남은 토큰이 곧 용사의 HP';
// 검색 결과에 보이는 페이지 제목(<title>)과 설명: 사람들이 실제로 찾는 말(Claude Code · Codex · Cursor 사용량 한도)을 넣는다
const seoKo = { title: 'Token Slayer — Claude Code · Codex · Cursor · Antigravity 사용량 한도를 보여주는 무료 데스크톱 위젯', desc: 'Claude Code · Codex · Cursor · Antigravity(Gemini)의 남은 사용량(5시간·주간·월간 한도)을 화면 위 도트 용사의 HP로 보여주는 무료 데스크톱 앱. 맥·윈도우 지원, 서버 없이 내 컴퓨터에서만 동작해요.' };
const seoEn = { title: 'Token Slayer — Free Claude Code, Codex, Cursor & Antigravity usage limit widget', desc: 'A free Mac & Windows desktop widget that shows your remaining Claude Code, Codex, Cursor and Antigravity (Gemini) usage (5-hour, weekly, monthly limits) as a pixel hero\'s HP. No server, nothing collected.' };
const titleEn = 'Token Slayer — your remaining tokens are the hero\'s HP';
const descEn = 'A free desktop app (Mac & Windows) that shows your remaining Claude · Codex · Cursor · Antigravity usage as a hero\'s HP on your screen';
const desc = 'Claude · Codex · Cursor · Antigravity 남은 사용량을 화면 위 용사의 HP로 보여주는 무료 데스크톱 앱 (맥 · 윈도우)';
const esc = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
// 자주 묻는 질문: 화면에 보이는 것과 검색용 구조화 데이터(JSON-LD)가 같은 내용 (site/faq.js)
const FAQ = require('../site/faq.js');
const escHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const faqHtml = (lang) => `<section id="faq">
      <h2>${lang === 'ko' ? '자주 묻는 질문' : 'FAQ'}</h2>
      <p class="sub">${lang === 'ko' ? 'Claude Code · Codex · Cursor · Antigravity 사용량을 한눈에 보는 방법과, 앱이 무엇을 읽는지 정리했어요.' : 'How to see your Claude Code, Codex, Cursor and Antigravity usage at a glance, and what the app reads.'}</p>
      <div class="faq">
${FAQ.map((f) => `        <div><h3>${escHtml(f[lang][0])}</h3><p>${escHtml(f[lang][1])}</p></div>`).join('\n')}
      </div>
    </section>`;
// 검색 엔진용: 앱 정보 + FAQ (</script>로 끊기지 않게 < 를 이스케이프)
const jsonLd = (l) => JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'SoftwareApplication', name: 'Token Slayer', applicationCategory: 'DeveloperApplication', operatingSystem: 'macOS, Windows', description: l.seo.desc, url: SITE + l.path, inLanguage: l.lang, image: SITE + '/og.png', downloadUrl: 'https://github.com/sigcrew/token-slayer-releases/releases/latest', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, author: { '@type': 'Organization', name: 'SIG Inc.' } },
    { '@type': 'FAQPage', mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f[l.lang][0], acceptedAnswer: { '@type': 'Answer', text: f[l.lang][1] } })) },
  ],
}).replace(/</g, '\\u003c');
const L = {
  ko: { lang: 'ko', locale: 'ko_KR', path: '/', title, desc, seo: seoKo, alt: 'Token Slayer: 용사 셋이 날아오는 코드와 싸우는 화면' },
  en: { lang: 'en', locale: 'en_US', path: '/en/', title: titleEn, desc: descEn, seo: seoEn, alt: 'Token Slayer: three heroes fighting incoming code' },
};
const headOf = (l) => [
  `<!doctype html><html lang="${l.lang}"><head><meta charset="utf-8">`,
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  `<meta name="description" content="${esc(l.seo.desc)}">`,
  '<link rel="icon" href="/icon.png">',
  `<link rel="canonical" href="${SITE}${l.path}">`,
  // 언어별 주소 (검색엔진용)
  `<link rel="alternate" hreflang="ko" href="${SITE}/">`,
  `<link rel="alternate" hreflang="en" href="${SITE}/en/">`,
  `<link rel="alternate" hreflang="x-default" href="${SITE}/en/">`,
  // 링크 미리보기 (카카오톡 · 슬랙 · X · 페이스북 등)
  '<meta property="og:type" content="website">',
  '<meta property="og:site_name" content="Token Slayer">',
  `<meta property="og:locale" content="${l.locale}">`,
  `<meta property="og:url" content="${SITE}${l.path}">`,
  `<meta property="og:title" content="${esc(l.title)}">`,
  `<meta property="og:description" content="${esc(l.desc)}">`,
  `<meta property="og:image" content="${SITE}/og.png">`,
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  `<meta property="og:image:alt" content="${esc(l.alt)}">`,
  '<meta name="twitter:card" content="summary_large_image">',
  `<meta name="twitter:title" content="${esc(l.title)}">`,
  `<meta name="twitter:description" content="${esc(l.desc)}">`,
  `<meta name="twitter:image" content="${SITE}/og.png">`,
  `<script type="application/ld+json">${jsonLd(l)}</script>`,
].join('\n');
const checkout = process.env.TOKEN_SLAYER_CHECKOUT_URL || require('../src/license-config').CHECKOUT_URL || '%%CHECKOUT_URL%%';
const body = fs.readFileSync(path.join(root, 'site', 'index.html'), 'utf8').replace('%%CHECKOUT_URL%%', checkout);
// 한국어: 언어 전환 링크만 더한다
const toggle = (href, text, hl) => `<a href="${href}" hreflang="${hl}" lang="${hl}" class="lang">${text}</a>`;
fs.writeFileSync(path.join(out, 'index.html'), `${headOf(L.ko)}\n${body.replace('<title>Token Slayer</title>', `<title>${esc(seoKo.title)}</title>`).replace('%%FAQ%%', faqHtml('ko')).replace('</nav>', `  ${toggle('/en/', 'EN', 'en')}\n    </nav>`).replace('%%LANG_FOOTER%%', '<a href="/en/" hreflang="en" lang="en">English</a>')}\n</html>\n`);
// 영어: 문장 조각을 바꾸고(긴 것 먼저), 한글이 남으면 빌드를 멈춘다. 파일은 /en/ 아래라 상대 경로를 절대 경로로.
let en = body.replace('%%CHECKOUT_URL%%', checkout).replace('%%LANG_FOOTER%% · ', '');
for (const [ko, eng] of [...require('../site/en-map.js')].sort((x, y) => y[0].length - x[0].length)) {
  if (!en.includes(ko)) throw new Error(`영어 사이트: 바꿀 문장을 못 찾았어요 → ${ko.slice(0, 50)}`);
  en = en.split(ko).join(eng);
}
const leftover = en.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/ .*$/, '')).join('\n').match(/[^\n]*[가-힣][^\n]*/g);
if (leftover) throw new Error('영어 사이트에 한글이 남았어요:\n' + leftover.slice(0, 8).map((x) => x.trim().slice(0, 120)).join('\n'));
en = en.replace('%%FAQ%%', faqHtml('en')).replace('</nav>', `  ${toggle('/', '한국어', 'ko')}\n    </nav>`).replace('</footer>', `  <span>${toggle('/', '한국어', 'ko')}</span>\n  </footer>`)
  .replace(/src="(demo-korea\.mp4|builtin-packs\.js|scene\.js)"/g, 'src="/$1"').replace('poster="demo-korea-poster.png"', 'poster="/demo-korea-poster.png"');
fs.mkdirSync(path.join(out, 'en'), { recursive: true });
fs.writeFileSync(path.join(out, 'en', 'index.html'), `${headOf(L.en)}\n${en.replace(/<title>[^<]*<\/title>/, `<title>${esc(seoEn.title)}</title>`)}\n</html>\n`);
// 검색 엔진용 sitemap(한국어·영어 서로 연결)과 robots
const today = new Date().toISOString().slice(0, 10);
const alt = (hl, p) => `    <xhtml:link rel="alternate" hreflang="${hl}" href="${SITE}${p}"/>`;
fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[['/', 1.0], ['/en/', 0.9]].map(([p, pr]) => `  <url>
    <loc>${SITE}${p}</loc>
    <lastmod>${today}</lastmod>
    <priority>${pr}</priority>
${alt('ko', '/')}
${alt('en', '/en/')}
${alt('x-default', '/en/')}
  </url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
fs.copyFileSync(path.join(root, 'renderer', 'scene.js'), path.join(out, 'scene.js'));
fs.copyFileSync(path.join(root, 'renderer', 'builtin-packs.js'), path.join(out, 'builtin-packs.js'));
fs.copyFileSync(path.join(root, 'assets', 'icon.png'), path.join(out, 'icon.png'));
for (const f of ['demo-korea.mp4', 'demo-korea-poster.png']) if (fs.existsSync(path.join(root, 'site', f))) fs.copyFileSync(path.join(root, 'site', f), path.join(out, f)); // 소개 영상
fs.copyFileSync(path.join(root, 'site', 'og.html'), path.join(out, 'og.html')); // og.png 만들 때 씀 (scripts/og-shot.js)
console.log('site → _site/');
