const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /estimates/next-number
router.get("/next-number", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const prefix = req.query.prefix || "EST-";

    const result = await db.query(
      `SELECT estimate_number FROM estimates WHERE company_id=$1 ORDER BY id DESC LIMIT 1`,
      [companyId]
    );

    let nextNumber;
    if (result.rowCount === 0) {
      nextNumber = `${prefix}0001`;
    } else {
      const last = result.rows[0].estimate_number;
      const match = last.match(/(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10) + 1;
        const padded = String(num).padStart(match[1].length, "0");
        nextNumber = last.slice(0, last.length - match[1].length) + padded;
      } else {
        nextNumber = `${prefix}0001`;
      }
    }

    res.json({ nextEstimateNumber: nextNumber });
  } catch (e) { next(e); }
});

// POST /estimates
router.post("/", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const b = req.body;
    const customerId = b.customerId || b.customer_id;
    const estimateNumber = b.estimateNumber || b.estimate_number;
    const estimateDate = b.estimateDate || b.estimate_date;
    const expiryDate = b.expiryDate || b.expiry_date;
    const lines = b.lines || [];
    const notes = b.notes;
    const terms = b.terms;
    const reference = b.reference;
    const status = b.status || "draft";

    if (!estimateNumber || !estimateDate || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: "estimateNumber, estimateDate and lines are required" });
    }

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      let netTotal = 0;
      let vatTotal = 0;

      for (const l of lines) {
        const qty = Number(l.quantity || 1);
        const price = Number(l.unitPrice || l.unit_price || 0);
        const vatRate = Number(l.vatRate ?? l.vat_rate ?? 20);
        const lineNet = qty * price;
        const lineVat = lineNet * vatRate / 100;
        netTotal += lineNet;
        vatTotal += lineVat;
      }

      const total = netTotal + vatTotal;

      const result = await client.query(
        `INSERT INTO estimates (company_id, customer_id, estimate_number, reference, estimate_date, expiry_date, status, net_total, vat_total, total, notes, terms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [companyId, customerId || null, estimateNumber, reference || null, estimateDate, expiryDate || null, status, netTotal, vatTotal, total, notes || null, terms || null]
      );

      const estimate = result.rows[0];

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const qty = Number(l.quantity || 1);
        const price = Number(l.unitPrice || l.unit_price || 0);
        const vatRate = Number(l.vatRate ?? l.vat_rate ?? 20);
        const lineTotal = qty * price;

        await client.query(
          `INSERT INTO estimate_lines (estimate_id, description, quantity, unit_price, vat_rate, line_total, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [estimate.id, l.description || null, qty, price, vatRate, lineTotal, i]
        );
      }

      await client.query("COMMIT");
      res.json({ estimate });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// GET /estimates
