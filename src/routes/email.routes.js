const express = require("express");
const db = require("../db");
const PDFDocument = require("pdfkit");

const router = express.Router();

// Helper: generate invoice PDF buffer
async function generateInvoicePdfBuffer(companyId, invoiceId) {
  const inv = await db.query(
    `SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.address AS customer_address
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.company_id=$1 AND i.id=$2`,
    [companyId, invoiceId]
  );
  if (inv.rowCount === 0) return null;

  const invoice = inv.rows[0];
  const lines = await db.query(
    `SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY id`,
    [invoiceId]
  );

  const company = await db.query(`SELECT * FROM companies WHERE id=$1`, [companyId]);
  const companyName = company.rows[0]?.name || "My Company";
  const symbol = company.rows[0]?.currency_symbol || "£";

  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    doc.on("data", (b) => buffers.push(b));
    doc.on("end", () => resolve({ buffer: Buffer.concat(buffers), invoice }));

    doc.fontSize(20).text(companyName, { align: "left" });
    doc.moveDown();
    doc.fontSize(16).text(`INVOICE ${invoice.invoice_number}`);
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(`Date: ${invoice.invoice_date}`);
    doc.text(`Due: ${invoice.due_date || "N/A"}`);
    doc.text(`Status: ${invoice.status}`);
    doc.moveDown();
    doc.text(`Bill To: ${invoice.customer_name || "N/A"}`);
    if (invoice.customer_address) doc.text(invoice.customer_address);
    doc.moveDown();

    doc.font("Helvetica-Bold");
    doc.text("Description", 50, doc.y, { width: 200, continued: false });
    const headerY = doc.y - 12;
    doc.text("Qty", 260, headerY, { width: 50 });
    doc.text("Price", 320, headerY, { width: 70 });
    doc.text("VAT%", 400, headerY, { width: 50 });
    doc.text("Total", 460, headerY, { width: 80 });
    doc.font("Helvetica");
    doc.moveDown(0.5);

    for (const l of lines.rows) {
      const y = doc.y;
      doc.text(l.description || "", 50, y, { width: 200 });
      doc.text(String(l.quantity), 260, y, { width: 50 });
      doc.text(`${symbol}${Number(l.unit_price).toFixed(2)}`, 320, y, { width: 70 });
      doc.text(`${Number(l.vat_rate).toFixed(0)}%`, 400, y, { width: 50 });
      doc.text(`${symbol}${Number(l.line_total).toFixed(2)}`, 460, y, { width: 80 });
      doc.moveDown(0.3);
    }

    doc.moveDown();
    doc.font("Helvetica-Bold");
    doc.text(`Net Total: ${symbol}${Number(invoice.net_total).toFixed(2)}`, { align: "right" });
    doc.text(`VAT: ${symbol}${Number(invoice.vat_total).toFixed(2)}`, { align: "right" });
    doc.text(`Total: ${symbol}${Number(invoice.total).toFixed(2)}`, { align: "right" });

    doc.end();
  });
}

// Helper: generate bill PDF buffer
async function generateBillPdfBuffer(companyId, billId) {
  const bill = await db.query(
    `SELECT b.*, s.name AS supplier_name, s.email AS supplier_email
     FROM bills b
     LEFT JOIN suppliers s ON s.id = b.supplier_id
     WHERE b.company_id=$1 AND b.id=$2`,
    [companyId, billId]
  );
  if (bill.rowCount === 0) return null;

  const billData = bill.rows[0];
  const lines = await db.query(
    `SELECT * FROM bill_lines WHERE bill_id=$1 ORDER BY id`,
    [billId]
  );

  const company = await db.query(`SELECT * FROM companies WHERE id=$1`, [companyId]);
  const companyName = company.rows[0]?.name || "My Company";
  const symbol = company.rows[0]?.currency_symbol || "£";

  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    doc.on("data", (b) => buffers.push(b));
    doc.on("end", () => resolve({ buffer: Buffer.concat(buffers), bill: billData }));

    doc.fontSize(20).text(companyName, { align: "left" });
    doc.moveDown();
    doc.fontSize(16).text(`BILL ${billData.bill_number}`);
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(`Date: ${billData.bill_date}`);
    doc.text(`Due: ${billData.due_date || "N/A"}`);
    doc.text(`Status: ${billData.status}`);
    doc.moveDown();
    doc.text(`From: ${billData.supplier_name || "N/A"}`);
    doc.moveDown();

    doc.font("Helvetica-Bold");
    doc.text("Description", 50, doc.y, { width: 200, continued: false });
    const headerY = doc.y - 12;
    doc.text("Qty", 260, headerY, { width: 50 });
    doc.text("Cost", 320, headerY, { width: 70 });
    doc.text("VAT%", 400, headerY, { width: 50 });
    doc.text("Total", 460, headerY, { width: 80 });
    doc.font("Helvetica");
    doc.moveDown(0.5);

    for (const l of lines.rows) {
      const y = doc.y;
      doc.text(l.description || "", 50, y, { width: 200 });
      doc.text(String(l.quantity), 260, y, { width: 50 });
      doc.text(`${symbol}${Number(l.unit_cost).toFixed(2)}`, 320, y, { width: 70 });
      doc.text(`${Number(l.vat_rate).toFixed(0)}%`, 400, y, { width: 50 });
      doc.text(`${symbol}${Number(l.line_total).toFixed(2)}`, 460, y, { width: 80 });
      doc.moveDown(0.3);
    }

    doc.moveDown();
    doc.font("Helvetica-Bold");
    doc.text(`Total: ${symbol}${Number(billData.total).toFixed(2)}`, { align: "right" });

    doc.end();
  });
}


