// 프리미엄 라이선스: Lemon Squeezy 라이선스 키 API로 활성화·검증 (서버 없이 앱에서 직접 호출)
//  - activate  : 키를 이 컴퓨터에 묶고(instance) 저장
//  - revalidate: 주기적으로 키가 아직 유효한지 확인 (환불·비활성화되면 다시 잠김)
//  - 오프라인이어도 마지막 확인 후 GRACE_MS 동안은 유지
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const config = require('./license-config');

const API = 'https://api.lemonsqueezy.com/v1/licenses';
const REVALIDATE_MS = 24 * 3600e3;     // 하루에 한 번 확인
const GRACE_MS = 30 * 24 * 3600e3;     // 네트워크가 안 돼도 30일은 유지

const BAD_STATUS = new Set(['disabled', 'expired']);

async function call(fetchFn, endpoint, params) {
  let res;
  try {
    res = await fetchFn(`${API}/${endpoint}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
  } catch (e) {
    return { network: true, message: e.message };
  }
  let body = null;
  try { body = await res.json(); } catch {}
  if (!body) return { network: true, message: `HTTP ${res.status}` }; // 5xx HTML 등은 서버 문제로 취급
  return { body, status: res.status };
}

// 결제 서비스 화면에서 "내 컴퓨터 2대"를 구분할 수 있는 이름. 컴퓨터 이름(hostname)에는 실명이 들어 있는 경우가 많아서 보내지 않고,
// 운영체제와 무작위 짧은 번호만 쓴다 (예: "Token Slayer darwin-arm64 #a3f9c1")
function instanceName() {
  return `Token Slayer ${process.platform}-${process.arch} #${crypto.randomBytes(3).toString('hex')}`;
}

// 내 스토어/상품의 키인지 확인 (다른 상품 키로 해금하는 것 방지)
function belongsToMe(meta) {
  if (!config.STORE_ID || !config.PRODUCT_ID) return false; // 설정 전에는 어떤 키도 통과시키지 않음
  if (!meta) return false;
  return Number(meta.store_id) === Number(config.STORE_ID) && Number(meta.product_id) === Number(config.PRODUCT_ID);
}

function create(dir, { fetchFn = globalThis.fetch, now = () => Date.now() } = {}) {
  const file = path.join(dir, 'license.json');
  let data = null; // { key, instanceId, activatedAt, checkedAt }
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const save = () => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (data) fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
      else fs.rmSync(file, { force: true });
    } catch {}
  };
  const valid = () => !!(data && data.key && data.instanceId && now() - (data.checkedAt || 0) < GRACE_MS);

  return {
    isValid: valid,
    info: () => (data ? { key: data.key, activatedAt: data.activatedAt, checkedAt: data.checkedAt } : null),

    async activate(rawKey) {
      const key = String(rawKey || '').trim();
      if (!/^[A-Za-z0-9-]{16,64}$/.test(key)) return { ok: false, reason: 'format', message: '라이선스 키 형식이 아니에요.' };
      // 이 컴퓨터가 이미 같은 키로 활성화돼 있으면 새 자리를 또 쓰지 않는다 (키를 다시 붙여 넣어도 자리가 새지 않게)
      const prev = data && data.instanceId ? data : null;
      if (prev && prev.key === key) {
        const v = await call(fetchFn, 'validate', { license_key: key, instance_id: prev.instanceId });
        if (v.network) return { ok: false, reason: 'network', message: '인터넷에 연결할 수 없어요. 잠시 뒤 다시 해 주세요.' };
        const vb = v.body || {};
        if (vb.valid === true && belongsToMe(vb.meta) && !(vb.license_key && BAD_STATUS.has(vb.license_key.status))) {
          data.checkedAt = now(); save();
          return { ok: true, already: true };
        }
      }
      const r = await call(fetchFn, 'activate', { license_key: key, instance_name: instanceName() });
      if (r.network) return { ok: false, reason: 'network', message: '인터넷에 연결할 수 없어요. 잠시 뒤 다시 해 주세요.' };
      const b = r.body;
      if (!b.activated) return { ok: false, reason: 'rejected', message: b.error || '키를 활성화하지 못했어요.' };
      if (!belongsToMe(b.meta) || (b.license_key && BAD_STATUS.has(b.license_key.status))) {
        // 이미 묶인 instance는 되돌려 놓는다
        if (b.instance) await call(fetchFn, 'deactivate', { license_key: key, instance_id: b.instance.id });
        return { ok: false, reason: 'wrong-product', message: 'Token Slayer 프리미엄 키가 아니에요.' };
      }
      data = { key, instanceId: b.instance.id, activatedAt: now(), checkedAt: now() };
      save();
      // 이전에 묶여 있던 자리는 새 활성화가 성공한 뒤에 반납한다 (실패해도 기존 키는 그대로 유지, 반납은 실패해도 무시)
      if (prev && prev.instanceId !== b.instance.id) await call(fetchFn, 'deactivate', { license_key: prev.key, instance_id: prev.instanceId });
      return { ok: true };
    },

    // 필요할 때만 서버에 확인. 잠기면 true를 돌려준다(메뉴 갱신용)
    async revalidate({ force = false } = {}) {
      if (!data) return { changed: false };
      if (!force && now() - (data.checkedAt || 0) < REVALIDATE_MS) return { changed: false };
      const r = await call(fetchFn, 'validate', { license_key: data.key, instance_id: data.instanceId });
      if (r.network) return { changed: false, offline: true }; // 오프라인: GRACE_MS 안에서는 그대로
      const b = r.body;
      const stillOk = b.valid === true && belongsToMe(b.meta) && !(b.license_key && BAD_STATUS.has(b.license_key.status));
      if (stillOk) { data.checkedAt = now(); save(); return { changed: false }; }
      data = null; save();
      return { changed: true };
    },

    async deactivate() {
      if (!data) return { ok: true };
      const r = await call(fetchFn, 'deactivate', { license_key: data.key, instance_id: data.instanceId });
      if (r.network) return { ok: false, message: '인터넷에 연결할 수 없어요.' }; // 자리를 반납하려면 온라인이어야 함
      data = null; save();
      return { ok: true };
    },
  };
}

module.exports = { create, belongsToMe, instanceName, REVALIDATE_MS, GRACE_MS };
