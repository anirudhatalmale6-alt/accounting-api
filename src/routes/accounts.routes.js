const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const asAt = req.query.asAt || new Date().toISOString().slice(0, 10);

    const out = await db.query(
      `SELECT a.*,
              COALESCE(SUM(l.debit),0) AS total_debit,
              COALESCE(SUM(l.credit),0) AS total_credit,
              CASE
                WHEN a.type IN ('ASSET','EXPENSE') THEN COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0)
                ELSE COALESCE(SUM(l.credit),0) - COALESCE(SUM(l.debit),0)
              END AS balance
       FROM chart_of_accounts a
       LEFT JOIN journal_entry_lines l ON l.account_id = a.id
       LEFT JOIN journal_entries j ON j.id = l.journal_entry_id
         AND j.company_id = $1 AND j.entry_date <= $2
       WHERE a.company_id = $1
       GROUP BY a.id, a.code, a.name, a.type, a.sub_type, a.company_id, a.created_at
       ORDER BY a.code`,
      [companyId, asAt]
    );

    // Calculate totals
    let totalDebit = 0, totalCredit = 0;
    out.rows.forEach(r => {
      r.total_debit = Number(r.total_debit);
      r.total_credit = Number(r.total_credit);
      r.balance = Number(r.balance);
      totalDebit += r.total_debit;
      totalCredit += r.total_credit;
    });

    res.json({
      accounts: out.rows,
      totals: { debit: totalDebit, credit: totalCredit },
    });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
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
