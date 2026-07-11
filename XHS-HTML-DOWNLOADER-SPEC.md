# xhs-html-downloader — 完整協作規格書

> 版本：0.4.6（VPS）/ 0.4.5（本地）  
> 專案路徑：`D:\project\xhs-html-downloader`（本地開發）  
> VPS：`108.61.163.87`（日本東京，root SSH）  
> 部署平台：VPS（主力 `link2publish.app`）+ Vercel（備援）  
> 技術棧：Node.js 20+、Express、Cheerio、yt-dlp、Python、Vanilla HTML/CSS/JS  
> 授權：MIT

---

## 目錄

1. [專案概述](#1-專案概述)
2. [架構總覽](#2-架構總覽)
3. [目錄結構](#3-目錄結構)
4. [目前支援平台](#4-目前支援平台)
5. [後端 API 規格](#5-後端-api-規格)
6. [前端 UI 規格](#6-前端-ui-規格)
7. [AI 分析系統](#7-ai-分析系統)
8. [輸出格式規範](#8-輸出格式規範)
9. [環境變數](#9-環境變數)
10. [開發與部署](#10-開發與部署)
11. [擴充新平台指引](#11-擴充新平台指引)
12. [程式碼規範](#12-程式碼規範)
13. [已知問題與注意事項](#13-已知問題與注意事項)

---

## 1. 專案概述

一個 Vercel-ready 的 HTML 網頁工具，讓使用者貼上**小紅書（Xiaohongshu / RED）** 的公開分享連結，即可：

- **解析**影片 / 圖片 / 標題 / 作者 / 文案
- **預覽與下載**媒體（支援影片播放 + 圖片網格）
- **AI 分析** — 影片逐字稿（Groq Whisper）+ 文案優化（Groq Llama / OpenAI）
- **最近解析紀錄**（localStorage，上限 30 條）

### 核心設計理念

- **僅處理公開內容** — 不繞過登入、人機驗證或私人存取限制
- **後端負責解析** — 前端只負責展示與下載
- **無框架** — 前後端都是純原生 JS/CSS，無 React/Vue 等依賴
- **可橫向擴充平台** — 現有架構已預留平台判別路由

---

## 2. 架構總覽

```
┌─────────────────┐      POST /api/parse       ┌──────────────────────┐
│  瀏覽器前端       │ ────────────────────────→ │  Express 後端         │
│  (index.html)    │                            │  (index.js)          │
│  (app.js)        │ ←──────────────────────── │                      │
│  (styles.css)    │       JSON response        │  ├─ resolver.js      │
└─────────────────┘                            │  ├─ analyzer.js      │
       │                                       │  ├─ thumbnail.js     │
       │ 靜態檔案                               │  ├─ utils.js         │
       └─────────────────────────────────────→ │  └─ platforms/      │
                                               │     ├─ index.js      │
                                               │     ├─ xiaohongshu.js│
                                               │     ├─ youtube.js    │
                                               │     ├─ douyin.js     │
                                               │     ├─ tiktok.js     │
                                               │     └─ facebook.js   │
                                               │                      │
                                               │  CDN 網域:            │
                                               │  ├─ xhscdn.com (小紅書)│
                                               │  ├─ googlevideo.com   │
                                               │  │   (YouTube)        │
                                               │  ├─ tikcdn.net (TikTok)│
                                               │  └─ bytecdn.com (抖音) │
                                               └──────────────────────┘
```

### 請求流程

```
使用者貼上連結
       │
       ▼
前端 isYouTubeLink() 判斷平台
       │
       ├── YouTube ──→ POST /api/youtube（預留，尚未實作）
       │
       └── 其他 ────→ POST /api/parse
                        │
                        ▼
                    resolver.resolvePublicShare(input)
                        │
                        ├── 是媒體直連（xhscdn.com）→ 直接回傳
                        │
                        └── 是分享連結
                              ├── 展開短網址（xhslink.com）
                              ├── 抓取公開頁面 HTML
                              ├── parsePublicPageHtml()
                              │     ├── window.__INITIAL_STATE__ 解析
                              │     ├── OG meta 標籤
                              │     ├── <script> 內容掃描
                              │     └── pickMediaUrls() 排序媒體
                              └── 回傳結構化結果
```

### VPS 基礎設施（已在東京機房運行）

```
link2publish.app ──┐
www.link2publish.app┤
                   ├── Caddy（80/443, TLS internal）
                   │       │
                   │       ├── localhost:8787 → xhs-downloader（Node.js）
                   │       │                     ├── POST /api/parse       → xiaohongshu.js
                   │       │                     ├── POST /api/youtube     → youtube.js
                   │       │                     ├── POST /api/analyze     → analyzer.js
                   │       │                     ├── GET  /api/thumbnail   → thumbnail.js
                   │       │                     ├── GET  /api/media       → 媒體代理
                   │       │                     └── GET  /api/health      → health check
                   │       │
                   │       └── localhost:8799 → yt-dlp-server（Python）
                   │                             └── POST /api/yt-dlp      → yt_local_server tunnel:18800
                   │
ytapi.link2publish.app ──┘
```

| 資源 | 規格 |
|------|------|
| IP | `108.61.163.87` |
| 地點 | 日本東京 |
| OS | Ubuntu 26.04 LTS |
| CPU | 1 vCPU |
| RAM | 1024 MB（可用約 600 MB）|
| 磁碟 | 25 GB（已用 20 GB，剩 2.3 GB ⚠️）|
| Node.js | v20.20.2 |
| yt-dlp | 2026.07.04（PATH + node_modules 雙份）|
| ffmpeg | 8.0.1 |
| 網域 | `link2publish.app`（Caddy reverse proxy）|

**Systemd 服務：**

| 服務名稱 | 說明 | Port |
|---------|------|------|
| `xhs-downloader.service` | Node.js 主應用（xhs-html-downloader） | 8787 |
| `yt-dlp-server.service` | Python 下載代理（yt_api_server.py） | 8799 |
| `yt-parser.service` | 備用服務 | — |

**Caddy 路由（`/etc/caddy/Caddyfile`）：**

| 網域 | 目標 | 用途 |
|------|------|------|
| `link2publish.app`、`www.link2publish.app` | `localhost:8787` | 主站 |
| `media.link2publish.app` | `localhost:8787` | 媒體代理 |
| `ytapi.link2publish.app` | `localhost:8799` | YouTube 下載 API |
| `line.link2publish.app` | Cloudflare Tunnel | LINE Bot |

---

## 3. 目錄結構

```
xhs-html-downloader/
├── src/
│   ├── index.js          # Express 伺服器入口（含 YouTube API 路由）
│   ├── local.js          # 本機開發啟動腳本（含 yt-dlp 自動下載）
│   ├── resolver.js       # 小紅書頁面解析核心（舊版，仍保留）
│   ├── analyzer.js       # AI 文案分析 + 語音轉文字
│   ├── thumbnail.js      # 縮圖代理（防盜連）
│   ├── utils.js          # 共用工具函式
│   └── platforms/        # 多平台解析器模組
│       ├── index.js          # 平台偵測 + 路由（detectPlatform / resolveForPlatform）
│       ├── xiaohongshu.js    # 小紅書（425 行，從舊 resolver.js 重構）
│       ├── youtube.js        # YouTube（533 行，yt-dlp + InnerTube + ytdl-core）
│       ├── douyin.js         # 抖音（519 行，已實作）
│       ├── tiktok.js         # TikTok（197 行，已實作）
│       └── facebook.js       # Facebook（146 行，已實作）
├── public/
│   ├── index.html        # 前端頁面
│   ├── app.js            # 前端邏輯（約 810 行）
│   ├── styles.css        # 前端樣式（約 650 行）
│   ├── favicon.svg       # 網站圖示
│   └── manifest.webmanifest  # PWA manifest
├── scripts/
│   └── postinstall.mjs   # npm postinstall — 自動下載 yt-dlp 二進位
├── docs/
│   └── superpowers/      # 其他文件
├── test/
│   ├── resolver.test.js  # 解析器單元測試
│   └── analyzer.test.js  # 分析器單元測試
├── .env.example          # 環境變數範本
├── package.json          # 依賴管理（含 youtubei.js / yt-dlp-exec 等）
├── nixpacks.toml          # Vercel Nixpacks 設定（pipx install yt-dlp）
├── vercel.json           # Vercel 部署設定
├── README.md             # 既有說明文件
├── README-FIRST.txt      # 快速入門
└── XHS-HTML-DOWNLOADER-SPEC.md  # 本協作規格書
```

---

## 4. 目前支援平台

### 4.1 ✅ 小紅書（Xiaohongshu / RED）— v0.4.6 完整支援（VPS 已部署）

| 項目 | 說明 |
|------|------|
| 分享網域 | `xhslink.com`、`www.xhslink.com` |
| 頁面網域 | `xiaohongshu.com`、`www.xiaohongshu.com`、`m.xiaohongshu.com` |
| 媒體 CDN | `xhscdn.com`、`*.xhscdn.com` |
| 可解析內容 | 影片（MP4）、圖片（JPEG/PNG/WebP/AVIF）、標題、作者、文案 |
| 解析方式 | `window.__INITIAL_STATE__` 結構資料 → OG meta → 頁面掃描 → 字串探勘 |
| 防盜連 | 請求帶 `Referer: https://www.xiaohongshu.com/` + DNS 驗證 |

### 4.2 ✅ YouTube — VPS 已完整實作

**狀態：VPS 版（v0.4.6）已完整部署，本地版（v0.4.5）尚未同步。**

| 項目 | 說明 |
|------|------|
| 後端 | `src/platforms/youtube.js`（533 行，4 層 fallback） |
| 前端 | `app.js` 已有完整格式選取 UI，已路由至 `POST /api/youtube` |
| VPS 端點 | `POST /api/yt-dlp`（Python 代理，port 8799，reverse proxy 至 `ytapi.link2publish.app`） |
| 解析方式 | yt-dlp（4 種 client strategy）→ InnerTube（youtubei.js）→ page scan → @distube/ytdl-core |
| yt-dlp 安裝 | `/usr/local/bin/yt-dlp`（pipx 安裝）+ `node_modules/.bin/yt-dlp`（postinstall 下載） |
| Cookie | `~/.secrets/youtube-cookies.txt`（可選，用於年齡限制影片） |
| 格式選取 | 前端 `yt-format-picker` 顯示各解析度 + 音訊選項，點選後走 `/api/yt-dlp` 代理下載 |

**VPS 端 Python dl-proxy（`yt_api_server.py`）：**
- 監聽 port `8799`
- 接受 `POST` 請求，轉發至本機 `http://localhost:18800/api/yt-dlp`（yt_local_server tunnel）
- 啟用 CORS，白名單來源 `https://go.link2publish.app`
- 由 systemd `yt-dlp-server.service` 管理

### 4.3 🕐 抖音（Douyin）— VPS 已有實作

**後端 `src/platforms/douyin.js` — 519 行，功能完整但前端尚未路由。**

| 項目 | 說明 |
|------|------|
| 支援網域 | `douyin.com`、`v.douyin.com`、`m.douyin.com`、`iesdouyin.com` |
| 解析方式 | Cheerio 解析頁面 + `window.__INITIAL_STATE__` + OG meta |
| 狀態 | 後端 `resolveShare()` 已實作，**前端 `parseCurrentInput()` 尚未加入 Douyin 路由** |

### 4.4 🕐 TikTok — VPS 已有實作

**後端 `src/platforms/tiktok.js` — 197 行，功能完整。**

| 項目 | 說明 |
|------|------|
| 支援網域 | `tiktok.com`、`vm.tiktok.com`、`m.tiktok.com` |
| 媒體 CDN | `tiktokcdn.com`、`bytecdn.com`、`tikcdn.net` |
| 解析方式 | Cheerio 解析 + OG meta |
| 狀態 | 後端 `resolveShare()` 已實作，**前端尚未路由** |

### 4.5 🕐 Facebook — VPS 已有實作

**後端 `src/platforms/facebook.js` — 146 行，功能完整。**

| 項目 | 說明 |
|------|------|
| 支援網域 | `facebook.com`、`fb.watch`、`fb.com` |
| 狀態 | 後端 `resolveShare()` 已實作，**前端尚未路由** |

### 4.6 前端路由未完成總表

| 平台 | 後端 | 前端 `parseCurrentInput()` 路由 | 前端 UI |
|------|------|-------------------------------|---------|
| 小紅書 | ✅ 完整 | ✅ `POST /api/parse` | ✅ 完整 |
| YouTube | ✅ 完整 | ✅ `POST /api/youtube` | ✅ 完整 + 格式選取 |
| 抖音 | ✅ 完整 | ❌ 未加入 | ❌ |
| TikTok | ✅ 完整 | ❌ 未加入 | ❌ |
| Facebook | ✅ 完整 | ❌ 未加入 | ❌ |


---

## 5. 後端 API 規格

### 5.1 `GET /api/health`

健康檢查。

**回應：**
```json
{
  "ok": true,
  "service": "xhs-html-downloader",
  "version": "0.4.5",
  "mediaProxyEnabled": false,
  "aiConfigured": true,
  "aiProvider": "groq",
  "aiAccessProtected": false
}
```

### 5.2 `POST /api/parse`

解析小紅書分享連結。

**Rate Limit：** 20 req / 60s

**Request Body：**
```json
{
  "url": "https://xhslink.com/o/xxxx",
  "text": "（或直接用文字貼上，會自動抓取 URL）"
}
```

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "sourceUrl": "https://www.xiaohongshu.com/explore/...",
    "noteId": "67a...",
    "title": "筆記標題",
    "description": "貼文文案",
    "author": "作者名稱",
    "cover": "https://ci.xhscdn.com/...",
    "type": "video",
    "videoUrl": "https://sns-video-hw.xhscdn.com/...",
    "alternatives": ["備選網址1", "備選網址2"],
    "images": [],
    "parser": "initial-state",
    "video": {
      "kind": "video",
      "directUrl": "https://sns-video-hw.xhscdn.com/...",
      "previewUrl": "代理後的預覽網址",
      "downloadUrl": "代理後的下載網址",
      "bytes": 12345678,
      "size": "11.77 MB",
      "contentType": "video/mp4"
    },
    "images": [
      {
        "kind": "image",
        "index": 1,
        "directUrl": "https://ci.xhscdn.com/...",
        "previewUrl": "代理網址",
        "downloadUrl": "代理網址"
      }
    ],
    "format": "MP4",
    "bytes": 12345678,
    "size": "11.77 MB",
    "contentType": "video/mp4",
    "parsedAt": "2026-07-06T..."
  }
}
```

**失敗回應（400/422）：**
```json
{
  "success": false,
  "error": "公開頁面中沒有找到可下載媒體；可能需要登入、遇到驗證、頁面已改版，或作品不可公開存取"
}
```

### 5.3 `GET /api/thumbnail`

安全縮圖代理。只接受 `xhscdn.com` 網域的圖片，請求帶小紅書 Referer。

**Query：** `?url=https://ci.xhscdn.com/...`

**回應：** 直接回傳圖片 binary + 正確 Content-Type + Cache-Control 1 day

**Rate Limit：** 60 req / 60s

### 5.4 `POST /api/analyze`

AI 文案分析。需要 `GROQ_API_KEY` 或 `OPENAI_API_KEY`。

可選 `x-ai-access-code` header 密碼保護。

**Rate Limit：** 20 req / 60s

**Request Body：**
```json
{
  "title": "筆記標題",
  "description": "貼文文案",
  "author": "作者",
  "sourceUrl": "原始連結",
  "videoUrl": "影片網址（選用，有則自動轉逐字稿）"
}
```

**成功回應（200）：**
```json
{
  "success": true,
  "data": {
    "summary": "核心摘要",
    "hook": "吸睛開頭",
    "audience": "目標觀眾",
    "structure": "文案結構分析",
    "strengths": ["優點1", "優點2"],
    "improvements": ["改善1", "改善2"],
    "keywords": ["關鍵字1", "關鍵字2"],
    "optimizedCopy": "優化後的完整口播稿／文案",
    "mode": "ai-video | ai-caption | local-caption",
    "model": "llama-3.3-70b-versatile",
    "provider": "groq",
    "transcript": "影片逐字稿（如有影片）",
    "transcriptionStatus": "已完成影片語音轉文字",
    "warning": null,
    "analyzedAt": "2026-07-06T..."
  }
}
```

### 5.5 `GET /api/media`

媒體代理（本機開發時預設啟用，Vercel 預設關閉）。

只代理 `xhscdn.com` 的影片/圖片，支援 Range 請求（影片拖曳）。

### 5.6 🔲 預留端點（待實作）

| 端點 | 用途 | 狀態 |
|------|------|------|
| `POST /api/youtube` | YouTube 連結解析 | 前端已路由，後端「未實作」 |
| `POST /api/dl-proxy` | YouTube 格式指定下載代理 | 前端已完整實作，後端「未實作」 |

---

## 6. 前端 UI 規格

### 6.1 設計語言

- **品牌色：** 紅色調 `#f64f63`（小紅書品牌延伸）
- **支援深色模式** — 透過 `data-theme` 屬性切換，並記憶在 localStorage
- **響應式設計** — 三種斷點：`>760px`（桌面）、`≤760px`（平板）、`≤470px`（手機）
- **無框架** — 純原生 HTML/CSS/JS，不依賴任何前端框架
- **字體堆疊：** `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif`

### 6.2 頁面結構（由上而下）

```
┌──────────────────────────────────────┐
│ Topbar (品牌標誌 + 深色模式切換)      │
├──────────────────────────────────────┤
│ Hero (標題 + 說明文案)                │
├──────────────────────────────────────┤
│ STEP 01: 貼上分享內容                  │
│ ┌──────────────────────────────────┐ │
│ │ Textarea (max 4096 chars)        │ │
│ │ 字數統計 + 清除按鈕               │ │
│ │ [貼上剪貼簿]  [開始解析]           │ │
│ └──────────────────────────────────┘ │
│ 錯誤提示（隱藏）                       │
├──────────────────────────────────────┤
│ STEP 02: 解析結果（隱藏）              │
│ ┌──────────┬───────────────────────┐ │
│ │ 媒體面板  │ 內容區                 │ │
│ │ (影片/圖片)│ 類型 + 解析器標籤      │ │
│ │           │ 標題 + 作者 + 文案     │ │
│ │           │ 格式/大小/項目         │ │
│ │           │ [下載] [複製直連]      │ │
│ │           │ [複製優化稿]           │ │
│ └──────────┴───────────────────────┘ │
├──────────────────────────────────────┤
│ STEP 03: AI 分析（隱藏）              │
│  ├─ AI 密碼保護區（可選）              │
│  ├─ 載入中狀態                        │
│  ├─ 錯誤狀態                          │
│  └─ 分析結果                          │
│     ├─ 核心摘要                       │
│     ├─ 吸睛開頭/目標觀眾/文案結構       │
│     ├─ 優點/改善（雙欄）              │
│     ├─ 關鍵字標籤                     │
│     ├─ 優化口播稿                     │
│     └─ 逐字稿（可展開）               │
├──────────────────────────────────────┤
│ RECENT: 最近解析（隱藏）               │
│ 歷史紀錄清單（最多 30 條）             │
├──────────────────────────────────────┤
│ How card (解析方式說明)               │
├──────────────────────────────────────┤
│ Footer                               │
└──────────────────────────────────────┘
```

### 6.3 關鍵互動行為

| 行為 | 實作 |
|------|------|
| **貼上自動解析** | 監聽 `paste` 事件，100ms 後自動觸發解析 |
| **Ctrl+Enter** | 快捷鍵觸發解析 |
| **貼上剪貼簿** | `navigator.clipboard.readText()`，失敗時提示手動貼上 |
| **解析載入** | 按鈕切換 `is-loading` 狀態，顯示 spinner |
| **錯誤顯示** | 紅色警示框 + 錯誤訊息 |
| **結果渲染** | 影片用 `<video>` 標籤，圖片用 2 欄網格 |
| **下載按鈕** | 同源用 `download` 屬性，跨源開新分頁 |
| **複製直連** | `navigator.clipboard.writeText()` |
| **歷史紀錄** | localStorage 儲存，點擊可重新解析 |
| **AI 分析** | 不會自動觸發（避免無意消耗 Token），需點「開始分析」 |
| **深色模式** | 按鈕切換，記憶在 localStorage |

### 6.4 前端平台路由邏輯

在 `app.js` 的 `parseCurrentInput()` 中：

```javascript
// 目前前端已實作的路由邏輯：
const isYT = isYouTubeLink(value);       // 檢測 YouTube 網址
const endpoint = isYT ? '/api/youtube' : '/api/parse';
```

這表示**要擴充新平台只需要**：
1. 寫一個 `isPlatformX(url)` 檢測函式
2. 在 `parseCurrentInput()` 中加入新的 endpoint 路由
3. 實作對應的後端 API

YouTube 的前端格式選取 UI（`yt-format-picker` / `yt-format-row` / `/api/dl-proxy`）已經完整實作，可直接複製模式。

### 6.5 CSS 類別命名慣例

- `is-hidden` — 控制元素顯示/隱藏
- `is-loading` — 載入狀態
- `is-done` / `is-ok` / `is-warn` — 狀態標示
- `button-primary` / `button-secondary` / `button-ghost` — 按鈕層級
- `section`, `card`, `shell` — 區塊容器

---

## 7. AI 分析系統

### 7.1 雙 Provider 架構

```
analyzeCopy(payload)
    │
    ├── getAIProvider()
    │     ├── GROQ_API_KEY 存在 → groq（優先）
    │     └── OPENAI_API_KEY 存在 → openai（備援）
    │
    ├── 有影片網址 → transcribeVideo(provider, videoUrl)
    │     ├── groq: 先試 URL 直傳，失敗則下載後上傳
    │     └── openai: 下載後上傳轉錄
    │
    └── analyzeWithAI(provider, {title, description, transcript})
          ├── groq → groqJsonAnalysis()   (llama-3.3-70b + JSON mode)
          └── openai → openAIJsonAnalysis() (gpt-5.5 + strict JSON schema)
```

### 7.2 降級機制

- 無 API Key → 使用 `localAnalysis()` 純規則分析（無需外部 API）
- 影片轉錄失敗 → 回退到只分析文案
- AI 分析失敗 → 回退到 `localAnalysis()`

### 7.3 分析模式

| mode | 說明 |
|------|------|
| `ai-video` | 有影片 + 有 AI Key：先轉逐字稿再用 AI 分析 |
| `ai-caption` | 無影片但有 AI Key：只用 AI 分析文案 |
| `local-caption` | 無 AI Key：純規則分析 |

### 7.4 分段設計

Groq API 回應時限：`AI_TIMEOUT_MS`（預設 55s）
影片大小上限：`MAX_TRANSCRIBE_BYTES`（預設 24MB）

---

## 8. 輸出格式規範

### 8.1 解析結果（data 欄位）統一格式

```typescript
interface ParseResult {
  sourceUrl: string | null;       // 最終頁面 URL
  noteId: string | null;          // 筆記 ID（小紅書專用）
  title: string | null;           // 標題
  description: string | null;     // 文案
  author: string | null;          // 作者
  cover: string | null;           // 封面圖 URL
  type: "video" | "images" | null; // 媒體類型
  videoUrl: string | null;        // 影片直連（舊欄位，相容）
  alternatives: string[];         // 備選影片網址
  images: string[];               // 圖片網址陣列（舊欄位）
  parser: "initial-state" | "page-media-scan" | "direct-media-url";
  video: MediaItem | null;        // 影片物件（新欄位）
  images: MediaItem[];            // 圖片物件陣列（新欄位）
  format: string | null;          // 格式文字
  bytes: number | null;           // 檔案大小
  size: string | null;            // 格式化大小
  contentType: string | null;     // MIME
  parsedAt: string;               // ISO 時間戳
}

interface MediaItem {
  kind: "video" | "image";
  index: number;                  // 僅圖片有
  directUrl: string;              // 原始 CDN 網址
  previewUrl: string;             // 預覽用網址（可能是代理）
  downloadUrl: string;            // 下載用網址（可能是代理）
  bytes: number | null;           // 僅影片有
  size: string | null;            // 僅影片有
  contentType: string | null;     // 僅影片有
}
```

### 8.2 AI 分析結果統一格式

```typescript
interface AnalysisResult {
  summary: string;                // 核心摘要
  hook: string;                   // 吸睛開頭
  audience: string;               // 目標觀眾
  structure: string;              // 文案結構
  strengths: string[];            // 優點列表
  improvements: string[];         // 改善列表
  keywords: string[];             // 關鍵字（不含 #）
  optimizedCopy: string;          // 優化稿全文
  mode: "ai-video" | "ai-caption" | "local-caption";
  model: string | null;
  provider: string | null;
  transcript: string | null;      // 逐字稿
  transcriptionStatus: string;    // 狀態文字
  warning: string | null;         // 警告訊息
  analyzedAt: string;             // ISO 時間戳
}
```

### 8.3 錯誤回應統一格式

```json
{
  "success": false,
  "error": "人類可讀的錯誤訊息"
}
```

---

## 9. 環境變數

| 變數 | 必要 | 預設值 | 說明 |
|------|------|--------|------|
| `GROQ_API_KEY` | 建議 | — | Groq API 金鑰（AI 分析用） |
| `GROQ_TEXT_MODEL` | 否 | `llama-3.3-70b-versatile` | Groq 文字分析模型 |
| `GROQ_TRANSCRIBE_MODEL` | 否 | `whisper-large-v3-turbo` | Groq 語音辨識模型 |
| `OPENAI_API_KEY` | 否 | — | OpenAI API 金鑰（備援） |
| `OPENAI_TEXT_MODEL` | 否 | `gpt-5.5` | OpenAI 文字分析模型 |
| `OPENAI_TRANSCRIBE_MODEL` | 否 | `gpt-4o-mini-transcribe` | OpenAI 語音辨識模型 |
| `AI_ACCESS_CODE` | 否 | — | 啟用 AI 功能密碼保護 |
| `AI_TRANSCRIBE_VIDEO` | 否 | `true` | 是否啟用影片語音辨識 |
| `TRANSCRIBE_LANGUAGE` | 否 | `zh` | 語音辨識語言 |
| `MAX_TRANSCRIBE_BYTES` | 否 | 25165824 | 影片轉錄大小上限 |
| `AI_TIMEOUT_MS` | 否 | 55000 | AI API 超時 |
| `AI_MEDIA_TIMEOUT_MS` | 否 | 45000 | 影片下載超時 |
| `REQUEST_TIMEOUT_MS` | 否 | 20000 | 頁面請求超時 |
| `MAX_HTML_BYTES` | 否 | 4194304 | 頁面內容大小上限 |
| `THUMBNAIL_TIMEOUT_MS` | 否 | 15000 | 縮圖請求超時 |
| `MAX_THUMBNAIL_BYTES` | 否 | 3670016 | 縮圖大小上限 |
| `PORT` | 否 | 8787 | 本機伺服器埠號 |
| `ENABLE_MEDIA_PROXY` | 否 | Vercel: false / 本機: true | 啟用媒體代理 |
| `CORS_ORIGIN` | 否 | `*` | CORS 設定 |

---

## 10. 開發與部署

### 10.1 本機開發

```bash
# 安裝依賴
npm install

# 複製環境變數
cp .env.example .env
# 編輯 .env 填入 GROQ_API_KEY

# 啟動開發模式（自動重載）
npm run dev

# 或一般啟動
npm start

# 執行測試
npm test
```

開啟 `http://127.0.0.1:8787`

### 10.2 VPS 部署（主力環境）

```bash
# SSH 連線
ssh root@108.61.163.87

# 更新程式碼（從本機推送後）
cd /root/xhs-html-downloader
git pull                          # 或手動 rsync
npm install                       # 安裝依賴 + postinstall 自動下載 yt-dlp
systemctl restart xhs-downloader  # 重啟主服務
systemctl restart yt-dlp-server   # 重啟 YouTube 下載代理
systemctl status xhs-downloader   # 確認運行中
```

**Python dl-proxy 部署方式：**
```bash
# 從本機推送 yt_api_server.py 到 VPS
ssh root@108.61.163.87 "cat > /root/yt_api_server.py" < yt_api_server.py
systemctl restart yt-dlp-server.service
```

**Caddy 管理：**
```bash
caddy reload                     # 重新載入 Caddyfile 設定
journalctl -u caddy -f           # 查看 Caddy 日誌
```

**查看應用日誌：**
```bash
journalctl -u xhs-downloader -f  # 主應用日誌
journalctl -u yt-dlp-server -f   # YouTube 代理日誌
```

### 10.3 Vercel 部署（備援 / AI 分析）

```bash
# 安裝 Vercel CLI
npm i -g vercel

# 部署
vercel

# 設定環境變數（也可以在 Vercel Dashboard 設定）
vercel env add GROQ_API_KEY
```

Vercel 上**不建議啟用 `ENABLE_MEDIA_PROXY`**（mediaProxyEnabled 預設為 false），因為 Vercel Serverless 有 10s 超時限制，媒體代理需要長時間串流。

### 10.4 測試

使用 Node.js 內建測試框架（`node --test`）：

```bash
npm test
```

測試檔案位於 `test/` 目錄，命名為 `*.test.js`。

---

## 11. 擴充新平台指引

### 11.1 標準擴充步驟

以加入 YouTube 為例（前端已半完成，需補後端）：

#### Step 1: 後端 API

在 `src/` 下新增 `youtube.js`：

```javascript
// src/youtube.js
export async function resolveYouTubeLink(url, options) {
  // 使用 @distube/ytdl-core 解析
  // 回傳格式需符合 ParseResult（見 8.1 節）
}
```

#### Step 2: 註冊路由

在 `src/index.js` 中加入：

```javascript
import { resolveYouTubeLink } from './youtube.js';

app.post('/api/youtube', parseLimiter, async (req, res) => {
  // 1. 驗證輸入
  // 2. 呼叫 resolveYouTubeLink()
  // 3. 回傳標準 ParseResult 格式
});
```

若需要格式選擇下載，實作 `/api/dl-proxy`。

#### Step 3: 前端串接

前端已內建 YouTube 路由，只需：

1. 確認 `isYouTubeLink()` 覆蓋所有 YouTube 網址格式
2. 確保 `/api/youtube` 回傳的資料包含 `videoFormats` / `audioFormats` 陣列供前端渲染

#### Step 4: 更新本協作規格書

在「支援平台」章節更新。

### 11.2 解析結果格式要求（跨平台）

所有平台的解析結果必須維持**同一組欄位結構**：

| 欄位 | 必要 | 說明 |
|------|------|------|
| `sourceUrl` | 是 | 原始輸入/最終 URL |
| `title` | 推薦 | 內容標題 |
| `author` | 否 | 作者/上傳者 |
| `type` | 是 | `"video"` 或 `"images"` |
| `video` | 影片時 | `MediaItem` 物件 |
| `images` | 圖片時 | `MediaItem[]` 陣列 |
| `format` | 推薦 | 人類可讀的格式 |
| `parser` | 推薦 | 解析方式標籤 |
| `videoFormats` | 否 | 多格式列表（YouTube 專用） |
| `audioFormats` | 否 | 音訊格式列表（YouTube 專用） |

**禁止**為特定平台新增專屬頂層欄位 — 使用 `videoFormats` / `audioFormats` 這類通用命名。

### 11.3 安全檢查規範（新平台必做）

所有新平台的 resolver 必須比照 `utils.js` 進行：

1. **DNS 驗證** — 使用 `assertPublicResolution()` 防止 SSRF
2. **網域白名單** — 在 `isShareHost()` / `isMediaHost()` 中加入合法網域
3. **大小限制** — 使用 `readTextWithLimit()` 防止 OOM
4. **HTTP 驗證** — 使用 `assertHttpUrl()` 確認 URL 格式

---

## 12. 程式碼規範

### 12.1 通用規範

- **語言：** 繁體中文（台灣正體）— 所有 UI 文字、錯誤訊息、註解
- **檔案命名：** `kebab-case.js`
- **模組系統：** ES Modules（`import` / `export`）
- **Node 版本：** 20.x
- **無 TypeScript** — 使用 JSDoc 註解標示類型（可選）

### 12.2 後端規範

- 所有 API 回傳格式：`{ success: boolean, data?: ..., error?: string }`
- 錯誤訊息：繁體中文，使用者可理解
- 非同步錯誤：使用 try/catch + 客製化 error.code
- DNS 查詢：所有外部請求前需通過 `assertPublicResolution()` 防止 SSRF
- 超時控制：所有 `fetch` 需帶 `AbortSignal.timeout()`

### 12.3 前端規範

- DOM 操作透過 `$(id)` 輔助函式（`document.getElementById` 別名）
- 事件監聽直接註冊，不使用框架
- localStorage key 前綴：`xhs-html-downloader-*`
- CSS 自訂屬性（CSS variables）用於主題切換
- 不依賴外部 CDN 或第三方 JS
- `aria-*` 屬性用於無障礙

### 12.4 Git 規範

- 忽略：`node_modules/`、`.env`、`*.log`、`.vercel/`、`*-player-script.js`

---

## 13. 已知問題與注意事項

### 13.1 已知問題

1. **本地版（v0.4.5）落後 VPS 版（v0.4.6）** — VPS 有 `platforms/` 多平台架構但本地沒有，兩者不同步
2. **抖音 / TikTok / Facebook 前端未路由** — 後端 resolver 已實作，但前端 `parseCurrentInput()` 只做了小紅書和 YouTube 路由
3. **VPS 磁碟空間不足** — 25 GB 已使用 20 GB（90%），剩 2.3 GB，需清理或擴容
4. **VPS 無 GROQ_API_KEY** — AI 分析功能在 VPS 上未啟用（`aiConfigured: false`）
5. **Vercel 媒體代理超時** — Vercel Serverless 10s 超時，不建議啟用 `ENABLE_MEDIA_PROXY`
6. 小紅書頁面結構可能改版導致 `window.__INITIAL_STATE__` 解析失敗 → 會自動降級到 `page-media-scan` 模式
7. 前端 `history-item` 的縮圖載入有多層 fallback（代理 → 原始 → 類型圖示）
8. `app.js` 中有少量 async 錯誤未 catch（如 `renderHistoryThumbnail` 中的 video.currentTime 設定）
9. CSS 中有兩個 `.toast` 規則重複

### 13.2 安全注意事項

- 永遠不要將 API Key 寫入前端程式碼或 GitHub
- 所有外部請求必須通過 DNS 驗證（防 SSRF）
- 媒體代理只允許 `xhscdn.com` 網域
- 縮圖代理只允許 `xhscdn.com` 圖片類型
- 前端 input 長度限制 4096 chars
- Rate limiting 在 `/api/parse`（20 req/min）和 `/api/media`（60 req/min）

### 13.3 開發注意事項

- 前端 `app.js` 有部分邏輯（YouTube 格式選取）依賴不存在的後端 API，測試時需注意
- `app.js` 第 584 行 `saveHistory()` 中的 `syncAiAccessUI()` 是黏在賦值後的奇怪排版
- 修改 `isShareHost()` 中的 `SHARE_HOSTS` Set 時，需要同時更新 `isMediaHost()`
- 加入新平台時，前端 `renderResult()` 中的 `platform === 'youtube'` 判斷式需要擴充

---

> 本文件由 AI 協作產生，最後更新：2026-07-06  
> 如需更新，請直接修改本檔案並保持格式一致。