// Helper: generate VAT summary PDF buffer
async function generateVatSummaryPdfBuffer(companyId, dateFrom, dateTo) {
  const PDFDocument = require("pdfkit");

  const company = await db.query(`SELECT * FROM companies WHERE id=$1`, [companyId]);
  const companyName = company.rows[0]?.name || "My Company";
  const symbol = "£";

  // VAT on sales (output VAT)
  const salesVat = await db.query(
    `SELECT COALESCE(SUM(vat_total),0) AS vat_collected,
            COALESCE(SUM(net_total),0) AS sales_ex_vat,
            COALESCE(SUM(total),0) AS sales_inc_vat,
            COUNT(*) AS invoice_count
     FROM invoices WHERE company_id=$1 AND invoice_date BETWEEN $2 AND $3`,
    [companyId, dateFrom, dateTo]
  );

  // VAT on purchases (input VAT)
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
  const salesNet = Number(salesVat.rows[0].sales_ex_vat);
  const salesGross = Number(salesVat.rows[0].sales_inc_vat);
  const purchasesNet = Number(purchaseVat.rows[0].purchases_ex_vat);
  const invoiceCount = Number(salesVat.rows[0].invoice_count);
  const billCount = Number(purchaseVat.rows[0].bill_count);

  // Get individual invoices for breakdown
  const invoices = await db.query(
    `SELECT i.invoice_number, i.invoice_date, c.name AS customer_name,
            i.net_total, i.vat_total, i.total
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.company_id=$1 AND i.invoice_date BETWEEN $2 AND $3
     ORDER BY i.invoice_date`,
    [companyId, dateFrom, dateTo]
  );

  // Get individual bills for breakdown
  const bills = await db.query(
    `SELECT b.bill_number, b.bill_date, s.name AS supplier_name,
            COALESCE(SUM(bl.line_total),0) AS net_total,
            COALESCE(SUM(bl.line_total * bl.vat_rate / 100),0) AS vat_total,
            b.total
     FROM bills b
     LEFT JOIN suppliers s ON s.id = b.supplier_id
     JOIN bill_lines bl ON bl.bill_id = b.id
     WHERE b.company_id=$1 AND b.bill_date BETWEEN $2 AND $3
     GROUP BY b.id, b.bill_number, b.bill_date, s.name, b.total
     ORDER BY b.bill_date`,
    [companyId, dateFrom, dateTo]
  );

  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    doc.on("data", (b) => buffers.push(b));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    // Header
    doc.fontSize(20).text(companyName, { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(16).text("VAT Summary Report");
    doc.moveDown(0.3);
    doc.fontSize(10).text(`Period: ${dateFrom} to ${dateTo}`);
    doc.moveDown(1);

    // Summary boxes
    doc.fontSize(12).font("Helvetica-Bold");
    doc.text("VAT Overview");
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica");

    const col1 = 50, col2 = 400;
    let y = doc.y;
    doc.text("VAT Collected (Output VAT)", col1, y);
    doc.text(`${symbol}${vatCollected.toFixed(2)}`, col2, y, { width: 100, align: "right" });
    y += 18;
    doc.text("VAT Paid (Input VAT)", col1, y);
    doc.text(`${symbol}${vatPaid.toFixed(2)}`, col2, y, { width: 100, align: "right" });
    y += 18;
    doc.moveTo(col1, y).lineTo(500, y).stroke();
    y += 5;
    doc.font("Helvetica-Bold");
    doc.text(vatOwed >= 0 ? "VAT Owed to HMRC" : "VAT Refund Due from HMRC", col1, y);
    doc.text(`${symbol}${Math.abs(vatOwed).toFixed(2)}`, col2, y, { width: 100, align: "right" });
    doc.font("Helvetica");

    doc.moveDown(2);

    // Sales breakdown
    doc.fontSize(12).font("Helvetica-Bold");
    doc.text(`Sales Breakdown (${invoiceCount} invoices)`);
    doc.moveDown(0.3);
    doc.fontSize(9).font("Helvetica");

    if (invoices.rows.length > 0) {
      // Table header
      y = doc.y;
      doc.font("Helvetica-Bold");
      doc.text("Invoice", 50, y, { width: 70 });
      doc.text("Date", 125, y, { width: 70 });
      doc.text("Customer", 200, y, { width: 130 });
      doc.text("Net", 335, y, { width: 55, align: "right" });
      doc.text("VAT", 395, y, { width: 50, align: "right" });
      doc.text("Total", 450, y, { width: 55, align: "right" });
      doc.font("Helvetica");
      doc.moveDown(0.5);

      for (const inv of invoices.rows) {
        y = doc.y;
        if (y > 700) { doc.addPage(); y = doc.y; }
        doc.text(inv.invoice_number || "", 50, y, { width: 70 });
        doc.text(String(inv.invoice_date).slice(0, 10), 125, y, { width: 70 });
        doc.text((inv.customer_name || "").slice(0, 20), 200, y, { width: 130 });
        doc.text(`${symbol}${Number(inv.net_total).toFixed(2)}`, 335, y, { width: 55, align: "right" });
        doc.text(`${symbol}${Number(inv.vat_total).toFixed(2)}`, 395, y, { width: 50, align: "right" });
        doc.text(`${symbol}${Number(inv.total).toFixed(2)}`, 450, y, { width: 55, align: "right" });
        doc.moveDown(0.3);
      }

      doc.moveDown(0.3);
      doc.font("Helvetica-Bold");
      y = doc.y;
      doc.text("Total Sales", 50, y);
      doc.text(`${symbol}${salesNet.toFixed(2)}`, 335, y, { width: 55, align: "right" });
      doc.text(`${symbol}${vatCollected.toFixed(2)}`, 395, y, { width: 50, align: "right" });
      doc.text(`${symbol}${salesGross.toFixed(2)}`, 450, y, { width: 55, align: "right" });
      doc.font("Helvetica");
    } else {
      doc.text("No sales in this period.");
    }

    doc.moveDown(1.5);

    // Purchases breakdown
    doc.fontSize(12).font("Helvetica-Bold");
    doc.text(`Purchases Breakdown (${billCount} bills)`);
    doc.moveDown(0.3);
    doc.fontSize(9).font("Helvetica");

    if (bills.rows.length > 0) {
      y = doc.y;
      doc.font("Helvetica-Bold");
      doc.text("Bill", 50, y, { width: 70 });
      doc.text("Date", 125, y, { width: 70 });
      doc.text("Supplier", 200, y, { width: 130 });
      doc.text("Net", 335, y, { width: 55, align: "right" });
      doc.text("VAT", 395, y, { width: 50, align: "right" });
      doc.text("Total", 450, y, { width: 55, align: "right" });
      doc.font("Helvetica");
      doc.moveDown(0.5);

      for (const b of bills.rows) {
        y = doc.y;
        if (y > 700) { doc.addPage(); y = doc.y; }
        doc.text(b.bill_number || "", 50, y, { width: 70 });
        doc.text(String(b.bill_date).slice(0, 10), 125, y, { width: 70 });
        doc.text((b.supplier_name || "").slice(0, 20), 200, y, { width: 130 });
        doc.text(`${symbol}${Number(b.net_total).toFixed(2)}`, 335, y, { width: 55, align: "right" });
        doc.text(`${symbol}${Number(b.vat_total).toFixed(2)}`, 395, y, { width: 50, align: "right" });
        doc.text(`${symbol}${Number(b.total).toFixed(2)}`, 450, y, { width: 55, align: "right" });
        doc.moveDown(0.3);
      }

      doc.moveDown(0.3);
      doc.font("Helvetica-Bold");
      y = doc.y;
      doc.text("Total Purchases", 50, y);
      doc.text(`${symbol}${purchasesNet.toFixed(2)}`, 335, y, { width: 55, align: "right" });
      doc.text(`${symbol}${vatPaid.toFixed(2)}`, 395, y, { width: 50, align: "right" });
      doc.text(`${symbol}${(purchasesNet + vatPaid).toFixed(2)}`, 450, y, { width: 55, align: "right" });
      doc.font("Helvetica");
    } else {
      doc.text("No purchases in this period.");
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).fillColor("gray");
    doc.text(`Generated on ${new Date().toISOString().slice(0, 10)} by Gas Man Accounting`, { align: "center" });

    doc.end();
  });
}

