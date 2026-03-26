const express = require("express");
const db = require("../db");
const PDFDocument = require("pdfkit");

const router = express.Router();

// Generate payslip PDF
// payslipId = payroll_run_lines.id
router.get("/:payslipId/pdf", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const payslipId = Number(req.params.payslipId);

    // Get payroll run line with employee and run details
    const result = await db.query(
      `SELECT prl.*,
              e.first_name, e.last_name, e.email AS employee_email,
              e.job_title, e.department, e.ni_number, e.tax_code,
              pr.run_date, pr.period_start, pr.period_end, pr.status AS run_status
       FROM payroll_run_lines prl
       JOIN employees e ON e.id = prl.employee_id
       JOIN payroll_runs pr ON pr.id = prl.payroll_run_id
       WHERE prl.id = $1 AND pr.company_id = $2`,
      [payslipId, companyId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Payslip not found" });
    }

    const payslip = result.rows[0];

    // Get company info
    const company = await db.query(`SELECT * FROM companies WHERE id=$1`, [companyId]);
    const companyName = company.rows[0]?.name || "My Company";
    const symbol = company.rows[0]?.currency_symbol || "£";

    // Generate PDF
    const pdfBuffer = await generatePayslipPdf(payslip, companyName, symbol);

    const filename = `Payslip_${payslip.first_name}_${payslip.last_name}_${payslip.period_start.toISOString().slice(0, 7)}.pdf`;

    // Check if client wants base64 (for mobile apps) or direct download
    if (req.query.format === "base64") {
      res.json({
        pdfBase64: pdfBuffer.toString("base64"),
        pdfFilename: filename,
        contentType: "application/pdf",
      });
    } else {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(pdfBuffer);
    }
  } catch (e) { next(e); }
});

// List payslips for an employee
router.get("/employee/:employeeId", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const employeeId = Number(req.params.employeeId);

    const result = await db.query(
      `SELECT prl.id AS payslip_id, prl.*,
              pr.run_date, pr.period_start, pr.period_end, pr.status AS run_status
       FROM payroll_run_lines prl
       JOIN payroll_runs pr ON pr.id = prl.payroll_run_id
       WHERE prl.employee_id = $1 AND pr.company_id = $2
       ORDER BY pr.period_start DESC`,
      [employeeId, companyId]
    );

    res.json({ payslips: result.rows });
  } catch (e) { next(e); }
});

// Get single payslip detail
router.get("/:payslipId", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const payslipId = Number(req.params.payslipId);

    const result = await db.query(
      `SELECT prl.*,
              e.first_name, e.last_name, e.email AS employee_email,
              e.job_title, e.department, e.ni_number, e.tax_code,
              pr.run_date, pr.period_start, pr.period_end, pr.status AS run_status
       FROM payroll_run_lines prl
       JOIN employees e ON e.id = prl.employee_id
       JOIN payroll_runs pr ON pr.id = prl.payroll_run_id
       WHERE prl.id = $1 AND pr.company_id = $2`,
      [payslipId, companyId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Payslip not found" });
    }

    res.json({ payslip: result.rows[0] });
  } catch (e) { next(e); }
});

