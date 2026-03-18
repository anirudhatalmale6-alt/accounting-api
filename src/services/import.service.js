const xlsx = require("xlsx");
const { parse } = require("csv-parse/sync");
const path = require("path");
const fs = require("fs");

function normalizeNumber(v, def = 0) {
  if (v === null || v === undefined || v === "") return def;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : def;
}

function normalizeInt(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function readRowsFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".csv") {
    const content = fs.readFileSync(filePath, "utf8");
    const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true });
    return rows;
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const wb = xlsx.readFile(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
    return rows;
  }

  const err = new Error("Unsupported file type. Use CSV/XLSX.");
  err.status = 400;
  throw err;
}

function mapProductRow(row) {
  const sku = row.sku || row.SKU || row.Sku;
  const name = row.name || row.Name;
  const description = row.description || row.Description || "";
  const price = normalizeNumber(row.price ?? row.Price, 0);
  const cost = normalizeNumber(row.cost ?? row.Cost, 0);
  const vatRate = normalizeNumber(row.vatRate ?? row.VatRate ?? row.vat ?? row.VAT, 20);
  const stockQty = normalizeInt(row.stockQty ?? row.StockQty ?? row.qty ?? row.Qty, 0);
  const barcode = row.barcode || row.Barcode || null;
  const category = row.category || row.Category || null;
  const type = (row.type || row.Type || "inventory").toString().toLowerCase() === "service"
    ? "service"
    : "inventory";

  return { sku, name, description, price, cost, vatRate, stockQty, barcode, category, type };
}

module.exports = { readRowsFromFile, mapProductRow };
