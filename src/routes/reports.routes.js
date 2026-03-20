const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/pl", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const dateFrom = req.query.dateFrom || "1900-01-01";
    const dateTo = req.query.dateTo || "2999-12-31";

    // Income: sum of all invoice net totals in the period
    const incomeResult = await db.query(
      `SELECT COALESCE(SUM(net_total),0) AS total
       FROM invoices
       WHERE company_id=$1 AND invoice_date BETWEEN $2 AND $3`,
      [companyId, dateFrom, dateTo]
    );

    // Expense: sum of all bill totals in the period
    const expenseResult = await db.query(
      `SELECT COALESCE(SUM(total),0) AS total
       FROM bills
       WHERE company_id=$1 AND bill_date BETWEEN $2 AND $3`,
      [companyId, dateFrom, dateTo]
    );

    // Income breakdown by customer
    const incomeByCustomer = await db.query(
      `SELECT c.name AS customer_name, COALESCE(SUM(i.net_total),0) AS total
       FROM invoices i
       LEFT JOIN customers c ON c.id=i.customer_id
       WHERE i.company_id=$1 AND i.invoice_date BETWEEN $2 AND $3
       GROUP BY c.name ORDER BY total DESC`,
      [companyId, dateFrom, dateTo]
    );

    // Expense breakdown by supplier
    const expenseBySupplier = await db.query(
      `SELECT s.name AS supplier_name, COALESCE(SUM(b.total),0) AS total
       FROM bills b
       LEFT JOIN suppliers s ON s.id=b.supplier_id
       WHERE b.company_id=$1 AND b.bill_date BETWEEN $2 AND $3
       GROUP BY s.name ORDER BY total DESC`,
      [companyId, dateFrom, dateTo]
    );

    const income = Number(incomeResult.rows[0].total);
    const expense = Number(expenseResult.rows[0].total);
    const netProfit = income - expense;

    res.json({
      period: { dateFrom, dateTo },
      income,
      expense,
      netProfit,
      incomeBreakdown: incomeByCustomer.rows,
      expenseBreakdown: expenseBySupplier.rows,
    });
  } catch (e) { next(e); }
});

router.get("/bs", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const asAt = req.query.asAt || new Date().toISOString().slice(0, 10);

    // Accounts Receivable
    const arResult = await db.query(
      `SELECT COALESCE(SUM(balance),0) AS total FROM invoices WHERE company_id=$1 AND status NOT IN ('PAID','VOID') AND invoice_date <= $2`,
      [companyId, asAt]
    );

    // Accounts Payable
    const apResult = await db.query(
      `SELECT COALESCE(SUM(balance),0) AS total FROM bills WHERE company_id=$1 AND status NOT IN ('PAID','VOID') AND bill_date <= $2`,
      [companyId, asAt]
    );

    // Bank balance
    let bankBalance = 0;
    try {
      const bankResult = await db.query(
        `SELECT COALESCE(SUM(current_balance),0) AS total FROM bank_accounts WHERE company_id=$1 AND is_active=true`,
        [companyId]
      );
      bankBalance = Number(bankResult.rows[0].total);
    } catch (e) { /* bank_accounts may not exist */ }

    // Inventory value
    const invResult = await db.query(
      `SELECT COALESCE(SUM(stock_qty * COALESCE(cost,0)),0) AS total FROM products WHERE company_id=$1`,
      [companyId]
    );

    const accountsReceivable = Number(arResult.rows[0].total);
    const accountsPayable = Number(apResult.rows[0].total);
    const inventoryValue = Number(invResult.rows[0].total);
    const totalAssets = bankBalance + accountsReceivable + inventoryValue;
    const totalLiabilities = accountsPayable;
    const equity = totalAssets - totalLiabilities;

    res.json({
      asAt,
      assets: {
        cash: bankBalance,
        accountsReceivable,
        inventory: inventoryValue,
        totalAssets,
      },
      liabilities: {
        accountsPayable,
        totalLiabilities,
      },
      equity: {
        retainedEarnings: equity,
        totalEquity: equity,
      },
    });
  } catch (e) { next(e); }
});

router.get("/tb", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const asAt = req.query.asAt || new Date().toISOString().slice(0, 10);

    const result = await db.query(
      `SELECT a.code, a.name, a.type,
              COALESCE(SUM(l.debit),0) AS total_debit,
              COALESCE(SUM(l.credit),0) AS total_credit
       FROM chart_of_accounts a
       LEFT JOIN journal_entry_lines l ON l.account_id=a.id
       LEFT JOIN journal_entries j ON j.id=l.journal_entry_id AND j.entry_date <= $2
       WHERE a.company_id=$1
       GROUP BY a.id, a.code, a.name, a.type
       HAVING COALESCE(SUM(l.debit),0) <> 0 OR COALESCE(SUM(l.credit),0) <> 0
       ORDER BY a.code`,
      [companyId, asAt]
    );

    let totalDebit = 0, totalCredit = 0;
    result.rows.forEach(r => {
      totalDebit += Number(r.total_debit);
      totalCredit += Number(r.total_credit);
    });

    res.json({
      asAt,
      lines: result.rows,
      totals: { debit: totalDebit, credit: totalCredit },
    });
  } catch (e) { next(e); }
});

module.exports = router;