// POST /email/invoices/:invoiceId/send
router.post("/invoices/:invoiceId/send", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const invoiceId = Number(req.params.invoiceId);
    const toEmail = req.body.toEmail;

    const result = await generateInvoicePdfBuffer(companyId, invoiceId);
    if (!result) return res.status(404).json({ error: "Invoice not found" });

    const { buffer, invoice } = result;

    // Get customer email if toEmail not provided
    const recipient = toEmail || invoice.customer_email;
    if (!recipient) {
      return res.status(400).json({ error: "No recipient email. Provide toEmail in body or set customer email." });
    }

    const subject = `Invoice ${invoice.invoice_number} from ${(await db.query('SELECT name FROM companies WHERE id=$1', [companyId])).rows[0]?.name || 'My Company'}`;
    const body = `Hi ${invoice.customer_name || ''},\n\nPlease find our invoice ${invoice.invoice_number} attached.\n\nThanks,\n${ (await db.query('SELECT name FROM companies WHERE id=$1', [companyId])).rows[0]?.name || 'My Company'}`;

    // Try to send email via nodemailer if SMTP is configured
    if (process.env.SMTP_HOST) {
      const nodemailer = require("nodemailer");
      const smtpConfig = {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
      };
      if (process.env.SMTP_USER) {
        smtpConfig.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
      }
      if (process.env.SMTP_HOST === "localhost" || process.env.SMTP_HOST === "127.0.0.1") {
        smtpConfig.tls = { rejectUnauthorized: false };
      }
      const transporter = nodemailer.createTransport(smtpConfig);

      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@gasman-app.com",
          to: recipient,
          subject,
          text: body,
          attachments: [{
            filename: `${invoice.invoice_number}.pdf`,
            content: buffer,
          }],
        });

        await db.query(
          `INSERT INTO email_logs (company_id, to_email, subject, body, attachment_name, reference_type, reference_id, status)
           VALUES ($1,$2,$3,$4,$5,'INVOICE',$6,'SENT')`,
          [companyId, recipient, subject, body, `${invoice.invoice_number}.pdf`, invoiceId]
        );

        res.json({ sent: true, toEmail: recipient, subject });
      } catch (mailErr) {
        await db.query(
          `INSERT INTO email_logs (company_id, to_email, subject, body, attachment_name, reference_type, reference_id, status, error_message)
           VALUES ($1,$2,$3,$4,$5,'INVOICE',$6,'FAILED',$7)`,
          [companyId, recipient, subject, body, `${invoice.invoice_number}.pdf`, invoiceId, mailErr.message]
        );
        res.json({ sent: false, error: mailErr.message, toEmail: recipient });
      }
    } else {
      // No SMTP configured - return PDF as download instead
      res.json({
        sent: false,
        reason: "SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env to enable email sending.",
        toEmail: recipient,
        subject,
        pdfBase64: buffer.toString("base64"),
        pdfFilename: `${invoice.invoice_number}.pdf`,
      });
    }
  } catch (e) { next(e); }
});

