const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/return", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const dateFrom = req.query.dateFrom || "1900-01-01";
    const dateTo = req.query.dateTo || "2999-12-31";

    const vatAc = await db.query(
      `SELECT id FROM chart_of_accounts WHERE company_id=$1 AND code='2100'`,
      [companyId]
    );
    if (vatAc.rowCount === 0) return res.status(400).json({ error: 'VAT Control account (2100) not found' });
    const vatAccountId = vatAc.rows[0].id;

    const vatLines = await db.query(
      `SELECT
         COALESCE(SUM(debit),0) AS vat_debit,
         COALESCE(SUM(credit),0) AS vat_credit
       FROM journal_entries j
       JOIN journal_entry_lines l ON l.journal_entry_id=j.id
       WHERE j.company_id=$1
         AND j.entry_date BETWEEN $2 AND $3
         AND l.account_id=$4`,
      [companyId, dateFrom, dateTo, vatAccountId]
    );

    const vatDebit = Number(vatLines.rows[0].vat_debit);
    const vatCredit = Number(vatLines.rows[0].vat_credit);

    const box1 = vatCredit;
    const box2 = 0;
    const box3 = box1 + box2;
    const box4 = vatDebit;
    const box5 = box3 - box4;

    const income = await db.query(
      `SELECT COALESCE(SUM(l.credit - l.debit),0) AS sales_ex_vat
       FROM journal_entries j
       JOIN journal_entry_lines l ON l.journal_entry_id=j.id
       JOIN chart_of_accounts a ON a.id=l.account_id
       WHERE j.company_id=$1
         AND j.entry_date BETWEEN $2 AND $3
         AND a.type='INCOME'`,
      [companyId, dateFrom, dateTo]
    );

    const purchases = await db.query(
      `SELECT COALESCE(SUM(l.debit - l.credit),0) AS purchases_ex_vat
       FROM journal_entries j
       JOIN journal_entry_lines l ON l.journal_entry_id=j.id
       JOIN chart_of_accounts a ON a.id=l.account_id
       WHERE j.company_id=$1
         AND j.entry_date BETWEEN $2 AND $3
         AND l.account_id <> $4
         AND (a.type='EXPENSE' OR (a.type='ASSET' AND a.sub_type IN ('INVENTORY')))`,
      [companyId, dateFrom, dateTo, vatAccountId]
    );

    const box6 = Number(income.rows[0].sales_ex_vat);
    const box7 = Number(purchases.rows[0].purchases_ex_vat);
    const box8 = 0;
    const box9 = 0;

    res.json({
      period: { dateFrom, dateTo },
      boxes: { box1, box2, box3, box4, box5, box6, box7, box8, box9 },
    });
  } catch (e) { next(e); }
});

module.exports = router;
