const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const out = await db.query(
      `SELECT * FROM chart_of_accounts WHERE company_id=$1 ORDER BY code`,
      [companyId]
    );
    res.json({ accounts: out.rows });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const { code, name, type, subType } = req.body;

    if (!code || !name || !type) {
      return res.status(400).json({ error: "code, name, and type are required" });
    }

    const out = await db.query(
      `INSERT INTO chart_of_accounts (company_id, code, name, type, sub_type)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [companyId, code, name, type, subType || null]
    );
    res.json({ account: out.rows[0] });
  } catch (e) { next(e); }
});

module.exports = router;
