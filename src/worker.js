// 抽食籤 Worker
// 負責這些事：
//   POST /api/nearby        用使用者位置向 Google Places 查附近「現在有開」的店
//   GET  /api/photo         把店家照片轉給前端（金鑰不會出現在瀏覽器）
//   POST /api/autocomplete  手動改位置：打字時給地點建議
//   POST /api/place         手動改位置：選好建議後查座標
// 其他路徑交給 public/ 裡的靜態檔（index.html）。

import { categorize } from './categories.js';

const NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';

// 只拿需要的欄位。評分、評論數、價位、營業時間、電話屬於 Enterprise 等級，
// 不要加 reviews、delivery 這類欄位，否則會跳到更貴的 Enterprise + Atmosphere。
// primaryType、types 是 Pro 等級，比 Enterprise 低，加了不會變貴，用來分類別。
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.primaryType',
  'places.types',
  'places.primaryTypeDisplayName',
  'places.location',
  'places.businessStatus',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.currentOpeningHours',
  'places.nationalPhoneNumber',
  'places.googleMapsUri',
  'places.photos'
].join(',');

// Nearby Search 一次最多 20 家，而且預設偏熱門店。
// 分三次查再合併，巷口小店比較不會被擠掉。
// 每多一組就多一次計費，想省額度可以刪到只剩前兩組。
const QUERIES = [
  { includedTypes: ['restaurant'], rankPreference: 'POPULARITY' },
  { includedTypes: ['restaurant'], rankPreference: 'DISTANCE' },
  {
    includedTypes: ['meal_takeaway', 'fast_food_restaurant', 'breakfast_restaurant', 'brunch_restaurant'],
    rankPreference: 'DISTANCE'
  }
];

const MIN_RADIUS = 100;
const MAX_RADIUS = 3000;

// 手動改位置用 Autocomplete (New) + Place Details (New)，同一次搜尋共用 sessionToken。
// 同一個 session 前 12 次建議算 Autocomplete Requests，選定後查座標算 Place Details Essentials，
// 兩者每月各有 10,000 次免費。查座標只拿 location（Essentials），不要加 displayName（Pro）等欄位。
const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACE_FIELD_MASK = 'location';
const MAX_SUGGESTIONS = 5;
const SESSION_RE = /^[A-Za-z0-9_-]{8,36}$/;
const PLACE_ID_RE = /^[A-Za-z0-9_-]{8,256}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/nearby') {
      if (request.method !== 'POST') return json({ error: '請用 POST' }, 405);
      return guard(request, url) || handleNearby(request, env);
    }

    if (url.pathname === '/api/photo') {
      if (request.method !== 'GET') return json({ error: '請用 GET' }, 405);
      return guard(request, url) || handlePhoto(url, env);
    }

    if (url.pathname === '/api/autocomplete') {
      if (request.method !== 'POST') return json({ error: '請用 POST' }, 405);
      return guard(request, url) || handleAutocomplete(request, env);
    }

    if (url.pathname === '/api/place') {
      if (request.method !== 'POST') return json({ error: '請用 POST' }, 405);
      return guard(request, url) || handlePlace(request, env);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  }
};

// 只接受自己網頁送來的請求，擋掉別的網站直接拿你的額度。
// 這只能擋一般情況，想完全只給自己用，請另外加 Cloudflare Access。
function guard(request, url) {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return json({ error: 'forbidden' }, 403);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'forbidden' }, 403);
  return null;
}

async function handleNearby(request, env) {
  if (!env.GOOGLE_MAPS_KEY) {
    return json({ error: '還沒設定 GOOGLE_MAPS_KEY' }, 500);
  }

  const body = await request.json().catch(() => null);
  const lat = Number(body && body.lat);
  const lng = Number(body && body.lng);
  const radius = clamp(Number(body && body.radius) || 1000, MIN_RADIUS, MAX_RADIUS);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return json({ error: '位置資料不正確' }, 400);
  }

  const settled = await Promise.allSettled(
    QUERIES.map((q) => searchNearby(env.GOOGLE_MAPS_KEY, lat, lng, radius, q))
  );

  const lists = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (lists.length === 0) {
    const reason = settled[0] && settled[0].reason;
    console.error('Places 查詢全部失敗', reason);
    return json({ error: 'Google 店家資料暫時抓不到', detail: String((reason && reason.message) || '') }, 502);
  }

  const byId = new Map();
  for (const list of lists) {
    for (const place of list) {
      if (place && place.id && !byId.has(place.id)) byId.set(place.id, place);
    }
  }

  const shops = [];
  for (const place of byId.values()) {
    if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') continue;
    if (!place.currentOpeningHours || place.currentOpeningHours.openNow !== true) continue;
    shops.push(compact(place, lat, lng, radius));
  }
  shops.sort((a, b) => a.distance - b.distance);

  return json({ shops, radius, partial: lists.length < QUERIES.length });
}

async function searchNearby(key, lat, lng, radius, query) {
  const res = await fetch(NEARBY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': FIELD_MASK
    },
    body: JSON.stringify({
      includedTypes: query.includedTypes,
      rankPreference: query.rankPreference,
      maxResultCount: 20,
      languageCode: 'zh-TW',
      regionCode: 'TW',
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius }
      }
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Places ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return Array.isArray(data.places) ? data.places : [];
}

