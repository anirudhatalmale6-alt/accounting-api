const express = require("express");
const db = require("../db");

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const { name, email, phone, address, vatNumber, contactPerson } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const out = await db.query(
      `INSERT INTO suppliers (company_id, name, email, phone, address, vat_number, contact_person)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [companyId, name, email || null, phone || null, address || null, vatNumber || null, contactPerson || null]
    );
    res.json({ supplier: out.rows[0] });
  } catch (e) { next(e); }
});

router.get("/", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const search = req.query.search || null;
    let q = `SELECT * FROM suppliers WHERE company_id=$1`;
    const params = [companyId];
    if (search) {
      q += ` AND (name ILIKE $2 OR email ILIKE $2)`;
      params.push(`%${search}%`);
    }
    q += ` ORDER BY name`;
    const out = await db.query(q, params);
    res.json({ suppliers: out.rows });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const out = await db.query(
      `SELECT * FROM suppliers WHERE id=$1 AND company_id=$2`,
      [Number(req.params.id), companyId]
    );
    if (out.rowCount === 0) return res.status(404).json({ error: "Supplier not found" });
    res.json({ supplier: out.rows[0] });
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const { name, email, phone, address, vatNumber, contactPerson } = req.body;
    const out = await db.query(
      `UPDATE suppliers SET
         name=COALESCE($3,name), email=COALESCE($4,email), phone=COALESCE($5,phone),
         address=COALESCE($6,address), vat_number=COALESCE($7,vat_number),
         contact_person=COALESCE($8,contact_person)
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [Number(req.params.id), companyId, name, email, phone, address, vatNumber, contactPerson]
    );
    if (out.rowCount === 0) return res.status(404).json({ error: "Supplier not found" });
    res.json({ supplier: out.rows[0] });
  } catch (e) { next(e); }
});

// POST /suppliers/import - Bulk import from CSV
router.post("/import", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const { rows } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "No rows provided" });
    }

    if (rows.length > 500) {
      return res.status(400).json({ error: "Maximum 500 rows per import" });
    }

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = (row.name || "").trim();
      if (!name) {
        skipped++;
        errors.push({ row: i + 1, error: "Name is required" });
        continue;
      }

      try {
        await db.query(
          `INSERT INTO suppliers (company_id, name, email, phone, address, vat_number, contact_person)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            companyId,
            name,
            (row.email || "").trim() || null,
            (row.phone || "").trim() || null,
            (row.address || "").trim() || null,
            (row.vat_number || row.vatNumber || "").trim() || null,
            (row.contact_person || row.contactPerson || "").trim() || null,
          ]
        );
        imported++;
      } catch (e) {
        skipped++;
        errors.push({ row: i + 1, error: e.message });
      }
    }

    res.json({ imported, skipped, total: rows.length, errors: errors.slice(0, 10) });
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const out = await db.query(
      `DELETE FROM suppliers WHERE id=$1 AND company_id=$2 RETURNING id`,
      [Number(req.params.id), companyId]
    );
    if (out.rowCount === 0) return res.status(404).json({ error: "Supplier not found" });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

module.exports = router;
