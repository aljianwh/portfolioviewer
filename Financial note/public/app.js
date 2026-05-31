const state = {
  portfolio: null,
  quotes: new Map(),
  activeView: "overview",
  investmentFilter: "all",
  range: "all",
  trendKeys: ["netWorth"],
  search: "",
  showZero: false,
  quoteTimer: null,
  quoteRefreshMs: 5 * 60 * 1000,
  lastQuoteFetch: 0
};

const titles = { overview: "總覽", assets: "資產", investments: "投資", trends: "趨勢" };
const colors = {
  cash: "#1f7a5a",
  funds: "#3b6ea8",
  securities: "#b8832f",
  crypto: "#b94d63",
  realEstate: "#7564a8",
  sideCapital: "#667085",
  liabilities: "#a33b3b",
  netWorth: "#10231f"
};
const categoryMeta = [
  ["cash", "現金", "cash"],
  ["funds", "基金", "fund"],
  ["securities", "證券", "stock"],
  ["crypto", "加密貨幣", "crypto"],
  ["realEstate", "房屋資產", "realEstate"],
  ["sideCapital", "斜槓資本", "side"],
  ["liabilities", "負債", "liability"]
];

const trendSeriesMeta = [
  { key: "netWorth", label: "淨資產", color: colors.netWorth, width: 4 },
  { key: "cash", label: "現金", color: colors.cash, width: 3 },
  { key: "funds", label: "基金", color: colors.funds, width: 3 },
  { key: "securities", label: "證券", color: colors.securities, width: 3 },
  { key: "crypto", label: "加密貨幣", color: colors.crypto, width: 3 },
  { key: "netRealEstate", label: "房屋淨值", color: colors.realEstate, width: 3 },
  { key: "liabilities", label: "負債", color: colors.liabilities, width: 3 }
];

const tradingViewLogoSlugs = {
  TSLA: "tesla",
  RKLB: "rocket-lab",
  GOOGL: "alphabet",
  NVDA: "nvidia",
  AMZN: "amazon",
  ASTS: "ast-spacemobile",
  CRCL: "circle",
  GRAB: "grab",
  NVO: "novo-nordisk",
  UNCY: "unicycive-therapeutics",
  PL: "planet-labs",
  VTI: "vanguard",
  ITOT: "blackrock",
  QYLD: "global-x",
  SCHD: "schwab",
  TSLY: "yieldmax",
  "TPE:2330": "taiwan-semiconductor",
  "TPE:2002": "china-steel",
  "TPE:2301": "lite-on-technology",
  "TPE:2317": "hon-hai",
  "CURRENCY:BTC/USD": "crypto/XTVCBTC",
  "BTC-USD": "crypto/XTVCBTC"
};

const netWorthCategoryMeta = [
  ["cash", "現金", "cash"],
  ["funds", "基金", "fund"],
  ["securities", "證券", "stock"],
  ["crypto", "加密貨幣", "crypto"],
  ["netRealEstate", "房屋淨值", "realEstate"]
];

const twd = new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 4 });
const pct = new Intl.NumberFormat("zh-TW", { style: "percent", maximumFractionDigits: 2 });
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[char]);
}

function fmtMoney(value) {
  return twd.format(Number(value || 0));
}

function fmtNumber(value) {
  return number.format(Number(value || 0));
}

function classFor(value) {
  return Number(value || 0) >= 0 ? "gain" : "loss";
}

function fxToTwd(currency) {
  if (currency === "TWD") return 1;
  if (currency === "USD") return state.quotes.get("USDTWD=X")?.price || state.portfolio?.meta?.usdTwd || latestHistory()?.usdTwd || 31.5;
  if (currency === "HKD") return state.quotes.get("HKDTWD=X")?.price || 4.05;
  if (currency === "JPY") return state.quotes.get("JPYTWD=X")?.price || 0.21;
  return 1;
}

function latestHistory() {
  return state.portfolio?.history?.at(-1) || {};
}

function assetPrice(asset) {
  return state.quotes.get(asset.quoteSymbol)?.price ?? asset.lastPrice ?? 0;
}

function assetValue(asset) {
  return Number(asset.shares || 0) * Number(assetPrice(asset) || 0) * fxToTwd(asset.currency || "TWD");
}

function assetDayChange(asset) {
  const quote = state.quotes.get(asset.quoteSymbol);
  if (!quote || quote.change == null) return asset.dayChangeTwd || 0;
  return Number(asset.shares || 0) * Number(quote.change || 0) * fxToTwd(asset.currency || "TWD");
}

function assetUnitChange(asset) {
  const quote = state.quotes.get(asset.quoteSymbol);
  if (!quote || quote.change == null) {
    const shares = Number(asset.shares || 0);
    return shares ? Number(asset.dayChangeTwd || 0) / shares / fxToTwd(asset.currency || "TWD") : 0;
  }
  return Number(quote.change || 0);
}

function assetChangePct(asset) {
  const quote = state.quotes.get(asset.quoteSymbol);
  return quote?.changePct ?? asset.dayChangePct ?? 0;
}

