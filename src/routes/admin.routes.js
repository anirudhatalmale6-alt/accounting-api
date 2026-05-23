const express = require("express");
const db = require("../db");

const router = express.Router();

// Middleware: only allow specific admin emails or saneuxbathrooms
function requireAdmin(req, res, next) {
  const admins = ["admin@gasman.co.uk", "pholmes73@gmail.com", "saneuxbathrooms@gmail.com"];
  if (admins.includes(req.user.email)) {
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
      `SELECT id, name, sku, stock_qty, cost, price FROM products WHERE company_id=$1 ORDER BY name`,
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

// DELETE /admin/users/:id - Delete a user and optionally their company
router.delete("/users/:id", async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    const deleteCompany = req.query.deleteCompany === "true";

    const user = await db.query(`SELECT id, company_id, email, role FROM users WHERE id=$1`, [userId]);
    if (user.rowCount === 0) return res.status(404).json({ error: "User not found" });

    const u = user.rows[0];
    const companyId = u.company_id;

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      if (deleteCompany) {
        await client.query(`DELETE FROM estimate_lines WHERE estimate_id IN (SELECT id FROM estimates WHERE company_id=$1)`, [companyId]);
        await client.query(`DELETE FROM estimates WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id=$1)`, [companyId]);
        await client.query(`DELETE FROM bill_lines WHERE bill_id IN (SELECT id FROM bills WHERE company_id=$1)`, [companyId]);
        await client.query(`DELETE FROM payroll_run_lines WHERE payroll_run_id IN (SELECT id FROM payroll_runs WHERE company_id=$1)`, [companyId]);
        await client.query(`DELETE FROM payment_allocations WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM bank_transactions WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM payments WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM invoices WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM bills WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM payroll_runs WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM products WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM customers WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM suppliers WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM employees WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM bank_accounts WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM attachments WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM inventory_movements WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE company_id=$1)`, [companyId]);
        await client.query(`DELETE FROM journal_entries WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM chart_of_accounts WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM email_logs WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM hmrc_tokens WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM vat_adjustments WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM vat_period_locks WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM vat_submissions WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM cis_deductions WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM cis_returns WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM cis_subcontractors WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM job_reminders WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM jobs WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM engineers WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM team_members WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM invitations WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM password_reset_otps WHERE user_id IN (SELECT id FROM users WHERE company_id=$1)`, [companyId]);
        await client.query(`DELETE FROM users WHERE company_id=$1`, [companyId]);
        await client.query(`DELETE FROM companies WHERE id=$1`, [companyId]);
      } else {
        await client.query(`DELETE FROM password_reset_otps WHERE user_id=$1`, [userId]);
        await client.query(`DELETE FROM users WHERE id=$1`, [userId]);
      }

      await client.query("COMMIT");
      res.json({ deleted: true, deletedCompany: deleteCompany });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// GET /admin/companies - List all companies with stats
router.get("/companies", async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT c.id, c.name, c.business_name, c.created_at,
              (SELECT count(*) FROM users WHERE company_id=c.id) AS user_count,
              (SELECT count(*) FROM jobs WHERE company_id=c.id) AS job_count,
              (SELECT count(*) FROM invoices WHERE company_id=c.id) AS invoice_count,
              (SELECT count(*) FROM customers WHERE company_id=c.id) AS customer_count
       FROM companies c ORDER BY c.created_at DESC`
    );
    res.json({ companies: result.rows });
  } catch (e) { next(e); }
});

module.exports = router;
