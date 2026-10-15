// 업적: 실제 사용 기록(경험치, 하루 사용량, GAME OVER, 부활, BURNING TIME, 쓰다듬기, 꾸미기 …)으로만 달성한다
const { dayKey, levelFor } = require('./progress');
const { SERIES, membersOf } = require('./series');

const LIST = [
  // 성장
  { id: 'first', group: '성장', icon: '⚔️', name: '첫 전투', desc: '처음으로 경험치를 얻었어요', test: (s) => s.totalXp > 0 },
  { id: 'lv5', group: '성장', icon: '🛡️', name: '견습 용사', desc: '용사 한 명이 Lv.5에 도달', test: (s) => s.maxLevel >= 5 },
  { id: 'lv10', group: '성장', icon: '🗡️', name: '베테랑', desc: '용사 한 명이 Lv.10에 도달', test: (s) => s.maxLevel >= 10 },
  { id: 'lv20', group: '성장', icon: '👑', name: '전설의 용사', desc: '용사 한 명이 Lv.20에 도달', test: (s) => s.maxLevel >= 20 },
  { id: 'lv30', group: '성장', icon: '🌌', name: '신화', desc: '용사 한 명이 Lv.30에 도달', test: (s) => s.maxLevel >= 30 },
  { id: 'allLv5', group: '성장', icon: '🏕️', name: '원정대', desc: '용사 셋이 모두 Lv.5 이상', test: (s) => s.heroesLv5 >= 3 },
  { id: 'claudeLv10', group: '성장', icon: '🟠', name: 'Claude 마스터', desc: 'Claude 용사 Lv.25 (한도를 매주 다 써도 약 2개월)', test: (s) => (s.levels.claude || 0) >= 25 },
  { id: 'codexLv10', group: '성장', icon: '🔵', name: 'Codex 마스터', desc: 'Codex 용사 Lv.25 (한도를 매주 다 써도 약 2개월)', test: (s) => (s.levels.codex || 0) >= 25 },
  { id: 'cursorLv10', group: '성장', icon: '🟣', name: 'Cursor 마스터', desc: 'Cursor 용사 Lv.25 (월간 한도를 두 달치 이상)', test: (s) => (s.levels.cursor || 0) >= 25 },
  { id: 'anniversary', group: '성장', icon: '🎂', name: '1주년 용사', desc: '첫 전투 뒤 1년이 지났어요', test: (s) => s.firstAt && Date.now() - s.firstAt >= 365 * 86400e3 },
  { id: 'xp100k', group: '성장', icon: '💎', name: '십만 대군', desc: '누적 경험치 100,000', test: (s) => s.totalXp >= 100000 },

  // 사용량
  { id: 'century', group: '사용량', icon: '💯', name: '하루 100%', desc: '하루에 사용량 100% 이상', test: (s) => s.bestDayPct >= 100 },
  { id: 'day200', group: '사용량', icon: '🚂', name: '폭주 기관차', desc: '하루에 사용량 200% 이상', test: (s) => s.bestDayPct >= 200 },
  { id: 'week500', group: '사용량', icon: '📈', name: '주간 500%', desc: '최근 7일 사용량 합계 500% 이상', test: (s) => s.weekPct >= 500 },
  { id: 'trinity', group: '사용량', icon: '🔺', name: '삼위일체', desc: '하루에 세 에이전트를 모두 사용', test: (s) => s.trinity },
  { id: 'pct1000', group: '사용량', icon: '🧮', name: '천 퍼센트 클럽', desc: '누적 사용량 1,000%', test: (s) => s.totalPct >= 1000 },
  { id: 'exact100', group: '사용량', icon: '🎯', name: '정확히 100', desc: '하루 사용량이 딱 100%로 끝났어요', test: (s) => s.exact100 },
  { id: 'fair', group: '사용량', icon: '⚖️', name: '공평한 리더', desc: '하루에 세 에이전트를 각각 5%p 이상, 비슷하게(10%p 이내) 사용', test: (s) => s.fair },
  { id: 'party', group: '사용량', icon: '🤝', name: '파티 결성', desc: '용사 셋이 동시에 전투', test: (s) => s.fightingNow >= 3 },

  // 시간 · 연속
  { id: 'night', group: '시간·연속', icon: '🦉', name: '올빼미', desc: '새벽 2~5시에 전투', test: (s) => s.nightOwl },
  { id: 'earlybird', group: '시간·연속', icon: '🐓', name: '아침형 용사', desc: '아침 5~8시에 전투', test: (s) => s.earlyBird },
  { id: 'weekend', group: '시간·연속', icon: '🏖️', name: '주말 전사', desc: '토요일과 일요일 모두 전투', test: (s) => s.weekend },
  { id: 'fridayNight', group: '시간·연속', icon: '🌙', name: '불금 전사', desc: '금요일 밤 10시~자정에 전투', test: (s) => s.fridayNight },
  { id: 'christmas', group: '시간·연속', icon: '🎄', name: '크리스마스에도 출근', desc: '12월 25일에 전투', test: (s) => s.christmas },
  { id: 'koreanHoliday', group: '시간·연속', icon: '🧧', name: '명절에도 출근', desc: '설날·추석 연휴(전날·당일·다음 날)에 전투', test: (s) => s.koreanHoliday },
  { id: 'steady', group: '시간·연속', icon: '🐢', name: '느긋한 용사', desc: '7일 연속 전투하면서 GAME OVER 없음', test: (s) => s.steady },
  { id: 'streak7', group: '시간·연속', icon: '🏃', name: '마라토너', desc: '7일 연속 전투', test: (s) => s.streak >= 7 },
  { id: 'streak14', group: '시간·연속', icon: '📅', name: '2주 개근', desc: '14일 연속 전투', test: (s) => s.streak >= 14 },
  { id: 'streak30', group: '시간·연속', icon: '🗓️', name: '한 달 개근', desc: '30일 연속 전투', test: (s) => s.streak >= 30 },

  // GAME OVER · 생존
  { id: 'gameover', group: 'GAME OVER', icon: '🪦', name: '장렬한 최후', desc: '처음으로 GAME OVER', test: (s) => s.gameOvers >= 1 },
  { id: 'gameover5', group: 'GAME OVER', icon: '⚰️', name: '불굴의 용사', desc: 'GAME OVER 5번', test: (s) => s.gameOvers >= 5 },
  { id: 'phoenix', group: 'GAME OVER', icon: '🧪', name: '불사조', desc: 'GAME OVER 뒤 포션을 마시고 부활', test: (s) => s.revives >= 1 },
  { id: 'wipeout', group: 'GAME OVER', icon: '💀', name: '전멸', desc: '용사 셋이 동시에 GAME OVER', test: (s) => s.deadNow >= 3 },
  { id: 'speedrun', group: 'GAME OVER', icon: '⏱️', name: '스피드런', desc: '리셋 뒤 1시간 안에 GAME OVER', test: (s) => s.speedrun },
  { id: 'revive3', group: 'GAME OVER', icon: '🔁', name: '부활 3연속', desc: '하루에 세 번 GAME OVER 뒤 부활', test: (s) => s.revive3 },
  { id: 'clutch', group: 'GAME OVER', icon: '😮‍💨', name: '구사일생', desc: 'HP 5% 아래로 버티다 리셋까지 살아남음', test: (s) => s.clutches >= 1 },

  // 소진율: 한도 창이 끝날 때 얼마나 남기지 않고 다 썼나 (앱의 취지: 토큰 남기지 말고 다 쓰자)
  { id: 'thrifty', group: '소진율', icon: '🧾', name: '알뜰 살림', desc: '주간 한도를 90% 이상 쓰고 리셋됐어요', test: (s) => s.thrifty },
  { id: 'thrifty3', group: '소진율', icon: '📒', name: '3주 연속 알뜰', desc: '한 에이전트의 주간 한도를 3주 연속 90% 이상 썼어요', test: (s) => s.thrifty3 },
  { id: 'monthClose', group: '소진율', icon: '🗒️', name: '월말 정산', desc: '월간 한도를 90% 이상 쓰고 마감했어요', test: (s) => s.monthClose },
  { id: 'exactFit', group: '소진율', icon: '📐', name: '딱 맞춰 씀', desc: '주간·월간 한도를 98% 이상 쓰고도 GAME OVER 없이 리셋', test: (s) => s.exactFit },
  { id: 'burnHunter', group: '소진율', icon: '🏹', name: '리셋 사냥꾼', desc: 'BURNING TIME에 들어간 뒤 남은 한도의 80% 이상을 리셋 전에 태웠어요', test: (s) => s.burnHunter },

  // 낭비 배지: 토큰을 남기고 버리는 걸 놀리는 업적. 좋은 일이 아니라서 알림은 띄우지 않고 목록에만 조용히 나온다
  { id: 'iceHero', group: '낭비 배지', quiet: true, icon: '🧊', name: '얼음 용사', desc: 'HP 100%로 5시간을 그냥 두었어요 (토큰이 녹고 있어요)', test: (s) => s.iceHero },
  { id: 'expired', group: '낭비 배지', quiet: true, icon: '🥀', name: '유통기한 만료', desc: '주간 한도를 10%도 못 쓰고 리셋됐어요', test: (s) => s.expiredWeek },
  { id: 'monthRegret', group: '낭비 배지', quiet: true, icon: '🍂', name: '월말의 후회', desc: '월간 한도를 20%도 못 쓰고 마감됐어요', test: (s) => s.monthRegret },
  { id: 'hibernate', group: '낭비 배지', quiet: true, icon: '🐻', name: '동면', desc: '앱을 켜 둔 채로 7일 동안 한 번도 안 썼어요', test: (s) => s.hibernated },

  // BURNING TIME
  { id: 'burner', group: 'BURNING TIME', icon: '🔥', name: '불꽃 사냥꾼', desc: 'BURNING TIME에 경험치 1,000 획득', test: (s) => s.burnXp >= 1000 },
  { id: 'burn10k', group: 'BURNING TIME', icon: '🌋', name: '화염술사', desc: 'BURNING TIME에 경험치 10,000 획득', test: (s) => s.burnXp >= 10000 },
  { id: 'burnStreak', group: 'BURNING TIME', icon: '🕯️', name: 'BURNING TIME 개근', desc: 'BURNING TIME이 켜질 때마다 5번 연속 사용', test: (s) => s.burnStreak5 },
  { id: 'fullburn', group: 'BURNING TIME', icon: '💥', name: '완전 연소', desc: 'BURNING TIME 중에 한도를 다 태웠어요', test: (s) => s.fullBurn },

  // 교감
  { id: 'petter', group: '교감', icon: '💕', name: '쓰다듬기 장인', desc: '용사를 50번 쓰다듬었어요', test: (s) => s.pets >= 50 },
  { id: 'petter200', group: '교감', icon: '🧸', name: '용사 집사', desc: '용사를 200번 쓰다듬었어요', test: (s) => s.pets >= 200 },
  { id: 'angry', group: '교감', icon: '💢', name: '건드리지 마', desc: '용사를 화나게 했어요', test: (s) => s.angry },
  { id: 'boo', group: '교감', icon: '👻', name: '유령과 친구', desc: '쓰러진 용사의 유령을 쓰다듬었어요', test: (s) => s.boo },

  // 꾸미기 · 기록
  { id: 'fashion', group: '꾸미기·기록', icon: '👗', name: '패셔니스타', desc: '용사 직업을 3가지 이상 입어 봤어요', test: (s) => s.skinsTried >= 3 },
  { id: 'maker', group: '꾸미기·기록', icon: '🛠️', name: '장인', desc: '직접 만든 팩을 불러왔어요', test: (s) => s.userPacks > 0 },
  ...SERIES.map((sr) => ({ id: `series_${sr.id}`, group: '꾸미기·기록', icon: sr.icon, name: `${sr.name} 완주`, desc: `${sr.name} 시리즈의 팩 ${membersOf(sr).length}개를 전부 써 봤어요`, test: (s) => s.seriesDone[sr.id] })),
  { id: 'seriesAll', group: '꾸미기·기록', icon: '🎨', name: '시리즈 컬렉터', desc: '모든 시리즈를 완주했어요', test: (s) => SERIES.every((sr) => s.seriesDone[sr.id]) },
  { id: 'reporter', group: '꾸미기·기록', icon: '📜', name: '기록관', desc: '주간 기록 카드를 만들었어요', test: (s) => s.cards >= 1 },

  // 숨은 업적 (달성 전엔 ??? 로 표시)
  { id: 'dontLeave', group: '숨은 업적', hidden: true, icon: '🙈', name: '떠나지 마', desc: '1분 안에 메뉴를 5번 열었다 닫았어요', test: (s) => s.menuSpam },
  { id: 'dragon', group: '숨은 업적', hidden: true, icon: '🐉', name: '드래곤 슬레이어', desc: '아주 드물게 나타나는 DRAGON을 처치', test: (s) => s.dragonSlain },
  { id: 'detective', group: '숨은 업적', hidden: true, icon: '🕵️', name: '코드 탐정', desc: '상세 패널을 100번 열어 봤어요', test: (s) => s.panelOpens >= 100 },
];

