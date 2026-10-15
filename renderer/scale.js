// 크기 조절 창: 슬라이더를 끄는 동안 위젯 크기가 바로 바뀐다. Electron 밖(브라우저)에서는 미리보기용 가짜 브리지를 쓴다.
(function () {
  const bridge = window.scaleBridge || {
    get: async () => ({ scale: 0.8, min: 0.5, max: 1.75 }),
    set() {}, commit() {}, reset() {}, onChanged() {},
  };
  const slider = document.getElementById('slider');
  const val = document.getElementById('val');
  const show = (v) => { val.textContent = `×${Number(v).toFixed(2)}`; };
  const apply = (v) => { slider.value = String(v); show(v); };

  bridge.get().then((s) => {
    slider.min = String(s.min);
    slider.max = String(s.max);
    apply(s.scale);
  });
  bridge.onChanged((v) => apply(v));

  slider.addEventListener('input', () => { show(slider.value); bridge.set(Number(slider.value)); });
  slider.addEventListener('change', () => bridge.commit());
  document.getElementById('reset').addEventListener('click', () => { bridge.reset(); apply(1); });
  document.getElementById('close').addEventListener('click', () => window.close());
})();