// POST /email/bills/:billId/send
router.post("/bills/:billId/send", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const billId = Number(req.params.billId);
    const toEmail = req.body.toEmail;

    const result = await generateBillPdfBuffer(companyId, billId);
    if (!result) return res.status(404).json({ error: "Bill not found" });

    const { buffer, bill } = result;

    const recipient = toEmail || bill.supplier_email;
    if (!recipient) {
      return res.status(400).json({ error: "No recipient email. Provide toEmail in body or set supplier email." });
    }

    const companyName = (await db.query('SELECT name FROM companies WHERE id=$1', [companyId])).rows[0]?.name || 'My Company';
    const subject = `Bill ${bill.bill_number} from ${companyName}`;
    const body = `Hi ${bill.supplier_name || ''},\n\nPlease find our bill ${bill.bill_number} attached.\n\nThanks,\n${companyName}`;

    if (process.env.SMTP_HOST) {
      const nodemailer = require("nodemailer");
      const smtpConfig = {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
      };
      if (process.env.SMTP_USER) {
        smtpConfig.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
      }
      if (process.env.SMTP_HOST === "localhost" || process.env.SMTP_HOST === "127.0.0.1") {
        smtpConfig.tls = { rejectUnauthorized: false };
      }
      const transporter = nodemailer.createTransport(smtpConfig);

      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@gasman-app.com",
          to: recipient,
          subject,
          text: body,
          attachments: [{
            filename: `${bill.bill_number}.pdf`,
            content: buffer,
          }],
        });

        await db.query(
          `INSERT INTO email_logs (company_id, to_email, subject, body, attachment_name, reference_type, reference_id, status)
           VALUES ($1,$2,$3,$4,$5,'BILL',$6,'SENT')`,
          [companyId, recipient, subject, body, `${bill.bill_number}.pdf`, billId]
        );

        res.json({ sent: true, toEmail: recipient, subject });
      } catch (mailErr) {
        await db.query(
          `INSERT INTO email_logs (company_id, to_email, subject, body, attachment_name, reference_type, reference_id, status, error_message)
           VALUES ($1,$2,$3,$4,$5,'BILL',$6,'FAILED',$7)`,
          [companyId, recipient, subject, body, `${bill.bill_number}.pdf`, billId, mailErr.message]
        );
        res.json({ sent: false, error: mailErr.message, toEmail: recipient });
      }
    } else {
      res.json({
        sent: false,
        reason: "SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env to enable email sending.",
        toEmail: recipient,
        subject,
        pdfBase64: buffer.toString("base64"),
        pdfFilename: `${bill.bill_number}.pdf`,
      });
    }
  } catch (e) { next(e); }
});


