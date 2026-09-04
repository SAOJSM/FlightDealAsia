const fs = require('fs');
const path = require('path');

// ========== CSV Parser（零依賴、容錯處理）==========

function parseCsvLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  fields.push(cur.trim());
  return fields;
}

function parseCsv(content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const lines = content.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    let vals = parseCsvLine(lines[i]);
    if (vals.every(v => v === '')) continue;

    // 容錯：若價格中含有千分位逗號未加引號（如 17,231 導致欄位比標題多 1 個），自動修復
    if (vals.length === headers.length + 1) {
      const priceIdx = headers.indexOf('價格');
      if (priceIdx !== -1 && /^\d+$/.test(vals[priceIdx]) && /^\d+$/.test(vals[priceIdx + 1])) {
        vals[priceIdx] = vals[priceIdx] + vals[priceIdx + 1];
        vals.splice(priceIdx + 1, 1);
      }
    }

    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

// ========== 截圖檔名正規化：單張改為 deal_screenshot.png，多張依序 deal_screenshot.png / deal_screenshot_2.png ... ==========

const IMG_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];

function sortScreenshotFiles(files) {
  return files.slice().sort((a, b) => {
    const baseA = path.basename(a, path.extname(a));
    const baseB = path.basename(b, path.extname(b));
    if (baseA === 'deal_screenshot' && baseB.startsWith('deal_screenshot_')) return -1;
    if (baseB === 'deal_screenshot' && baseA.startsWith('deal_screenshot_')) return 1;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function normalizeScreenshots(baseDir) {
  if (!fs.existsSync(baseDir)) return;
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(baseDir, entry.name);
    const files = sortScreenshotFiles(
      fs.readdirSync(dirPath).filter(f => IMG_EXTS.includes(path.extname(f).toLowerCase()))
    );

    if (files.length === 0) continue;

    if (files.length === 1) {
      const ext = path.extname(files[0]).toLowerCase() || '.png';
      const targetName = 'deal_screenshot' + ext;
      if (files[0] !== targetName) {
        fs.renameSync(path.join(dirPath, files[0]), path.join(dirPath, targetName));
        console.log(`  🔄 重新命名: ${entry.name}/${files[0]} -> ${targetName}`);
      }
    } else {
      // 檢查是否已經完全符合規範
      let alreadyNormalized = true;
      for (let i = 0; i < files.length; i++) {
        const ext = path.extname(files[i]).toLowerCase();
        const expected = (i === 0) ? `deal_screenshot${ext}` : `deal_screenshot_${i + 1}${ext}`;
        if (files[i] !== expected) {
          alreadyNormalized = false;
          break;
        }
      }
      if (!alreadyNormalized) {
        // 先轉為臨時檔名防碰撞
        const tempFiles = [];
        for (let i = 0; i < files.length; i++) {
          const ext = path.extname(files[i]).toLowerCase() || '.png';
          const tempName = `__temp_${Date.now()}_${i}${ext}`;
          fs.renameSync(path.join(dirPath, files[i]), path.join(dirPath, tempName));
          tempFiles.push({ tempName, ext });
        }
        for (let i = 0; i < tempFiles.length; i++) {
          const ext = tempFiles[i].ext;
          const targetName = (i === 0) ? `deal_screenshot${ext}` : `deal_screenshot_${i + 1}${ext}`;
          fs.renameSync(path.join(dirPath, tempFiles[i].tempName), path.join(dirPath, targetName));
          console.log(`  🔄 重新命名: ${entry.name} -> ${targetName}`);
        }
      }
    }
  }
}

// ========== 截圖解析：URL 直接用，資料夾名稱則掃描所有圖片 ==========

function resolveScreenshots(value) {
  if (!value) return [];

  // 1. 判斷是否為外部網址
  if (/^https?:\/\//i.test(value)) return [value];

  // 2. 視為 screenshot/ 下的資料夾
  const targetPath = path.join(__dirname, 'screenshot', value);
  if (fs.existsSync(targetPath)) {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      const imgs = sortScreenshotFiles(
        fs.readdirSync(targetPath).filter(f => IMG_EXTS.includes(path.extname(f).toLowerCase()))
      );
      if (imgs.length > 0) {
        return imgs.map(f => 'screenshot/' + encodeURIComponent(value) + '/' + encodeURIComponent(f));
      }
    } else if (stat.isFile() && IMG_EXTS.includes(path.extname(targetPath).toLowerCase())) {
      return ['screenshot/' + encodeURIComponent(value)];
    }
  }

  // 3. 檢查是否有同名圖片檔案（例如 2026-11-18國航.png）
  for (const ext of IMG_EXTS) {
    const fileWithExt = path.join(__dirname, 'screenshot', value + ext);
    if (fs.existsSync(fileWithExt)) {
      return ['screenshot/' + encodeURIComponent(value + ext)];
    }
  }

  console.warn('  ⚠️  截圖資源未找到: screenshot/' + value);
  return [];
}

// ========== 日期與 CSV 序列化工具函式 ==========

function getMidnightDate(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function parseDealDate(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 0, 0, 0, 0);
  }
  const dt = new Date(str);
  if (isNaN(dt.getTime())) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0);
}

