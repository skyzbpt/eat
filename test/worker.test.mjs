// Worker 的基本測試：用假的 Google 回應，不會真的打 API、不會花錢。
// 執行：npm test
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const realFetch = globalThis.fetch;
const env = { GOOGLE_MAPS_KEY: 'test-key', ASSETS: { fetch: async () => new Response('asset') } };

const openShop = {
  id: 'A',
  displayName: { text: '巷口麵' },
  primaryTypeDisplayName: { text: '麵店' },
  location: { latitude: 25.0335, longitude: 121.5645 },
  businessStatus: 'OPERATIONAL',
  rating: 4.4,
  userRatingCount: 120,
  priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
  currentOpeningHours: { openNow: true, nextCloseTime: '2026-09-25T13:00:00Z' },
  photos: [{ name: 'places/A/photos/P1', authorAttributions: [{ displayName: '小明', uri: 'https://maps.google.com/x' }] }]
};
const closedShop = { id: 'B', displayName: { text: '關門店' }, location: { latitude: 25.034, longitude: 121.565 }, currentOpeningHours: { openNow: false } };
const pausedShop = { id: 'C', displayName: { text: '歇業店' }, location: { latitude: 25.034, longitude: 121.565 }, businessStatus: 'CLOSED_TEMPORARILY', currentOpeningHours: { openNow: true } };

let calls;
beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('searchNearby')) {
      const body = JSON.parse(init.body);
      if (body.rankPreference === 'POPULARITY') {
        return new Response(JSON.stringify({ places: [openShop, closedShop, pausedShop] }));
      }
      if (body.includedTypes.includes('meal_takeaway')) return new Response('bad', { status: 400 });
      return new Response(JSON.stringify({ places: [openShop] }));
    }
    if (String(url).includes('/media')) {
      return new Response(JSON.stringify({ photoUri: 'https://lh3.googleusercontent.com/abc' }));
    }
    throw new Error('unexpected fetch ' + url);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

function nearby(body, headers = {}) {
  return new Request('https://app.example/api/nearby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...headers },
    body: JSON.stringify(body)
  });
}

test('只回傳營業中的店，並合併重複', async () => {
  const res = await worker.fetch(nearby({ lat: 25.033, lng: 121.5654, radius: 1000 }), env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.shops.map((s) => s.id), ['A']);
  assert.equal(data.shops[0].closeAt, '2026-09-25T13:00:00Z');
  assert.equal(data.shops[0].photo.author, '小明');
  assert.equal(data.partial, true, '有一組查詢失敗時要標記 partial');
});

test('金鑰放在 header，不會出現在網址', async () => {
  await worker.fetch(nearby({ lat: 25.033, lng: 121.5654, radius: 1000 }), env);
  const first = calls[0];
  assert.equal(first.init.headers['X-Goog-Api-Key'], 'test-key');
  assert.ok(!first.url.includes('test-key'));
});

test('半徑會被限制在 100 到 3000 公尺', async () => {
  await worker.fetch(nearby({ lat: 25.033, lng: 121.5654, radius: 99999 }), env);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.locationRestriction.circle.radius, 3000);
});

test('擋掉其他網站的請求', async () => {
  const res = await worker.fetch(nearby({ lat: 25, lng: 121, radius: 1000 }, { 'Sec-Fetch-Site': 'cross-site' }), env);
  assert.equal(res.status, 403);
});

test('位置不正確回 400，不打 Google', async () => {
  const res = await worker.fetch(nearby({ lat: 'abc', lng: 121, radius: 1000 }), env);
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('沒設金鑰回 500', async () => {
  const res = await worker.fetch(nearby({ lat: 25, lng: 121, radius: 1000 }), {});
  assert.equal(res.status, 500);
});

test('nearby 只接受 POST', async () => {
  const res = await worker.fetch(new Request('https://app.example/api/nearby'), env);
  assert.equal(res.status, 405);
});

test('照片轉址到 Google 給的網址', async () => {
  const res = await worker.fetch(new Request('https://app.example/api/photo?name=places/A/photos/P1', { headers: { 'Sec-Fetch-Site': 'same-origin' } }), env);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), 'https://lh3.googleusercontent.com/abc');
});

test('照片名稱格式不對回 400', async () => {
  const res = await worker.fetch(new Request('https://app.example/api/photo?name=../../evil', { headers: { 'Sec-Fetch-Site': 'same-origin' } }), env);
  assert.equal(res.status, 400);
});

test('其他路徑交給靜態檔', async () => {
  const res = await worker.fetch(new Request('https://app.example/'), env);
  assert.equal(await res.text(), 'asset');
});
