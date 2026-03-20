const express = require("express");
const db = require("../db");

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const { name, email, phone, address, vatNumber, contactPerson } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const out = await db.query(
      `INSERT INTO customers (company_id, name, email, phone, address, vat_number, contact_person)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [companyId, name, email || null, phone || null, address || null, vatNumber || null, contactPerson || null]
    );
    res.json({ customer: out.rows[0] });
  } catch (e) { next(e); }
});

router.get("/", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const search = req.query.search || null;
    let q = `SELECT * FROM customers WHERE company_id=$1`;
    const params = [companyId];
    if (search) {
      q += ` AND (name ILIKE $2 OR email ILIKE $2)`;
      params.push(`%${search}%`);
    }
    q += ` ORDER BY name`;
    const out = await db.query(q, params);
    res.json({ customers: out.rows });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const out = await db.query(
      `SELECT * FROM customers WHERE id=$1 AND company_id=$2`,
      [Number(req.params.id), companyId]
    );
    if (out.rowCount === 0) return res.status(404).json({ error: "Customer not found" });
    res.json({ customer: out.rows[0] });
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const { name, email, phone, address, vatNumber, contactPerson } = req.body;
    const out = await db.query(
      `UPDATE customers SET
         name=COALESCE($3,name), email=COALESCE($4,email), phone=COALESCE($5,phone),
         address=COALESCE($6,address), vat_number=COALESCE($7,vat_number),
         contact_person=COALESCE($8,contact_person)
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [Number(req.params.id), companyId, name, email, phone, address, vatNumber, contactPerson]
    );
    if (out.rowCount === 0) return res.status(404).json({ error: "Customer not found" });
    res.json({ customer: out.rows[0] });
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const out = await db.query(
      `DELETE FROM customers WHERE id=$1 AND company_id=$2 RETURNING id`,
      [Number(req.params.id), companyId]
    );
    if (out.rowCount === 0) return res.status(404).json({ error: "Customer not found" });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

module.exports = router;
