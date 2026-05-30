import { readFile, writeFile } from "node:fs/promises";
import zlib from "node:zlib";

const SHEET_NAME = "資產表";

function decodeXml(value = "") {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function columnToNumber(ref) {
  const letters = String(ref).match(/[A-Z]+/)?.[0] || "";
  return [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
}

function excelDate(serial) {
  if (!Number.isFinite(serial)) return "";
  const date = new Date(Date.UTC(1899, 11, 30 + Math.floor(serial)));
  return date.toISOString().slice(0, 10);
}

function clean(value) {
  if (value == null || value === "" || value === "-") return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function readZipEntries(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Invalid xlsx file");
  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < total; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid central directory");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(start, start + compressedSize);
    const data = method === 8 ? zlib.inflateRawSync(compressed) : compressed;
    entries.set(name, data.toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function parseSharedStrings(xml = "") {
  const strings = [];
  for (const match of xml.matchAll(/<si\b[\s\S]*?<\/si>/g)) {
    const text = [...match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((item) => decodeXml(item[1])).join("");
    strings.push(text);
  }
  return strings;
}

function sheetPath(entries) {
  const workbook = entries.get("xl/workbook.xml") || "";
  const rels = entries.get("xl/_rels/workbook.xml.rels") || "";
  const sheetMatch = [...workbook.matchAll(/<sheet\b[^>]*>/g)]
    .map((item) => item[0])
    .find((tag) => decodeXml(tag.match(/name="([^"]+)"/)?.[1] || "") === SHEET_NAME);
  if (!sheetMatch) return "xl/worksheets/sheet1.xml";
  const relId = sheetMatch.match(/r:id="([^"]+)"/)?.[1];
  const relMatch = [...rels.matchAll(/<Relationship\b[^>]*>/g)]
    .map((item) => item[0])
    .find((tag) => tag.includes(`Id="${relId}"`));
  const target = relMatch?.match(/Target="([^"]+)"/)?.[1] || "worksheets/sheet1.xml";
  return `xl/${target.replace(/^\/?xl\//, "")}`;
}

function parseSheet(xml, sharedStrings) {
  const cells = new Map();
  for (const match of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = match[1];
    const body = match[2];
    const ref = attrs.match(/r="([^"]+)"/)?.[1];
    if (!ref) continue;
    const type = attrs.match(/t="([^"]+)"/)?.[1];
    const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
    const inlineMatch = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
    let value = "";
    if (type === "s") value = sharedStrings[Number(valueMatch?.[1] || 0)] || "";
    else if (type === "inlineStr") value = decodeXml(inlineMatch?.[1] || "");
    else value = decodeXml(valueMatch?.[1] || "");
    const row = Number(ref.match(/\d+/)?.[0]);
    const col = columnToNumber(ref);
    const numeric = Number(value);
    cells.set(`${row}:${col}`, Number.isFinite(numeric) && value !== "" ? numeric : value);
  }
  return (row, col) => cells.get(`${row}:${col}`);
}

function buildHistory(get, lastRow) {
  const rows = [];
  for (let row = 20; row <= lastRow; row += 1) {
    const monthSerial = get(row, 2);
    if (!monthSerial) continue;
    const monthDate = excelDate(Number(monthSerial));
    rows.push({
      date: excelDate(Number(get(row, 1))),
      month: monthDate.slice(0, 7),
      salary: clean(get(row, 3)),
      passiveIncome: clean(get(row, 4)),
      income: clean(get(row, 5)),
      netWorth: clean(get(row, 6)),
      mom: clean(get(row, 7)),
      yoy: clean(get(row, 8)),
      cash: clean(get(row, 17)),
      funds: clean(get(row, 22)),
      securities: clean(get(row, 30)),
      crypto: clean(get(row, 35)),
      sideCapital: clean(get(row, 39)),
      realEstate: clean(get(row, 40)),
      privateEquity: clean(get(row, 44)),
      liabilities: clean(get(row, 48)),
      loanDelta: clean(get(row, 49)),
      usdTwd: clean(get(row, 45))
    });
  }
  return rows;
}

function updateAccountRecords(get, data, lastRow) {
  const latestMonth = excelDate(Number(get(lastRow, 2))).slice(0, 7);
  let accounts = 0;
  let records = 0;
  for (const account of data.accounts || []) {
    const match = String(account.id || "").match(/-(\d+)$/);
    if (!match) {
      account.records ||= [];
      continue;
    }
    const col = Number(match[1]);
    const nextRecords = [];
    for (let row = 20; row <= lastRow; row += 1) {
      const monthDate = excelDate(Number(get(row, 2)));
      if (!monthDate) continue;
      const amount = clean(get(row, col));
      const usdTwd = clean(get(row, 45)) || data.meta?.usdTwd || 31.5;
      const valueTwd = account.currency === "TWD" || account.type === "liability" ? amount : amount * usdTwd;
      nextRecords.push({
        date: excelDate(Number(get(row, 1))) || `${monthDate.slice(0, 7)}-01`,
        month: monthDate.slice(0, 7),
        amount,
        valueTwd
      });
    }
    account.records = nextRecords;
    const latest = [...nextRecords].reverse().find((item) => item.month === latestMonth) || nextRecords.at(-1);
    if (latest) {
      account.amount = latest.amount;
      account.valueTwd = latest.valueTwd;
    }
    accounts += 1;
    records += nextRecords.length;
  }
  return { accounts, records };
}

export async function importWorkbookData(workbookPath, dataPath) {
  const [workbookBuffer, dataText] = await Promise.all([readFile(workbookPath), readFile(dataPath, "utf8")]);
  const entries = readZipEntries(workbookBuffer);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml"));
  const xml = entries.get(sheetPath(entries));
  if (!xml) throw new Error(`${SHEET_NAME} worksheet not found`);
  const get = parseSheet(xml, sharedStrings);
  let lastRow = 20;
  for (let row = 20; row < 500; row += 1) {
    if (get(row, 2)) lastRow = row;
  }
  const data = JSON.parse(dataText);
  data.history = buildHistory(get, lastRow);
  const result = updateAccountRecords(get, data, lastRow);
  data.meta ||= {};
  data.meta.assetTableImportedAt = new Date().toISOString();
  await writeFile(dataPath, JSON.stringify(data, null, 2), "utf8");
  return { ok: true, history: data.history.length, ...result, importedAt: data.meta.assetTableImportedAt };
}
