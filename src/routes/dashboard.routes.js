const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/summary", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);

    const thisMonth = new Date();
    const monthStart = `${thisMonth.getFullYear()}-${String(thisMonth.getMonth() + 1).padStart(2, '0')}-01`;

    // Invoice stats
    const invoiceStats = await db.query(
      `SELECT
         COUNT(*) AS total_invoices,
         COALESCE(SUM(total),0) AS total_invoiced,
         COALESCE(SUM(CASE WHEN status='PAID' THEN total ELSE 0 END),0) AS total_paid,
         COALESCE(SUM(CASE WHEN status != 'PAID' THEN balance ELSE 0 END),0) AS total_outstanding,
         COUNT(CASE WHEN status='OVERDUE' OR (status='SENT' AND due_date < CURRENT_DATE) THEN 1 END) AS overdue_count
       FROM invoices WHERE company_id=$1`,
      [companyId]
    );

    // Bill stats
    const billStats = await db.query(
      `SELECT
         COUNT(*) AS total_bills,
         COALESCE(SUM(total),0) AS total_billed,
         COALESCE(SUM(CASE WHEN status='PAID' THEN total ELSE 0 END),0) AS total_paid,
         COALESCE(SUM(CASE WHEN status != 'PAID' THEN balance ELSE 0 END),0) AS total_outstanding,
         COUNT(CASE WHEN status='OVERDUE' OR (status='UNPAID' AND due_date < CURRENT_DATE) THEN 1 END) AS overdue_count
       FROM bills WHERE company_id=$1`,
      [companyId]
    );

    // Profit this month (income - expenses)
    const monthSales = await db.query(
      `SELECT COALESCE(SUM(net_total),0) AS sales_net,
              COALESCE(SUM(total),0) AS sales_gross
       FROM invoices WHERE company_id=$1 AND invoice_date >= $2`,
      [companyId, monthStart]
    );

    const monthPurchases = await db.query(
      `SELECT COALESCE(SUM(bl.line_total),0) AS purchases_total
       FROM bills b
       JOIN bill_lines bl ON bl.bill_id = b.id
       WHERE b.company_id=$1 AND b.bill_date >= $2`,
      [companyId, monthStart]
    );

    const profitThisMonth = Number(monthSales.rows[0].sales_net) - Number(monthPurchases.rows[0].purchases_total);

    // Bank balance (sum of all active bank accounts)
    let bankBalance = 0;
    try {
      const bankResult = await db.query(
        `SELECT COALESCE(SUM(current_balance),0) AS total_balance FROM bank_accounts WHERE company_id=$1 AND is_active=true`,
        [companyId]
      );
      bankBalance = Number(bankResult.rows[0].total_balance);
    } catch (e) {
      // bank_accounts table may not exist yet
    }

    // Accounts Receivable (unpaid invoice balances)
    const arResult = await db.query(
      `SELECT COALESCE(SUM(balance),0) AS accounts_receivable
       FROM invoices WHERE company_id=$1 AND status NOT IN ('PAID','VOID')`,
      [companyId]
    );
    const accountsReceivable = Number(arResult.rows[0].accounts_receivable);

    // Accounts Payable (unpaid bill balances)
    const apResult = await db.query(
      `SELECT COALESCE(SUM(balance),0) AS accounts_payable
       FROM bills WHERE company_id=$1 AND status NOT IN ('PAID','VOID')`,
      [companyId]
    );
    const accountsPayable = Number(apResult.rows[0].accounts_payable);

    // VAT Payable (from journal entries on VAT control account 2100)
    let vatPayable = 0;
    try {
      const vatAc = await db.query(
        `SELECT id FROM chart_of_accounts WHERE company_id=$1 AND code='2100'`,
        [companyId]
      );
      if (vatAc.rowCount > 0) {
        const vatLines = await db.query(
          `SELECT COALESCE(SUM(credit - debit),0) AS vat_payable
           FROM journal_entries j
           JOIN journal_entry_lines l ON l.journal_entry_id=j.id
           WHERE j.company_id=$1 AND l.account_id=$2`,
          [companyId, vatAc.rows[0].id]
        );
        vatPayable = Number(vatLines.rows[0].vat_payable);
      }
    } catch (e) { /* ignore */ }

    // Stock details
    const stockResult = await db.query(
      `SELECT
         COUNT(*) AS total_products,
         COALESCE(SUM(stock_qty),0) AS total_stock_qty,
         COALESCE(SUM(stock_qty * COALESCE(cost,0)),0) AS total_stock_value,
         COUNT(CASE WHEN track_inventory=true AND stock_qty <= 0 THEN 1 END) AS low_stock_count
       FROM products WHERE company_id=$1`,
      [companyId]
    );

    // Entity counts
    const customerCount = await db.query(`SELECT COUNT(*) AS count FROM customers WHERE company_id=$1`, [companyId]);
    const supplierCount = await db.query(`SELECT COUNT(*) AS count FROM suppliers WHERE company_id=$1`, [companyId]);
    const productCount = await db.query(`SELECT COUNT(*) AS count FROM products WHERE company_id=$1`, [companyId]);
    const employeeCount = await db.query(`SELECT COUNT(*) AS count FROM employees WHERE company_id=$1 AND is_active=true`, [companyId]);

    // Recent invoices and bills
    const recentInvoices = await db.query(
      `SELECT id, invoice_number, customer_id, total, status, invoice_date
       FROM invoices WHERE company_id=$1
       ORDER BY created_at DESC LIMIT 5`,
      [companyId]
    );

    const recentBills = await db.query(
      `SELECT id, bill_number, supplier_id, total, status, bill_date
       FROM bills WHERE company_id=$1
       ORDER BY created_at DESC LIMIT 5`,
      [companyId]
    );

    res.json({
      bankBalance,
      profitThisMonth,
      accountsReceivable,
      accountsPayable,
      vatPayable,
      stockDetails: {
        totalProducts: Number(stockResult.rows[0].total_products),
        totalStockQty: Number(stockResult.rows[0].total_stock_qty),
        totalStockValue: Number(stockResult.rows[0].total_stock_value),
        lowStockCount: Number(stockResult.rows[0].low_stock_count),
      },
      invoices: invoiceStats.rows[0],
      bills: billStats.rows[0],
      thisMonth: {
        salesNet: Number(monthSales.rows[0].sales_net),
        salesGross: Number(monthSales.rows[0].sales_gross),
        purchasesTotal: Number(monthPurchases.rows[0].purchases_total),
        profit: profitThisMonth,
      },
      counts: {
        customers: Number(customerCount.rows[0].count),
        suppliers: Number(supplierCount.rows[0].count),
        products: Number(productCount.rows[0].count),
        employees: Number(employeeCount.rows[0].count),
      },
      recentInvoices: recentInvoices.rows,
      recentBills: recentBills.rows,
    });
  } catch (e) { next(e); }
});

module.exports = router;