// 연속으로 사용 기록이 있는 날 수 (오늘 또는 어제부터 거슬러)
function streak(days, now = Date.now()) {
  const used = (k) => days[k] && Object.values(days[k]).some((v) => v > 0);
  let n = 0;
  let t = now;
  if (!used(dayKey(t))) t -= 86400e3; // 오늘 아직 안 썼으면 어제부터
  while (used(dayKey(t))) { n++; t -= 86400e3; }
  return n;
}

// 한 에이전트의 주간 창이 연달아(창 끝 사이가 9일 이내) 90% 이상으로 끝난 가장 긴 횟수
function thriftyStreak(ends) {
  let best = 0;
  const ids = [...new Set(ends.filter((e) => e.key === 'weekly').map((e) => e.id))];
  for (const id of ids) {
    let run = 0, last = null;
    for (const e of ends.filter((x) => x.key === 'weekly' && x.id === id).sort((a, b) => a.at - b.at)) {
      const connected = last != null && e.at - last <= 9 * 86400e3;
      run = e.util >= 90 ? (connected ? run + 1 : 1) : 0;
      last = e.at;
      best = Math.max(best, run);
    }
  }
  return best;
}

// 앱이 켜져 있던 날 중 어제부터 7일이 전부 '사용량이 하나도 안 늘어난 날'인지 (앱이 꺼져 있던 날은 모르니까 인정 안 함)
function hibernated(days, runDays, now = Date.now()) {
  for (let i = 1; i <= 7; i++) {
    const k = dayKey(now - i * 86400e3);
    if (!runDays.includes(k) || (days[k] && Object.values(days[k]).some((v) => v > 0))) return false;
  }
  return true;
}

