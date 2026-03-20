const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/summary", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);

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

    const thisMonth = new Date();
    const monthStart = `${thisMonth.getFullYear()}-${String(thisMonth.getMonth() + 1).padStart(2, '0')}-01`;

    const monthSales = await db.query(
      `SELECT COALESCE(SUM(net_total),0) AS sales_net,
              COALESCE(SUM(total),0) AS sales_gross
       FROM invoices WHERE company_id=$1 AND invoice_date >= $2`,
      [companyId, monthStart]
    );

    const monthPurchases = await db.query(
      `SELECT COALESCE(SUM(total),0) AS purchases_total
       FROM bills WHERE company_id=$1 AND bill_date >= $2`,
      [companyId, monthStart]
    );

    const customerCount = await db.query(
      `SELECT COUNT(*) AS count FROM customers WHERE company_id=$1`,
      [companyId]
    );

    const supplierCount = await db.query(
      `SELECT COUNT(*) AS count FROM suppliers WHERE company_id=$1`,
      [companyId]
    );

    const productCount = await db.query(
      `SELECT COUNT(*) AS count FROM products WHERE company_id=$1`,
      [companyId]
    );

    const employeeCount = await db.query(
      `SELECT COUNT(*) AS count FROM employees WHERE company_id=$1 AND is_active=true`,
      [companyId]
    );

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
      invoices: invoiceStats.rows[0],
      bills: billStats.rows[0],
      thisMonth: {
        salesNet: Number(monthSales.rows[0].sales_net),
        salesGross: Number(monthSales.rows[0].sales_gross),
        purchasesTotal: Number(monthPurchases.rows[0].purchases_total),
        profit: Number(monthSales.rows[0].sales_net) - Number(monthPurchases.rows[0].purchases_total),
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
