const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/engineers", async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT * FROM engineers
       WHERE company_id=$1
       ORDER BY is_active DESC, name ASC`,
      [req.user.companyId]
    );
    res.json({ engineers: result.rows });
  } catch (e) { next(e); }
});

router.post("/engineers", async (req, res, next) => {
  try {
    const { name, email, phone, colour } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Engineer name is required" });
    }
    const result = await db.query(
      `INSERT INTO engineers (company_id, name, email, phone, colour)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [req.user.companyId, name, email || null, phone || null, colour || "#2563EB"]
    );
    res.json({ engineer: result.rows[0] });
  } catch (e) { next(e); }
});

router.put("/engineers/:id", async (req, res, next) => {
  try {
    const { name, email, phone, colour, isActive } = req.body;
    const result = await db.query(
      `UPDATE engineers SET
        name=$1, email=$2, phone=$3, colour=$4, is_active=$5
       WHERE id=$6 AND company_id=$7
       RETURNING *`,
      [name, email || null, phone || null, colour || "#2563EB", isActive ?? true, req.params.id, req.user.companyId]
    );
    res.json({ engineer: result.rows[0] });
  } catch (e) { next(e); }
});

module.exports = router;
