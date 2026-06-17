# v0.4.4 首屏精簡版

本版縮小頂部標題、上下間距、解析卡片與輸入框高度，讓使用者一進網站即可更容易看到貼上輸入框與操作按鈕。

---

# xhs-html-downloader v0.4.3 (AI 密碼保護版)

新增功能：
- AI 分析 API 可透過 `AI_ACCESS_CODE` 啟用密碼保護。
- 公開訪客仍可正常解析與下載影片／圖片。
- 只有知道密碼的人，才能觸發 AI 逐字稿、AI 文案分析與優化口播稿，避免消耗您的 Groq / OpenAI Token。

## 新增環境變數

```env
AI_ACCESS_CODE=您自己設定的一組密碼
```

若未設定 `AI_ACCESS_CODE`，AI 功能仍維持公開。設定完成後，前端會要求輸入密碼並儲存在目前瀏覽器的 localStorage。

---

# 小紅書公開媒體解析器 v0.4.2（HTML + Vercel + Groq）

功能：

- 貼上小紅書公開分享文字或短連結
- 解析影片、圖片、標題、作者與貼文文案
- 下載媒體或複製 CDN 直連
- 使用 Groq Whisper 產生影片逐字稿
- 使用 Groq Llama 產生摘要、內容分析與優化口播稿
- 顯示最近解析紀錄與縮圖

## v0.4.2 修正

- 新增 `GET /api/thumbnail` 安全縮圖代理，只接受 `xhscdn.com` 圖片。
- 代理請求帶入小紅書 Referer，修正部分 CDN 防盜連造成的最近解析縮圖空白。
- 縮圖載入順序為：同站代理 → 原始網址 → 類型圖示。
- 新紀錄會保存第一個媒體網址；影片沒有封面時會嘗試顯示第一幀。
- 舊的瀏覽器歷史紀錄不用清除，既有封面網址也會自動改走縮圖代理。

## Vercel API

- `POST /api/parse`
- `POST /api/analyze`
- `GET /api/thumbnail?url=...`
- `GET /api/health`

## Vercel 環境變數

必要：

```text
GROQ_API_KEY=你的新金鑰
```

建議：

```text
GROQ_TEXT_MODEL=llama-3.3-70b-versatile
GROQ_TRANSCRIBE_MODEL=whisper-large-v3-turbo
AI_TRANSCRIBE_VIDEO=true
TRANSCRIBE_LANGUAGE=zh
REQUEST_TIMEOUT_MS=20000
MAX_HTML_BYTES=4194304
```

縮圖可選設定：

```text
THUMBNAIL_TIMEOUT_MS=15000
MAX_THUMBNAIL_BYTES=3670016
```

API Key 只放在 Vercel Environment Variables，不要寫入 GitHub 或前端程式。

## 本機執行

```bash
npm install
npm test
npm start
```

開啟：

```text
http://127.0.0.1:8787
```

## 部署檢查

部署完成後開啟：

```text
https://xhs-html-downloader.vercel.app/api/health
```

應顯示：

```json
{
  "ok": true,
  "version": "0.4.2",
  "aiConfigured": true,
  "aiProvider": "groq"
}
```

## 使用限制

僅處理公開可存取內容，不會繞過登入、人機驗證或私人存取限制。使用者應自行確認下載及再利用權利。
