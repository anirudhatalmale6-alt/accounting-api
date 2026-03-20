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

router.get("/summary", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const dateFrom = req.query.dateFrom || "1900-01-01";
    const dateTo = req.query.dateTo || "2999-12-31";

    // VAT on sales (output VAT)
    const salesVat = await db.query(
      `SELECT COALESCE(SUM(vat_total),0) AS vat_collected,
              COALESCE(SUM(net_total),0) AS sales_ex_vat,
              COALESCE(SUM(total),0) AS sales_inc_vat,
              COUNT(*) AS invoice_count
       FROM invoices WHERE company_id=$1 AND invoice_date BETWEEN $2 AND $3`,
      [companyId, dateFrom, dateTo]
    );

    // VAT on purchases (input VAT) - calculate from bill lines
    const purchaseVat = await db.query(
      `SELECT COALESCE(SUM(bl.line_total * bl.vat_rate / 100),0) AS vat_paid,
              COALESCE(SUM(bl.line_total),0) AS purchases_ex_vat,
              COUNT(DISTINCT b.id) AS bill_count
       FROM bills b
       JOIN bill_lines bl ON bl.bill_id=b.id
       WHERE b.company_id=$1 AND b.bill_date BETWEEN $2 AND $3`,
      [companyId, dateFrom, dateTo]
    );

    const vatCollected = Number(salesVat.rows[0].vat_collected);
    const vatPaid = Number(purchaseVat.rows[0].vat_paid);
    const vatOwed = vatCollected - vatPaid;

    res.json({
      period: { dateFrom, dateTo },
      vatCollected,
      vatPaid,
      vatOwed,
      sales: {
        netAmount: Number(salesVat.rows[0].sales_ex_vat),
        vatAmount: vatCollected,
        grossAmount: Number(salesVat.rows[0].sales_inc_vat),
        invoiceCount: Number(salesVat.rows[0].invoice_count),
      },
      purchases: {
        netAmount: Number(purchaseVat.rows[0].purchases_ex_vat),
        vatAmount: vatPaid,
        billCount: Number(purchaseVat.rows[0].bill_count),
      },
    });
  } catch (e) { next(e); }
});

module.exports = router;
