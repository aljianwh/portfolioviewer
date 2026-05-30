import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importWorkbookData } from "./scripts/xlsx-importer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, "data", "portfolio-data.json");
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 4173);
const workbookPath = path.join(__dirname, "Financial Portfolio .xlsx");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

async function readPortfolio() {
  return JSON.parse(await readFile(dataPath, "utf8"));
}

async function savePortfolio(data) {
  data.meta = data.meta || {};
  data.meta.updatedAt = new Date().toISOString();
  await writeFile(dataPath, JSON.stringify(data, null, 2), "utf8");
  return data;
}

async function importWorkbook() {
  return importWorkbookData(workbookPath, dataPath);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function normalizeAsset(input) {
  const symbol = String(input.symbol || "").trim();
  if (!symbol) throw new Error("Symbol is required");
  const id = input.id || symbol.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const market = input.market || input.exchange || "";
  const isTaiwan = symbol.startsWith("TPE:") || market === "TW";
  const isHongKong = symbol.startsWith("HK:") || market === "HK";
  const isJapan = symbol.startsWith("JP:") || market === "JP";
  const isCrypto = input.type === "crypto" || input.investmentType === "crypto" || /BTC|ETH|CRYPTO|CURRENCY:/i.test(symbol);
  const code = symbol.replace(/^TPE:|^HK:|^JP:/i, "");
  const quoteSymbol = input.quoteSymbol
    || (isTaiwan ? `${code}.TW` : isHongKong ? `${code.padStart(4, "0")}.HK` : isJapan ? `${code}.T` : isCrypto ? "BTC-USD" : symbol);
  const currency = input.currency || (isTaiwan ? "TWD" : isHongKong ? "HKD" : isJapan ? "JPY" : "USD");
  return {
    id,
    symbol,
    quoteSymbol,
    exchange: input.exchange || (isTaiwan ? "TW" : isHongKong ? "HK" : isJapan ? "JP" : isCrypto ? "Crypto" : "US"),
    name: input.name || symbol,
    type: isCrypto ? "crypto" : (input.type || "stock"),
    investmentType: input.investmentType || (isCrypto ? "crypto" : input.type === "fund" ? "fund" : "stock"),
    assetClass: input.assetClass || (isCrypto ? "加密貨幣" : input.type === "fund" ? "基金/ETF" : "股票"),
    market: input.market || (isTaiwan ? "TW" : isHongKong ? "HK" : isJapan ? "JP" : isCrypto ? "Crypto" : "US"),
    group: "投資",
    isInvestment: true,
    currency,
    shares: Number(input.shares || 0),
    avgCost: Number(input.avgCost || 0),
    costBasisTwd: Number(input.costBasisTwd || 0),
    lastPrice: Number(input.lastPrice || 0),
    dayChangeTwd: Number(input.dayChangeTwd || 0),
    dayChangePct: Number(input.dayChangePct || 0),
    marketValueTwd: Number(input.marketValueTwd || 0),
    weight: Number(input.weight || 0),
    notes: input.notes || ""
  };
}

function normalizeAccount(input) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Account name is required");
  const id = input.id || name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-").replace(/^-|-$/g, "");
  return {
    id,
    group: input.group || "現金存款",
    type: input.type || "cash",
    name,
    currency: input.currency || "TWD",
    amount: Number(input.amount || 0),
    valueTwd: Number(input.valueTwd || input.amount || 0),
    notes: input.notes || "",
    records: Array.isArray(input.records) ? input.records : []
  };
}

function normalizeAccountRecord(input) {
  const month = String(input.month || new Date().toISOString().slice(0, 7)).slice(0, 7);
  return {
    date: input.date || `${month}-01`,
    month,
    amount: Number(input.amount || 0),
    valueTwd: Number(input.valueTwd || input.amount || 0),
    note: input.note || ""
  };
}

function normalizeHistory(input, existingHistory = []) {
  const month = String(input.month || new Date().toISOString().slice(0, 7)).slice(0, 7);
  const row = {
    date: input.date || `${month}-01`,
    month,
    salary: Number(input.salary || 0),
    passiveIncome: Number(input.passiveIncome || 0),
    income: Number(input.income || Number(input.salary || 0) + Number(input.passiveIncome || 0)),
    cash: Number(input.cash || 0),
    funds: Number(input.funds || 0),
    securities: Number(input.securities || 0),
    crypto: Number(input.crypto || 0),
    sideCapital: Number(input.sideCapital || 0),
    realEstate: Number(input.realEstate || 0),
    privateEquity: Number(input.privateEquity || 0),
    liabilities: Number(input.liabilities || 0),
    loanDelta: Number(input.loanDelta || 0),
    usdTwd: Number(input.usdTwd || 0)
  };
  row.netWorth = Number(input.netWorth || (row.cash + row.funds + row.securities + row.crypto + row.realEstate - row.liabilities));
  const comparable = existingHistory
    .filter((item) => item.month !== month)
    .concat(row)
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));
  const index = comparable.findIndex((item) => item.month === month);
  const prev = comparable[index - 1];
  const lastYear = comparable.find((item) => item.month === `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`);
  row.mom = prev?.netWorth ? (row.netWorth - Number(prev.netWorth)) / Number(prev.netWorth) : 0;
  row.yoy = lastYear?.netWorth ? (row.netWorth - Number(lastYear.netWorth)) / Number(lastYear.netWorth) : 0;
  return row;
}

