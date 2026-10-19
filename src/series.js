// 세계관 시리즈: 배경 · 적 · 쉬는 장면 · 용사를 한 번에 바꾸는 묶음.
// 종류마다 "먼저 열려 있는 것"을 순서대로 골라 쓴다. 뒤쪽에 무료 팩을 두면 프리미엄이 잠겨 있어도 맛보기로 적용된다.
const SERIES = [
  { id: 'japan', icon: '🎌', name: '일본풍', backdrop: ['shrine', 'cherry'], enemies: ['yokai'], rest: ['lantern'], heroes: ['samurai', 'ninja'] },
  { id: 'hell', icon: '🔥', name: '야근 지옥', backdrop: ['lava'], enemies: ['legacy', 'meeting'], rest: ['hotspring'], heroes: ['demon', 'zombie'] },
  { id: 'dungeon', icon: '🏰', name: '던전', backdrop: ['dungeon'], enemies: ['monsters'], rest: ['torchcamp'], heroes: ['paladin', 'rogue'] },
  { id: 'halloween', icon: '🎃', name: '할로윈', backdrop: ['graveyard', 'pumpkins'], enemies: ['ghosts', 'treats'], rest: ['jacklantern'], heroes: ['witch', 'vampire', 'skeleton'] },
  { id: 'korea', icon: '🐯', name: '한국풍', backdrop: ['gyeongbok', 'autumntemple'], enemies: ['gwisin'], rest: ['jeongja'], heroes: ['musa', 'dokkaebi', 'gumiho'] },
  { id: 'cyber', icon: '🌃', name: '사이버', backdrop: ['cyber', 'serverroom', 'terminal'], enemies: ['attacks'], rest: ['nightdesk'], heroes: ['hacker', 'android'] },
  { id: 'devlife', icon: '☕', name: '개발자 일상', backdrop: ['pangyo'], enemies: ['mergequeue', 'commits'], rest: ['subway', 'coffee'], heroes: ['developer'] },
];

// 시리즈에 속한 모든 팩 [type, id]
function membersOf(sr) {
  const out = [];
  for (const [type, ids] of [['backdrop', sr.backdrop], ['enemies', sr.enemies], ['rest', sr.rest], ['hero', sr.heroes]]) for (const id of ids || []) out.push([type, id]);
  return out;
}

// 이 시리즈를 적용하면 무엇이 바뀌는지 계산 (순수 함수)
//  has(type, id): 지금 쓸 수 있는(열려 있는) 팩인지 · currentSkins: 지금 용사 직업 · serviceIds: 화면의 서비스 순서
function planSeries(sr, has, currentSkins = {}, serviceIds = []) {
  const first = (type, ids) => (ids || []).find((id) => has(type, id)) || null;
  const patch = {};
  const b = first('backdrop', sr.backdrop); if (b) patch.backdropTheme = b;
  const e = first('enemies', sr.enemies); if (e) patch.enemyTheme = e;
  const r = first('rest', sr.rest); if (r) patch.restTheme = r;
  const heroes = (sr.heroes || []).filter((id) => has('hero', id));
  if (heroes.length) {
    const skins = { ...currentSkins };
    serviceIds.forEach((sid, i) => { if (heroes[i]) skins[sid] = heroes[i]; }); // 시리즈 용사를 서비스 순서대로 (남는 서비스는 그대로)
    patch.skins = skins;
  }
  const members = membersOf(sr);
  const open = members.filter(([t, id]) => has(t, id)).length;
  // 열려 있어도 이번에 쓰이지 않는 것(같은 종류의 뒤쪽 후보)은 "잠금"이 아니므로 잠긴 것만 센다
  const locked = members.filter(([t, id]) => !has(t, id)).map(([, id]) => id);
  return { patch, open, total: members.length, locked, changes: Object.keys(patch).length };
}

module.exports = { SERIES, membersOf, planSeries };