function assetPreviousPrice(asset) {
  const quote = state.quotes.get(asset.quoteSymbol);
  return quote?.previousClose ?? (assetPrice(asset) - assetUnitChange(asset));
}

function currencyCode(asset) {
  return asset.currency || (asset.market === "TW" ? "TWD" : "USD");
}

function formatPriceByCurrency(value, currency) {
  const digits = currency === "JPY" || currency === "TWD" ? 2 : 2;
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: currency || "TWD",
    maximumFractionDigits: digits
  }).format(Number(value || 0));
}

function quoteDisplayName(asset) {
  if (asset.market === "TW") return asset.name || asset.symbol.replace("TPE:", "");
  if (asset.market === "US") return asset.symbol;
  return asset.name || asset.symbol;
}

function quoteSubName(asset) {
  if (asset.market === "TW") return asset.symbol.replace("TPE:", "");
  if (asset.market === "US") return asset.name || asset.quoteSymbol || "";
  return `${asset.market || asset.exchange || ""} ${asset.symbol}`;
}

function logoText(asset) {
  const source = asset.market === "TW" ? (asset.name || asset.symbol) : asset.symbol;
  const letters = String(source).replace(/^TPE:/, "").replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, "");
  return [...letters].slice(0, 2).join("").toUpperCase() || "?";
}

function logoColor(asset) {
  const palette = ["#10231f", "#1f7a5a", "#3b6ea8", "#b8832f", "#7564a8", "#b94d63"];
  const seed = [...String(asset.symbol)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[seed % palette.length];
}

function tradingViewLogoUrl(asset) {
  const slug = tradingViewLogoSlugs[asset.symbol] || tradingViewLogoSlugs[asset.quoteSymbol] || tradingViewLogoSlugs[String(asset.symbol || "").replace(/^TPE:/, "")];
  return slug ? `https://s3-symbol-logo.tradingview.com/${slug}.svg` : "";
}

function categoryValue(key) {
  const latest = latestHistory();
  return Number(latest[key] || 0);
}

function grossAssets() {
  const latest = latestHistory();
  return Number(latest.cash || 0) + Number(latest.funds || 0) + Number(latest.securities || 0) + Number(latest.crypto || 0) + Number(latest.realEstate || 0) + Number(latest.sideCapital || 0);
}

function netRealEstateValue() {
  const latest = latestHistory();
  return Math.max(Number(latest.realEstate || 0) - Number(latest.liabilities || 0), 0);
}

function netAllocationEntries() {
  const latest = latestHistory();
  return netWorthCategoryMeta
    .map(([key, label]) => ({
      key,
      label,
      value: key === "netRealEstate" ? netRealEstateValue() : Number(latest[key] || 0),
      color: colors[key === "netRealEstate" ? "realEstate" : key]
    }))
    .filter((item) => item.value > 0);
}

function accountCategoryEntries() {
  const accounts = state.portfolio.accounts || [];
  const totals = new Map();
  accounts.forEach((account) => {
    totals.set(account.group, (totals.get(account.group) || 0) + Math.abs(Number(account.valueTwd || 0)));
  });
  if (totals.has("房屋資產") && totals.has("負債")) {
    totals.set("房屋資產", Math.max((totals.get("房屋資產") || 0) - (totals.get("負債") || 0), 0));
    totals.delete("負債");
  }
  return [...totals.entries()]
    .map(([label, value], index) => ({
      key: label,
      label,
      value: Math.max(value, 0),
      color: Object.values(colors)[index % Object.values(colors).length]
    }))
    .filter((item) => item.value > 0);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error((await response.json()).error || "Request failed");
  return response.json();
}

async function loadPortfolio() {
  state.portfolio = await api("/api/portfolio");
  state.showZero = Boolean(state.portfolio.settings?.showZeroPositions);
  $("#showZero").checked = state.showZero;
  render();
}

function quoteIntervalMinutes() {
  return Math.max(1, Number(state.portfolio?.settings?.refreshMinutes || 5));
}

function quoteStatusText(prefix, time = null) {
  const suffix = `每 ${quoteIntervalMinutes()} 分鐘自動更新`;
  return time ? `${prefix} ${time} · ${suffix}` : `${prefix} · ${suffix}`;
}

async function refreshQuotes({ silent = false } = {}) {
  if (!state.portfolio) return;
  if (!silent) $("#quoteStatus").textContent = quoteStatusText("更新中...");
  const symbols = state.portfolio.assets
    .filter((asset) => asset.type !== "cash" && asset.quoteSymbol)
    .map((asset) => asset.quoteSymbol);
  try {
    const payload = await api(`/api/quotes?symbols=${encodeURIComponent([...new Set(symbols)].join(","))}`);
    state.quotes = new Map(payload.quotes.map((quote) => [quote.quoteSymbol, quote]));
    state.lastQuoteFetch = Date.now();
    const time = new Date(payload.fetchedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    $("#quoteStatus").textContent = payload.quotes.length ? quoteStatusText("已更新", time) : quoteStatusText("使用匯入價格");
  } catch (error) {
    $("#quoteStatus").textContent = quoteStatusText("報價暫不可用");
    console.warn(error);
  }
  render();
}

function startQuoteAutoRefresh() {
  state.quoteRefreshMs = quoteIntervalMinutes() * 60 * 1000;
  if (state.quoteTimer) clearInterval(state.quoteTimer);
  state.quoteTimer = setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine !== false) {
      refreshQuotes({ silent: true });
    }
  }, state.quoteRefreshMs);
  $("#quoteStatus").textContent = quoteStatusText("自動更新已啟用");
}

