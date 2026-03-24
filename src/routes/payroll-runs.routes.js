const express = require("express");
const db = require("../db");

const router = express.Router();

// Create a payroll run
router.post("/", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const { runDate, periodStart, periodEnd, notes, lines } = req.body;

    if (!runDate || !periodStart || !periodEnd) {
      return res.status(400).json({ error: "runDate, periodStart, and periodEnd are required" });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const runResult = await client.query(
        `INSERT INTO payroll_runs (company_id, run_date, period_start, period_end, status, notes)
         VALUES ($1,$2,$3,$4,'DRAFT',$5)
         RETURNING *`,
        [companyId, runDate, periodStart, periodEnd, notes || null]
      );
      const run = runResult.rows[0];

      let totalGross = 0, totalTax = 0, totalNi = 0, totalNet = 0;
      const insertedLines = [];

      if (Array.isArray(lines) && lines.length > 0) {
        for (const line of lines) {
          const basicPay = Number(line.basicPay || 0);
          const overtime = Number(line.overtime || 0);
          const bonus = Number(line.bonus || 0);
          const grossPay = basicPay + overtime + bonus;
          const tax = Number(line.tax || 0);
          const niEmployee = Number(line.niEmployee || 0);
          const niEmployer = Number(line.niEmployer || 0);
          const otherDeductions = Number(line.otherDeductions || 0);
          const netPay = grossPay - tax - niEmployee - otherDeductions;

          const lineResult = await client.query(
            `INSERT INTO payroll_run_lines (payroll_run_id, employee_id, basic_pay, overtime, bonus, gross_pay, tax, ni_employee, ni_employer, other_deductions, net_pay)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING *`,
            [run.id, line.employeeId, basicPay, overtime, bonus, grossPay, tax, niEmployee, niEmployer, otherDeductions, netPay]
          );
          insertedLines.push(lineResult.rows[0]);

          totalGross += grossPay;
          totalTax += tax;
          totalNi += niEmployee;
          totalNet += netPay;
        }
      }

      const updated = await client.query(
        `UPDATE payroll_runs SET total_gross=$2, total_tax=$3, total_ni=$4, total_net=$5, updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [run.id, totalGross, totalTax, totalNi, totalNet]
      );

      await client.query("COMMIT");
      res.json({ payrollRun: updated.rows[0], lines: insertedLines });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// List payroll runs
router.get("/", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const status = req.query.status || null;
    let q = `SELECT * FROM payroll_runs WHERE company_id=$1`;
    const params = [companyId];
    if (status) {
      q += ` AND status=$2`;
      params.push(status);
    }
    q += ` ORDER BY run_date DESC`;
    const out = await db.query(q, params);
    res.json({ payrollRuns: out.rows });
  } catch (e) { next(e); }
});

// Get payroll run detail with lines
router.get("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const runId = Number(req.params.id);

    const run = await db.query(
      `SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2`,
      [runId, companyId]
    );
    if (run.rowCount === 0) return res.status(404).json({ error: "Payroll run not found" });

    const lines = await db.query(
      `SELECT prl.*, e.first_name, e.last_name, e.job_title
       FROM payroll_run_lines prl
       JOIN employees e ON e.id=prl.employee_id
       WHERE prl.payroll_run_id=$1
       ORDER BY e.last_name, e.first_name`,
      [runId]
    );

    res.json({ payrollRun: run.rows[0], lines: lines.rows });
  } catch (e) { next(e); }
});

// Update payroll run status (DRAFT -> APPROVED -> PAID)
router.put("/:id/status", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const runId = Number(req.params.id);
    const { status } = req.body;

    if (!status || !["DRAFT", "APPROVED", "PAID", "VOID"].includes(status)) {
      return res.status(400).json({ error: "status must be DRAFT, APPROVED, PAID, or VOID" });
    }

    const out = await db.query(
      `UPDATE payroll_runs SET status=$3, updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING *`,
      [runId, companyId, status]
    );
    if (out.rowCount === 0) return res.status(404).json({ error: "Payroll run not found" });
    res.json({ payrollRun: out.rows[0] });
  } catch (e) { next(e); }
});

// Update payroll run (edit lines)
router.put("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const runId = Number(req.params.id);
    const { runDate, periodStart, periodEnd, notes, lines } = req.body;

    const existing = await db.query(
      `SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2`,
      [runId, companyId]
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: "Payroll run not found" });
    if (existing.rows[0].status !== "DRAFT") {
      return res.status(400).json({ error: "Can only edit DRAFT payroll runs" });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE payroll_runs SET
           run_date=COALESCE($3,run_date), period_start=COALESCE($4,period_start),
           period_end=COALESCE($5,period_end), notes=COALESCE($6,notes), updated_at=NOW()
         WHERE id=$1 AND company_id=$2`,
        [runId, companyId, runDate, periodStart, periodEnd, notes]
      );

      let totalGross = 0, totalTax = 0, totalNi = 0, totalNet = 0;
      const insertedLines = [];

      if (Array.isArray(lines)) {
        await client.query(`DELETE FROM payroll_run_lines WHERE payroll_run_id=$1`, [runId]);

        for (const line of lines) {
          const basicPay = Number(line.basicPay || 0);
          const overtime = Number(line.overtime || 0);
          const bonus = Number(line.bonus || 0);
          const grossPay = basicPay + overtime + bonus;
          const tax = Number(line.tax || 0);
          const niEmployee = Number(line.niEmployee || 0);
          const niEmployer = Number(line.niEmployer || 0);
          const otherDeductions = Number(line.otherDeductions || 0);
          const netPay = grossPay - tax - niEmployee - otherDeductions;

          const lineResult = await client.query(
            `INSERT INTO payroll_run_lines (payroll_run_id, employee_id, basic_pay, overtime, bonus, gross_pay, tax, ni_employee, ni_employer, other_deductions, net_pay)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING *`,
            [runId, line.employeeId, basicPay, overtime, bonus, grossPay, tax, niEmployee, niEmployer, otherDeductions, netPay]
          );
          insertedLines.push(lineResult.rows[0]);

          totalGross += grossPay;
          totalTax += tax;
          totalNi += niEmployee;
          totalNet += netPay;
        }
      }

      const updated = await client.query(
        `UPDATE payroll_runs SET total_gross=$2, total_tax=$3, total_ni=$4, total_net=$5, updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [runId, totalGross, totalTax, totalNi, totalNet]
      );

      await client.query("COMMIT");
      res.json({ payrollRun: updated.rows[0], lines: insertedLines });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// Delete payroll run
router.delete("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const runId = Number(req.params.id);

    const existing = await db.query(
      `SELECT status FROM payroll_runs WHERE id=$1 AND company_id=$2`,
      [runId, companyId]
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: "Payroll run not found" });
    if (existing.rows[0].status === "PAID") {
      return res.status(400).json({ error: "Cannot delete a PAID payroll run" });
    }

    await db.query(`DELETE FROM payroll_runs WHERE id=$1 AND company_id=$2`, [runId, companyId]);
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

module.exports = router;
