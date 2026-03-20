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

// POST /email/invoices/:invoiceId/send
router.post("/invoices/:invoiceId/send", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
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
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      try {
        await transporter.sendMail({
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
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
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
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      try {
        await transporter.sendMail({
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

module.exports = router;