function serializeCsv(rows, headers) {
  const lines = [];
  lines.push(headers.join(','));
  for (const row of rows) {
    const vals = headers.map(h => {
      let v = String(row[h] !== undefined ? row[h] : '').trim();
      if (v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')) {
        v = '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    });
    lines.push(vals.join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

// ========== 排除超出 3 天的過期 Deal，並清理 deals.csv 與 screenshot 資料夾 ==========

function pruneExpiredDeals(deals, days = 3) {
  const today = getMidnightDate(new Date());
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1), 0, 0, 0, 0);

  const validDeals = [];
  const expiredDeals = [];

  deals.forEach(d => {
    // 優先依照「更新日期」，若無則依「日期」
    const dateStr = (d['更新日期'] || d['日期'] || '').trim();
    const dt = parseDealDate(dateStr);
    if (dt && dt < cutoff) {
      expiredDeals.push(d);
    } else {
      validDeals.push(d);
    }
  });

  if (expiredDeals.length > 0) {
    console.log(`\n  🧹 發現 ${expiredDeals.length} 筆超出 ${days} 天的過期 Deal，執行本地清理...`);

    // 找出所有有效 Deal 仍在使用的截圖連結
    const activeScreenshots = new Set(validDeals.map(d => (d['截圖連結'] || '').trim()).filter(Boolean));

    // 實體刪除過期 Deal 的截圖目錄/檔案
    expiredDeals.forEach(d => {
      const target = (d['截圖連結'] || '').trim();
      if (!target || activeScreenshots.has(target) || /^https?:\/\//i.test(target)) return;

      const targetPath = path.join(__dirname, 'screenshot', target);
      if (fs.existsSync(targetPath)) {
        try {
          const stat = fs.statSync(targetPath);
          if (stat.isDirectory() && target !== '.' && target !== '..') {
            fs.rmSync(targetPath, { recursive: true, force: true });
            console.log(`    🗑️ 已刪除過期截圖資料夾: screenshot/${target}`);
          } else if (stat.isFile() && target !== '.gitkeep') {
            fs.unlinkSync(targetPath);
            console.log(`    🗑️ 已刪除過期截圖檔案: screenshot/${target}`);
          }
        } catch (err) {
          console.warn(`    ⚠️ 刪除 screenshot/${target} 失敗:`, err.message);
        }
      }

      // 檢查帶有副檔名的檔案（例如 2026-11-18國航.png）
      for (const ext of IMG_EXTS) {
        const fileWithExt = path.join(__dirname, 'screenshot', target + ext);
        if (fs.existsSync(fileWithExt)) {
          try {
            fs.unlinkSync(fileWithExt);
            console.log(`    🗑️ 已刪除過期截圖檔案: screenshot/${target + ext}`);
          } catch (err) {
            console.warn(`    ⚠️ 刪除 ${fileWithExt} 失敗:`, err.message);
          }
        }
      }
    });

    // 將未過期資料寫回 data/deals.csv
    const headers = ['日期', '天數', '出發地', '到達地', '價格', '航空公司', '購買平台', '截圖連結', '更新日期'];
    const newCsvContent = serializeCsv(validDeals, headers);
    fs.writeFileSync(csvPath, newCsvContent, 'utf-8');
    console.log(`    💾 已從 data/deals.csv 排除過期資料，剩餘 ${validDeals.length} 筆。\n`);
  }

  return validDeals;
}

// ========== HTML 轉義 ==========

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ========== 主流程 ==========

const csvPath = path.join(__dirname, 'data', 'deals.csv');
if (!fs.existsSync(csvPath)) { console.error('❌ 找不到 data/deals.csv'); process.exit(1); }

const allDeals = parseCsv(fs.readFileSync(csvPath, 'utf-8'));
// 執行清理：將超過 3 天的過期資料從 deals.csv 排除並實體刪除 screenshot 資料夾
const deals = pruneExpiredDeals(allDeals, 3);
// 自動正規化截圖資料夾內的檔名（單張 deal_screenshot.png，多張 deal_screenshot.png, deal_screenshot_2.png...）
normalizeScreenshots(path.join(__dirname, 'screenshot'));

// 解析每筆 Deal 的截圖
deals.forEach(d => { d._imgs = resolveScreenshots(d['截圖連結']); });

const buildTime = new Date().toLocaleString('zh-TW', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit'
});

const dealsJson = JSON.stringify(deals).replace(/<\/script>/gi, '<\\/script>');

const vTag = Date.now();

// ========== 生成 HTML ==========

const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="最新便宜機票 Deal 資訊，每日更新超值航班優惠">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <title>✈️ 便宜機票 Deals</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="style.css?v=${vTag}">
</head>
<body>

<div class="bg-image"></div>

<div class="container">
  <header class="site-header">
    <h1><span class="header-icon">✈️</span><span class="header-title-text">便宜機票 Deals</span></h1>
    <p class="subtitle">最近 3 天的超值機票優惠，即時更新</p>
    <div class="header-stats">
      <div class="stat-item"><span>目前顯示</span><span class="stat-value" id="deal-count">${deals.length}</span><span>筆 Deal</span></div>
      <div class="stat-item"><span>最後更新</span><span class="stat-value">${esc(buildTime)}</span></div>
    </div>
  </header>

  <section class="filter-panel">
    <div class="filter-title">🔍 篩選條件</div>
    <div class="filter-row">
      <div class="filter-group">
        <label for="filter-departure">出發地</label>
        <select id="filter-departure"><option value="">全部</option></select>
      </div>
      <div class="filter-group">
        <label for="filter-destination">目的地</label>
        <select id="filter-destination"><option value="">全部</option></select>
      </div>
      <div class="filter-group">
        <label for="filter-days">旅遊天數</label>
        <select id="filter-days"><option value="">全部</option></select>
      </div>
      <div class="filter-group">
        <label for="filter-airline">航空公司</label>
        <select id="filter-airline"><option value="">全部</option></select>
      </div>
      <div class="filter-group">
        <label for="filter-platform">購買平台</label>
        <select id="filter-platform"><option value="">全部</option></select>
      </div>
      <div class="filter-group">
        <label for="sort-update-date">更新日期排序</label>
        <select id="sort-update-date">
          <option value="desc">新 → 舊 (降冪)</option>
          <option value="asc">舊 → 新 (升冪)</option>
        </select>
      </div>
      <div class="filter-group">
        <label for="sort-date">出發日期排序</label>
        <select id="sort-date">
          <option value="">無</option>
          <option value="desc">新 → 舊 (降冪)</option>
          <option value="asc">舊 → 新 (升冪)</option>
        </select>
      </div>
      <div class="filter-group">
        <label for="sort-price">價格排序</label>
        <select id="sort-price">
          <option value="">無</option>
          <option value="asc">低 → 高 (升冪)</option>
          <option value="desc">高 → 低 (降冪)</option>
        </select>
      </div>
      <button class="btn-clear" id="clear-filters">清除篩選</button>
    </div>
  </section>

  <section class="table-section">
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th class="sortable" id="th-update-date" title="點選切換更新日期排序">更新日期 <span class="sort-indicator" id="ind-update-date">▼</span></th>
            <th class="sortable" id="th-date" title="點選切換出發日期排序">出發日期 <span class="sort-indicator" id="ind-date"></span></th>
            <th>天數</th>
            <th>出發地</th>
            <th>目的地</th>
            <th class="sortable" id="th-price" title="點選切換價格排序">價格 <span class="sort-indicator" id="ind-price"></span></th>
            <th>航空公司</th>
            <th>購買平台</th>
            <th>DEAL 截圖</th>
          </tr>
        </thead>
        <tbody id="deals-body"></tbody>
      </table>
    </div>
  </section>

  <footer class="site-footer">便宜機票 Deals &mdash; 資料都是作者手動更新 &middot; 僅顯示最近 3 天，請耐心等待</footer>
</div>

<!-- 截圖浮動預覽（大圖預覽 + 橫向捲動 + 點選開新分頁） -->
<div class="screenshot-tooltip" id="screenshot-tooltip">
  <div class="tooltip-header">
    <span class="tooltip-hint">🔍 點選圖片在新分頁查看高畫質大圖</span>
    <button type="button" class="tooltip-close" id="tooltip-close" title="關閉預覽">✕</button>
  </div>
  <div class="tooltip-gallery" id="tooltip-gallery"></div>
  <div class="tooltip-counter" id="tooltip-counter"></div>
</div>

<script>
(function() {
  var DEALS = ${dealsJson};

  var depF         = document.getElementById('filter-departure');
  var destF        = document.getElementById('filter-destination');
  var daysF        = document.getElementById('filter-days');
  var airF         = document.getElementById('filter-airline');
  var platF        = document.getElementById('filter-platform');
  var sortUpDate   = document.getElementById('sort-update-date');
  var sortDate     = document.getElementById('sort-date');
  var sortPrice    = document.getElementById('sort-price');
  var thUpDate     = document.getElementById('th-update-date');
  var thDate       = document.getElementById('th-date');
  var thPrice      = document.getElementById('th-price');
  var indUpDate    = document.getElementById('ind-update-date');
  var indDate      = document.getElementById('ind-date');
  var indPrice     = document.getElementById('ind-price');
  var tbody        = document.getElementById('deals-body');
  var cntEl        = document.getElementById('deal-count');
  var tip          = document.getElementById('screenshot-tooltip');
  var gallery      = document.getElementById('tooltip-gallery');
  var counter      = document.getElementById('tooltip-counter');
  var closeBtn     = document.getElementById('tooltip-close');
  var hideTimer = null;

  var activeSort = 'updateDate'; // 'updateDate' | 'date' | 'price'

  /* ---- 工具函式 ---- */
  function e(s) { var d=document.createElement('div'); d.appendChild(document.createTextNode(s)); return d.innerHTML; }
  function ea(s) { return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function numPrice(v) { var n = parseFloat(String(v || '').replace(/,/g, '')); return isNaN(n) ? 0 : n; }
  function fmtP(v) {
    var n = numPrice(v);
    return n === 0 ? e(v) : 'NT$ ' + n.toLocaleString();
  }

  function updateSortIndicators() {
    indUpDate.textContent = '';
    indDate.textContent = '';
    indPrice.textContent = '';

    if (activeSort === 'updateDate') {
      indUpDate.textContent = sortUpDate.value === 'asc' ? '▲' : '▼';
    } else if (activeSort === 'date') {
      indDate.textContent = sortDate.value === 'asc' ? '▲' : '▼';
    } else if (activeSort === 'price') {
      indPrice.textContent = sortPrice.value === 'asc' ? '▲' : '▼';
    }
  }

  /* ---- 填充下拉選單 ---- */
  function uniq(key) {
    var m={}, a=[];
    DEALS.forEach(function(d){
      var val = key === '目的地' ? (d['目的地'] || d['到達地']) : d[key];
      if(val&&!m[val]){m[val]=1;a.push(val);}
    });
    return a.sort(function(x, y) {
      var nx = parseFloat(x), ny = parseFloat(y);
      if (!isNaN(nx) && !isNaN(ny)) return nx - ny;
      return x.localeCompare(y);
    });
  }
  function fill(sel, items, suffix) {
    suffix = suffix || '';
    items.forEach(function(t){
      var o=document.createElement('option');
      o.value=t;
      o.textContent=t + suffix;
      sel.appendChild(o);
    });
  }
  fill(depF, uniq('出發地'));
  fill(destF, uniq('目的地'));
  fill(daysF, uniq('天數'), ' 天');
  fill(airF, uniq('航空公司'));
  fill(platF, uniq('購買平台'));

  /* ---- 篩選 + 渲染 ---- */
  function render() {
    var list = DEALS.filter(function(d) {
      var destVal = d['目的地'] || d['到達地'] || '';
      if (depF.value  && d['出發地']  !== depF.value)  return false;
      if (destF.value && destVal     !== destF.value) return false;
      if (daysF.value && d['天數']    !== daysF.value) return false;
      if (airF.value  && d['航空公司'] !== airF.value)  return false;
      if (platF.value && d['購買平台'] !== platF.value) return false;
      return true;
    });

    // 排序處理
    if (activeSort === 'price') {
      if (sortPrice.value === 'asc') {
        list.sort(function(a,b){ return numPrice(a['價格']) - numPrice(b['價格']); });
      } else {
        list.sort(function(a,b){ return numPrice(b['價格']) - numPrice(a['價格']); });
      }
    } else if (activeSort === 'date') {
      if (sortDate.value === 'asc') {
        list.sort(function(a,b){ return (a['日期']||'').localeCompare(b['日期']||''); });
      } else {
        list.sort(function(a,b){ return (b['日期']||'').localeCompare(a['日期']||''); });
      }
    } else {
      // 預設依 更新日期 排序
      if (sortUpDate.value === 'asc') {
        list.sort(function(a,b){
          var da = a['更新日期'] || a['日期'] || '';
          var db = b['更新日期'] || b['日期'] || '';
          return da.localeCompare(db);
        });
      } else {
        list.sort(function(a,b){
          var da = a['更新日期'] || a['日期'] || '';
          var db = b['更新日期'] || b['日期'] || '';
          return db.localeCompare(da);
        });
      }
    }
    cntEl.textContent = list.length;

    if (list.length===0) {
      tbody.innerHTML='<tr><td colspan="9" class="no-data">目前沒有符合條件的機票 Deal ✈️</td></tr>';
      return;
    }

    var h='';
    list.forEach(function(d,i) {
      var imgs = d._imgs || [];
      var imgsAttr = ea(JSON.stringify(imgs));
      var cntTxt = imgs.length>1 ? ' ('+imgs.length+')' : '';
      var daysTxt = d['天數'] ? e(d['天數']) + ' 天' : '—';
      var platTxt = d['購買平台'] ? e(d['購買平台']) : '—';
      var upDateTxt = d['更新日期'] ? e(d['更新日期']) : '—';
      h+='<tr style="animation-delay:'+(i*0.05)+'s">'
        +'<td><span class="badge update-date">'+upDateTxt+'</span></td>'
        +'<td class="date-departure">'+e(d['日期'])+'</td>'
        +'<td><span class="badge days">'+daysTxt+'</span></td>'
        +'<td><span class="badge departure">'+e(d['出發地'])+'</span></td>'
        +'<td><span class="badge destination">'+e(d['目的地'] || d['到達地'] || '')+'</span></td>'
        +'<td class="price">'+fmtP(d['價格'])+'</td>'
        +'<td><span class="badge airline">'+e(d['航空公司'])+'</span></td>'
        +'<td><span class="badge platform">'+platTxt+'</span></td>'
        +'<td class="screenshot-cell" data-imgs="'+imgsAttr+'" title="點選在新分頁開啟大圖">'
        +(imgs.length>0
          ? '<span class="screenshot-icon">🖼️ 預覽'+cntTxt+'</span>'
          : '<span class="screenshot-none">—</span>')
        +'</td></tr>';
    });
    tbody.innerHTML=h;

    var cells=document.querySelectorAll('.screenshot-cell');
    for(var j=0;j<cells.length;j++){
      cells[j].addEventListener('mouseenter', showTip);
      cells[j].addEventListener('mouseleave', delayHide);
      cells[j].addEventListener('click', onCellClick);
    }
  }

  /* ---- 點選儲存格開啟新分頁 ---- */
  function onCellClick(ev) {
    var imgs;
    try { imgs=JSON.parse(ev.currentTarget.getAttribute('data-imgs')); } catch(x){ imgs=[]; }
    if(!imgs||imgs.length===0) return;
    window.open(imgs[0], '_blank', 'noopener,noreferrer');
  }

  /* ---- 截圖浮動預覽（大圖 + 橫向捲動 + 點選開新分頁） ---- */
  function showTip(ev) {
    clearTimeout(hideTimer);
    var imgs;
    try { imgs=JSON.parse(ev.currentTarget.getAttribute('data-imgs')); } catch(x){ imgs=[]; }
    if(!imgs||imgs.length===0) return;

    var gh='';
    for(var i=0;i<imgs.length;i++) {
      var badgeTxt = imgs.length > 1 ? '🔍 開啟圖 ' + (i+1) + ' 原圖' : '🔍 開啟高畫質原圖';
      gh+='<a href="'+imgs[i]+'" target="_blank" rel="noopener" class="gallery-item" title="點選在新分頁開啟高畫質原圖">'
        +'<img src="'+imgs[i]+'" alt="Deal 截圖" loading="lazy">'
        +'<span class="img-open-badge">'+badgeTxt+'</span>'
        +'</a>';
    }
    gallery.innerHTML=gh;

    if (imgs.length > 1) {
      tip.classList.remove('single-img');
      tip.classList.add('multi-img');
      counter.textContent='共 '+imgs.length+' 張截圖（橫向並排顯示 · 點選圖片開新分頁）';
      counter.style.display='';
    } else {
      tip.classList.remove('multi-img');
      tip.classList.add('single-img');
      counter.textContent='';
      counter.style.display='none';
    }

    // 定位與寬度計算
    if (window.innerWidth > 768) {
      var tw;
      if (imgs.length === 1) {
        tw = Math.min(540, window.innerWidth - 30);
      } else if (imgs.length === 2) {
        tw = Math.min(940, window.innerWidth - 30);
      } else {
        tw = Math.min(imgs.length * 440 + 40, window.innerWidth - 30, 1380);
      }
      tip.style.width = tw + 'px';

      var rect = ev.currentTarget.getBoundingClientRect();
      var x = rect.left - tw - 16;
      if (x < 12) {
        if (rect.right + 16 + tw <= window.innerWidth - 12) {
          x = rect.right + 16;
        } else {
          x = Math.max(12, Math.floor((window.innerWidth - tw) / 2));
        }
      }

      var y = rect.top - 20;
      if (y + 540 > window.innerHeight) y = Math.max(12, window.innerHeight - 550);
      if (y < 12) y = 12;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    }
    tip.classList.add('visible');
  }

  function delayHide() { hideTimer=setTimeout(hideTip, 300); }
  function hideTip()   { tip.classList.remove('visible'); gallery.innerHTML=''; }

  tip.addEventListener('mouseenter', function(){ clearTimeout(hideTimer); });
  tip.addEventListener('mouseleave', hideTip);
  gallery.addEventListener('wheel', function(e) {
    if (gallery.scrollWidth > gallery.clientWidth) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        gallery.scrollLeft += e.deltaY;
      }
    }
  }, { passive: false });
  if (closeBtn) {
    closeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      hideTip();
    });
  }

  /* ---- 表格標題點擊排序事件 ---- */
  if (thUpDate) {
    thUpDate.addEventListener('click', function() {
      activeSort = 'updateDate';
      sortUpDate.value = sortUpDate.value === 'desc' ? 'asc' : 'desc';
      sortDate.value = '';
      sortPrice.value = '';
      updateSortIndicators();
      render();
    });
  }
  if (thDate) {
    thDate.addEventListener('click', function() {
      activeSort = 'date';
      sortDate.value = sortDate.value === 'desc' ? 'asc' : 'desc';
      sortPrice.value = '';
      updateSortIndicators();
      render();
    });
  }
  if (thPrice) {
    thPrice.addEventListener('click', function() {
      activeSort = 'price';
      sortPrice.value = sortPrice.value === 'asc' ? 'desc' : 'asc';
      updateSortIndicators();
      render();
    });
  }

  /* ---- 事件監聽 ---- */
  depF.addEventListener('change', render);
  destF.addEventListener('change', render);
  daysF.addEventListener('change', render);
  airF.addEventListener('change', render);
  platF.addEventListener('change', render);

  sortUpDate.addEventListener('change', function() {
    activeSort = 'updateDate';
    sortDate.value = '';
    sortPrice.value = '';
    updateSortIndicators();
    render();
  });
  sortDate.addEventListener('change', function() {
    if (!sortDate.value) {
      activeSort = 'updateDate';
    } else {
      activeSort = 'date';
      sortPrice.value = '';
    }
    updateSortIndicators();
    render();
  });
  sortPrice.addEventListener('change', function() {
    if (!sortPrice.value) {
      activeSort = 'updateDate';
    } else {
      activeSort = 'price';
    }
    updateSortIndicators();
    render();
  });

  document.getElementById('clear-filters').addEventListener('click', function(){
    depF.value=''; destF.value=''; daysF.value=''; airF.value=''; platF.value='';
    sortUpDate.value='desc'; sortDate.value=''; sortPrice.value='';
    activeSort = 'updateDate';
    updateSortIndicators();
    render();
  });

  updateSortIndicators();

  render();
})();
</script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html, 'utf-8');

console.log('');
console.log('  ✅ 建置完成！');
console.log('  ─────────────────────────────');
console.log('  📄 輸出: index.html');
console.log('  📊 總筆數: ' + allDeals.length);
console.log('  ✈️  顯示筆數: ' + deals.length + ' (最近 3 天)');
deals.forEach(d => {
  const n = d._imgs.length;
  console.log('     • ' + (d['更新日期'] || d['日期']) + ' (出發: ' + d['日期'] + ') [' + (d['天數'] || '?') + '天] ' + d['出發地'] + ' → ' + (d['目的地'] || d['到達地'] || '') + ' | 價格: ' + d['價格'] + ' | 截圖: ' + (n > 0 ? n + ' 張' : '無'));
});
console.log('  🕐 建置時間: ' + buildTime);
console.log('');
