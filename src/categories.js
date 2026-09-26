// 抽食籤：店家類別分組（給 worker.js 用，只看 Google 已經回傳的資料，不會多打 API）

// 類別：先看 Google 給的店家類型，再看店名關鍵字（台灣很多店只被標成「餐廳」）。
// 一家店可以同時屬於好幾類，例如拉麵店是「麵」也是「異國」。
// 前端的類別按鈕用同樣的 key：rice 飯、noodle 麵、snack 小吃、bento 便當、
// foreign 異國、brunch 早午餐、cafe 咖啡甜點。
const CATEGORY_TYPES = {
  noodle: ['ramen_restaurant', 'noodle_shop', 'noodle_restaurant', 'chinese_noodle_restaurant', 'pho_restaurant'],
  rice: ['donburi_restaurant', 'rice_restaurant'],
  snack: ['snack_bar', 'food_court', 'street_food', 'food_stall', 'dumpling_restaurant', 'hot_dog_stand'],
  foreign: [
    'japanese_restaurant', 'sushi_restaurant', 'ramen_restaurant', 'korean_restaurant', 'korean_barbecue_restaurant',
    'thai_restaurant', 'vietnamese_restaurant', 'pho_restaurant', 'indian_restaurant', 'indonesian_restaurant',
    'italian_restaurant', 'pizza_restaurant', 'french_restaurant', 'american_restaurant', 'hamburger_restaurant',
    'mexican_restaurant', 'spanish_restaurant', 'greek_restaurant', 'turkish_restaurant', 'lebanese_restaurant',
    'mediterranean_restaurant', 'middle_eastern_restaurant', 'brazilian_restaurant', 'steak_house'
  ],
  brunch: ['breakfast_restaurant', 'brunch_restaurant', 'bagel_shop', 'sandwich_shop'],
  cafe: [
    'cafe', 'coffee_shop', 'bakery', 'dessert_shop', 'dessert_restaurant', 'ice_cream_shop', 'tea_house',
    'cake_shop', 'confectionery', 'donut_shop', 'juice_shop', 'cat_cafe', 'dog_cafe', 'chocolate_shop'
  ]
};

// meal_takeaway 很多餐廳都會順便帶，只有它是「主要類型」時才當便當店。
const PRIMARY_ONLY = { bento: ['meal_takeaway'] };

const CATEGORY_WORDS = {
  noodle: /麵(?!包)|麺(?!包)|米粉|粿仔|冬粉|河粉|烏龍|拉麵|麵線/,
  rice: /飯|丼|粥|燉飯|咖哩/,
  snack: /小吃|臭豆腐|鹽酥雞|雞排|蚵仔煎|肉圓|碗粿|鍋貼|水餃|餃子|滷味|蔥油餅|胡椒餅|黑白切|米糕|刈包|割包|肉羹|夜市/,
  bento: /便當|餐盒|自助餐/,
  foreign: /義大利|義式|披薩|pizza|日式|日本|壽司|居酒屋|燒肉|拉麵|韓式|韓國|泰式|泰國|越南|印度|南洋|美式|墨西哥|漢堡|法式|西班牙|牛排/i,
  brunch: /早餐|早午餐|蛋餅|美而美|豆漿|燒餅|飯糰|吐司|brunch/i,
  cafe: /咖啡|coffee|caf[eé]|甜點|甜品|蛋糕|豆花|冰|烘焙|麵包/i
};

export function categorize(place) {
  const primary = place.primaryType || '';
  const types = Array.isArray(place.types) ? place.types : [];
  const all = primary ? [primary, ...types] : types;
  const name = (place.displayName && place.displayName.text) || '';
  const cats = [];
  for (const key of ['rice', 'noodle', 'snack', 'bento', 'foreign', 'brunch', 'cafe']) {
    const byType = (CATEGORY_TYPES[key] || []).some((t) => all.includes(t));
    const byPrimary = (PRIMARY_ONLY[key] || []).includes(primary);
    const byName = CATEGORY_WORDS[key].test(name);
    if (byType || byPrimary || byName) cats.push(key);
  }
  return cats;
}
