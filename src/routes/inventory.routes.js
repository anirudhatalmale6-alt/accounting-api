const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/movements", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const productId = req.query.productId ? Number(req.query.productId) : null;
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const limit = req.query.limit ? Number(req.query.limit) : 200;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const filters = [`company_id=$1`];
    const values = [companyId];
    let idx = values.length;

    if (productId) { idx++; filters.push(`product_id=$${idx}`); values.push(productId); }
    if (dateFrom) { idx++; filters.push(`created_at >= $${idx}`); values.push(dateFrom); }
    if (dateTo) { idx++; filters.push(`created_at <= $${idx}`); values.push(dateTo); }

    idx++; values.push(limit);
    idx++; values.push(offset);

    const q = `
      SELECT * FROM inventory_movements
      WHERE ${filters.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT $${idx - 1} OFFSET $${idx}
    `;

    const out = await db.query(q, values);
    res.json({ movements: out.rows });
  } catch (e) { next(e); }
});

router.get("/products/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const productId = Number(req.params.id);

    const p = await db.query(
      `SELECT * FROM products WHERE company_id=$1 AND id=$2`,
      [companyId, productId]
    );
    if (p.rowCount === 0) return res.status(404).json({ error: "Product not found" });

    res.json({ product: p.rows[0] });
  } catch (e) { next(e); }
});

module.exports = router;
