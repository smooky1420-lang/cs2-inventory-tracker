const state = {
  snapshot: null,
  job: { running: false, kind: 'idle', message: '', error: null, steamGuard: null },
  page: 'dashboard',
  view: 'items',
  location: 'all',
  type: 'all',
  search: '',
  hideUnpriced: false,
  onlyUnpriced: false,
  hideZero: false,
  sortKey: 'marketValue',
  sortDir: 'desc',
};

const $ = (id) => document.getElementById(id);

function usd(value, fallback = 'N/A') {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `-$${abs}` : `$${abs}`;
}

function pct(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function clsPnl(value) {
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return '';
}

function when(iso) {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString();
}

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function csfloatUrl(name) {
  const lookup = name.startsWith('Sticker Slab | ') ? `Sticker | ${name.slice('Sticker Slab | '.length)}` : name;
  return `https://csfloat.com/search?market_hash_name=${encodeURIComponent(lookup)}`;
}

function itemLink(name) {
  return `<a class="item-link" href="${esc(csfloatUrl(name))}" target="_blank" rel="noopener noreferrer" title="Open on CSFloat">${esc(name)}</a>`;
}

function setBanner() {
  const banner = $('banner');
  const { job } = state;
  if (job.error) {
    banner.className = 'banner error';
    banner.textContent = job.error;
    return;
  }
  if (job.running || job.message) {
    banner.className = 'banner';
    banner.textContent = job.message || 'Working…';
    return;
  }
  banner.className = 'banner hidden';
}

function setBusy(busy) {
  $('btn-sync').disabled = busy;
  $('btn-prices').disabled = busy;
  $('btn-fill-buy').disabled = busy;
}

function renderCards(summary) {
  const items = [
    ['Net worth (2% fee)', usd(summary.totalNetLiquidated), 'gold'],
    ['Market value', usd(summary.totalMarketValue), ''],
    ['Cost basis', usd(summary.totalInvested), ''],
    ['Overall P/L', usd(summary.totalProfitUsd), clsPnl(summary.totalProfitUsd)],
    ['ROI', pct(summary.overallRoiPct), clsPnl(summary.totalProfitUsd)],
  ];
  $('cards').innerHTML = items
    .map(
      ([label, value, klass]) =>
        `<article class="card"><div class="label">${label}</div><div class="value ${klass}">${value}</div></article>`,
    )
    .join('');
}

function pageFromHash() {
  const hash = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return hash === 'inventory' ? 'inventory' : 'dashboard';
}

function applyPage() {
  const page = state.page;
  document.body.dataset.page = page;
  document.title = page === 'inventory' ? 'Inventory · CS2 Tracker' : 'Dashboard · CS2 Tracker';
  for (const link of document.querySelectorAll('.nav a')) {
    link.classList.toggle('active', link.dataset.page === page);
  }
  if (location.hash !== `#/${page}`) {
    history.replaceState(null, '', `#/${page}`);
  }
}

function openInventory(filters = {}) {
  if (filters.type !== undefined) state.type = filters.type;
  if (filters.location !== undefined) state.location = filters.location;
  if (filters.search !== undefined) {
    state.search = filters.search;
    $('search').value = filters.search;
  }
  if (filters.onlyUnpriced !== undefined) {
    state.onlyUnpriced = filters.onlyUnpriced;
    $('only-unpriced').checked = filters.onlyUnpriced;
    if (filters.onlyUnpriced) {
      state.hideUnpriced = false;
      $('hide-unpriced').checked = false;
    }
  }
  state.page = 'inventory';
  applyPage();
  render();
}

function renderBreakdown(id, rows, emptyText, kind) {
  const max = Math.max(0, ...rows.map((row) => row.marketValue));
  if (rows.length === 0) {
    $(id).innerHTML = `<p class="empty-note">${emptyText}</p>`;
    return;
  }
  $(id).innerHTML = rows
    .map((row) => {
      const width = max > 0 ? Math.max(3, (row.marketValue / max) * 100) : 0;
      return `<div class="break-row clickable" data-kind="${kind}" data-label="${esc(row.label)}">
        <div class="break-head"><span>${esc(row.label)}</span><span>${usd(row.marketValue)}</span></div>
        <div class="break-meta">${row.quantity} items · net ${usd(row.netLiquidated)} · ${usd(row.profitUsd)} P/L</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
      </div>`;
    })
    .join('');
}

function renderUnpriced(summary) {
  const items = summary.unpriced || [];
  $('unpriced-count').textContent = items.length ? `${items.length}` : '';
  if (items.length === 0) {
    $('unpriced').innerHTML = '<p class="empty-note">Every item has a CSFloat price.</p>';
    return;
  }
  $('unpriced').innerHTML = items
    .map(
      (item) => `<div class="break-row clickable" data-kind="unpriced" data-label="${esc(item.marketHashName)}">
        <div class="break-head">${itemLink(item.marketHashName)}<span class="muted">${item.quantity} × N/A</span></div>
        <div class="break-meta">${esc(item.itemType)} · ${esc((item.locations || []).join(', '))}</div>
      </div>`,
    )
    .join('');
}

function renderChart() {
  const canvas = $('value-chart');
  const empty = $('chart-empty');
  if (state.page !== 'dashboard' || !canvas) return;
  const history = state.snapshot.history || [];
  if (history.length < 2) {
    empty.classList.remove('hidden');
    empty.textContent = history.length === 1
      ? 'One snapshot saved. Refresh prices later to see the trend.'
      : 'Refresh prices once to start a history.';
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  empty.classList.add('hidden');

  const wrap = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const width = wrap.clientWidth;
  const height = wrap.clientHeight;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pad = { top: 16, right: 16, bottom: 28, left: 64 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const times = history.map((point) => Date.parse(point.at));
  const values = history.flatMap((point) => [point.netLiquidated, point.marketValue]);
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const spanT = Math.max(1, maxT - minT);
  const padV = Math.max(1, (maxV - minV) * 0.12);
  const lo = Math.max(0, minV - padV);
  const hi = maxV + padV;
  const spanV = Math.max(1, hi - lo);

  const xAt = (t) => pad.left + ((t - minT) / spanT) * plotW;
  const yAt = (v) => pad.top + plotH - ((v - lo) / spanV) * plotH;

  ctx.strokeStyle = '#2c3338';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#8d979e';
  ctx.font = '11px Segoe UI, system-ui, sans-serif';
  const ticks = 4;
  for (let i = 0; i <= ticks; i += 1) {
    const value = lo + (spanV * i) / ticks;
    const y = yAt(value);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(usd(value), 8, y + 4);
  }

  ctx.fillText(new Date(minT).toLocaleDateString(), pad.left, height - 8);
  const endLabel = new Date(maxT).toLocaleDateString();
  ctx.fillText(endLabel, width - pad.right - ctx.measureText(endLabel).width, height - 8);

  function drawLine(key, color, widthPx) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = widthPx;
    history.forEach((point, index) => {
      const x = xAt(Date.parse(point.at));
      const y = yAt(point[key]);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    history.forEach((point) => {
      const x = xAt(Date.parse(point.at));
      const y = yAt(point[key]);
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  drawLine('marketValue', '#6d787f', 1.5);
  drawLine('netLiquidated', '#e2c37a', 2);
}

function filteredRows() {
  const summary = state.snapshot.summary;
  const q = state.search.trim().toLowerCase();
  const source = state.view === 'lots' ? summary.lots : summary.rollups;

  return source.filter((row) => {
    const name = rowName(row);
    const location = rowLocation(row);
    if (state.location !== 'all') {
      if (state.view === 'lots' && row.location !== state.location) return false;
      if (state.view === 'items' && !(row.locations || []).includes(state.location)) return false;
    }
    if (state.type !== 'all' && row.itemType !== state.type) return false;
    if (q && !`${name} ${location} ${row.itemType || ''}`.toLowerCase().includes(q)) return false;
    if (state.onlyUnpriced && row.unitPrice !== null) return false;
    if (state.hideUnpriced && row.unitPrice === null) return false;
    if (state.hideZero && row.buyPrice === 0) return false;
    return true;
  });
}

function rowName(row) {
  return row.marketHashName || row.market_hash_name || '';
}

function rowLocation(row) {
  return row.location || (row.locations || []).join(', ');
}

function sortRows(rows) {
  const key = state.sortKey;
  const dir = state.sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    if (key === 'marketHashName') {
      av = rowName(a);
      bv = rowName(b);
    } else if (key === 'location') {
      av = rowLocation(a);
      bv = rowLocation(b);
    }
    if (typeof av === 'number' && typeof bv === 'number') return ((av ?? -1) - (bv ?? -1)) * dir;
    return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
  });
}

function headerCell(key, label, numeric = false) {
  const sorted = state.sortKey === key ? 'sorted' : '';
  const mark = state.sortKey === key ? (state.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
  return `<th class="${numeric ? 'num ' : ''}${sorted}" data-sort="${key}">${label}${mark}</th>`;
}

function rollupFor(name) {
  return (state.snapshot?.summary.rollups || []).find((row) => row.marketHashName === name);
}

function weightedAverage(currentQty, currentBuyPrice, addQty, addPrice, alreadyInInventory) {
  const baseQty = alreadyInInventory ? Math.max(0, currentQty - addQty) : currentQty;
  const denom = alreadyInInventory ? Math.max(currentQty, baseQty + addQty) : currentQty + addQty;
  if (denom <= 0) return addPrice;
  return Math.round(((baseQty * currentBuyPrice + addQty * addPrice) / denom) * 100) / 100;
}

function rowHtml(row) {
  const name = row.marketHashName || row.market_hash_name;
  const location = row.location || (row.locations || []).join(', ');
  const type = row.itemType ? `<div class="item-type muted">${esc(row.itemType)}</div>` : '';
  const purchases = row.purchases || rollupFor(name)?.purchases || [];
  const buyNote = purchases.length
    ? `<div class="item-type muted">${purchases.length} buy${purchases.length === 1 ? '' : 's'}</div>`
    : '';
  return `<tr>
    <td>${itemLink(name)}${type}</td>
    <td class="muted">${esc(location)}</td>
    <td class="num">${row.quantity}</td>
    <td class="num">
      <div class="buy-cell">
        <input class="buy-input" type="number" min="0" step="0.01" value="${row.buyPrice.toFixed(2)}" data-name="${encodeURIComponent(name)}" title="Set average buy price" />
        <button type="button" class="btn-add-buy" data-name="${encodeURIComponent(name)}" title="Add a purchase and average it in">+</button>
      </div>
      ${buyNote}
    </td>
    <td class="num">${usd(row.unitPrice)}</td>
    <td class="num">${usd(row.invested)}</td>
    <td class="num">${usd(row.marketValue)}</td>
    <td class="num">${usd(row.netLiquidated)}</td>
    <td class="num ${clsPnl(row.profitUsd)}">${usd(row.profitUsd)}</td>
    <td class="num ${clsPnl(row.profitUsd)}">${pct(row.profitPct)}</td>
  </tr>`;
}

function renderTable() {
  const rows = sortRows(filteredRows());
  const thead = $('holdings').tHead;
  const tbody = $('holdings').tBodies[0];
  thead.innerHTML = `<tr>
    ${headerCell('marketHashName', 'Item')}
    ${headerCell('location', 'Location')}
    ${headerCell('quantity', 'Qty', true)}
    ${headerCell('buyPrice', 'Avg buy', true)}
    ${headerCell('unitPrice', 'CSFloat', true)}
    ${headerCell('invested', 'Invested', true)}
    ${headerCell('marketValue', 'Value', true)}
    ${headerCell('netLiquidated', 'Net (2%)', true)}
    ${headerCell('profitUsd', 'P/L $', true)}
    ${headerCell('profitPct', 'P/L %', true)}
  </tr>`;

  if (state.view === 'lots') {
    const groups = new Map();
    for (const row of rows) {
      const list = groups.get(row.location) || [];
      list.push(row);
      groups.set(row.location, list);
    }
    tbody.innerHTML = [...groups.entries()]
      .map(([location, list]) => {
        const qty = list.reduce((sum, row) => sum + row.quantity, 0);
        const value = list.reduce((sum, row) => sum + row.marketValue, 0);
        return `<tr class="group-row"><td colspan="10">${location} · ${qty} items · ${usd(value)}</td></tr>${list.map(rowHtml).join('')}`;
      })
      .join('');
  } else {
    tbody.innerHTML = rows.map(rowHtml).join('');
  }
}

function renderMeta() {
  const p = state.snapshot.portfolio;
  const s = state.snapshot.summary;
  $('sync-meta').innerHTML = `
    <div>${s.totalQuantity} items · ${s.rollups.length} distinct · ${s.pricedItems} priced</div>
    <div>Steam: ${when(p.lastSteamSyncAt)}</div>
    <div>Prices: ${when(p.lastPriceSyncAt)}</div>
  `;
}

function renderLocations() {
  const select = $('location');
  const current = state.location;
  const locations = state.snapshot.summary.locations || [];
  select.innerHTML = `<option value="all">All locations</option>${locations
    .map((name) => `<option value="${name}">${name}</option>`)
    .join('')}`;
  select.value = locations.includes(current) ? current : 'all';
  state.location = select.value;
}

function renderTypes() {
  const select = $('type');
  const current = state.type;
  const types = (state.snapshot.summary.byType || []).map((row) => row.label);
  select.innerHTML = `<option value="all">All types</option>${types
    .map((name) => `<option value="${name}">${name}</option>`)
    .join('')}`;
  select.value = types.includes(current) ? current : 'all';
  state.type = select.value;
}

function renderInventoryStrip() {
  const s = state.snapshot.summary;
  const rows = filteredRows();
  const shownQty = rows.reduce((sum, row) => sum + row.quantity, 0);
  $('inventory-strip').innerHTML = `
    <span>Net worth <strong class="gold">${usd(s.totalNetLiquidated)}</strong></span>
    <span>P/L <strong class="${clsPnl(s.totalProfitUsd)}">${usd(s.totalProfitUsd)}</strong></span>
    <span>Showing <strong>${shownQty}</strong> of ${s.totalQuantity} items</span>
  `;
}

function render() {
  if (!state.snapshot) return;
  applyPage();
  setBanner();
  setBusy(state.job.running);
  renderMeta();
  if (state.page === 'dashboard') {
    renderCards(state.snapshot.summary);
    renderBreakdown('by-type', state.snapshot.summary.byType || [], 'No items to group.', 'type');
    renderBreakdown('by-location', state.snapshot.summary.byLocation || [], 'No storage units yet.', 'location');
    renderUnpriced(state.snapshot.summary);
    requestAnimationFrame(() => requestAnimationFrame(renderChart));
  } else {
    renderTypes();
    renderLocations();
    renderTable();
    renderInventoryStrip();
  }
  const modal = $('guard-modal');
  if (state.job.steamGuard) {
    modal.classList.remove('hidden');
    $('guard-copy').textContent = state.job.steamGuard.domain
      ? `Enter the email code sent to ${state.job.steamGuard.domain}.`
      : 'Enter the code from your Steam mobile authenticator.';
    $('guard-code').focus();
  } else {
    modal.classList.add('hidden');
  }
}

function applySnapshot(payload) {
  if (payload.snapshot) state.snapshot = payload.snapshot;
  else if (payload.portfolio && payload.summary) {
    state.snapshot = {
      portfolio: payload.portfolio,
      summary: payload.summary,
      history: payload.history || state.snapshot?.history || [],
    };
  }
  if (payload.running !== undefined) {
    state.job = {
      running: payload.running,
      kind: payload.kind,
      message: payload.message,
      error: payload.error,
      steamGuard: payload.steamGuard,
    };
  }
  render();
}

async function load() {
  const res = await fetch('/api/portfolio');
  applySnapshot(await res.json());
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : '{}',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function exportCsv() {
  const rows = sortRows(filteredRows());
  const header = ['Item', 'Location', 'Qty', 'Buy', 'CSFloat', 'Invested', 'Value', 'Net', 'PnL', 'PnL%'];
  const lines = [header.join(',')];
  for (const row of rows) {
    const name = row.marketHashName || row.market_hash_name;
    const location = row.location || (row.locations || []).join('; ');
    lines.push(
      [
        `"${name.replaceAll('"', '""')}"`,
        `"${location.replaceAll('"', '""')}"`,
        row.quantity,
        row.buyPrice,
        row.unitPrice ?? '',
        row.invested,
        row.marketValue,
        row.netLiquidated,
        row.profitUsd,
        row.profitPct ?? '',
      ].join(','),
    );
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cs2-portfolio.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function refreshInventory() {
  if (state.page !== 'inventory' || !state.snapshot) return;
  renderTable();
  renderInventoryStrip();
}

let buyModalName = '';

function closeBuyModal() {
  $('buy-modal').classList.add('hidden');
  buyModalName = '';
}

function updateBuyPreview() {
  const item = rollupFor(buyModalName);
  if (!item) return;
  const addQty = Number($('buy-qty').value);
  const addPrice = Number($('buy-price').value);
  const already = $('buy-already').checked;
  if (!Number.isFinite(addQty) || addQty <= 0 || !Number.isFinite(addPrice) || addPrice < 0) {
    $('buy-preview').textContent = 'Enter quantity and price to see the new average.';
    return;
  }
  const next = weightedAverage(item.quantity, item.buyPrice, addQty, addPrice, already);
  const total = Math.round(addQty * addPrice * 100) / 100;
  $('buy-preview').innerHTML = `This buy: <strong>${usd(total)}</strong> · New average: <strong>${usd(next)}</strong>`;
}

function openBuyModal(name) {
  const item = rollupFor(name);
  if (!item) return;
  buyModalName = name;
  $('buy-modal-item').textContent = name;
  $('buy-modal-current').textContent = `${item.quantity} owned · current average ${usd(item.buyPrice)}`;
  $('buy-qty').value = '';
  $('buy-price').value = item.unitPrice != null ? item.unitPrice.toFixed(2) : '';
  $('buy-already').checked = true;
  updateBuyPreview();
  $('buy-modal').classList.remove('hidden');
  $('buy-qty').focus();
}

$('search').addEventListener('input', (event) => {
  state.search = event.target.value;
  refreshInventory();
});
$('type').addEventListener('change', (event) => {
  state.type = event.target.value;
  refreshInventory();
});
$('location').addEventListener('change', (event) => {
  state.location = event.target.value;
  refreshInventory();
});
$('view').addEventListener('change', (event) => {
  state.view = event.target.value;
  refreshInventory();
});
$('hide-unpriced').addEventListener('change', (event) => {
  state.hideUnpriced = event.target.checked;
  if (state.hideUnpriced) {
    state.onlyUnpriced = false;
    $('only-unpriced').checked = false;
  }
  refreshInventory();
});
$('only-unpriced').addEventListener('change', (event) => {
  state.onlyUnpriced = event.target.checked;
  if (state.onlyUnpriced) {
    state.hideUnpriced = false;
    $('hide-unpriced').checked = false;
  }
  refreshInventory();
});
$('hide-zero').addEventListener('change', (event) => {
  state.hideZero = event.target.checked;
  refreshInventory();
});
$('holdings').tHead.addEventListener('click', (event) => {
  const th = event.target.closest('th[data-sort]');
  if (!th) return;
  const key = th.dataset.sort;
  if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  else {
    state.sortKey = key;
    state.sortDir = ['marketHashName', 'location'].includes(key) ? 'asc' : 'desc';
  }
  refreshInventory();
});
$('by-type').addEventListener('click', (event) => {
  const row = event.target.closest('.break-row[data-kind="type"]');
  if (!row) return;
  openInventory({ type: row.dataset.label, location: 'all', search: '', onlyUnpriced: false });
});
$('by-location').addEventListener('click', (event) => {
  const row = event.target.closest('.break-row[data-kind="location"]');
  if (!row) return;
  openInventory({ location: row.dataset.label, type: 'all', search: '', onlyUnpriced: false });
});
$('unpriced').addEventListener('click', (event) => {
  if (event.target.closest('a')) return;
  const row = event.target.closest('.break-row[data-kind="unpriced"]');
  if (!row) return;
  openInventory({ search: row.dataset.label, type: 'all', location: 'all' });
});
$('unpriced-count').addEventListener('click', () => {
  if (!state.snapshot?.summary.unpriced?.length) return;
  openInventory({ onlyUnpriced: true, search: '', type: 'all', location: 'all' });
});
$('holdings').addEventListener('click', (event) => {
  const button = event.target.closest('.btn-add-buy');
  if (!button) return;
  openBuyModal(decodeURIComponent(button.dataset.name));
});
$('holdings').addEventListener('change', async (event) => {
  const input = event.target.closest('.buy-input');
  if (!input) return;
  const name = decodeURIComponent(input.dataset.name);
  const buyPrice = Number(input.value);
  const res = await fetch('/api/holdings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marketHashName: name, buyPrice }),
  });
  applySnapshot(await res.json());
});
$('btn-sync').addEventListener('click', () => post('/api/sync-steam').catch((err) => alert(err.message)));
$('btn-prices').addEventListener('click', () => post('/api/refresh-prices').catch((err) => alert(err.message)));
$('btn-fill-buy').addEventListener('click', async () => {
  const ok = confirm(
    'Set buy price to the current CSFloat price for items still at $0.00?\n\nItems you already entered a buy price for will not be changed.',
  );
  if (!ok) return;
  try {
    const data = await post('/api/holdings/from-csfloat');
    applySnapshot(data);
    alert(`Updated ${data.updated ?? 0} item(s) to current CSFloat as buy price.`);
  } catch (err) {
    alert(err.message);
  }
});
$('btn-csv').addEventListener('click', exportCsv);
$('buy-qty').addEventListener('input', updateBuyPreview);
$('buy-price').addEventListener('input', updateBuyPreview);
$('buy-already').addEventListener('change', updateBuyPreview);
$('buy-cancel').addEventListener('click', closeBuyModal);
$('buy-modal').addEventListener('click', (event) => {
  if (event.target === $('buy-modal')) closeBuyModal();
});
$('buy-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!buyModalName) return;
  const quantity = Number($('buy-qty').value);
  const unitPrice = Number($('buy-price').value);
  try {
    const data = await post('/api/holdings/purchase', {
      marketHashName: buyModalName,
      quantity,
      unitPrice,
      alreadyInInventory: $('buy-already').checked,
    });
    closeBuyModal();
    applySnapshot(data);
  } catch (err) {
    alert(err.message);
  }
});
$('guard-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await post('/api/steam-guard', { code: $('guard-code').value });
    $('guard-code').value = '';
  } catch (err) {
    alert(err.message);
  }
});

const events = new EventSource('/api/events');
events.onmessage = (event) => applySnapshot(JSON.parse(event.data));
window.addEventListener('hashchange', () => {
  const page = pageFromHash();
  if (page === state.page) return;
  state.page = page;
  if (state.snapshot) render();
  else applyPage();
});
window.addEventListener('resize', () => {
  if (state.snapshot && state.page === 'dashboard') renderChart();
});
state.page = pageFromHash();
applyPage();
load().catch((err) => {
  $('banner').className = 'banner error';
  $('banner').textContent = err.message;
});