function generatePayslipPdf(payslip, companyName, symbol) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const buffers = [];
    doc.on("data", (b) => buffers.push(b));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    const fmt = (v) => `${symbol}${Number(v).toFixed(2)}`;
    const periodStart = payslip.period_start.toISOString().slice(0, 10);
    const periodEnd = payslip.period_end.toISOString().slice(0, 10);
    const runDate = payslip.run_date.toISOString().slice(0, 10);

    // Header
    doc.fontSize(20).font("Helvetica-Bold").text(companyName, { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(14).font("Helvetica").text("PAYSLIP", { align: "center" });
    doc.moveDown(0.5);

    // Divider
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    // Employee details
    const detailsTop = doc.y;
    doc.fontSize(10).font("Helvetica-Bold").text("Employee Details", 50);
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(9);
    doc.text(`Name: ${payslip.first_name} ${payslip.last_name}`, 50);
    if (payslip.job_title) doc.text(`Job Title: ${payslip.job_title}`, 50);
    if (payslip.department) doc.text(`Department: ${payslip.department}`, 50);
    if (payslip.ni_number) doc.text(`NI Number: ${payslip.ni_number}`, 50);
    if (payslip.tax_code) doc.text(`Tax Code: ${payslip.tax_code}`, 50);

    // Pay period details (right column)
    doc.fontSize(10).font("Helvetica-Bold").text("Pay Period", 350, detailsTop);
    doc.font("Helvetica").fontSize(9);
    doc.text(`Period: ${periodStart} to ${periodEnd}`, 350);
    doc.text(`Pay Date: ${runDate}`, 350);
    doc.text(`Payslip Ref: PS-${String(payslip.id).padStart(4, "0")}`, 350);

    doc.moveDown(2);

    // Earnings section
    const earningsTop = doc.y;
    doc.moveTo(50, earningsTop).lineTo(545, earningsTop).stroke();
    doc.moveDown(0.3);

    doc.fontSize(11).font("Helvetica-Bold").text("EARNINGS", 50);
    doc.moveDown(0.3);

    // Table header
    doc.fontSize(9).font("Helvetica-Bold");
    doc.text("Description", 60, doc.y, { width: 300 });
    doc.text("Amount", 450, doc.y - 11, { width: 80, align: "right" });
    doc.moveDown(0.5);

    doc.font("Helvetica").fontSize(9);
    let earningsY = doc.y;

    doc.text("Basic Pay", 60, earningsY);
    doc.text(fmt(payslip.basic_pay), 450, earningsY, { width: 80, align: "right" });
    earningsY += 15;

    if (Number(payslip.overtime) > 0) {
      doc.text("Overtime", 60, earningsY);
      doc.text(fmt(payslip.overtime), 450, earningsY, { width: 80, align: "right" });
      earningsY += 15;
    }

    if (Number(payslip.bonus) > 0) {
      doc.text("Bonus", 60, earningsY);
      doc.text(fmt(payslip.bonus), 450, earningsY, { width: 80, align: "right" });
      earningsY += 15;
    }

    earningsY += 5;
    doc.moveTo(50, earningsY).lineTo(545, earningsY).stroke();
    earningsY += 5;

    doc.font("Helvetica-Bold");
    doc.text("Gross Pay", 60, earningsY);
    doc.text(fmt(payslip.gross_pay), 450, earningsY, { width: 80, align: "right" });
    earningsY += 25;

    // Deductions section
    doc.moveTo(50, earningsY).lineTo(545, earningsY).stroke();
    earningsY += 8;

    doc.fontSize(11).font("Helvetica-Bold").text("DEDUCTIONS", 50, earningsY);
    earningsY += 18;

    doc.fontSize(9).font("Helvetica-Bold");
    doc.text("Description", 60, earningsY, { width: 300 });
    doc.text("Amount", 450, earningsY, { width: 80, align: "right" });
    earningsY += 15;

    doc.font("Helvetica").fontSize(9);

    doc.text("Income Tax (PAYE)", 60, earningsY);
    doc.text(fmt(payslip.tax), 450, earningsY, { width: 80, align: "right" });
    earningsY += 15;

    doc.text("National Insurance (Employee)", 60, earningsY);
    doc.text(fmt(payslip.ni_employee), 450, earningsY, { width: 80, align: "right" });
    earningsY += 15;

    if (Number(payslip.other_deductions) > 0) {
      doc.text("Other Deductions", 60, earningsY);
      doc.text(fmt(payslip.other_deductions), 450, earningsY, { width: 80, align: "right" });
      earningsY += 15;
    }

    const totalDeductions = Number(payslip.tax) + Number(payslip.ni_employee) + Number(payslip.other_deductions);
    earningsY += 5;
    doc.moveTo(50, earningsY).lineTo(545, earningsY).stroke();
    earningsY += 5;

    doc.font("Helvetica-Bold");
    doc.text("Total Deductions", 60, earningsY);
    doc.text(fmt(totalDeductions), 450, earningsY, { width: 80, align: "right" });
    earningsY += 25;

    // Net Pay
    doc.moveTo(50, earningsY).lineTo(545, earningsY).stroke();
    earningsY += 8;

    doc.fontSize(14).font("Helvetica-Bold");
    doc.text("NET PAY", 60, earningsY);
    doc.text(fmt(payslip.net_pay), 400, earningsY, { width: 130, align: "right" });
    earningsY += 25;

    doc.moveTo(50, earningsY).lineTo(545, earningsY).stroke();
    earningsY += 15;

    // Employer NI (for information)
    doc.fontSize(8).font("Helvetica").fillColor("#666666");
    doc.text(`Employer National Insurance Contribution: ${fmt(payslip.ni_employer)}`, 50, earningsY);
    earningsY += 20;

    // Footer
    doc.text("This payslip is computer generated and does not require a signature.", 50, earningsY, {
      align: "center",
      width: 495,
    });

    doc.end();
  });
}

module.exports = router;
