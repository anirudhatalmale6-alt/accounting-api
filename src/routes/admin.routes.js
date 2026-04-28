const express = require("express");
const db = require("../db");

const router = express.Router();

// Middleware: only allow admin@gasman.co.uk or owner role
function requireAdmin(req, res, next) {
  if (req.user.email === "admin@gasman.co.uk" || req.user.email === "pholmes73@gmail.com") {
    return next();
  }
  return res.status(403).json({ error: "Admin access required" });
}

router.use(requireAdmin);

// GET /admin/users - List all registered users
router.get("/users", async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.email, u.role, u.company_id, c.name AS company_name, u.created_at,
              (SELECT count(*) FROM invoices WHERE company_id=u.company_id) AS invoice_count,
              (SELECT count(*) FROM bills WHERE company_id=u.company_id) AS bill_count,
              (SELECT count(*) FROM customers WHERE company_id=u.company_id) AS customer_count,
              (SELECT count(*) FROM suppliers WHERE company_id=u.company_id) AS supplier_count,
              (SELECT count(*) FROM products WHERE company_id=u.company_id) AS product_count
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       ORDER BY u.created_at DESC`
    );
    res.json({ users: result.rows, totalUsers: result.rowCount });
  } catch (e) { next(e); }
});

// GET /admin/users/:id - Get detailed info for a specific user
router.get("/users/:id", async (req, res, next) => {
  try {
    const userId = Number(req.params.id);

    const user = await db.query(
      `SELECT u.id, u.email, u.role, u.company_id, c.name AS company_name, u.created_at
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.id=$1`,
      [userId]
    );
    if (user.rowCount === 0) return res.status(404).json({ error: "User not found" });

    const companyId = user.rows[0].company_id;

    const invoices = await db.query(
      `SELECT id, invoice_number, invoice_date, total, status FROM invoices WHERE company_id=$1 ORDER BY invoice_date DESC LIMIT 20`,
      [companyId]
    );

    const bills = await db.query(
      `SELECT id, bill_number, bill_date, total, status FROM bills WHERE company_id=$1 ORDER BY bill_date DESC LIMIT 20`,
      [companyId]
    );

    const bankAccounts = await db.query(
      `SELECT id, account_name, bank_name, current_balance FROM bank_accounts WHERE company_id=$1`,
      [companyId]
    );

    const customers = await db.query(
      `SELECT id, name, email FROM customers WHERE company_id=$1 ORDER BY name`,
      [companyId]
    );

    const suppliers = await db.query(
      `SELECT id, name, email FROM suppliers WHERE company_id=$1 ORDER BY name`,
      [companyId]
    );

    const products = await db.query(
      `SELECT id, name, sku, stock_qty, cost, sell_price FROM products WHERE company_id=$1 ORDER BY name`,
      [companyId]
    );

    res.json({
      user: user.rows[0],
      invoices: invoices.rows,
      bills: bills.rows,
      bankAccounts: bankAccounts.rows,
      customers: customers.rows,
      suppliers: suppliers.rows,
      products: products.rows,
    });
  } catch (e) { next(e); }
});

// GET /admin/stats - Overall platform statistics
router.get("/stats", async (req, res, next) => {
  try {
    const users = await db.query(`SELECT count(*) AS count FROM users`);
    const companies = await db.query(`SELECT count(*) AS count FROM companies`);
    const invoices = await db.query(`SELECT count(*) AS count, COALESCE(SUM(total),0) AS total FROM invoices`);
    const bills = await db.query(`SELECT count(*) AS count, COALESCE(SUM(total),0) AS total FROM bills`);

    const recentUsers = await db.query(
      `SELECT u.id, u.email, u.company_id, c.name AS company_name, u.created_at
       FROM users u LEFT JOIN companies c ON c.id=u.company_id
       ORDER BY u.created_at DESC LIMIT 10`
    );

    res.json({
      totalUsers: Number(users.rows[0].count),
      totalCompanies: Number(companies.rows[0].count),
      totalInvoices: Number(invoices.rows[0].count),
      totalInvoiceValue: Number(invoices.rows[0].total),
      totalBills: Number(bills.rows[0].count),
      totalBillValue: Number(bills.rows[0].total),
      recentUsers: recentUsers.rows,
    });
  } catch (e) { next(e); }
});

module.exports = router;
