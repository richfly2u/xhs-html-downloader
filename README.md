# 小紅書公開媒體解析＋Groq AI 影片文字分析 v0.4.1

## 修正內容

v0.4.0 只讀取 `OPENAI_API_KEY`，所以只設定 `GROQ_API_KEY` 時不會啟用 AI。v0.4.1 已正式支援 Groq：

- 影片語音轉逐字稿：`whisper-large-v3-turbo`
- 文案分析與優化稿：`llama-3.3-70b-versatile`
- 只要 Vercel 有設定 `GROQ_API_KEY`，就會自動啟用
- 影片直連會先嘗試交由 Groq 讀取；失敗時再以小檔案上傳備援
- AI 回傳異常時仍會退回內建文案分析，不會整頁空白

## Vercel 環境變數

必要：

```text
GROQ_API_KEY=您新建立的 Groq 金鑰
```

建議：

```text
GROQ_TEXT_MODEL=llama-3.3-70b-versatile
GROQ_TRANSCRIBE_MODEL=whisper-large-v3-turbo
AI_TRANSCRIBE_VIDEO=true
TRANSCRIBE_LANGUAGE=zh
AI_TIMEOUT_MS=55000
AI_MEDIA_TIMEOUT_MS=45000
MAX_TRANSCRIBE_BYTES=25165824
```

金鑰只放在 Vercel 的 Environment Variables，不能寫進 GitHub 或前端。

## 驗證

部署後開啟：

```text
https://xhs-html-downloader.vercel.app/api/health
```

正常應看到：

```json
{
  "ok": true,
  "version": "0.4.1",
  "aiConfigured": true,
  "aiProvider": "groq"
}
```

接著回首頁貼入小紅書分享連結。解析完成後會顯示：

- 影片語音逐字稿
- 核心摘要
- 文案優缺點
- AI 優化口播稿／發布文案

## 本機測試

```bash
npm install
npm test
npm start
```
