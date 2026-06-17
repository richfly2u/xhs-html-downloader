# 小紅書公開媒體解析器 — Vercel 版 v0.3

這個版本已整理成可直接匯入 Vercel 的單一專案根目錄。

## 本機啟動

```bash
copy .env.example .env
npm install
npm start
```

開啟 `http://127.0.0.1:8787`。

## 部署到 Vercel（GitHub）

1. 把本資料夾中的所有檔案推送到 GitHub 倉庫根目錄。
2. 在 Vercel 選擇 **Add New → Project**，匯入該 GitHub 倉庫。
3. Framework Preset 保持 **Other**；Root Directory 保持倉庫根目錄。
4. 不需要設定 Build Command 或 Output Directory。
5. 建議在 Environment Variables 加入：

```text
ENABLE_MEDIA_PROXY=false
REQUEST_TIMEOUT_MS=20000
MAX_HTML_BYTES=4194304
TRUST_PROXY=true
```

6. 按 Deploy。

部署完成後測試：

- `/health`
- 首頁貼入一條小紅書分享連結

## 為什麼 Vercel 要關閉媒體代理

Vercel Function 的請求或回應 payload 上限為 4.5 MB。影片常遠大於此限制，因此 Vercel 版只負責解析，影片預覽與下載會直接使用小紅書 CDN 網址，不讓影片流量經過 Vercel Function。

若需要伺服器強制以附件方式中轉大型影片，請把 `/api/media` 部署到沒有 4.5 MB 回應限制的服務，例如一般 VPS、Render、Railway 或 Cloudflare 方案，再由前端呼叫該服務。

## 目錄

```text
public/          HTML、CSS、瀏覽器 JavaScript
src/index.js     Vercel Express 入口（default export）
src/local.js     本機啟動入口
src/resolver.js  公開分享頁解析
src/utils.js     網址與安全檢查
vercel.json      Vercel 設定
```
