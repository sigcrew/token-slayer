// 정적 HTML(첫 실행 안내 · 크기 조절 창)을 영어로 바꾼다. 창을 열 때 ?lang=en 이 붙어 온다.
// 안쪽에 인라인 태그(b · code · small · br · span)만 있는 요소의 innerHTML을 사전 키로 쓴다.
(function () {
  const lang = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'ko';
  window.TSI18N.setLang(lang);
  document.documentElement.lang = lang;
  if (lang !== 'en') return;
  const INLINE = new Set(['B', 'CODE', 'SMALL', 'BR', 'SPAN', 'I']);
  const tr = window.TSI18N.tr;
  function walk(el) {
    if (/[가-힣]/.test(el.innerHTML) && [...el.querySelectorAll('*')].every((c) => INLINE.has(c.tagName)) && /[가-힣]/.test(el.textContent)) {
      const key = el.innerHTML.trim();
      const out = tr(key);
      if (out !== key) { el.innerHTML = out; return; }
    }
    for (const c of el.children) walk(c);
  }
  walk(document.body);
  document.title = tr(document.title);
})();
