const db = require("../db");
const { getAccountIdByCode, createJournalEntry } = require("./journals.service");

async function getInvoiceWithLines(client, companyId, invoiceId) {
  const invRes = await client.query(
    `SELECT i.*, c.name AS customer_name, c.email AS customer_email,
            c.phone AS customer_phone, c.address AS customer_address,
            c.vat_number AS customer_vat_number, c.contact_person AS customer_contact_person
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.company_id=$1 AND i.id=$2`,
    [companyId, invoiceId]
  );
  if (invRes.rowCount === 0) return null;

  const linesRes = await client.query(
    `SELECT il.*, p.name AS product_name, p.sku AS product_sku
     FROM invoice_lines il
     LEFT JOIN products p ON p.id = il.product_id
     WHERE il.invoice_id=$1 ORDER BY il.id`,
    [invoiceId]
  );

  const row = invRes.rows[0];
  const invoice = {
    id: row.id, company_id: row.company_id, customer_id: row.customer_id,
    invoice_number: row.invoice_number, invoice_date: row.invoice_date,
    due_date: row.due_date, status: row.status, net_total: row.net_total,
    vat_total: row.vat_total, total: row.total, balance: row.balance,
    journal_entry_id: row.journal_entry_id,
    created_at: row.created_at, updated_at: row.updated_at,
  };

  const customer = {
    id: row.customer_id,
    name: row.customer_name,
    email: row.customer_email,
    phone: row.customer_phone,
    address: row.customer_address,
    vatNumber: row.customer_vat_number,
    contactPerson: row.customer_contact_person,
  };

  return { invoice, customer, lines: linesRes.rows };
}

function computeInvoiceTotals(lines) {
  let netTotal = 0, vatTotal = 0, total = 0;
  for (const l of lines) {
    const qty = Number(l.quantity || 1);
    const unitPrice = Number(l.unitPrice || l.unit_price || 0);
    const vatRate = Number(l.vatRate ?? l.vat_rate ?? 20);
    const lineNet = qty * unitPrice;
    const lineVat = lineNet * (vatRate / 100);
    netTotal += lineNet;
    vatTotal += lineVat;
    total += (lineNet + lineVat);
  }
  return { netTotal, vatTotal, total };
}

async function applyInvoiceStockMovement(client, companyId, invoiceId,
  invoiceNumber, lines, direction) {
  for (const l of lines) {
    const productId = l.productId ? Number(l.productId) :
      (l.product_id ? Number(l.product_id) : null);
    if (!productId) continue;

    const qty = Number(l.quantity || 1);
    const qtyChange = direction * qty;

    const pRes = await client.query(
      `SELECT id, stock_qty, track_inventory, type FROM products WHERE
       company_id=$1 AND id=$2 FOR UPDATE`,
      [companyId, productId]
    );
    if (pRes.rowCount === 0) continue;
    const p = pRes.rows[0];

    if (!p.track_inventory || p.type !== "inventory") continue;

    const newQty = p.stock_qty + qtyChange;
    if (newQty < 0) {
      const err = new Error(`Insufficient stock for productId=${productId}. Current=${p.stock_qty}, required=${qty}`);
      err.status = 400;
      throw err;
    }

    await client.query(
      `UPDATE products SET stock_qty=$1, updated_at=NOW() WHERE id=$2`,
      [newQty, productId]
    );

    await client.query(
      `INSERT INTO inventory_movements (company_id, product_id,
       movement_type, qty_change, reference_type, reference_id, note)
       VALUES ($1,$2,$3,$4,'INVOICE',$5,$6)`,
      [companyId, productId, direction === -1 ? "SALE" : "REVERSAL",
       qtyChange, invoiceId,
       `${direction === -1 ? "Invoice" : "Invoice reversal"} ${invoiceNumber}`]
    );
  }
}

