// 에이전트가 일할 때 쓰는 파일을 실시간으로 감시해서 '지금 일하는 중'을 바로 알아낸다.
// (용사 움직임용. HP 수치는 서버 조회로 따로 맞춘다)
//
//  - 파일이 바뀌면 즉시 busy → 전투 시작
//  - 조용한 시간이 idleMs(기본 30초) 넘으면 busy 해제 → 모닥불
//  - 잡음이 많은 곳(Cursor 설정 DB)은 minEvents 이상 몰려서 바뀔 때만 인정
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class ActivityWatcher extends EventEmitter {
  // targets: { [id]: { paths: [{ dir, recursive?, match?(filename) }], idleMs?, minEvents?, windowMs? } }
  constructor(targets, { now = () => Date.now() } = {}) {
    super();
    this.targets = targets;
    this.now = now;
    this.state = {};
    this.watchers = [];
    this.retry = null;
    this.tick = null;
  }

  start() {
    for (const id of Object.keys(this.targets)) {
      this.state[id] = { busy: false, last: 0, recent: [], watching: new Set(), raw: 0, matched: 0, lastFile: null, errors: [], probeHits: 0, probeSeen: {} };
      this.attach(id);
    }
    // 파일 알림이 안 오는 경우(열린 파일에 계속 덧붙여 쓰기)를 위해, 지금 쓰이는 파일을 짧은 간격으로 직접 확인
    this.probeTimers = [];
    for (const [id, cfg] of Object.entries(this.targets)) {
      if (!cfg.probe) continue;
      let files = [];
      let refreshedAt = 0;
      const t = setInterval(async () => {
        try {
          if (Date.now() - refreshedAt > (cfg.probeRefreshMs || 20000)) { files = (await cfg.probe()) || []; refreshedAt = Date.now(); }
          const st = this.state[id];
          for (const f of files) {
            let s;
            try { s = fs.statSync(f); } catch { continue; }
            const sig = `${s.size}:${s.mtimeMs}`;
            if (st.probeSeen[f] && st.probeSeen[f] !== sig) { st.probeHits++; st.lastFile = path.basename(f); this.touch(id); }
            st.probeSeen[f] = sig;
          }
        } catch {}
      }, cfg.probeEvery || 1500);
      this.probeTimers.push(t);
    }
    // 파일 변화 대신 '지금 일하는 중인가'를 직접 말해 주는 곳(예: Cursor 대화 기록의 마지막 줄)
    // 일하는 중이라고 하면 바로 busy로 만들고(minEvents 무시), 그 뒤로는 평소처럼 idleMs 만큼 조용해야 해제된다
    for (const [id, cfg] of Object.entries(this.targets)) {
      if (!cfg.stateProbe) continue;
      let files = [];
      let refreshedAt = 0;
      const cache = new Map();
      const t = setInterval(async () => {
        try {
          if (Date.now() - refreshedAt > (cfg.stateRefreshMs || 8000)) { files = (await cfg.stateProbe.files()) || []; refreshedAt = Date.now(); }
          const r = cfg.stateProbe.state(files, this.now(), cache);
          if (r && r.working) {
            const st = this.state[id];
            st.stateHits = (st.stateHits || 0) + 1;
            st.lastFile = 'transcript';
            this.touch(id, true);
          }
        } catch {}
      }, cfg.stateEvery || 2000);
      this.probeTimers.push(t);
    }
    // 아직 없는 폴더는 1분마다 다시 시도 (앱을 나중에 설치한 경우)
    this.retry = setInterval(() => { for (const id of Object.keys(this.targets)) this.attach(id); }, 60000);
    this.tick = setInterval(() => this.checkIdle(), 2000);
  }

  stop() {
    clearInterval(this.retry);
    clearInterval(this.tick);
    for (const t of this.probeTimers || []) clearInterval(t);
    for (const w of this.watchers) { try { w.close(); } catch {} }
    this.watchers = [];
  }

  attach(id) {
    const st = this.state[id];
    for (const p of this.targets[id].paths) {
      if (st.watching.has(p.dir)) continue;
      if (!fs.existsSync(p.dir)) continue;
      // 심볼릭 링크 폴더는 실제 경로로 감시해야 macOS에서 이벤트가 들어옴
      let real = p.dir;
      try { real = fs.realpathSync(p.dir); } catch {}
      if (real !== p.dir) st.realDirs = { ...(st.realDirs || {}), [p.dir]: real };
      try {
        const w = fs.watch(real, { recursive: !!p.recursive, persistent: false }, (_ev, name) => {
          const file = name ? String(name) : '';
          st.raw++;
          st.lastRawFile = file;
          const ok = !p.match || p.match(file);
          st.log = (st.log || []).concat({ t: this.now(), file, ok }).slice(-25);
          if (!ok) return;
          // 경로별 기준: 앱이 혼자 주기적으로 쓰는 파일(1~2개씩 띄엄띄엄)은 거르고, 몰려서 바뀔 때만 인정
          if (p.minEvents > 1) {
            const t = this.now(), win = p.windowMs || 10000;
            st.pathRecent = st.pathRecent || {};
            const list = (st.pathRecent[p.dir] || []).filter((x) => t - x < win).concat(t);
            st.pathRecent[p.dir] = list;
            if (list.length < p.minEvents) { st.log[st.log.length - 1].ok = false; return; }
          }
          st.matched++;
          st.lastFile = file;
          this.touch(id);
        });
        w.on('error', (e) => { st.errors.push(`${p.dir}: ${e.message}`); st.watching.delete(p.dir); try { w.close(); } catch {} });
        this.watchers.push(w);
        st.watching.add(p.dir);
      } catch (e) {
        st.errors.push(`${p.dir}: ${e.message}`);
        // 이 OS에서 recursive 감시가 안 되면 최상위만이라도
        if (p.recursive) {
          try {
            const w = fs.watch(p.dir, { persistent: false }, () => this.touch(id));
            this.watchers.push(w);
            st.watching.add(p.dir);
          } catch {}
        }
      }
    }
  }

  touch(id, force = false) {
    const st = this.state[id];
    const cfg = this.targets[id];
    const t = this.now();
    st.last = t;
    if (force && !st.busy) { st.busy = true; st.recent = [t]; this.emit('change', id, true); return; }
    const minEvents = cfg.minEvents || 1;
    const windowMs = cfg.windowMs || 10000;
    st.recent = st.recent.filter((x) => t - x < windowMs).concat(t);
    if (!st.busy && st.recent.length >= minEvents) {
      st.busy = true;
      this.emit('change', id, true);
    }
  }

  checkIdle() {
    const t = this.now();
    for (const id of Object.keys(this.state)) {
      const st = this.state[id];
      const idleMs = this.targets[id].idleMs || 30000;
      if (st.busy && t - st.last > idleMs) {
        st.busy = false;
        st.recent = [];
        this.emit('change', id, false);
      }
    }
  }

  // 진단용 요약
  diag() {
    const out = {};
    for (const [id, st] of Object.entries(this.state)) {
      out[id] = {
        dirs: this.targets[id].paths.map((p) => ({ dir: p.dir, realDir: (st.realDirs || {})[p.dir] || undefined, exists: fs.existsSync(p.dir), watching: st.watching.has(p.dir) })),
        busy: st.busy, rawEvents: st.raw, matchedEvents: st.matched, probeHits: st.probeHits, stateHits: st.stateHits || 0,
        lastRawFile: st.lastRawFile || null, lastMatchedFile: st.lastFile,
        lastAt: st.last ? new Date(st.last).toLocaleTimeString() : null,
        errors: st.errors.slice(-3),
        timeline: (st.log || []).map((e) => `${new Date(e.t).toLocaleTimeString()} ${e.ok ? '✓' : '·'} ${e.file}`),
      };
    }
    return out;
  }

  isBusy(id) { return !!(this.state[id] && this.state[id].busy); }
  lastAt(id) { return (this.state[id] && this.state[id].last) || null; }
  isWatching(id) { return !!(this.state[id] && this.state[id].watching.size); }
}

module.exports = { ActivityWatcher };
