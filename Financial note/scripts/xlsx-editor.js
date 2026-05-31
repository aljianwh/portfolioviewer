import { readFile, writeFile } from "node:fs/promises";
import zlib from "node:zlib";

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date = new Date()) {
  return ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
}

function dosDate(date = new Date()) {
  return (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
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
    entries.set(name, method === 8 ? zlib.inflateRawSync(compressed) : Buffer.from(compressed));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function buildZip(entries) {
  const fileParts = [];
  const centralParts = [];
  let offset = 0;
  const now = new Date();
  for (const [name, data] of entries) {
    const nameBuffer = Buffer.from(name);
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime(now), 10);
    local.writeUInt16LE(dosDate(now), 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    fileParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime(now), 12);
    central.writeUInt16LE(dosDate(now), 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }
  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.size, 8);
  eocd.writeUInt16LE(entries.size, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...fileParts, central, eocd]);
}

function decodeXml(value = "") {
  return value.replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function columnName(col) {
  let name = "";
  while (col > 0) {
    const mod = (col - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    col = Math.floor((col - mod) / 26);
  }
  return name;
}

function columnToNumber(ref) {
  return [...(String(ref).match(/[A-Z]+/)?.[0] || "")].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function excelSerial(dateText) {
  const date = new Date(`${dateText || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round(date.getTime() / 86400000 + 25569);
}

function excelMonth(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Math.round((value - 25569) * 86400000));
    return date.toISOString().slice(0, 7);
  }
  return String(value || "").slice(0, 7);
}

function parseSharedStrings(entries) {
  const xml = entries.get("xl/sharedStrings.xml")?.toString("utf8") || "";
  const strings = [];
  for (const match of xml.matchAll(/<si\b[\s\S]*?<\/si>/g)) {
    strings.push([...match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((item) => decodeXml(item[1])).join(""));
  }
  return strings;
}

function sheetPaths(entries) {
  const workbook = entries.get("xl/workbook.xml")?.toString("utf8") || "";
  const rels = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") || "";
  const paths = new Map();
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = match[0];
    const name = decodeXml(tag.match(/name="([^"]+)"/)?.[1] || "");
    const relId = tag.match(/r:id="([^"]+)"/)?.[1];
    const relTag = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((item) => item[0]).find((item) => item.includes(`Id="${relId}"`));
    const target = relTag?.match(/Target="([^"]+)"/)?.[1];
    if (name && target) paths.set(name, `xl/${target.replace(/^\/?xl\//, "")}`);
  }
  return paths;
}

function symbolKeys(asset) {
  const values = new Set([asset?.symbol, asset?.quoteSymbol].filter(Boolean).map(String));
  for (const value of [...values]) {
    const twMatch = value.match(/^(?:TPE:)?(\d{4,6})(?:\.TW)?$/);
    if (twMatch) {
      values.add(twMatch[1]);
      values.add(`TPE:${twMatch[1]}`);
      values.add(`${twMatch[1]}.TW`);
    }
  }
  return values;
}

function isAssetSheet(sheetName, b2Value, keys) {
  const name = String(sheetName || "").trim();
  const b2 = String(b2Value || "").trim();
  if (keys.has(b2) || keys.has(name)) return true;
  return [...keys].some((key) => {
    const value = String(key);
    return value.length >= 2 && (name === value || name.startsWith(`${value} `));
  });
}

function parseCells(xml, sharedStrings) {
  const cells = new Map();
  for (const match of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = match[1];
    const body = match[2];
    const ref = attrs.match(/r="([^"]+)"/)?.[1];
    if (!ref) continue;
    const type = attrs.match(/t="([^"]+)"/)?.[1];
    const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "";
    if (type === "s") cells.set(ref, sharedStrings[Number(value)] || "");
    else cells.set(ref, Number.isFinite(Number(value)) && value !== "" ? Number(value) : decodeXml(value));
  }
  return cells;
}

function upsertCell(xml, ref, value) {
  const row = Number(ref.match(/\d+/)?.[0]);
  const col = columnToNumber(ref);
  const cellXml = `<c r="${ref}"><v>${value}</v></c>`;
  const cellPattern = new RegExp(`<c\\b[^>]*r="${escapeRegExp(ref)}"[^>]*>[\\s\\S]*?<\\/c>`);
  if (cellPattern.test(xml)) return xml.replace(cellPattern, cellXml);
  const rowPattern = new RegExp(`<row\\b[^>]*r="${row}"[^>]*>[\\s\\S]*?<\\/row>`);
  const rowMatch = xml.match(rowPattern);
  if (rowMatch) {
    const rowXml = rowMatch[0].replace("</row>", `${cellXml}</row>`);
    return xml.replace(rowPattern, rowXml);
  }
  return xml.replace("</sheetData>", `<row r="${row}">${cellXml}</row></sheetData>`);
}

function lastUsedTransactionRow(cells) {
  let row = 25;
  for (const ref of cells.keys()) {
    const match = ref.match(/^([J-N])(\d+)$/);
    if (match && Number(match[2]) >= 26) row = Math.max(row, Number(match[2]));
  }
  return row;
}

async function writeWorkbook(workbookPath, mutate) {
  const entries = readZipEntries(await readFile(workbookPath));
  await mutate(entries);
  await writeFile(workbookPath, buildZip(entries));
}

export async function writeAccountRecord(workbookPath, accountId, record) {
  await writeWorkbook(workbookPath, async (entries) => {
    const paths = sheetPaths(entries);
    const path = paths.get("資產表");
    if (!path) throw new Error("資產表 worksheet not found");
    const xml = entries.get(path).toString("utf8");
    const cells = parseCells(xml, parseSharedStrings(entries));
    const col = Number(String(accountId).match(/-(\d+)$/)?.[1]);
    if (!col) throw new Error("Account is not linked to an Excel column");
    let row = null;
    for (const [ref, value] of cells) {
      if (ref.startsWith("B") && excelMonth(value) === record.month) row = Number(ref.slice(1));
    }
    if (!row) throw new Error(`Month ${record.month} not found in 資產表`);
    entries.set(path, Buffer.from(upsertCell(xml, `${columnName(col)}${row}`, Number(record.amount || 0)), "utf8"));
  });
}

export async function appendTransactionRecord(workbookPath, asset, tx) {
  await writeWorkbook(workbookPath, async (entries) => {
    const sharedStrings = parseSharedStrings(entries);
    const paths = sheetPaths(entries);
    const keys = symbolKeys(asset);
    let targetPath = null;
    for (const [sheetName, path] of paths) {
      const xml = entries.get(path)?.toString("utf8") || "";
      const cells = parseCells(xml, sharedStrings);
      if (isAssetSheet(sheetName, cells.get("B2"), keys)) {
        targetPath = path;
        break;
      }
    }
    if (!targetPath) throw new Error(`No Excel sheet found for ${asset.symbol}`);
    let xml = entries.get(targetPath).toString("utf8");
    const row = lastUsedTransactionRow(parseCells(xml, sharedStrings)) + 1;
    const updates = {
      [`J${row}`]: excelSerial(tx.date),
      [`K${row}`]: Number(tx.shares || 0),
      [`L${row}`]: Number(tx.price || 0),
      [`M${row}`]: Number(tx.fee || 0),
      [`N${row}`]: Number(tx.cost || 0)
    };
    for (const [ref, value] of Object.entries(updates)) xml = upsertCell(xml, ref, value);
    entries.set(targetPath, Buffer.from(xml, "utf8"));
  });
}