async function fetchYahooQuotes(symbols) {
  if (!symbols.length) return [];
  const results = await Promise.all(symbols.map(async (symbol) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!response.ok) throw new Error(`Quote provider returned ${response.status}`);
    const json = await response.json();
    const meta = json.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice ?? meta.previousClose ?? null;
    const previous = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const change = price != null && previous != null ? price - previous : null;
    return {
      quoteSymbol: meta.symbol || symbol,
      price,
      change,
      changePct: change != null && previous ? change / previous : null,
      currency: meta.currency || "",
      marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
      provider: "Yahoo Finance Chart"
    };
  }));
  return results.filter(Boolean);
}

async function handleApi(req, res, url) {
  const portfolio = await readPortfolio();

  if (url.pathname === "/api/portfolio" && req.method === "GET") {
    sendJson(res, 200, portfolio);
    return;
  }

  if (url.pathname === "/api/portfolio" && req.method === "PUT") {
    sendJson(res, 200, await savePortfolio(await readBody(req)));
    return;
  }

  if (url.pathname === "/api/import-workbook" && req.method === "POST") {
    const result = await importWorkbook();
    sendJson(res, 200, { ...result, portfolio: await readPortfolio() });
    return;
  }

  if (url.pathname === "/api/assets" && req.method === "POST") {
    const asset = normalizeAsset(await readBody(req));
    portfolio.assets = portfolio.assets.filter((item) => item.id !== asset.id);
    portfolio.assets.push(asset);
    sendJson(res, 200, await savePortfolio(portfolio));
    return;
  }

  if (url.pathname === "/api/accounts" && req.method === "POST") {
    const account = normalizeAccount(await readBody(req));
    portfolio.accounts = (portfolio.accounts || []).filter((item) => item.id !== account.id);
    portfolio.accounts.push(account);
    sendJson(res, 200, await savePortfolio(portfolio));
    return;
  }

  const accountMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)$/);
  if (accountMatch && req.method === "PUT") {
    const id = decodeURIComponent(accountMatch[1]);
    const previous = (portfolio.accounts || []).find((item) => item.id === id);
    const account = normalizeAccount({ ...(await readBody(req)), id, records: previous?.records || [] });
    portfolio.accounts = (portfolio.accounts || []).map((item) => (item.id === id ? account : item));
    sendJson(res, 200, await savePortfolio(portfolio));
    return;
  }

  if (accountMatch && req.method === "DELETE") {
    const id = decodeURIComponent(accountMatch[1]);
    portfolio.accounts = (portfolio.accounts || []).filter((item) => item.id !== id);
    sendJson(res, 200, await savePortfolio(portfolio));
    return;
  }

  const accountRecordMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)\/records$/);
  if (accountRecordMatch && req.method === "POST") {
    const id = decodeURIComponent(accountRecordMatch[1]);
    const record = normalizeAccountRecord(await readBody(req));
    let found = false;
    portfolio.accounts = (portfolio.accounts || []).map((item) => {
      if (item.id !== id) return item;
      found = true;
      const records = Array.isArray(item.records) ? item.records.filter((entry) => entry.month !== record.month) : [];
      records.push(record);
      records.sort((a, b) => String(a.month).localeCompare(String(b.month)));
      return { ...item, amount: record.amount, valueTwd: record.valueTwd, records };
    });
    if (!found) throw new Error("Account not found");
    sendJson(res, 200, await savePortfolio(portfolio));
    return;
  }

  if (url.pathname === "/api/history" && req.method === "POST") {
    const row = normalizeHistory(await readBody(req), portfolio.history || []);
    portfolio.history = (portfolio.history || []).filter((item) => item.month !== row.month);
    portfolio.history.push(row);
    portfolio.history.sort((a, b) => String(a.month).localeCompare(String(b.month)));
    sendJson(res, 200, await savePortfolio(portfolio));
    return;
  }

  const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
  if (assetMatch && req.method === "PUT") {
    const id = decodeURIComponent(assetMatch[1]);
    const asset = normalizeAsset({ ...(await readBody(req)), id });
    portfolio.assets = portfolio.assets.map((item) => (item.id === id ? asset : item));
    sendJson(res, 200, await savePortfolio(portfolio));
    return;
  }

  if (assetMatch && req.method === "DELETE") {
    const id = decodeURIComponent(assetMatch[1]);
    portfolio.assets = portfolio.assets.filter((item) => item.id !== id);
    portfolio.transactions = portfolio.transactions.filter((item) => item.assetId !== id);
    sendJson(res, 200, await savePortfolio(portfolio));
    return;
  }

  if (url.pathname === "/api/transactions" && req.method === "POST") {
    const input = await readBody(req);
    const asset = (portfolio.assets || []).find((item) => item.id === input.assetId);
    const shares = Number(input.shares || 0);
    portfolio.transactions.push({
      id: input.id || `tx-${Date.now()}`,
      assetId: input.assetId,
      date: input.date || new Date().toISOString().slice(0, 10),
      shares,
      price: Number(input.price || 0),
      fee: Number(input.fee || 0),
      cost: Number(input.cost || 0),
      kind: input.kind || (shares >= 0 ? "buy" : "sell"),
      investmentType: asset?.investmentType || asset?.type || "stock"
    });
    sendJson(res, 200, await savePortfolio(portfolio));
    return;
  }

  if (url.pathname === "/api/quotes" && req.method === "GET") {
    const symbols = (url.searchParams.get("symbols") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const withFx = [...new Set([...symbols, "USDTWD=X", "HKDTWD=X", "JPYTWD=X"])];
    try {
      sendJson(res, 200, { quotes: await fetchYahooQuotes(withFx), fetchedAt: new Date().toISOString() });
    } catch (error) {
      sendJson(res, 200, { quotes: [], fetchedAt: new Date().toISOString(), warning: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Portfolio app running at http://localhost:${port}`);
});