const FAIR_MIN = 5; // 공평한 리더: 에이전트마다 하루 최소 사용량(%p). 조금만 써도 달성되는 것을 막음
const daySum = (d) => Object.values(d || {}).reduce((a, b) => a + b, 0);

function summarize(store, extra = {}) {
  const st = store.stats();
  const days = st.days || {};
  const now = Date.now();
  let weekPct = 0;
  for (let i = 0; i < 7; i++) weekPct += daySum(days[dayKey(now - i * 86400e3)]);
  // 토요일에 쓰고 바로 다음 날(일요일)에도 쓴 주말이 있었는지
  const weekend = Object.keys(days).some((k) => {
    const d = new Date(`${k}T12:00:00`);
    return d.getDay() === 6 && daySum(days[k]) > 0 && daySum(days[dayKey(d.getTime() + 86400e3)]) > 0;
  });
  const heroes = Object.entries(store.all()).filter(([k]) => !k.startsWith('_'));
  const today = dayKey(now);
  const pastDays = Object.keys(days).filter((k) => k !== today);
  const goDays = new Set(st.gameOverDays || []);
  const s7 = streak(days);
  let noGameOver7 = true;
  for (let i = 0; i < 7; i++) if (goDays.has(dayKey(now - i * 86400e3))) noGameOver7 = false;
  return {
    levels: Object.fromEntries(heroes.map(([k, v]) => [k, levelFor(v.xp || 0)])),
    firstAt: st.firstAt || null,
    totalPct: st.totalPct || 0,
    exact100: pastDays.some((k) => Math.round(daySum(days[k])) === 100),
    fair: Object.values(days).some((d) => {
      const v = Object.values(d).filter((x) => x > 0);
      return v.length >= 3 && Math.min(...v) >= FAIR_MIN && Math.max(...v) - Math.min(...v) <= 10;
    }),
    expiredWeek: (st.windowEnds || []).some((e) => e.key === 'weekly' && e.util <= 10),
    thrifty: (st.windowEnds || []).some((e) => e.key === 'weekly' && e.util >= 90),
    thrifty3: thriftyStreak(st.windowEnds || []) >= 3,
    monthClose: (st.windowEnds || []).some((e) => e.key === 'monthly' && e.util >= 90),
    exactFit: (st.windowEnds || []).some((e) => (e.key === 'weekly' || e.key === 'monthly') && e.util >= 98 && e.util < 99.5),
    burnHunter: !!st.burnHunter,
    monthRegret: (st.windowEnds || []).some((e) => e.key === 'monthly' && e.util <= 20),
    hibernated: hibernated(days, st.runDays || [], now),
    fridayNight: !!st.fridayNight,
    christmas: !!st.christmas,
    koreanHoliday: !!st.koreanHoliday,
    steady: s7 >= 7 && noGameOver7,
    speedrun: !!st.speedrun,
    revive3: !!st.revive3,
    iceHero: !!st.iceHero,
    burnStreak5: !!st.burnStreak5,
    menuSpam: !!st.menuSpam,
    dragonSlain: !!st.dragonSlain,
    panelOpens: st.panelOpens || 0,
    totalXp: store.totalXp(),
    maxLevel: store.maxLevel(),
    heroesLv5: heroes.filter(([, v]) => levelFor(v.xp || 0) >= 5).length,
    bestDayPct: Math.max(0, ...Object.values(days).map(daySum)),
    weekPct,
    trinity: Object.values(days).some((d) => Object.values(d).filter((v) => v > 0).length >= 3),
    weekend,
    gameOvers: st.gameOvers || 0,
    revives: st.revives || 0,
    clutches: st.clutches || 0,
    burnXp: st.burnXp || 0,
    fullBurn: !!st.fullBurn,
    nightOwl: !!st.nightOwl,
    earlyBird: !!st.earlyBird,
    pets: st.pets || 0,
    angry: !!st.angry,
    boo: !!st.boo,
    skinsTried: (st.skinsTried || []).length,
    seriesDone: Object.fromEntries(SERIES.map((sr) => [sr.id, membersOf(sr).every(([type, id]) => (st.packsTried || []).includes(`${type}:${id}`))])),
    cards: st.cards || 0,
    streak: s7,
    fightingNow: extra.fightingNow || 0,
    deadNow: extra.deadNow || 0,
    userPacks: extra.userPacks || 0,
  };
}

// 새로 달성한 업적 목록을 돌려준다
function evaluate(store, extra) {
  const s = summarize(store, extra);
  const got = [];
  for (const a of LIST) if (a.test(s) && store.unlock(a.id)) got.push(a);
  return got;
}

module.exports = { LIST, evaluate, summarize, streak, hibernated, thriftyStreak };
