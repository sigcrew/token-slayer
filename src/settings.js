const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  pos: null,            // 캐릭터 영역의 화면 좌표 {x, y}
  scale: 1,
  hpBasis: {},          // 서비스별 HP 기준 한도 { claude: 'weekly' }: 'auto'(가장 적은 것, 기본) | 'fiveHour'(5시간) | 'weekly'(주간·월간 같은 긴 한도)
  codexServer: true,    // Codex 사용량을 서버에서 조회 (끄면 로컬 기록만)
  welcomeShown: [],     // 편지를 이미 보여 준 추억 팩 id
  lang: 'auto',         // 언어: 'auto'(시스템 언어) | 'ko' | 'en'
  heroRes: 'classic',   // 용사 도트 해상도: 'classic'(12칸) | 'hd'(고해상도, 프리미엄)
  driver: 'min',        // 캐릭터 기준: 'min' 또는 서비스 id
  show: {},             // 서비스별 표시 여부 { claude: true, cursor: false, ... }
  clickThrough: false,
  demo: false,
  visible: true,
};

function create(dir) {
  const file = path.join(dir, 'settings.json');
  let data = { ...DEFAULTS };
  try { data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  let timer = null;
  return {
    get: () => data,
    set(patch) {
      data = { ...data, ...patch };
      clearTimeout(timer);
      timer = setTimeout(() => {
        try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch {}
      }, 300);
      return data;
    },
  };
}

// 위젯 크기 배율 범위 (0.5배보다 작으면 글자를 읽기 어렵고, 1.75배보다 크면 화면을 너무 차지함)
const SCALE_MIN = 0.5, SCALE_MAX = 1.75;
const clampScale = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, n)) * 100) / 100;
};

module.exports = { create, DEFAULTS, SCALE_MIN, SCALE_MAX, clampScale };
