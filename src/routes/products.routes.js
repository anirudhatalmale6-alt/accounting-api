const express = require("express");
const db = require("../db");
const { upload } = require("../middleware/upload");
const { importProductsFromFile, listProducts } = require("../services/products.service");
const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const products = await listProducts(companyId);
    res.json({ products });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const id = Number(req.params.id);
    const out = await db.query(`SELECT * FROM products WHERE company_id=$1 AND id=$2`, [companyId, id]);
    if (out.rowCount === 0) return res.status(404).json({ error: "Product not found" });
    res.json({ product: out.rows[0] });
  } catch (e) { next(e); }
});

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
