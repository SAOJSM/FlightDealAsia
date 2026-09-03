# ✈️ FlightDealAsia — 便宜機票 Deals

展示亞洲便宜機票優惠的靜態網頁。自動過濾僅顯示**最近 3 天**的 Deal。

🌐 **線上預覽**：[https://saojsm.github.io/FlightDealAsia](https://saojsm.github.io/FlightDealAsia)

---

## 🚀 快速開始

### 1. 新增 Deal

編輯 `data/deals.csv`，新增一行資料：

```csv
2026-09-05,TPE 台北,KIX 大阪,4800,台灣虎航,deal_osaka
```

### 2. 新增截圖

截圖連結欄位支援**兩種格式**：

| 格式 | 範例 | 說明 |
|------|------|------|
| 資料夾名稱 | `deal_osaka` | 自動掃描 `screenshot/deal_osaka/` 資料夾中所有圖片 |
| 網址 | `https://example.com/deal.png` | 直接使用該圖片 URL |

**資料夾截圖範例：**

```
screenshot/
├── deal_osaka/
│   ├── price.png        ← 價格截圖
│   ├── route.jpg        ← 路線截圖
│   └── booking.webp     ← 訂票頁面截圖
└── deal_tokyo/
    └── screenshot.png
```

### 3. 構建頁面

```bash
npm run build
```

構建完成後打開 `index.html` 即可預覽。

### 4. 部署

```bash
git add .
git commit -m "新增 Deal"
git push
```

推送後 GitHub Actions 會自動構建並部署到 GitHub Pages。

---

## 📋 CSV 欄位說明

| 欄位 | 格式 | 範例 |
|------|------|------|
| 日期 | `YYYY-MM-DD` | `2026-09-04` |
| 出發地 | 機場代碼 + 城市名 | `TPE 台北` |
| 到達地 | 機場代碼 + 城市名 | `NRT 東京` |
| 價格 | 數字（新台幣） | `4500` |
| 航空公司 | 航空公司名稱 | `台灣虎航` |
| 截圖連結 | 資料夾名稱 或 圖片 URL | `deal_tokyo` |

> ⚠️ 超過 3 天的資料會在構建時自動過濾，無需手動刪除。

---

## ⚙️ 技術架構

```
data/deals.csv  →  build.js  →  index.html  →  GitHub Pages
    (資料)         (構建)        (靜態頁面)      (部署)
```

- **零依賴**：僅使用 Node.js 原生 API，不需要安裝任何套件
- **靜態生成**：構建時讀取 CSV + 掃描截圖資料夾，產出純 HTML
- **自動部署**：GitHub Actions 在每次 push 後自動構建並部署

---

## 📄 License

MIT
