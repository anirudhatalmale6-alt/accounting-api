const db = require("../db");
const { readRowsFromFile, mapProductRow } = require("./import.service");

async function upsertProduct(client, companyId, p) {
  const q = `
    INSERT INTO products (company_id, sku, name, description, type,
      price, cost, vat_rate, stock_qty, barcode, category)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (company_id, sku)
    DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      type = EXCLUDED.type,
      price = EXCLUDED.price,
      cost = EXCLUDED.cost,
      vat_rate = EXCLUDED.vat_rate,
      stock_qty = EXCLUDED.stock_qty,
      barcode = EXCLUDED.barcode,
      category = EXCLUDED.category,
      updated_at = NOW()
    RETURNING id
  `;
  const vals = [
    companyId, p.sku, p.name, p.description, p.type,
    p.price, p.cost, p.vatRate, p.stockQty, p.barcode, p.category,
  ];
  const res = await client.query(q, vals);
  return res.rows[0].id;
}

async function importProductsFromFile({ companyId, filePath }) {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    const rawRows = readRowsFromFile(filePath);
    let imported = 0;
    let updated = 0;
    const errors = [];

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const p = mapProductRow(row);

      if (!p.sku || !p.name || !(p.price >= 0)) {
        errors.push({ row: i + 2, reason: "Missing sku/name or invalid price", data: row });
        continue;
      }

      const exists = await client.query(
        `SELECT id FROM products WHERE company_id=$1 AND sku=$2`,
        [companyId, p.sku]
      );

      await upsertProduct(client, companyId, p);

      if (exists.rowCount === 0) imported++;
      else updated++;
    }

    await client.query("COMMIT");
    return { imported, updated, errors: errors.length, errorRows: errors };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function listProducts(companyId) {
  const res = await db.query(
    `SELECT * FROM products WHERE company_id=$1 ORDER BY name`,
    [companyId]
  );
  return res.rows;
}

module.exports = { importProductsFromFile, listProducts };
