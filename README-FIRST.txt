小紅書 HTML 下載器｜完整專案 v0.4.5

包含功能：
- 純 HTML 前端
- 小紅書公開連結解析
- 影片 / 圖片下載
- 原始文案提取
- Groq AI 影片逐字稿
- AI 文案分析與口播稿優化
- AI_ACCESS_CODE 密碼保護
- 最近解析縮圖修正
- 最近解析保留 30 條
- 首屏精簡版介面
- Vercel 部署支援
- 本機 Node.js 啟動支援

建議專案位置：
E:\temp\xhs-html-downloader-complete-v0.4.5

本機啟動：
1. 安裝 Node.js 20 以上
2. 開啟 CMD
3. cd /d "E:\temp\xhs-html-downloader-complete-v0.4.5"
4. npm install
5. npm start
6. 開啟 http://127.0.0.1:8787

Vercel 必要環境變數：
GROQ_API_KEY=您的新 Groq API Key
AI_ACCESS_CODE=您自訂的 AI 功能密碼

可選環境變數：
GROQ_TEXT_MODEL=llama-3.3-70b-versatile
GROQ_TRANSCRIBE_MODEL=whisper-large-v3-turbo
AI_TRANSCRIBE_VIDEO=true
REQUEST_TIMEOUT_MS=20000
MAX_HTML_BYTES=4194304

注意：
- 不要把 API Key 寫進前端或 GitHub。
- 先在 Vercel 設定環境變數，再重新部署。
- AI 密碼只保護 AI 分析功能，一般解析下載功能仍可公開使用。
