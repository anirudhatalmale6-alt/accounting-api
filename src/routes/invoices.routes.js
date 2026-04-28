const express = require("express");
const {
  createInvoice, listInvoices, getInvoiceDetail, updateInvoice, deleteInvoice,
} = require("../services/invoices.service");

const router = express.Router();

// GET /invoices/next-number - get next auto-increment invoice number
router.get("/next-number", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const prefix = req.query.prefix || "INV-";

    // Get the latest invoice number for this company
    const result = await db.query(
      `SELECT invoice_number FROM invoices WHERE company_id=$1 ORDER BY id DESC LIMIT 1`,
      [companyId]
    );

    let nextNumber;
    if (result.rowCount === 0) {
      nextNumber = `${prefix}0001`;
    } else {
      const lastNumber = result.rows[0].invoice_number;
      // Try to extract numeric part from the last invoice number
      const match = lastNumber.match(/(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10) + 1;
        const padded = String(num).padStart(match[1].length, "0");
        const prefixPart = lastNumber.slice(0, lastNumber.length - match[1].length);
        nextNumber = prefixPart + padded;
      } else {
        nextNumber = `${prefix}0001`;
      }
    }

    // Check if this number already exists (handle edge cases)
    const exists = await db.query(
      `SELECT id FROM invoices WHERE company_id=$1 AND invoice_number=$2`,
      [companyId, nextNumber]
    );
    if (exists.rowCount > 0) {
      // Append timestamp to make unique
      nextNumber = `${prefix}${Date.now()}`;
    }

    res.json({ nextInvoiceNumber: nextNumber });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const { customerId, invoiceNumber, invoiceDate, dueDate, lines, note } = req.body;

    if (!customerId || !invoiceNumber || !invoiceDate ||
      !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const invoice = await createInvoice({ companyId, customerId,
      invoiceNumber, invoiceDate, dueDate, lines, note });
    res.json({ invoice });
  } catch (e) { next(e); }
});

router.get("/", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const data = await listInvoices({
      companyId,
      customerId: req.query.customerId ? Number(req.query.customerId) : null,
      status: req.query.status || null,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      limit: req.query.limit ? Number(req.query.limit) : 100,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    res.json({ invoices: data });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const invoiceId = Number(req.params.id);
    const detail = await getInvoiceDetail({ companyId, invoiceId });
    if (!detail) return res.status(404).json({ error: "Invoice not found" });
    res.json(detail);
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const invoiceId = Number(req.params.id);
    const updated = await updateInvoice({ companyId, invoiceId, patch: req.body });
    res.json({ invoice: updated });
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const invoiceId = Number(req.params.id);
    const out = await deleteInvoice({ companyId, invoiceId });
    res.json(out);
  } catch (e) { next(e); }
});

module.exports = router;
