const express = require("express");
const db = require("../db");

const router = express.Router();

// POST /employees
router.post("/", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const { firstName, lastName, email, phone, jobTitle, department,
            salary, startDate, niNumber, taxCode } = req.body;

    if (!firstName || !lastName) {
      return res.status(400).json({ error: "firstName and lastName are required" });
    }

    const result = await db.query(
      `INSERT INTO employees (company_id, first_name, last_name, email, phone,
       job_title, department, salary, start_date, ni_number, tax_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [companyId, firstName, lastName, email || null, phone || null,
       jobTitle || null, department || null, salary || 0,
       startDate || null, niNumber || null, taxCode || null]
    );

    res.json({ employee: result.rows[0] });
  } catch (e) { next(e); }
});

// GET /employees
router.get("/", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const activeOnly = req.query.active !== "false";

    let q = `SELECT * FROM employees WHERE company_id=$1`;
    const values = [companyId];

    if (activeOnly) {
      q += ` AND is_active=true`;
    }

    q += ` ORDER BY last_name, first_name`;

    const result = await db.query(q, values);
    res.json({ employees: result.rows });
  } catch (e) { next(e); }
});

// GET /employees/:id
router.get("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const id = Number(req.params.id);

    const result = await db.query(
      `SELECT * FROM employees WHERE company_id=$1 AND id=$2`,
      [companyId, id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: "Employee not found" });
    res.json({ employee: result.rows[0] });
  } catch (e) { next(e); }
});

// PUT /employees/:id
router.put("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const id = Number(req.params.id);
    const { firstName, lastName, email, phone, jobTitle, department,
            salary, startDate, niNumber, taxCode, isActive } = req.body;

    const result = await db.query(
      `UPDATE employees SET
         first_name = COALESCE($1, first_name),
         last_name = COALESCE($2, last_name),
         email = COALESCE($3, email),
         phone = COALESCE($4, phone),
         job_title = COALESCE($5, job_title),
         department = COALESCE($6, department),
         salary = COALESCE($7, salary),
         start_date = COALESCE($8, start_date),
         ni_number = COALESCE($9, ni_number),
         tax_code = COALESCE($10, tax_code),
         is_active = COALESCE($11, is_active),
         updated_at = NOW()
       WHERE company_id=$12 AND id=$13
       RETURNING *`,
      [firstName || null, lastName || null, email, phone, jobTitle, department,
       salary, startDate, niNumber, taxCode,
       isActive !== undefined ? isActive : null, companyId, id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: "Employee not found" });
    res.json({ employee: result.rows[0] });
  } catch (e) { next(e); }
});

// DELETE /employees/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const id = Number(req.params.id);

    const result = await db.query(
      `DELETE FROM employees WHERE company_id=$1 AND id=$2 RETURNING *`,
      [companyId, id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: "Employee not found" });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

module.exports = router;