function refreshQuotesIfStale() {
  if (!state.lastQuoteFetch || Date.now() - state.lastQuoteFetch > Math.min(state.quoteRefreshMs, 60 * 1000)) {
    refreshQuotes({ silent: true });
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/service-worker.js").catch((error) => console.warn("Service worker registration failed", error));
}

function visibleInvestments() {
  const needle = state.search.toLowerCase();
  return state.portfolio.assets
    .filter((asset) => asset.isInvestment !== false)
    .filter((asset) => state.investmentFilter === "all" || asset.investmentType === state.investmentFilter || asset.type === state.investmentFilter)
    .filter((asset) => state.showZero || Number(asset.shares || 0) !== 0 || assetValue(asset) !== 0)
    .filter((asset) => `${asset.symbol} ${asset.name}`.toLowerCase().includes(needle))
    .sort((a, b) => assetValue(b) - assetValue(a));
}

function scopedHistory() {
  const rows = state.portfolio.history || [];
  if (state.range === "all") return rows;
  return rows.slice(-Number(state.range));
}

function renderOverview() {
  const latest = latestHistory();
  const investments = state.portfolio.assets.reduce((sum, asset) => sum + assetValue(asset), 0);
  $("#netWorthHero").textContent = fmtMoney(latest.netWorth);
  $("#monthLabel").textContent = latest.month || "--";
  $("#momBadge").textContent = `MoM ${pct.format(Number(latest.mom || 0))}`;
  $("#momBadge").className = `delta ${classFor(latest.mom)}`;
  $("#yoyBadge").textContent = `YoY ${pct.format(Number(latest.yoy || 0))}`;
  $("#yoyBadge").className = `delta ${classFor(latest.yoy)}`;
  $("#grossAssets").textContent = fmtMoney(latest.netWorth);
  $("#investmentAssets").textContent = fmtMoney(investments);
  $("#liabilities").textContent = fmtMoney(latest.liabilities);
  $("#monthlyIncome").textContent = fmtMoney(latest.income);
  $("#allocationTotal").textContent = fmtMoney(latest.netWorth);
  drawSparkline();
  drawAllocation();
  renderCategoryCards();
}

function renderCategoryCards() {
  const total = Number(latestHistory().netWorth || 0);
  $("#categoryCards").innerHTML = netAllocationEntries().map(({ key, label, value, color }) => {
    const share = total ? pct.format(value / total) : "";
    return `<div class="category-item">
      <span class="swatch" style="background:${color}"></span>
      <div><strong>${label}</strong><span>${share}</span></div>
      <strong>${fmtMoney(value)}</strong>
    </div>`;
  }).join("");
}

function renderAssets() {
  const accounts = state.portfolio.accounts || [];
  renderAssetCharts();
  renderLatestSnapshot();
  $("#accountsBody").innerHTML = accounts
    .slice()
    .sort((a, b) => String(a.group).localeCompare(String(b.group), "zh-Hant") || Number(b.valueTwd || 0) - Number(a.valueTwd || 0))
    .map((account) => accountCardHtml(account)).join("");
  requestAnimationFrame(drawAccountRecordCharts);
}

function accountCardHtml(account) {
  const records = (account.records || []).slice().sort((a, b) => String(b.month).localeCompare(String(a.month)));
  const latest = records[0] || { month: latestHistory().month, amount: account.amount, valueTwd: account.valueTwd };
  return `
    <article class="account-card" data-account-card="${escapeHtml(account.id)}">
      <div class="account-summary">
        <div><span class="subtle">分類</span><div>${escapeHtml(account.group)}</div></div>
        <div><span class="subtle">帳戶/資產</span><div class="symbol">${escapeHtml(account.name)}</div><div class="subtle">${escapeHtml(account.notes || "")}</div></div>
        <div><span class="subtle">幣別</span><div>${escapeHtml(account.currency)}</div></div>
        <div><span class="subtle">金額</span><div>${fmtNumber(account.amount)}</div></div>
        <div><span class="subtle">折合 TWD</span><div class="${account.type === "liability" ? "loss" : ""}">${fmtMoney(account.valueTwd)}</div></div>
        <div class="row-actions">
          <button title="展開記錄" data-toggle-account="${escapeHtml(account.id)}">⌄</button>
          <button title="編輯" data-edit-account="${escapeHtml(account.id)}">✎</button>
          <button title="刪除" data-delete-account="${escapeHtml(account.id)}">×</button>
        </div>
      </div>
      <div class="account-detail" hidden>
        <div>
          <form class="account-record-form" data-account-record-form="${escapeHtml(account.id)}">
            <input name="month" type="month" value="${escapeHtml(latest.month || "")}" required>
            <input name="amount" type="number" step="0.01" value="${Number(latest.amount || account.amount || 0)}" placeholder="原幣金額">
            <input name="valueTwd" type="number" step="1" value="${Number(latest.valueTwd || account.valueTwd || 0)}" placeholder="折合 TWD">
            <button class="primary-button">更新</button>
          </form>
          <canvas class="account-chart" data-account-chart="${escapeHtml(account.id)}" width="520" height="180"></canvas>
        </div>
        <div class="records-table">
          <table>
            <thead><tr><th>月份</th><th>金額</th><th>折合 TWD</th></tr></thead>
            <tbody>
              ${records.map((record) => `<tr><td>${escapeHtml(record.month)}</td><td>${fmtNumber(record.amount)}</td><td>${fmtMoney(record.valueTwd)}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </article>`;
}

function renderLatestSnapshot() {
  const latest = latestHistory();
  $("#latestSnapshotLabel").textContent = latest.month || "";
  const items = [
    ["淨資產", latest.netWorth],
    ["現金", latest.cash],
    ["基金", latest.funds],
    ["證券", latest.securities],
    ["加密貨幣", latest.crypto],
    ["房屋淨值", netRealEstateValue()],
    ["負債", latest.liabilities]
  ];
  $("#latestSnapshot").innerHTML = items.map(([label, value]) => `
    <div class="snapshot-item">
      <span>${label}</span>
      <strong class="${label === "負債" ? "loss" : ""}">${fmtMoney(value)}</strong>
    </div>`).join("");
}

function renderAssetCharts() {
  const categoryEntries = accountCategoryEntries();
  const categoryTotal = categoryEntries.reduce((sum, item) => sum + item.value, 0);
  $("#assetCategoryTotal").textContent = fmtMoney(categoryTotal);
  drawPieChart($("#assetCategoryChart"), categoryEntries, $("#assetCategoryLegend"), categoryTotal);

  const accounts = state.portfolio.accounts || [];
  const groups = [...new Set(accounts.map((account) => account.group))];
  const select = $("#accountPieGroup");
  const current = select.value || groups[0] || "";
  select.innerHTML = groups.map((group) => `<option ${group === current ? "selected" : ""}>${escapeHtml(group)}</option>`).join("");
  const selectedGroup = select.value || current;
  const accountEntries = accounts
    .filter((account) => account.group === selectedGroup)
    .map((account, index) => ({
      key: account.id,
      label: account.name,
      value: Math.abs(Number(account.valueTwd || 0)),
      color: Object.values(colors)[index % Object.values(colors).length]
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
  drawPieChart($("#accountChart"), accountEntries, $("#accountLegend"));
}

function drawAccountRecordCharts() {
  $$(".account-chart").forEach((canvas) => {
    const id = canvas.dataset.accountChart;
    const account = (state.portfolio.accounts || []).find((item) => item.id === id);
    if (!account) return;
    drawAccountLine(canvas, account.records || []);
  });
}

function renderInvestments() {
  const assets = visibleInvestments();
  const total = assets.reduce((sum, asset) => sum + assetValue(asset), 0);
  const portfolioAssets = state.portfolio.assets.filter((asset) => asset.isInvestment !== false && (Number(asset.shares || 0) !== 0 || state.showZero));
  const portfolioTotal = portfolioAssets.reduce((sum, asset) => sum + assetValue(asset), 0);
  const portfolioPrevious = portfolioAssets.reduce((sum, asset) => {
    return sum + Number(asset.shares || 0) * Number(assetPreviousPrice(asset) || 0) * fxToTwd(asset.currency || "TWD");
  }, 0);
  const dayChange = portfolioTotal - portfolioPrevious;
  const dayPct = portfolioPrevious ? dayChange / portfolioPrevious : 0;
  renderInvestmentChart(assets, total);
  $("#investmentCount").textContent = `${assets.length} 筆 / ${fmtMoney(total)}`;
  renderPortfolioQuoteSummary(portfolioTotal, dayChange, dayPct);
  $("#txAsset").innerHTML = state.portfolio.assets
    .filter((asset) => asset.isInvestment !== false)
    .map((asset) => `<option value="${escapeHtml(asset.id)}">${escapeHtml(asset.symbol)} ${escapeHtml(asset.name)}</option>`)
    .join("");
  $("#holdingsBody").innerHTML = assets.map((asset) => {
    const value = assetValue(asset);
    const pnl = value - Number(asset.costBasisTwd || 0);
    const unitChange = assetUnitChange(asset);
    const changePct = assetChangePct(asset);
    const changeClass = classFor(unitChange);
    const currency = currencyCode(asset);
    const logoUrl = tradingViewLogoUrl(asset);
    const quote = state.quotes.get(asset.quoteSymbol);
    return `
      <article class="quote-row">
        <div class="quote-main">
          <div class="quote-logo" style="background:${logoColor(asset)}">
            ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove(); this.parentElement.dataset.fallback='${escapeHtml(logoText(asset))}'">` : escapeHtml(logoText(asset))}
          </div>
          <div class="quote-title">
            <strong>${escapeHtml(quoteDisplayName(asset))}</strong>
            <span>${escapeHtml(quoteSubName(asset))} · ${escapeHtml(asset.market || asset.exchange || "")}</span>
          </div>
        </div>
        <div class="quote-cell"><strong>${escapeHtml(asset.assetClass || asset.investmentType || asset.type)}</strong><span>類型</span></div>
        <div class="quote-cell"><strong>${fmtNumber(asset.shares)}</strong><span>持有</span></div>
        <div class="quote-cell"><strong>${formatPriceByCurrency(assetPrice(asset), currency)}</strong><span>現價</span></div>
        <div class="quote-cell"><strong>${fmtMoney(value)}</strong><span>現值</span></div>
        <div class="quote-cell quote-change ${changeClass}">
          <strong>${unitChange >= 0 ? "+" : ""}${formatPriceByCurrency(unitChange, currency)}</strong>
          <span>${changePct >= 0 ? "+" : ""}${pct.format(changePct)}${quote?.marketTime ? ` · ${new Date(quote.marketTime).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
        </div>
        <div class="row-actions">
          <button title="編輯" data-edit-asset="${escapeHtml(asset.id)}">✎</button>
          <button title="刪除" data-delete-asset="${escapeHtml(asset.id)}">×</button>
        </div>
      </article>`;
  }).join("");
  renderTransactions();
}

