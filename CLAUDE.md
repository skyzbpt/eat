# 抽食籤：給 Claude Code 的專案說明

打開手機網頁就定位，從附近「現在有營業」的 Google 店家裡隨機抽一家吃。
使用者是 Sky，台灣的物理治療師，會一點網頁開發（單頁 HTML、Cloudflare Workers、LINE LIFF）。
請用繁體中文（台灣用語）溝通，說明要淺顯，不要堆術語。

## 架構

一個 Cloudflare Worker 專案，同時提供網頁和 API，部署一次就好。

- `public/index.html`：整個前端，單一檔案，原生 JS，沒有框架、沒有建置步驟。
- `src/worker.js`：後端。`POST /api/nearby` 查附近營業中的店，`GET /api/photo` 轉店家照片。其他路徑由 `[assets]` 回傳 `public/` 的靜態檔。
- `src/categories.js`：依 `primaryType`、`types` 和店名關鍵字幫店家分類別（key 要和前端 `CATEGORIES` 一致）。放在 Worker 端是為了能用 `npm test` 測，不會多打 API。
- `public/manifest.webmanifest`、`public/icons/`：PWA 設定和籤筒圖示。刻意不加 Service Worker（不能快取店家資料）。
- `test/worker.test.mjs`：用假的 Google 回應測 Worker，不會真的呼叫 API。
- `wrangler.toml`：Worker 設定。金鑰是 secret `GOOGLE_MAPS_KEY`，不寫在任何檔案裡。

## 常用指令

```bash
npm install          # 裝 wrangler（需要 Node.js 22 以上，見 .node-version）
npm test             # 跑測試（改 worker.js 之後一定要跑）
npm run dev          # 本機測試，需要 .dev.vars 裡有金鑰
npm run deploy       # 部署到 Cloudflare
npx wrangler secret put GOOGLE_MAPS_KEY   # 設定金鑰，讓 Sky 自己貼
```

## 工作規則

- **不要自己執行 `npm run deploy` 或 `wrangler secret put`**。先說明要做什麼，等 Sky 同意，或請 Sky 自己執行。
- **合併進 `main` 就等於部署**：Cloudflare Workers Builds 已連到這個 repo，`main` 一有新 commit 就自動部署到正式網站。合併前要 Sky 明確同意。
- 平常改動推到工作分支、開 PR 給 Sky 確認。PR 上的「Workers Builds」檢查是分支預覽打包，目前會失敗（原因要看 Cloudflare 後台的 build log，本機照同樣步驟打包是成功的），不影響正式部署。
- **不要讀取、印出或修改 `.dev.vars`**，也不要把金鑰寫進任何檔案或 commit。
- 改 `src/worker.js` 後要跑 `npm test`，新功能順手補測試。
- 改動前先用兩三句話說計畫，大改動分小步做。
- 前端維持單一 HTML 檔、不引入框架或建置工具，除非 Sky 明確要求。

## Google Places 的硬性限制（違反會出問題，改功能時要守住）

1. **金鑰只能在 Worker 裡**。前端永遠透過 `/api/*` 取資料。
2. **不能快取店家內容**。除了 place_id，Places 回傳的內容不能預先抓取、快取或存起來。Worker 不做快取；前端只在同一次開啟時重複使用剛拿到的清單（15 分鐘或移動超過 150 公尺就重抓）。localStorage 只存 place_id 和時間戳。
3. **要顯示 Google 標誌**。沒有搭配 Google 地圖顯示店家資料的畫面，都要有 Google 標誌（`public/google-logo.png`，缺圖時前端會先用文字代替）。
4. **照片要標出處**。顯示 `authorAttributions` 裡的作者名稱和連結。
5. **注意欄位計費等級**。`FIELD_MASK` 目前最高到 Nearby Search Enterprise。不要加 `reviews`、`delivery`、`dineIn`、`editorialSummary` 這類欄位，會跳到更貴的 Enterprise + Atmosphere。
6. **注意查詢次數**。每次抓店家 = `QUERIES` 的組數次計費（目前 3 次）。Enterprise 每月前 1,000 次免費。新增查詢前要先算成本告訴 Sky。

## 設計規範

整體是天空藍、簡約、柔和。新畫面照這套做，不要另起風格。

| 用途 | 色碼 |
|---|---|
| 主視覺天空藍（籤筒、選中的分段按鈕） | `#8ECDF5` |
| 淺藍底、照片底 | `#D6EDFB` |
| 頁面背景 | `#EEF7FD` |
| 淺框線 | `#BFE3FA` |
| 主要按鈕、連結 | `#135A8C` |
| 主要文字 | `#0F2A3F` |
| 次要文字 | `#4F6B80` |
| 快打烊提醒 | 底 `#FFF1DE`、字 `#8A4A06` |

- 標題、店名用 Google Fonts 的 **Huninn（粉圓體）**，內文用 **Noto Sans TC**。
- 可點的東西至少 44×44 px。不用 emoji 當圖示，一律用線條 SVG。
- 動畫要尊重 `prefers-reduced-motion`。
- 結果卡片做成「籤」的樣子：白卡、上方中間一個小圓孔。這是這個 App 的招牌細節，保留。

## 文案原則

- 口語、短、像朋友講話。例：「今天吃這家」、「不要這家」、「抽到第 4 次了，就吃這家吧」。
- 首頁數量那行會跟時段變：「晚餐時間，1 公里內有 23 家可以抽」。
- 錯誤訊息要說發生什麼、下一步怎麼做，不要只寫「錯誤」。

## 目前進度

已完成：部署上線（Cloudflare Workers Builds，合併進 main 自動部署）、定位、營業中篩選、快打烊提醒、單抽／抽三選一、評分與評論數門檻、7 天內吃過不抽（按導航才算吃過）、黑名單、重抽次數文案、照片與出處、Worker 測試、類別篩選、PWA（manifest 和圖示）、定位問題自動判斷（App 內建瀏覽器、非 https、沒給權限、定位沒開、逾時，依 iPhone／Android 給設定步驟）與「複製網址」「用瀏覽器打開（LINE）」按鈕、LINE Pay 自己做記號（籤卡外的開關＋「只抽可以用 LINE Pay 的店」篩選；LINE Pay 和 Google 都沒有公開的「哪些店收 LINE Pay」資料，所以只能自己記）。

還沒做（依優先順序）：

1. **補 Google 標誌圖**：要 Sky 從 Google 官方下載 Google Maps 標誌（開發環境連不到 Google 網域，也不能自己畫）。
2. **手動改位置**：定位不準或想查別處時用。注意 Geocoding 另外計費，做之前先算成本給 Sky。
3. 分支預覽打包失敗：請 Sky 提供 Cloudflare build log，或在 Cloudflare 關掉非正式分支的打包。
4. 之後再說：LINE LIFF 多人投票、LINE Pay 記號跨手機／和朋友共用（需要 D1 之類的資料庫，只存 place_id）、雨天自動縮小範圍、咖啡甜點類店家偏少（`QUERIES` 沒查 `cafe`，要加就多一次計費）。
