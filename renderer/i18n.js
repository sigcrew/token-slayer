// 다국어(i18n): 한국어 문장을 키로 쓰고, 영어일 때만 사전(i18n-en.js)에서 찾아 바꾼다.
//  tr('남은 사용량 {n}%', { n: 5 })  →  ko: "남은 사용량 5%" · en: "5% left" (사전에 "남은 사용량 {n}%": "{n}% left")
//  사전에 없는 한국어는 그대로 보여 주고(앱이 깨지지 않음) misses에 기록한다 → 테스트가 누락을 잡는다.
// 앱(main · src)과 화면(renderer)이 같은 파일을 쓴다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./i18n-en'));
  else root.TSI18N = factory(root.TS_EN);
})(typeof self !== 'undefined' ? self : this, function (EN) {
  const HANGUL = /[가-힣]/;
  const state = { lang: 'ko' };
  const misses = new Set();

  const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

  // 'ko' | 'en'
  function setLang(l) { state.lang = l === 'en' ? 'en' : 'ko'; }
  function getLang() { return state.lang; }
  // 설정값('auto' | 'ko' | 'en')과 시스템 언어(예: 'ko-KR', 'en-US')로 실제 언어를 정한다
  function resolveLang(setting, systemLocale) {
    if (setting === 'ko' || setting === 'en') return setting;
    return /^ko\b/i.test(String(systemLocale || '')) ? 'ko' : 'en';
  }

  function tr(ko, vars) {
    if (typeof ko !== 'string') return ko;
    if (state.lang !== 'en' || !HANGUL.test(ko)) return fill(ko, vars);
    const hit = EN && EN[ko];
    if (hit !== undefined) return fill(hit, vars);
    misses.add(ko);
    return fill(ko, vars);
  }

  // 메뉴 템플릿의 label · sublabel을 재귀로 번역 (이미 번역된 라벨은 한글이 없어서 그대로 둔다)
  function trMenu(items) {
    return (items || []).map((it) => {
      if (!it || typeof it !== 'object') return it;
      const out = { ...it };
      if (typeof out.label === 'string') out.label = tr(out.label);
      if (typeof out.sublabel === 'string') out.sublabel = tr(out.sublabel);
      if (Array.isArray(out.submenu)) out.submenu = trMenu(out.submenu);
      return out;
    });
  }

  return { tr, trMenu, setLang, getLang, resolveLang, misses, HANGUL };
});