function renderPortfolioQuoteSummary(total, dayChange, dayPct) {
  const changeClass = classFor(dayChange);
  $("#portfolioQuoteSummary").innerHTML = `
    <div class="quote-stat"><span>投資組合現值</span><strong>${fmtMoney(total)}</strong></div>
    <div class="quote-stat"><span>今日漲跌</span><strong class="${changeClass}">${dayChange >= 0 ? "+" : ""}${fmtMoney(dayChange)}</strong></div>
    <div class="quote-stat"><span>今日漲跌幅</span><strong class="${changeClass}">${dayPct >= 0 ? "+" : ""}${pct.format(dayPct)}</strong></div>
    <div class="quote-stat"><span>報價狀態</span><strong>${escapeHtml($("#quoteStatus").textContent.split("·")[0].trim() || "自動更新")}</strong></div>`;
}

function renderInvestmentChart(assets = visibleInvestments(), total = assets.reduce((sum, asset) => sum + assetValue(asset), 0)) {
  $("#investmentPieTotal").textContent = fmtMoney(total);
  const entries = assets.slice(0, 14).map((asset, index) => ({
    key: asset.id,
    label: asset.symbol,
    value: assetValue(asset),
    color: Object.values(colors)[index % Object.values(colors).length]
  })).filter((item) => item.value > 0);
  const other = assets.slice(14).reduce((sum, asset) => sum + assetValue(asset), 0);
  if (other > 0) entries.push({ key: "other", label: "其他", value: other, color: "#8a8175" });
  drawPieChart($("#investmentChart"), entries, $("#investmentLegend"), total);
}

