# 抽食籤

打開就定位，從附近「現在有開」的店裡幫你抽一家。

```
chou-shi-qian/
├── CLAUDE.md          給 Claude Code 看的專案說明
├── package.json       指令：npm run dev / deploy / test
├── wrangler.toml      Cloudflare 設定
├── src/worker.js      後端：幫你向 Google 查店家，金鑰藏在這裡
├── src/categories.js  幫店家分類別（飯、麵、小吃…）
├── public/index.html  前端：你在手機上看到的畫面
├── public/icons/      加入主畫面用的籤筒圖示
└── test/              後端測試（用假資料，不花錢）
```

## 一、準備 Google 金鑰（約 10 分鐘）

1. 到 Google Cloud Console 建一個新專案，綁定帳單帳戶。Places API 一定要綁卡才能用，但每月有免費額度。
2. 在「API 和服務」裡啟用 **Places API (New)**。注意是 New 版本，不是舊的 Places API。
3. 到「憑證」建立 API 金鑰。
4. 編輯這把金鑰：「API 限制」只勾 Places API (New)。「應用程式限制」維持「無」，因為金鑰只放在 Cloudflare，不會出現在瀏覽器。
5. **一定要設用量上限**：到「Google Maps Platform → 配額」，選 Places API (New)，找到 SearchNearby 那一項。
   - 有「每天」的上限：調成每天 60 次左右。
   - 只有「每分鐘」的上限：調成每分鐘 10 次。每抽一次會同時查 3 次，不要低於 3。
   這樣就算網址外流，用量也不會暴衝。照片那一項（GetPhotoMedia）也可以照同樣方式調低。
6. 到「帳單 → 預算與快訊」設一個小額預算提醒，例如 5 美元。注意預算只會寄信提醒，**不會自動停用**。
   如果配額只能設每分鐘，建議再用下面「資料與隱私」提到的 Cloudflare Access 把網站鎖成只有你能開。

## 二、部署到 Cloudflare（約 5 分鐘）

電腦需要先裝 Node.js。在這個資料夾打開終端機：

```bash
npm install
npx wrangler login
npx wrangler secret put GOOGLE_MAPS_KEY
npm run deploy
```

第三行會要你貼上金鑰，貼上按 Enter 就好，金鑰會加密存在 Cloudflare。
部署完會給你一個 `https://chou-shi-qian.你的帳號.workers.dev` 網址，用手機打開、允許定位就能用。
iPhone 在 Safari 按「分享 → 加入主畫面」，用起來就像 App。

## 三、Google 標誌（上線前補上）

沒有搭配 Google 地圖顯示店家資料時，Google 規定畫面上要放 **Google Maps 標誌**，版面不夠時才可以用「Google Maps」文字代替。
到 Google 的「Places API 政策與出處」（Policies and attributions for Places API）說明頁，下載淺色背景用的官方 Google Maps 標誌，存成 `public/google-logo.png` 再重新部署。
不要自己重畫或改顏色。沒放之前，畫面會先用「Google Maps」文字代替。

## 在自己電腦上測試

把 `.dev.vars.example` 複製成 `.dev.vars`，填入金鑰，然後：

```bash
npm run dev
```

打開 `http://localhost:8787`。本機網址瀏覽器也允許定位。

## 費用怎麼算

- 每次抓附近店家會查 3 次，屬於 Nearby Search Enterprise，每月前 1,000 次免費。
- 抽中的店有照片時會載入 1 張，屬於 Place Details Photos，每月前 1,000 次免費。
- App 開著時，同一個地點 15 分鐘內重抽不會再查；走超過 150 公尺或換範圍才會重新查。
- 一天打開 5 次大約是每月 450 次查詢，在免費額度內。想更省，可以把 `src/worker.js` 裡 `QUERIES` 刪到只剩前兩組。

## 資料與隱私

- 位置只在查詢時送到你自己的 Worker，再轉給 Google，不會被存下來。
- 手機只存你的設定、黑名單、「吃過的店」和「可以用 LINE Pay」的記號，而且只存 Google 的店家編號（place_id），這是 Google 條款允許長期保存的唯一欄位。
- LINE Pay 記號是你自己按的，只存在這支手機。LINE Pay 和 Google 都沒有公開「哪些店收 LINE Pay」的資料。
- 網址是公開的。只想給自己用的話，可以在 Cloudflare 的 Zero Trust 用 Access 鎖定只有你的 email 能開。
- 如果之後要公開給別人用，Google 要求網站提供使用條款和隱私權政策頁面。