router.get("/", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const { status, customerId, customer_id, dateFrom, dateTo, limit, offset } = req.query;
    const custId = customerId || customer_id;

    let query = `SELECT e.*, c.name AS customer_name
                 FROM estimates e
                 LEFT JOIN customers c ON c.id = e.customer_id
                 WHERE e.company_id=$1`;
    const params = [companyId];
    let idx = 2;

    if (status) { query += ` AND e.status=$${idx++}`; params.push(status); }
    if (custId) { query += ` AND e.customer_id=$${idx++}`; params.push(Number(custId)); }
    if (dateFrom) { query += ` AND e.estimate_date >= $${idx++}`; params.push(dateFrom); }
    if (dateTo) { query += ` AND e.estimate_date <= $${idx++}`; params.push(dateTo); }

    query += ` ORDER BY e.estimate_date DESC, e.id DESC`;
    query += ` LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Number(limit) || 100, Number(offset) || 0);

    const result = await db.query(query, params);
    res.json({ estimates: result.rows });
  } catch (e) { next(e); }
});

// GET /estimates/:id
router.get("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const id = Number(req.params.id);

    const est = await db.query(
      `SELECT e.*, c.name AS customer_name, c.email AS customer_email
       FROM estimates e
       LEFT JOIN customers c ON c.id = e.customer_id
       WHERE e.id=$1 AND e.company_id=$2`,
      [id, companyId]
    );
    if (est.rowCount === 0) return res.status(404).json({ error: "Estimate not found" });

    const lines = await db.query(
      `SELECT * FROM estimate_lines WHERE estimate_id=$1 ORDER BY sort_order`,
      [id]
    );

    res.json({ estimate: est.rows[0], lines: lines.rows });
  } catch (e) { next(e); }
});

// PUT /estimates/:id
router.put("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const id = Number(req.params.id);
    const b = req.body;
    const customerId = b.customerId || b.customer_id;
    const estimateNumber = b.estimateNumber || b.estimate_number;
    const estimateDate = b.estimateDate || b.estimate_date;
    const expiryDate = b.expiryDate || b.expiry_date;
    const lines = b.lines;
    const notes = b.notes;
    const terms = b.terms;
    const reference = b.reference;
    const status = b.status;

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      if (Array.isArray(lines) && lines.length > 0) {
        let netTotal = 0;
        let vatTotal = 0;

        for (const l of lines) {
          const qty = Number(l.quantity || 1);
          const price = Number(l.unitPrice || l.unit_price || 0);
          const vatRate = Number(l.vatRate ?? l.vat_rate ?? 20);
          const lineNet = qty * price;
          netTotal += lineNet;
          vatTotal += lineNet * vatRate / 100;
        }
        const total = netTotal + vatTotal;

        await client.query(
          `UPDATE estimates SET
            customer_id=COALESCE($3, customer_id),
            estimate_number=COALESCE($4, estimate_number),
            reference=COALESCE($5, reference),
            estimate_date=COALESCE($6, estimate_date),
            expiry_date=COALESCE($7, expiry_date),
            status=COALESCE($8, status),
            net_total=$9, vat_total=$10, total=$11,
            notes=COALESCE($12, notes),
            terms=COALESCE($13, terms),
            updated_at=NOW()
          WHERE id=$1 AND company_id=$2`,
          [id, companyId, customerId || null, estimateNumber || null, reference || null, estimateDate || null, expiryDate || null, status || null, netTotal, vatTotal, total, notes || null, terms || null]
        );

        await client.query(`DELETE FROM estimate_lines WHERE estimate_id=$1`, [id]);

        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          const qty = Number(l.quantity || 1);
          const price = Number(l.unitPrice || l.unit_price || 0);
          const vatRate = Number(l.vatRate ?? l.vat_rate ?? 20);
          const lineTotal = qty * price;

          await client.query(
            `INSERT INTO estimate_lines (estimate_id, description, quantity, unit_price, vat_rate, line_total, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [id, l.description || null, qty, price, vatRate, lineTotal, i]
          );
        }
      } else {
        await client.query(
          `UPDATE estimates SET
            customer_id=COALESCE($3, customer_id),
            estimate_number=COALESCE($4, estimate_number),
            reference=COALESCE($5, reference),
            estimate_date=COALESCE($6, estimate_date),
            expiry_date=COALESCE($7, expiry_date),
            status=COALESCE($8, status),
            notes=COALESCE($9, notes),
            terms=COALESCE($10, terms),
            updated_at=NOW()
          WHERE id=$1 AND company_id=$2`,
          [id, companyId, customerId || null, estimateNumber || null, reference || null, estimateDate || null, expiryDate || null, status || null, notes || null, terms || null]
        );
      }

      await client.query("COMMIT");

      const updated = await db.query(`SELECT * FROM estimates WHERE id=$1`, [id]);
      res.json({ estimate: updated.rows[0] });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// POST /estimates/:id/convert-to-invoice - Convert estimate to invoice
router.post("/:id/convert-to-invoice", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const id = Number(req.params.id);

    const est = await db.query(
      `SELECT * FROM estimates WHERE id=$1 AND company_id=$2`,
      [id, companyId]
    );
    if (est.rowCount === 0) return res.status(404).json({ error: "Estimate not found" });

    const estimate = est.rows[0];
    const lines = await db.query(
      `SELECT * FROM estimate_lines WHERE estimate_id=$1 ORDER BY sort_order`, [id]
    );

    const lastInv = await db.query(
      `SELECT invoice_number FROM invoices WHERE company_id=$1 ORDER BY id DESC LIMIT 1`,
      [companyId]
    );
    let invoiceNumber = "INV-0001";
    if (lastInv.rowCount > 0) {
      const match = lastInv.rows[0].invoice_number.match(/(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10) + 1;
        invoiceNumber = lastInv.rows[0].invoice_number.slice(0, -match[1].length) + String(num).padStart(match[1].length, "0");
      }
    }

    const { createInvoice } = require("../services/invoices.service");
    const invoiceLines = lines.rows.map(l => ({
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
      vatRate: Number(l.vat_rate),
    }));

    const invoice = await createInvoice({
      companyId,
      customerId: estimate.customer_id,
      invoiceNumber,
      invoiceDate: new Date().toISOString().split("T")[0],
      dueDate: null,
      lines: invoiceLines,
      note: estimate.notes,
    });

    await db.query(
      `UPDATE estimates SET status='accepted', updated_at=NOW() WHERE id=$1`,
      [id]
    );

    res.json({ invoice, estimateStatus: "accepted" });
  } catch (e) { next(e); }
});

// DELETE /estimates/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const id = Number(req.params.id);

    const result = await db.query(
      `DELETE FROM estimates WHERE id=$1 AND company_id=$2 RETURNING id`,
      [id, companyId]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: "Estimate not found" });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

module.exports = router;