function renderTransactions() {
  const assetById = new Map(state.portfolio.assets.map((asset) => [asset.id, asset]));
  $("#transactionsBody").innerHTML = state.portfolio.transactions
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 260)
    .map((tx) => {
      const asset = assetById.get(tx.assetId);
      return `
        <tr>
          <td>${escapeHtml(tx.date || "")}</td>
          <td>${escapeHtml(asset ? asset.symbol : tx.assetId)}</td>
          <td>${escapeHtml(tx.kind || "")}</td>
          <td>${fmtNumber(tx.shares)}</td>
          <td>${fmtNumber(tx.price)}</td>
          <td>${fmtMoney(tx.fee)}</td>
          <td>${fmtMoney(tx.cost)}</td>
        </tr>`;
    }).join("");
}

function renderTrends() {
  const rows = scopedHistory().slice().reverse();
  renderTrendOptions();
  $("#historyBody").innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.month)}</td>
      <td>${fmtMoney(row.netWorth)}</td>
      <td>${fmtMoney(row.cash)}</td>
      <td>${fmtMoney(row.funds)}</td>
      <td>${fmtMoney(row.securities)}</td>
      <td>${fmtMoney(row.crypto)}</td>
      <td>${fmtMoney(row.realEstate)}</td>
      <td class="loss">${fmtMoney(row.liabilities)}</td>
    </tr>`).join("");
  drawTrendChart();
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width || canvas.width));
  const height = Math.max(180, Math.floor(canvas.height / (canvas.width / width)));
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  return { ctx, width, height };
}

function drawSparkline() {
  const canvas = $("#sparklineChart");
  const { ctx, width, height } = setupCanvas(canvas);
  const rows = (state.portfolio.history || []).slice(-18);
  drawMultiLine(ctx, width, height, rows, [{ key: "netWorth", color: colors.netWorth, width: 4 }], false);
}

function drawTrendChart() {
  const canvas = $("#trendChart");
  const { ctx, width, height } = setupCanvas(canvas);
  const rows = scopedHistory().map((row) => ({
    ...row,
    netRealEstate: Math.max(Number(row.realEstate || 0) - Number(row.liabilities || 0), 0)
  }));
  const selected = state.trendKeys.length ? state.trendKeys : ["netWorth"];
  const series = trendSeriesMeta.filter((item) => selected.includes(item.key));
  drawMultiLine(ctx, width, height, rows, series, true);
}

function renderTrendOptions() {
  $("#trendOptions").innerHTML = trendSeriesMeta.map((item) => `
    <label class="trend-option">
      <input type="checkbox" value="${escapeHtml(item.key)}" ${state.trendKeys.includes(item.key) ? "checked" : ""}>
      <span class="swatch" style="background:${item.color}"></span>
      ${escapeHtml(item.label)}
    </label>`).join("");
}

function drawMultiLine(ctx, width, height, rows, series, withLegend) {
  ctx.clearRect(0, 0, width, height);
  const pad = { left: 54, right: 20, top: 24, bottom: 40 };
  const values = rows.flatMap((row) => series.map((item) => Number(row[item.key] || 0)));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const x = (index) => pad.left + (rows.length <= 1 ? 0 : index * (width - pad.left - pad.right) / (rows.length - 1));
  const y = (value) => pad.top + (max - value) * (height - pad.top - pad.bottom) / (max - min || 1);
  ctx.strokeStyle = "#ded8cd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 4; i += 1) {
    const yy = pad.top + i * (height - pad.top - pad.bottom) / 3;
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(width - pad.right, yy);
  }
  ctx.stroke();
  series.forEach((item) => {
    ctx.beginPath();
    rows.forEach((row, index) => {
      const xx = x(index);
      const yy = y(Number(row[item.key] || 0));
      if (index === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    });
    ctx.strokeStyle = item.color;
    ctx.lineWidth = item.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  });
  ctx.fillStyle = "#6f7a74";
  ctx.font = "12px Segoe UI";
  ctx.textAlign = "left";
  if (rows[0]) ctx.fillText(rows[0].month, pad.left, height - 14);
  if (rows.at(-1)) {
    ctx.textAlign = "right";
    ctx.fillText(rows.at(-1).month, width - pad.right, height - 14);
  }
  ctx.textAlign = "left";
  ctx.fillText(fmtMoney(max), 6, pad.top + 4);
  ctx.fillText(fmtMoney(min), 6, height - pad.bottom);
  if (withLegend) {
    let lx = pad.left;
    series.forEach((item) => {
      const label = item.label || (item.key === "netWorth" ? "淨資產" : categoryMeta.find(([key]) => key === item.key)?.[1] || item.key);
      ctx.fillStyle = item.color;
      ctx.fillRect(lx, 8, 10, 10);
      ctx.fillStyle = "#17211d";
      ctx.fillText(label, lx + 14, 18);
      lx += 82;
    });
  }
}

function drawAccountLine(canvas, records) {
  const rows = records
    .slice()
    .sort((a, b) => String(a.month).localeCompare(String(b.month)))
    .map((record) => ({ month: record.month, valueTwd: Number(record.valueTwd || 0) }));
  const { ctx, width, height } = setupCanvas(canvas);
  if (!rows.length) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#6f7a74";
    ctx.font = "13px Segoe UI";
    ctx.fillText("尚無歷史記錄", 12, 24);
    return;
  }
  drawMultiLine(ctx, width, height, rows, [{ key: "valueTwd", color: colors.netWorth, width: 3 }], false);
}

function drawAllocation() {
  drawPieChart($("#allocationChart"), netAllocationEntries(), $("#allocationLegend"), Number(latestHistory().netWorth || 0), "淨資產");
}

function drawPieChart(canvas, entries, legendEl, totalOverride = null, centerLabel = "配置") {
  const { ctx, width, height } = setupCanvas(canvas);
  const total = totalOverride ?? entries.reduce((sum, item) => sum + item.value, 0);
  const cx = width * 0.34;
  const cy = height * 0.5;
  const radius = Math.min(width, height) * 0.34;
  let start = -Math.PI / 2;
  ctx.clearRect(0, 0, width, height);
  entries.forEach((item) => {
    const angle = total ? item.value / total * Math.PI * 2 : 0;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = item.color;
    ctx.fill();
    start += angle;
  });
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.58, 0, Math.PI * 2);
  ctx.fillStyle = "#fffdfa";
  ctx.fill();
  ctx.fillStyle = "#17211d";
  ctx.font = "700 17px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText(centerLabel, cx, cy - 4);
  ctx.font = "12px Segoe UI";
  ctx.fillStyle = "#6f7a74";
  ctx.fillText(fmtMoney(total), cx, cy + 18);
  legendEl.innerHTML = entries.map((item) => `
    <div class="legend-row">
      <span class="swatch" style="background:${item.color}"></span>
      <span>${escapeHtml(item.label)}</span>
      <strong>${total ? pct.format(item.value / total) : "0%"}</strong>
    </div>`).join("");
}

function renderNavigation() {
  $("#pageTitle").textContent = titles[state.activeView];
  $$(".view").forEach((view) => view.classList.remove("active"));
  $(`#${state.activeView}View`).classList.add("active");
  $$(".nav").forEach((nav) => nav.classList.toggle("active", nav.dataset.view === state.activeView));
}

