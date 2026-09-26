// Worker 的基本測試：用假的 Google 回應，不會真的打 API、不會花錢。
// 執行：npm test
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { categorize } from '../src/categories.js';

const realFetch = globalThis.fetch;
const env = { GOOGLE_MAPS_KEY: 'test-key', ASSETS: { fetch: async () => new Response('asset') } };

const openShop = {
  id: 'A',
  displayName: { text: '巷口麵' },
  primaryType: 'restaurant',
  types: ['restaurant', 'food'],
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
    if (String(url).includes('places:autocomplete')) {
      const p = (i) => ({ placePrediction: { placeId: 'ChIJplace' + i, text: { text: '台北車站' + i }, structuredFormat: { mainText: { text: '台北車站' + i }, secondaryText: { text: '台北市中正區' } } } });
      return new Response(JSON.stringify({ suggestions: [p(1), { queryPrediction: { text: { text: '台北車站美食' } } }, p(2), p(3), p(4), p(5), p(6)] }));
    }
    if (/\/v1\/places\/[A-Za-z0-9_-]+\?/.test(String(url))) {
      return new Response(JSON.stringify({ location: { latitude: 25.0478, longitude: 121.517 } }));
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
  assert.deepEqual(data.shops[0].cats, ['noodle'], '店名有「麵」要分到麵類');
});

test('欄位清單不能出現會跳到 Atmosphere 計費的欄位', async () => {
  await worker.fetch(nearby({ lat: 25.033, lng: 121.5654, radius: 1000 }), env);
  const mask = calls[0].init.headers['X-Goog-FieldMask'];
  for (const field of ['reviews', 'delivery', 'dineIn', 'editorialSummary', 'takeout', 'servesBreakfast', 'outdoorSeating']) {
    assert.ok(!mask.includes(field), `不應該有 ${field}`);
  }
  assert.ok(mask.includes('places.primaryType'), '分類需要 primaryType');
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

test('類別：看 Google 類型', () => {
  assert.deepEqual(categorize({ primaryType: 'ramen_restaurant', displayName: { text: '一蘭' } }), ['noodle', 'foreign']);
  assert.deepEqual(categorize({ primaryType: 'cafe', types: ['cafe', 'food'], displayName: { text: 'Simple Kaffa' } }), ['cafe']);
  assert.deepEqual(categorize({ primaryType: 'breakfast_restaurant', displayName: { text: '晨間廚房' } }), ['brunch']);
});

test('類別：只有 meal_takeaway 是主要類型才算便當', () => {
  assert.deepEqual(categorize({ primaryType: 'meal_takeaway', displayName: { text: '好味道' } }), ['bento']);
  assert.deepEqual(categorize({ primaryType: 'restaurant', types: ['restaurant', 'meal_takeaway'], displayName: { text: '好味道' } }), []);
});

test('類別：看店名關鍵字', () => {
  assert.deepEqual(categorize({ primaryType: 'restaurant', displayName: { text: '阿嬤便當' } }), ['bento']);
  assert.deepEqual(categorize({ primaryType: 'restaurant', displayName: { text: '福記滷肉飯' } }), ['rice']);
  assert.deepEqual(categorize({ primaryType: 'restaurant', displayName: { text: '夜市臭豆腐' } }), ['snack']);
  assert.deepEqual(categorize({ primaryType: 'restaurant', displayName: { text: '晨光早午餐' } }), ['brunch']);
});

test('類別：麵包店不算麵', () => {
  assert.deepEqual(categorize({ primaryType: 'bakery', displayName: { text: '吳寶春麵包店' } }), ['cafe']);
});

test('類別：沒有線索就不分類', () => {
  assert.deepEqual(categorize({ primaryType: 'restaurant', displayName: { text: '好好吃' } }), []);
  assert.deepEqual(categorize({}), []);
});

function post(path, body, headers = {}) {
  return new Request('https://app.example' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...headers },
    body: JSON.stringify(body)
  });
}
const TOKEN = '3f1c2a9e-7b4d-4e2a-9c1f-0a1b2c3d4e5f';

test('地點建議：金鑰放 header，帶 sessionToken 和位置偏好，最多 5 筆', async () => {
  const res = await worker.fetch(post('/api/autocomplete', { input: '台北車', sessionToken: TOKEN, lat: 25.03, lng: 121.56 }), env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.suggestions.length, 5);
  assert.deepEqual(data.suggestions[0], { id: 'ChIJplace1', main: '台北車站1', secondary: '台北市中正區' });
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].init.headers['X-Goog-Api-Key'], 'test-key');
  assert.ok(!calls[0].url.includes('test-key'));
  assert.equal(sent.input, '台北車');
  assert.equal(sent.sessionToken, TOKEN);
  assert.equal(sent.locationBias.circle.center.latitude, 25.03);
});

test('地點建議：字太少或太多不打 Google', async () => {
  for (const input of ['台', 'x'.repeat(61), '  ', 123]) {
    const res = await worker.fetch(post('/api/autocomplete', { input, sessionToken: TOKEN }), env);
    assert.equal(res.status, 400);
  }
  assert.equal(calls.length, 0);
});

test('地點建議：sessionToken 格式不對回 400', async () => {
  const res = await worker.fetch(post('/api/autocomplete', { input: '台北車站', sessionToken: 'bad token!' }), env);
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('地點建議：只接受 POST，也擋其他網站', async () => {
  assert.equal((await worker.fetch(new Request('https://app.example/api/autocomplete'), env)).status, 405);
  const res = await worker.fetch(post('/api/autocomplete', { input: '台北車站', sessionToken: TOKEN }, { 'Sec-Fetch-Site': 'cross-site' }), env);
  assert.equal(res.status, 403);
});

test('地點建議：Google 出錯回 502', async () => {
  globalThis.fetch = async () => new Response('quota', { status: 429 });
  const res = await worker.fetch(post('/api/autocomplete', { input: '台北車站', sessionToken: TOKEN }), env);
  assert.equal(res.status, 502);
});

test('查座標：只拿 location 欄位（Essentials），帶 sessionToken', async () => {
  const res = await worker.fetch(post('/api/place', { id: 'ChIJplace1', sessionToken: TOKEN }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { lat: 25.0478, lng: 121.517 });
  assert.equal(calls[0].init.headers['X-Goog-FieldMask'], 'location', '多拿 displayName 之類的欄位會變成 Pro 計費');
  assert.ok(calls[0].url.startsWith('https://places.googleapis.com/v1/places/ChIJplace1?'));
  assert.ok(calls[0].url.includes('sessionToken=' + TOKEN));
});

test('查座標：地點 id 格式不對回 400，不打 Google', async () => {
  for (const id of ['../../evil', 'a/b', '', 'short']) {
    const res = await worker.fetch(post('/api/place', { id, sessionToken: TOKEN }), env);
    assert.equal(res.status, 400);
  }
  assert.equal(calls.length, 0);
});

test('地點建議和查座標：沒設金鑰回 500', async () => {
  assert.equal((await worker.fetch(post('/api/autocomplete', { input: '台北車站', sessionToken: TOKEN }), {})).status, 500);
  assert.equal((await worker.fetch(post('/api/place', { id: 'ChIJplace1', sessionToken: TOKEN }), {})).status, 500);
});