async function createInvoice({ companyId, customerId, invoiceNumber,
  invoiceDate, dueDate, lines }) {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    const totals = computeInvoiceTotals(lines);

    const invRes = await client.query(
      `INSERT INTO invoices (company_id, customer_id, invoice_number,
       invoice_date, due_date, status, net_total, vat_total, total, balance)
       VALUES ($1,$2,$3,$4,$5,'SENT',$6,$7,$8,$8)
       RETURNING *`,
      [companyId, customerId, invoiceNumber, invoiceDate, dueDate || null,
       totals.netTotal, totals.vatTotal, totals.total]
    );
    const invoice = invRes.rows[0];

    for (const l of lines) {
      const qty = Number(l.quantity || 1);
      const unit = Number(l.unitPrice || 0);
      const vatRate = Number(l.vatRate ?? 20);
      const desc = l.description || "";
      const productId = l.productId ? Number(l.productId) : null;
      const lineTotal = qty * unit;

      await client.query(
        `INSERT INTO invoice_lines (invoice_id, product_id,
         description, quantity, unit_price, line_total, vat_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [invoice.id, productId, desc, qty, unit, lineTotal, vatRate]
      );
    }

    await applyInvoiceStockMovement(client, companyId, invoice.id,
      invoice.invoice_number, lines, -1);

    // Journal Posting
    try {
      const arId = await getAccountIdByCode(client, companyId, '1100');
      const salesId = await getAccountIdByCode(client, companyId, '4000');
      const vatId = await getAccountIdByCode(client, companyId, '2100');

      const journalId = await createJournalEntry(client, {
        companyId,
        entryDate: invoice.invoice_date,
        referenceType: 'INVOICE',
        referenceId: invoice.id,
        memo: `Invoice ${invoice.invoice_number}`,
        lines: [
          { accountId: arId, description: 'Accounts Receivable', debit: totals.total, credit: 0 },
          { accountId: salesId, description: 'Sales', debit: 0, credit: totals.netTotal },
          { accountId: vatId, description: 'VAT on sales', debit: 0, credit: totals.vatTotal },
        ],
      });

      await client.query(
        `UPDATE invoices SET journal_entry_id=$1 WHERE id=$2`,
        [journalId, invoice.id]
      );
    } catch (e) {
      // Journal posting is optional - don't fail invoice creation if chart of accounts not set up
      console.warn('Journal posting skipped:', e.message);
    }

    await client.query("COMMIT");
    return invoice;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function listInvoices({ companyId, customerId, status, dateFrom,
  dateTo, limit = 100, offset = 0 }) {
  const filters = [`company_id=$1`];
  const values = [companyId];
  let idx = values.length;

  if (customerId) { idx++; filters.push(`customer_id=$${idx}`); values.push(customerId); }
  if (status) { idx++; filters.push(`status=$${idx}`); values.push(status); }
  if (dateFrom) { idx++; filters.push(`invoice_date >= $${idx}`); values.push(dateFrom); }
  if (dateTo) { idx++; filters.push(`invoice_date <= $${idx}`); values.push(dateTo); }

  idx++; values.push(limit);
  idx++; values.push(offset);

  const q = `
    SELECT * FROM invoices
    WHERE ${filters.join(" AND ")}
    ORDER BY invoice_date DESC, id DESC
    LIMIT $${idx - 1} OFFSET $${idx}
  `;

  const res = await db.query(q, values);
  return res.rows;
}

async function getInvoiceDetail({ companyId, invoiceId }) {
  const client = await db.getClient();
  try {
    return await getInvoiceWithLines(client, companyId, invoiceId);
  } finally {
    client.release();
  }
}

async function updateInvoice({ companyId, invoiceId, patch }) {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    const existing = await getInvoiceWithLines(client, companyId, invoiceId);
    if (!existing) {
      const err = new Error("Invoice not found");
      err.status = 404;
      throw err;
    }

    const oldInvoice = existing.invoice;
    const oldLines = existing.lines;

    await applyInvoiceStockMovement(client, companyId, invoiceId,
      oldInvoice.invoice_number, oldLines, +1);

    await client.query(`DELETE FROM invoice_lines WHERE invoice_id=$1`, [invoiceId]);

    const newLines = patch.lines || [];
    if (!Array.isArray(newLines) || newLines.length === 0) {
      const err = new Error('"lines" required when updating invoice');
      err.status = 400;
      throw err;
    }

    const totals = computeInvoiceTotals(newLines);

    const invoiceNumber = patch.invoiceNumber || oldInvoice.invoice_number;
    const invoiceDate = patch.invoiceDate || oldInvoice.invoice_date;
    const dueDate = patch.dueDate ?? oldInvoice.due_date;
    const status = patch.status || oldInvoice.status;

    const upd = await client.query(
      `UPDATE invoices
       SET invoice_number=$1, invoice_date=$2, due_date=$3, status=$4,
           net_total=$5, vat_total=$6, total=$7, updated_at=NOW()
       WHERE company_id=$8 AND id=$9
       RETURNING *`,
      [invoiceNumber, invoiceDate, dueDate, status, totals.netTotal,
       totals.vatTotal, totals.total, companyId, invoiceId]
    );

    for (const l of newLines) {
      const qty = Number(l.quantity || 1);
      const unit = Number(l.unitPrice || 0);
      const vatRate = Number(l.vatRate ?? 20);
      const desc = l.description || "";
      const productId = l.productId ? Number(l.productId) : null;
      const lineTotal = qty * unit;

      await client.query(
        `INSERT INTO invoice_lines (invoice_id, product_id,
         description, quantity, unit_price, line_total, vat_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [invoiceId, productId, desc, qty, unit, lineTotal, vatRate]
      );
    }

    await applyInvoiceStockMovement(client, companyId, invoiceId,
      invoiceNumber, newLines, -1);

    await client.query("COMMIT");
    return upd.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function deleteInvoice({ companyId, invoiceId }) {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    const existing = await getInvoiceWithLines(client, companyId, invoiceId);
    if (!existing) {
      const err = new Error("Invoice not found");
      err.status = 404;
      throw err;
    }

    // Check for linked payments
    const paymentsCheck = await client.query(
      `SELECT id FROM payments WHERE invoice_id=$1`, [invoiceId]
    );
    const allocCheck = await client.query(
      `SELECT id FROM payment_allocations WHERE invoice_id=$1`, [invoiceId]
    );

    if (paymentsCheck.rowCount > 0 || allocCheck.rowCount > 0) {
      if (existing.invoice.status === "PAID") {
        const err = new Error("Cannot delete a PAID invoice that has payments recorded against it. Void it instead by updating status to VOID.");
        err.status = 400;
        throw err;
      }
      // For non-paid invoices with partial payments, delete the payments first
      await client.query(`DELETE FROM payment_allocations WHERE invoice_id=$1`, [invoiceId]);
      await client.query(`DELETE FROM payments WHERE invoice_id=$1`, [invoiceId]);
    }

    // Delete linked journal entries
    if (existing.invoice.journal_entry_id) {
      await client.query(`DELETE FROM journal_entries WHERE id=$1`, [existing.invoice.journal_entry_id]);
    }

    // Delete linked attachments
    await client.query(
      `DELETE FROM attachments WHERE parent_type='invoice' AND parent_id=$1 AND company_id=$2`,
      [invoiceId, companyId]
    );

    // Reverse stock movements
    await applyInvoiceStockMovement(client, companyId, invoiceId,
      existing.invoice.invoice_number, existing.lines, +1);

    await client.query(`DELETE FROM invoices WHERE company_id=$1 AND id=$2`,
      [companyId, invoiceId]);

    await client.query("COMMIT");
    return { deleted: true };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { createInvoice, listInvoices, getInvoiceDetail, updateInvoice, deleteInvoice };