function renderSegments() {
  $$("[data-investment-filter]").forEach((button) => button.classList.toggle("active", button.dataset.investmentFilter === state.investmentFilter));
  $$("[data-range]").forEach((button) => button.classList.toggle("active", button.dataset.range === state.range));
}

function render() {
  if (!state.portfolio) return;
  renderNavigation();
  renderSegments();
  renderOverview();
  renderAssets();
  renderInvestments();
  renderTrends();
}

function openAssetDialog(asset = null) {
  $("#assetDialogTitle").textContent = asset ? "編輯投資" : "新增投資";
  $("#assetId").value = asset?.id || "";
  $("#assetType").value = asset?.investmentType || asset?.type || "stock";
  $("#assetMarket").value = asset?.market || asset?.exchange || "TW";
  $("#assetSymbol").value = asset?.symbol || "";
  $("#assetQuoteSymbol").value = asset?.quoteSymbol || "";
  $("#assetName").value = asset?.name || "";
  $("#assetCurrency").value = asset?.currency || marketCurrency($("#assetMarket").value);
  $("#assetShares").value = asset?.shares || 0;
  $("#assetAvgCost").value = asset?.avgCost || 0;
  $("#assetCostBasis").value = asset?.costBasisTwd || 0;
  $("#assetNotes").value = asset?.notes || "";
  $("#assetDialog").showModal();
}

