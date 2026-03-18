const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/pl", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const dateFrom = req.query.dateFrom || "1900-01-01";
    const dateTo = req.query.dateTo || "2999-12-31";

    const sales = await db.query(
      `SELECT COALESCE(SUM(net_total),0) AS sales_net,
              COALESCE(SUM(vat_total),0) AS sales_vat,
              COALESCE(SUM(total),0) AS sales_gross
       FROM invoices
       WHERE company_id=$1 AND invoice_date BETWEEN $2 AND $3`,
      [companyId, dateFrom, dateTo]
    );

    const purchases = await db.query(
      `SELECT COALESCE(SUM(total),0) AS purchases_total
       FROM bills
       WHERE company_id=$1 AND bill_date BETWEEN $2 AND $3`,
      [companyId, dateFrom, dateTo]
    );

    const salesNet = Number(sales.rows[0].sales_net);
    const purchasesTotal = Number(purchases.rows[0].purchases_total);
    const grossProfit = salesNet - purchasesTotal;

    res.json({
      period: { dateFrom, dateTo },
      sales: sales.rows[0],
      purchases: purchases.rows[0],
      grossProfit,
    });
  } catch (e) { next(e); }
});

router.get("/bs", async (req, res, next) => {
  try {
    res.json({
      assets: { cash: 0, accountsReceivable: 0, inventory: 0, totalAssets: 0 },
      liabilities: { accountsPayable: 0, vatPayable: 0, totalLiabilities: 0 },
      equity: { retainedEarnings: 0, totalEquity: 0 },
      notes: ["Balance Sheet scaffold endpoint. Implement chart_of_accounts + journal_entries for real data."],
    });
  } catch (e) { next(e); }
});

router.get("/tb", async (req, res, next) => {
  try {
    res.json({
      lines: [],
      totals: { debit: 0, credit: 0 },
      notes: ["Trial Balance scaffold endpoint. Implement journal_entry_lines grouped by account for real data."],
    });
  } catch (e) { next(e); }
});

module.exports = router;
