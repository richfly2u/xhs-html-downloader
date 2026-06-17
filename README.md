# 小紅書公開媒體解析＋自動文案分析器 v0.4.0

## 新功能

- 解析完成後自動分析貼文標題與文案。
- 顯示核心摘要、吸睛開頭、目標觀眾、文案結構、優點、改善建議與關鍵字。
- 自動產生一份可複製的優化文案。
- 沒有 AI 金鑰也能使用內建文案分析。
- 設定 OpenAI API 金鑰後，可用 AI 深度分析；影片小於設定上限時，也會嘗試先做語音轉文字再分析。

## Vercel API

- `POST /api/parse`：解析公開小紅書分享連結。
- `POST /api/analyze`：分析標題、貼文文案及可選的影片語音。
- `GET /api/health`：健康檢查及 AI 設定狀態。

## Vercel 環境變數

基本解析：

```text
REQUEST_TIMEOUT_MS=20000
MAX_HTML_BYTES=4194304
```

啟用 AI 深度分析與影片語音轉文字：

```text
OPENAI_API_KEY=您的 API Key
OPENAI_TEXT_MODEL=gpt-5.5
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
AI_TRANSCRIBE_VIDEO=true
MAX_TRANSCRIBE_BYTES=25165824
AI_TIMEOUT_MS=55000
AI_MEDIA_TIMEOUT_MS=45000
```

`OPENAI_API_KEY` 只能放在 Vercel 環境變數，不要寫進前端、GitHub 或任何公開檔案。

若未設定 `OPENAI_API_KEY`，貼文有標題或文案時仍會使用內建規則自動分析。若只貼 MP4 直連，因為直連本身沒有貼文文字，需要 AI 語音轉錄才能分析內容。

## 部署更新

將本版檔案覆蓋到既有專案後：

```bash
git add .
git commit -m "Add automatic copy analysis"
git push
```

Vercel 會由 GitHub 自動重新部署。

## 本機執行

```bash
npm install
npm test
npm start
```

開啟 `http://127.0.0.1:8787`。

## 使用限制

僅解析不需登入且公開可存取的分享頁面。請尊重作者權利、平台規範及適用法律。