function marketCurrency(market) {
  if (market === "TW") return "TWD";
  if (market === "HK") return "HKD";
  if (market === "JP") return "JPY";
  return "USD";
}

function quoteFromSymbol(symbol, market, type) {
  const code = symbol.replace(/^TPE:|^HK:|^JP:/i, "");
  if (type === "crypto" || market === "Crypto") return symbol.includes("-USD") ? symbol : "BTC-USD";
  if (market === "TW") return `${code}.TW`;
  if (market === "HK") return `${code.padStart(4, "0")}.HK`;
  if (market === "JP") return `${code}.T`;
  return code;
}

function assetFromForm() {
  const type = $("#assetType").value;
  const market = $("#assetMarket").value;
  const currency = $("#assetCurrency").value;
  const symbol = $("#assetSymbol").value.trim();
  const shares = Number($("#assetShares").value || 0);
  const avgCost = Number($("#assetAvgCost").value || 0);
  return {
    id: $("#assetId").value || undefined,
    symbol,
    quoteSymbol: $("#assetQuoteSymbol").value.trim() || quoteFromSymbol(symbol, market, type),
    name: $("#assetName").value.trim(),
    type: type === "crypto" ? "crypto" : "stock",
    investmentType: type,
    assetClass: type === "crypto" ? "加密貨幣" : type === "fund" ? "基金/ETF" : "股票",
    market,
    currency,
    shares,
    avgCost,
    costBasisTwd: Number($("#assetCostBasis").value || shares * avgCost * fxToTwd(currency)),
    notes: $("#assetNotes").value.trim()
  };
}

function openAccountDialog(account = null) {
  $("#accountDialogTitle").textContent = account ? "編輯資產" : "新增資產";
  $("#accountId").value = account?.id || "";
  $("#accountGroup").value = account?.group || "現金存款";
  $("#accountCurrency").value = account?.currency || "TWD";
  $("#accountName").value = account?.name || "";
  $("#accountAmount").value = account?.amount || 0;
  $("#accountValueTwd").value = account?.valueTwd || 0;
  $("#accountNotes").value = account?.notes || "";
  $("#accountDialog").showModal();
}

function accountType(group) {
  return {
    "現金存款": "cash",
    "基金": "fund",
    "證券": "stock",
    "加密貨幣": "crypto",
    "房屋資產": "realEstate",
    "股權": "equity",
    "斜槓資本": "side",
    "負債": "liability"
  }[group] || "cash";
}

function accountFromForm() {
  const group = $("#accountGroup").value;
  const currency = $("#accountCurrency").value;
  const amount = Number($("#accountAmount").value || 0);
  return {
    id: $("#accountId").value || undefined,
    group,
    type: accountType(group),
    name: $("#accountName").value.trim(),
    currency,
    amount,
    valueTwd: Number($("#accountValueTwd").value || amount * fxToTwd(currency)),
    notes: $("#accountNotes").value.trim()
  };
}

