// 바닥 예측: 최근 사용 속도로 "이 속도면 언제 0%가 되는지" 계산하고, 리셋보다 먼저인지 알려준다.
// 한도 창마다 최근 샘플(시각, 사용%)을 모아 두고, 같은 리셋 주기 안에서만 속도를 잰다.

const LOOKBACK_MS = 30 * 60e3; // 최근 30분의 속도
const MIN_SPAN_MS = 3 * 60e3;  // 최소 3분 이상 쌓여야 계산
const MIN_RATE = 0.5;          // 시간당 0.5%p 미만이면 '거의 안 씀'으로 보고 예측 안 함

class Forecaster {
  constructor() { this.samples = {}; } // key: `${서비스}:${창}` → [{ t, used, resetsAt }]

  add(id, windows, now = Date.now()) {
    for (const w of windows || []) {
      if (typeof w.usedPercent !== 'number') continue;
      const k = `${id}:${w.key}`;
      let arr = this.samples[k] || [];
      // 리셋되면(사용량이 줄거나 리셋 시각이 바뀌면) 새로 시작
      const last = arr[arr.length - 1];
      if (last && (w.usedPercent < last.used - 0.01 || (w.resetsAt && last.resetsAt && Math.abs(w.resetsAt - last.resetsAt) > 60e3))) arr = [];
      arr.push({ t: now, used: w.usedPercent, resetsAt: w.resetsAt || null });
      this.samples[k] = arr.filter((s) => now - s.t <= LOOKBACK_MS + 60e3).slice(-120);
    }
  }

  // 창별 예측 중 가장 급한 것: { key, label, ratePerHour, etaMs, beforeReset, resetInMs }
  predict(id, windows, now = Date.now()) {
    let best = null;
    for (const w of windows || []) {
      const arr = (this.samples[`${id}:${w.key}`] || []).filter((s) => now - s.t <= LOOKBACK_MS);
      if (arr.length < 2) continue;
      const a = arr[0], b = arr[arr.length - 1];
      const span = b.t - a.t;
      if (span < MIN_SPAN_MS) continue;
      const ratePerHour = ((b.used - a.used) / span) * 3600e3;
      if (ratePerHour < MIN_RATE) continue;
      const remaining = Math.max(0, 100 - b.used);
      const etaMs = (remaining / ratePerHour) * 3600e3;
      const resetInMs = w.resetsAt ? w.resetsAt - now : null;
      const beforeReset = resetInMs == null ? true : etaMs < resetInMs;
      const f = { key: w.key, label: w.label, ratePerHour: Math.round(ratePerHour * 10) / 10, etaMs: Math.round(etaMs), beforeReset, resetInMs };
      if (!best || (f.beforeReset && !best.beforeReset) || (f.beforeReset === best.beforeReset && f.etaMs < best.etaMs)) best = f;
    }
    return best;
  }
}

// HP 경고 단계: 20% → 10% (리셋으로 30% 넘게 회복하면 다시 경고 가능)
class HpAlarm {
  constructor() { this.level = {}; }
  check(id, remaining) {
    if (remaining == null) return null;
    const prev = this.level[id] || 100;
    if (remaining > 30) { this.level[id] = 100; return null; }
    for (const th of [10, 20]) {
      if (remaining <= th && prev > th) { this.level[id] = th; return th; }
    }
    return null;
  }
}

module.exports = { Forecaster, HpAlarm, LOOKBACK_MS };