// 只回傳前端用得到的欄位，其餘丟掉。
function compact(place, lat, lng, radius) {
  const loc = place.location || {};
  const photo = Array.isArray(place.photos) && place.photos.length ? place.photos[0] : null;
  const author = photo && Array.isArray(photo.authorAttributions) && photo.authorAttributions.length
    ? photo.authorAttributions[0]
    : null;
  const dist = haversine(lat, lng, loc.latitude, loc.longitude);

  return {
    id: place.id,
    name: (place.displayName && place.displayName.text) || '沒有店名',
    type: (place.primaryTypeDisplayName && place.primaryTypeDisplayName.text) || '',
    cats: categorize(place),
    distance: Number.isFinite(dist) ? Math.round(dist) : radius,
    rating: typeof place.rating === 'number' ? place.rating : null,
    reviews: place.userRatingCount || 0,
    priceLevel: place.priceLevel || '',
    closeAt: (place.currentOpeningHours && place.currentOpeningHours.nextCloseTime) || null,
    phone: place.nationalPhoneNumber || '',
    mapsUri: place.googleMapsUri || '',
    photo: photo
      ? {
          name: photo.name,
          author: author ? author.displayName || '' : '',
          authorUri: author ? author.uri || '' : ''
        }
      : null
  };
}

async function handlePhoto(url, env) {
  if (!env.GOOGLE_MAPS_KEY) return new Response(null, { status: 500 });

  const name = url.searchParams.get('name') || '';
  if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(name)) {
    return json({ error: '照片參數不正確' }, 400);
  }

  const res = await fetch(
    `https://places.googleapis.com/v1/${name}/media?maxWidthPx=800&skipHttpRedirect=true`,
    { headers: { 'X-Goog-Api-Key': env.GOOGLE_MAPS_KEY } }
  );
  if (!res.ok) return new Response(null, { status: 404 });

  const data = await res.json().catch(() => null);
  if (!data || !data.photoUri) return new Response(null, { status: 404 });

  return new Response(null, {
    status: 302,
    headers: { Location: data.photoUri, 'Cache-Control': 'no-store' }
  });
}

async function handleAutocomplete(request, env) {
  if (!env.GOOGLE_MAPS_KEY) return json({ error: '還沒設定 GOOGLE_MAPS_KEY' }, 500);

  const body = await request.json().catch(() => null);
  const input = typeof (body && body.input) === 'string' ? body.input.trim() : '';
  const sessionToken = body && body.sessionToken;
  if (input.length < 2 || input.length > 60) return json({ error: '請輸入 2 到 60 個字' }, 400);
  if (typeof sessionToken !== 'string' || !SESSION_RE.test(sessionToken)) return json({ error: 'sessionToken 不正確' }, 400);

  const req = { input, sessionToken, languageCode: 'zh-TW', regionCode: 'tw' };
  // 有目前位置就優先建議附近的地點（只是偏好，不會限制在附近）
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    req.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 50000 } };
  }

  const res = await fetch(AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_MAPS_KEY },
    body: JSON.stringify(req)
  });
  if (!res.ok) {
    console.error('Autocomplete 失敗', res.status, (await res.text()).slice(0, 300));
    return json({ error: '地點建議暫時抓不到' }, 502);
  }
  const data = await res.json().catch(() => ({}));
  const suggestions = [];
  for (const item of Array.isArray(data.suggestions) ? data.suggestions : []) {
    const p = item && item.placePrediction;
    if (!p || !p.placeId) continue;
    const fmt = p.structuredFormat || {};
    suggestions.push({
      id: p.placeId,
      main: (fmt.mainText && fmt.mainText.text) || (p.text && p.text.text) || '',
      secondary: (fmt.secondaryText && fmt.secondaryText.text) || ''
    });
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }
  return json({ suggestions });
}

async function handlePlace(request, env) {
  if (!env.GOOGLE_MAPS_KEY) return json({ error: '還沒設定 GOOGLE_MAPS_KEY' }, 500);

  const body = await request.json().catch(() => null);
  const id = body && body.id;
  const sessionToken = body && body.sessionToken;
  if (typeof id !== 'string' || !PLACE_ID_RE.test(id)) return json({ error: '地點參數不正確' }, 400);
  if (typeof sessionToken !== 'string' || !SESSION_RE.test(sessionToken)) return json({ error: 'sessionToken 不正確' }, 400);

  const res = await fetch(
    `https://places.googleapis.com/v1/places/${id}?sessionToken=${encodeURIComponent(sessionToken)}&languageCode=zh-TW`,
    { headers: { 'X-Goog-Api-Key': env.GOOGLE_MAPS_KEY, 'X-Goog-FieldMask': PLACE_FIELD_MASK } }
  );
  if (!res.ok) {
    console.error('Place Details 失敗', res.status, (await res.text()).slice(0, 300));
    return json({ error: '這個地點的位置暫時抓不到' }, 502);
  }
  const data = await res.json().catch(() => ({}));
  const loc = data.location || {};
  if (!Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) {
    return json({ error: '這個地點沒有座標' }, 502);
  }
  return json({ lat: loc.latitude, lng: loc.longitude });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function haversine(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return NaN;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