// POST /email/vat-summary/send - Send VAT summary PDF via email
router.post("/vat-summary/send", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const toEmail = req.body.toEmail;
    const dateFrom = req.body.dateFrom || "1900-01-01";
    const dateTo = req.body.dateTo || new Date().toISOString().slice(0, 10);

    if (!toEmail) {
      return res.status(400).json({ error: "toEmail is required" });
    }

    const buffer = await generateVatSummaryPdfBuffer(companyId, dateFrom, dateTo);
    const companyName = (await db.query('SELECT name FROM companies WHERE id=$1', [companyId])).rows[0]?.name || 'My Company';
    const subject = `VAT Summary Report (${dateFrom} to ${dateTo}) - ${companyName}`;
    const body = `Hi,\n\nPlease find the VAT Summary Report for the period ${dateFrom} to ${dateTo} attached.\n\nThanks,\n${companyName}`;
    const filename = `VAT_Summary_${dateFrom}_to_${dateTo}.pdf`;

    if (process.env.SMTP_HOST) {
      const nodemailer = require("nodemailer");
      const smtpConfig = {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
      };
      if (process.env.SMTP_USER) {
        smtpConfig.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
      }
      const transporter = nodemailer.createTransport(smtpConfig);

      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: toEmail,
          subject,
          text: body,
          attachments: [{ filename, content: buffer }],
        });

        res.json({ sent: true, toEmail, subject, pdfFilename: filename });
      } catch (mailErr) {
        res.json({ sent: false, error: mailErr.message, toEmail });
      }
    } else {
      res.json({
        sent: false,
        reason: "SMTP not configured",
        toEmail,
        subject,
        pdfBase64: buffer.toString("base64"),
        pdfFilename: filename,
      });
    }
  } catch (e) { next(e); }
});

// GET /email/vat-summary/pdf - Download VAT summary as PDF
router.get("/vat-summary/pdf", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const dateFrom = req.query.dateFrom || "1900-01-01";
    const dateTo = req.query.dateTo || new Date().toISOString().slice(0, 10);

    const buffer = await generateVatSummaryPdfBuffer(companyId, dateFrom, dateTo);
    const filename = `VAT_Summary_${dateFrom}_to_${dateTo}.pdf`;

    res.json({
      pdfBase64: buffer.toString("base64"),
      pdfFilename: filename,
    });
  } catch (e) { next(e); }
});

module.exports = router;
