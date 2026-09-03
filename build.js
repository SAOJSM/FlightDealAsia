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

// ========== 截圖解析：URL 直接用，資料夾名稱則掃描所有圖片 ==========

const IMG_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];

function resolveScreenshots(value) {
  if (!value) return [];

  // 1. 判斷是否為外部網址
  if (/^https?:\/\//i.test(value)) return [value];

  // 2. 視為 screenshot/ 下的資料夾
  const targetPath = path.join(__dirname, 'screenshot', value);
  if (fs.existsSync(targetPath)) {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      const imgs = fs.readdirSync(targetPath)
        .filter(f => IMG_EXTS.includes(path.extname(f).toLowerCase()))
        .sort();
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

// ========== 日期過濾：僅保留最近 N 天 ==========

function filterRecent(deals, days) {
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  return deals.filter(d => {
    const dt = new Date(d['日期']);
    return !isNaN(dt.getTime()) && dt >= cutoff;
  });
}

// ========== HTML 轉義 ==========

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ========== 主流程 ==========

const csvPath = path.join(__dirname, 'data', 'deals.csv');
if (!fs.existsSync(csvPath)) { console.error('❌ 找不到 data/deals.csv'); process.exit(1); }

const allDeals = parseCsv(fs.readFileSync(csvPath, 'utf-8'));
const deals = filterRecent(allDeals, 3);
deals.sort((a, b) => new Date(b['日期']) - new Date(a['日期']));

// 解析每筆 Deal 的截圖
deals.forEach(d => { d._imgs = resolveScreenshots(d['截圖連結']); });

const buildTime = new Date().toLocaleString('zh-TW', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit'
});

const dealsJson = JSON.stringify(deals).replace(/<\/script>/gi, '<\\/script>');

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
  <link rel="stylesheet" href="style.css">
</head>
<body>

<div class="bg-orbs"><div class="orb"></div><div class="orb"></div><div class="orb"></div></div>

<div class="container">
  <header class="site-header">
    <h1>✈️ 便宜機票 Deals</h1>
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
        <label for="filter-destination">到達地</label>
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
        <label for="sort-date">日期排序</label>
        <select id="sort-date">
          <option value="desc">新 → 舊 (降冪)</option>
          <option value="asc">舊 → 新 (升冪)</option>
        </select>
      </div>
      <div class="filter-group">
        <label for="sort-price">價格排序</label>
        <select id="sort-price">
          <option value="">預設 (依日期)</option>
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
            <th class="sortable" id="th-date" title="點擊切換日期升/降冪">日期 <span class="sort-indicator" id="ind-date">▼</span></th>
            <th>天數</th>
            <th>出發地</th>
            <th>到達地</th>
            <th class="sortable" id="th-price" title="點擊切換價格升/降冪">價格 <span class="sort-indicator" id="ind-price"></span></th>
            <th>航空公司</th>
            <th>購買平台</th>
            <th>DEAL 截圖</th>
          </tr>
        </thead>
        <tbody id="deals-body"></tbody>
      </table>
    </div>
  </section>

  <footer class="site-footer">便宜機票 Deals &mdash; 資料每次 commit 後自動更新 &middot; 僅顯示最近 3 天</footer>
</div>

<!-- 截圖浮動預覽（大圖預覽 + 捲動 + 點擊開新視窗） -->
<div class="screenshot-tooltip" id="screenshot-tooltip">
  <div class="tooltip-header">
    <span class="tooltip-hint">🔍 點擊圖片在新視窗查看高清大圖</span>
    <button type="button" class="tooltip-close" id="tooltip-close" title="關閉預覽">✕</button>
  </div>
  <div class="tooltip-gallery" id="tooltip-gallery"></div>
  <div class="tooltip-counter" id="tooltip-counter"></div>
</div>

<script>
(function() {
  var DEALS = ${dealsJson};

  var depF     = document.getElementById('filter-departure');
  var destF    = document.getElementById('filter-destination');
  var daysF    = document.getElementById('filter-days');
  var airF     = document.getElementById('filter-airline');
  var platF    = document.getElementById('filter-platform');
  var sortDate = document.getElementById('sort-date');
  var sortS    = document.getElementById('sort-price');
  var thDate   = document.getElementById('th-date');
  var thPrice  = document.getElementById('th-price');
  var indDate  = document.getElementById('ind-date');
  var indPrice = document.getElementById('ind-price');
  var tbody    = document.getElementById('deals-body');
  var cntEl    = document.getElementById('deal-count');
  var tip      = document.getElementById('screenshot-tooltip');
  var gallery  = document.getElementById('tooltip-gallery');
  var counter  = document.getElementById('tooltip-counter');
  var closeBtn = document.getElementById('tooltip-close');
  var hideTimer = null;

  /* ---- 工具函式 ---- */
  function e(s) { var d=document.createElement('div'); d.appendChild(document.createTextNode(s)); return d.innerHTML; }
  function ea(s) { return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function numPrice(v) { var n = parseFloat(String(v || '').replace(/,/g, '')); return isNaN(n) ? 0 : n; }
  function fmtP(v) {
    var n = numPrice(v);
    return n === 0 ? e(v) : 'NT$ ' + n.toLocaleString();
  }

  function updateSortIndicators() {
    if (sortS.value === 'asc') {
      indPrice.textContent = '▲';
      indDate.textContent = '';
    } else if (sortS.value === 'desc') {
      indPrice.textContent = '▼';
      indDate.textContent = '';
    } else {
      indPrice.textContent = '';
      indDate.textContent = sortDate.value === 'asc' ? '▲' : '▼';
    }
  }

  /* ---- 填充下拉選單 ---- */
  function uniq(key) {
    var m={}, a=[];
    DEALS.forEach(function(d){ if(d[key]&&!m[d[key]]){m[d[key]]=1;a.push(d[key]);} });
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
  fill(destF, uniq('到達地'));
  fill(daysF, uniq('天數'), ' 天');
  fill(airF, uniq('航空公司'));
  fill(platF, uniq('購買平台'));

  /* ---- 篩選 + 渲染 ---- */
  function render() {
    var list = DEALS.filter(function(d) {
      if (depF.value  && d['出發地']  !== depF.value)  return false;
      if (destF.value && d['到達地']  !== destF.value) return false;
      if (daysF.value && d['天數']    !== daysF.value) return false;
      if (airF.value  && d['航空公司'] !== airF.value)  return false;
      if (platF.value && d['購買平台'] !== platF.value) return false;
      return true;
    });

    // 排序處理：若有選擇價格排序則價格優先，否則依日期升/降冪
    if (sortS.value === 'asc') {
      list.sort(function(a,b){ return numPrice(a['價格']) - numPrice(b['價格']); });
    } else if (sortS.value === 'desc') {
      list.sort(function(a,b){ return numPrice(b['價格']) - numPrice(a['價格']); });
    } else {
      if (sortDate.value === 'asc') {
        list.sort(function(a,b){ return a['日期'].localeCompare(b['日期']); });
      } else {
        list.sort(function(a,b){ return b['日期'].localeCompare(a['日期']); });
      }
    }
    cntEl.textContent = list.length;

    if (list.length===0) {
      tbody.innerHTML='<tr><td colspan="8" class="no-data">目前沒有符合條件的機票 Deal ✈️</td></tr>';
      return;
    }

    var h='';
    list.forEach(function(d,i) {
      var imgs = d._imgs || [];
      var imgsAttr = ea(JSON.stringify(imgs));
      var cntTxt = imgs.length>1 ? ' ('+imgs.length+')' : '';
      var daysTxt = d['天數'] ? e(d['天數']) + ' 天' : '—';
      var platTxt = d['購買平台'] ? e(d['購買平台']) : '—';
      h+='<tr style="animation-delay:'+(i*0.05)+'s">'
        +'<td>'+e(d['日期'])+'</td>'
        +'<td><span class="badge days">'+daysTxt+'</span></td>'
        +'<td><span class="badge departure">'+e(d['出發地'])+'</span></td>'
        +'<td><span class="badge destination">'+e(d['到達地'])+'</span></td>'
        +'<td class="price">'+fmtP(d['價格'])+'</td>'
        +'<td><span class="badge airline">'+e(d['航空公司'])+'</span></td>'
        +'<td><span class="badge platform">'+platTxt+'</span></td>'
        +'<td class="screenshot-cell" data-imgs="'+imgsAttr+'" title="點擊在新視窗開啟大圖">'
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

  /* ---- 點擊儲存格開啟新視窗 ---- */
  function onCellClick(ev) {
    var imgs;
    try { imgs=JSON.parse(ev.currentTarget.getAttribute('data-imgs')); } catch(x){ imgs=[]; }
    if(!imgs||imgs.length===0) return;
    window.open(imgs[0], '_blank', 'noopener,noreferrer');
  }

  /* ---- 截圖浮動預覽（大圖 + 多張捲動 + 點擊外開） ---- */
  function showTip(ev) {
    clearTimeout(hideTimer);
    var imgs;
    try { imgs=JSON.parse(ev.currentTarget.getAttribute('data-imgs')); } catch(x){ imgs=[]; }
    if(!imgs||imgs.length===0) return;

    var gh='';
    for(var i=0;i<imgs.length;i++) {
      gh+='<a href="'+imgs[i]+'" target="_blank" rel="noopener" class="gallery-item" title="點擊在新視窗開啟高清原圖">'
        +'<img src="'+imgs[i]+'" alt="Deal 截圖" loading="lazy">'
        +'<span class="img-open-badge">🔍 開啟原圖</span>'
        +'</a>';
    }
    gallery.innerHTML=gh;
    counter.textContent='共 '+imgs.length+' 張截圖 (點擊圖片開新視窗)';
    counter.style.display=imgs.length>1?'':'none';

    // 定位計算
    if (window.innerWidth > 768) {
      var rect=ev.currentTarget.getBoundingClientRect();
      var tw=Math.min(560, window.innerWidth - 30);
      var x=rect.left - tw - 16;
      var y=rect.top - 20;
      if(x < 12) x = rect.right + 16;
      if(y + 540 > window.innerHeight) y = Math.max(12, window.innerHeight - 550);
      if(y < 12) y = 12;
      tip.style.left=x+'px'; tip.style.top=y+'px';
    }
    tip.classList.add('visible');
  }

  function delayHide() { hideTimer=setTimeout(hideTip, 300); }
  function hideTip()   { tip.classList.remove('visible'); gallery.innerHTML=''; }

  tip.addEventListener('mouseenter', function(){ clearTimeout(hideTimer); });
  tip.addEventListener('mouseleave', hideTip);
  if (closeBtn) {
    closeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      hideTip();
    });
  }

  /* ---- 表格標題點擊排序事件 ---- */
  if (thDate) {
    thDate.addEventListener('click', function() {
      sortS.value = '';
      sortDate.value = sortDate.value === 'desc' ? 'asc' : 'desc';
      updateSortIndicators();
      render();
    });
  }
  if (thPrice) {
    thPrice.addEventListener('click', function() {
      if (sortS.value === 'asc') sortS.value = 'desc';
      else sortS.value = 'asc';
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
  sortDate.addEventListener('change', function() {
    sortS.value = '';
    updateSortIndicators();
    render();
  });
  sortS.addEventListener('change', function() {
    updateSortIndicators();
    render();
  });
  document.getElementById('clear-filters').addEventListener('click', function(){
    depF.value=''; destF.value=''; daysF.value=''; airF.value=''; platF.value='';
    sortDate.value='desc'; sortS.value='';
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
console.log('  ✅ 構建完成！');
console.log('  ─────────────────────────────');
console.log('  📄 輸出: index.html');
console.log('  📊 總筆數: ' + allDeals.length);
console.log('  ✈️  顯示筆數: ' + deals.length + ' (最近 3 天)');
deals.forEach(d => {
  const n = d._imgs.length;
  console.log('     • ' + d['日期'] + ' [' + (d['天數'] || '?') + '天] ' + d['出發地'] + ' → ' + d['到達地'] + ' | 價格: ' + d['價格'] + ' | 截圖: ' + (n > 0 ? n + ' 張' : '無'));
});
console.log('  🕐 構建時間: ' + buildTime);
console.log('');
