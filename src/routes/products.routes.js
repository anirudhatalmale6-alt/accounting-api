const express = require("express");
const db = require("../db");
const { upload } = require("../middleware/upload");
const { importProductsFromFile, listProducts } = require("../services/products.service");
const router = express.Router();

// List products
router.get("/", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const search = req.query.search || null;
    const category = req.query.category || null;
    const type = req.query.type || null;

    let q = `SELECT * FROM products WHERE company_id=$1`;
    const params = [companyId];
    let idx = 2;

    if (search) {
      q += ` AND (name ILIKE $${idx} OR sku ILIKE $${idx} OR description ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    if (category) {
      q += ` AND category=$${idx}`;
      params.push(category);
      idx++;
    }
    if (type) {
      q += ` AND type=$${idx}`;
      params.push(type);
      idx++;
    }
    q += ` ORDER BY name`;

    const out = await db.query(q, params);
    res.json({ products: out.rows });
  } catch (e) { next(e); }
});

// Get single product
router.get("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const id = Number(req.params.id);
    const out = await db.query(`SELECT * FROM products WHERE company_id=$1 AND id=$2`, [companyId, id]);
    if (out.rowCount === 0) return res.status(404).json({ error: "Product not found" });
    res.json({ product: out.rows[0] });
  } catch (e) { next(e); }
});

// Create product
router.post("/", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const { name, sku, description, type, price, cost, vatRate, stockQty, trackInventory, barcode, category } = req.body;

    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const out = await db.query(
      `INSERT INTO products (company_id, name, sku, description, type, price, cost, vat_rate, stock_qty, track_inventory, barcode, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        companyId,
        name,
        sku || null,
        description || null,
        type || 'inventory',
        price || 0,
        cost || 0,
        vatRate != null ? vatRate : 20,
        stockQty || 0,
        trackInventory != null ? trackInventory : true,
        barcode || null,
        category || null,
      ]
    );
    res.json({ product: out.rows[0] });
  } catch (e) {
    if (String(e.message).includes("products_company_id_sku")) {
      return res.status(409).json({ error: "A product with this SKU already exists" });
    }
    next(e);
  }
});

// Update product
router.put("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const id = Number(req.params.id);
    const { name, sku, description, type, price, cost, vatRate, stockQty, trackInventory, barcode, category } = req.body;

    const out = await db.query(
      `UPDATE products SET
         name=COALESCE($3,name), sku=COALESCE($4,sku), description=COALESCE($5,description),
         type=COALESCE($6,type), price=COALESCE($7,price), cost=COALESCE($8,cost),
         vat_rate=COALESCE($9,vat_rate), stock_qty=COALESCE($10,stock_qty),
         track_inventory=COALESCE($11,track_inventory), barcode=COALESCE($12,barcode),
         category=COALESCE($13,category), updated_at=NOW()
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [id, companyId, name, sku, description, type, price, cost, vatRate, stockQty, trackInventory, barcode, category]
    );
    if (out.rowCount === 0) return res.status(404).json({ error: "Product not found" });
    res.json({ product: out.rows[0] });
  } catch (e) {
    if (String(e.message).includes("products_company_id_sku")) {
      return res.status(409).json({ error: "A product with this SKU already exists" });
    }
    next(e);
  }
});

// Get stock movements for a product
router.get("/:id/stock-movements", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const productId = Number(req.params.id);
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const limit = req.query.limit ? Number(req.query.limit) : 200;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    // Verify product exists
    const product = await db.query(
      `SELECT id, name, sku, stock_qty FROM products WHERE company_id=$1 AND id=$2`,
      [companyId, productId]
    );
    if (product.rowCount === 0) return res.status(404).json({ error: "Product not found" });

    let q = `SELECT * FROM inventory_movements WHERE company_id=$1 AND product_id=$2`;
    const params = [companyId, productId];
    let idx = 3;

    if (dateFrom) {
      q += ` AND created_at >= $${idx}`;
      params.push(dateFrom);
      idx++;
    }
    if (dateTo) {
      q += ` AND created_at <= $${idx}`;
      params.push(dateTo);
      idx++;
    }

    q += ` ORDER BY created_at DESC, id DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const movements = await db.query(q, params);

    res.json({
      product: product.rows[0],
      movements: movements.rows,
    });
  } catch (e) { next(e); }
});

// Add manual stock adjustment for a product
router.post("/:id/stock-movements", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const productId = Number(req.params.id);
    const { quantityChange, reason, note } = req.body;

    if (quantityChange == null || quantityChange === 0) {
      return res.status(400).json({ error: "quantityChange is required and cannot be zero" });
    }

    const product = await db.query(
      `SELECT id, name, stock_qty FROM products WHERE company_id=$1 AND id=$2`,
      [companyId, productId]
    );
    if (product.rowCount === 0) return res.status(404).json({ error: "Product not found" });

    const currentQty = product.rows[0].stock_qty;
    const newQty = currentQty + Number(quantityChange);

    if (newQty < 0) {
      return res.status(400).json({ error: `Insufficient stock. Current: ${currentQty}, adjustment: ${quantityChange}` });
    }

    await db.query(
      `UPDATE products SET stock_qty=$1, updated_at=NOW() WHERE id=$2`,
      [newQty, productId]
    );

    const movement = await db.query(
      `INSERT INTO inventory_movements (company_id, product_id, movement_type, qty_change, reference_type, note)
       VALUES ($1, $2, $3, $4, 'MANUAL', $5)
       RETURNING *`,
      [companyId, productId, reason || 'ADJUSTMENT', Number(quantityChange), note || null]
    );

    res.json({
      movement: movement.rows[0],
      previousQty: currentQty,
      newQty,
    });
  } catch (e) { next(e); }
});

// Delete product
router.delete("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const id = Number(req.params.id);
    const out = await db.query(
      `DELETE FROM products WHERE id=$1 AND company_id=$2 RETURNING id`,
      [id, companyId]
    );
    if (out.rowCount === 0) return res.status(404).json({ error: "Product not found" });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

// Import products from CSV/Excel
router.post("/import", upload.single("file"), async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    if (!req.file) {
      const err = new Error("No file uploaded");
      err.status = 400;
      throw err;
    }
    const result = await importProductsFromFile({ companyId, filePath: req.file.path });
    res.json(result);
  } catch (e) { next(e); }
});

module.exports = router;