function wireEvents() {
  $("#refreshQuotes").addEventListener("click", () => refreshQuotes());
  $("#exportData").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.portfolio, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "portfolio-data.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  $$(".nav").forEach((nav) => nav.addEventListener("click", () => {
    state.activeView = nav.dataset.view;
    render();
  }));
  $$("[data-investment-filter]").forEach((button) => button.addEventListener("click", () => {
    state.investmentFilter = button.dataset.investmentFilter;
    render();
  }));
  $$("[data-range]").forEach((button) => button.addEventListener("click", () => {
    state.range = button.dataset.range;
    render();
  }));
  $("#trendOptions").addEventListener("change", () => {
    state.trendKeys = $$("#trendOptions input:checked").map((input) => input.value);
    if (!state.trendKeys.length) state.trendKeys = ["netWorth"];
    renderTrends();
  });

  $("#searchBox").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderInvestments();
  });
  $("#showZero").addEventListener("change", (event) => {
    state.showZero = event.target.checked;
    renderInvestments();
  });

  $("#addAsset").addEventListener("click", () => openAssetDialog());
  $("#addAccount").addEventListener("click", () => openAccountDialog());
  $("#addAccountSecondary").addEventListener("click", () => openAccountDialog());
  $("#syncWorkbook").addEventListener("click", async () => {
    const button = $("#syncWorkbook");
    button.disabled = true;
    button.textContent = "同步中...";
    try {
      const result = await api("/api/import-workbook", { method: "POST", body: "{}" });
      state.portfolio = result.portfolio;
      render();
      button.textContent = "已同步";
      setTimeout(() => { button.textContent = "從 Excel 同步"; }, 1400);
    } catch (error) {
      button.textContent = "同步失敗";
      console.warn(error);
      setTimeout(() => { button.textContent = "從 Excel 同步"; }, 1800);
    } finally {
      button.disabled = false;
    }
  });
  $("#accountPieGroup").addEventListener("change", renderAssetCharts);
  $("#cancelAsset").addEventListener("click", () => $("#assetDialog").close());
  $("#cancelAccount").addEventListener("click", () => $("#accountDialog").close());
  $("#assetMarket").addEventListener("change", () => {
    $("#assetCurrency").value = marketCurrency($("#assetMarket").value);
  });
  $("#assetSymbol").addEventListener("input", () => {
    if (!$("#assetQuoteSymbol").value.trim()) $("#assetQuoteSymbol").placeholder = quoteFromSymbol($("#assetSymbol").value.trim(), $("#assetMarket").value, $("#assetType").value);
  });

  $("#holdingsBody").addEventListener("click", async (event) => {
    const editId = event.target.closest("[data-edit-asset]")?.dataset.editAsset;
    const deleteId = event.target.closest("[data-delete-asset]")?.dataset.deleteAsset;
    if (editId) openAssetDialog(state.portfolio.assets.find((asset) => asset.id === editId));
    if (deleteId && confirm("確定刪除這個投資與相關買賣紀錄？")) {
      state.portfolio = await api(`/api/assets/${encodeURIComponent(deleteId)}`, { method: "DELETE" });
      render();
    }
  });

  $("#accountsBody").addEventListener("click", async (event) => {
    const toggleId = event.target.closest("[data-toggle-account]")?.dataset.toggleAccount;
    const editId = event.target.closest("[data-edit-account]")?.dataset.editAccount;
    const deleteId = event.target.closest("[data-delete-account]")?.dataset.deleteAccount;
    if (toggleId) {
      const card = event.target.closest("[data-account-card]");
      const detail = card?.querySelector(".account-detail");
      if (detail) {
        detail.hidden = !detail.hidden;
        if (!detail.hidden) requestAnimationFrame(drawAccountRecordCharts);
      }
      return;
    }
    if (editId) openAccountDialog(state.portfolio.accounts.find((account) => account.id === editId));
    if (deleteId && confirm("確定刪除這個分類資產？")) {
      state.portfolio = await api(`/api/accounts/${encodeURIComponent(deleteId)}`, { method: "DELETE" });
      render();
    }
  });

  $("#accountsBody").addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-account-record-form]");
    if (!form) return;
    event.preventDefault();
    const id = form.dataset.accountRecordForm;
    const data = new FormData(form);
    state.portfolio = await api(`/api/accounts/${encodeURIComponent(id)}/records`, {
      method: "POST",
      body: JSON.stringify({
        month: data.get("month"),
        amount: data.get("amount"),
        valueTwd: data.get("valueTwd")
      })
    });
    renderAssets();
    renderOverview();
  });

  $("#assetForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const asset = assetFromForm();
    const method = asset.id ? "PUT" : "POST";
    const url = asset.id ? `/api/assets/${encodeURIComponent(asset.id)}` : "/api/assets";
    state.portfolio = await api(url, { method, body: JSON.stringify(asset) });
    $("#assetDialog").close();
    render();
  });

  $("#accountForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const account = accountFromForm();
    const method = account.id ? "PUT" : "POST";
    const url = account.id ? `/api/accounts/${encodeURIComponent(account.id)}` : "/api/accounts";
    state.portfolio = await api(url, { method, body: JSON.stringify(account) });
    $("#accountDialog").close();
    render();
  });

  $("#transactionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const shares = Number($("#txShares").value || 0);
    const price = Number($("#txPrice").value || 0);
    const fee = Number($("#txFee").value || 0);
    state.portfolio = await api("/api/transactions", {
      method: "POST",
      body: JSON.stringify({
        assetId: $("#txAsset").value,
        date: $("#txDate").value,
        shares,
        price,
        fee,
        cost: shares * price + fee
      })
    });
    event.target.reset();
    render();
  });

  window.addEventListener("resize", () => {
    drawSparkline();
    drawAllocation();
    renderAssetCharts();
    renderInvestmentChart();
    drawTrendChart();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshQuotesIfStale();
  });
  window.addEventListener("focus", refreshQuotesIfStale);
  window.addEventListener("online", () => refreshQuotes({ silent: true }));
}

wireEvents();
registerServiceWorker();
await loadPortfolio();
startQuoteAutoRefresh();
await refreshQuotes();
