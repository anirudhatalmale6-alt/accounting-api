const db = require("../db");
const { getAccountIdByCode, createJournalEntry } = require("./journals.service");

async function getBillWithLines(client, companyId, billId) {
  const bRes = await client.query(
    `SELECT b.*, s.name AS supplier_name, s.email AS supplier_email,
            s.phone AS supplier_phone, s.address AS supplier_address,
            s.vat_number AS supplier_vat_number, s.contact_person AS supplier_contact_person
     FROM bills b
     LEFT JOIN suppliers s ON s.id = b.supplier_id
     WHERE b.company_id=$1 AND b.id=$2`,
    [companyId, billId]
  );
  if (bRes.rowCount === 0) return null;

  const linesRes = await client.query(
    `SELECT bl.*, p.name AS product_name, p.sku AS product_sku
     FROM bill_lines bl
     LEFT JOIN products p ON p.id = bl.product_id
     WHERE bl.bill_id=$1 ORDER BY bl.id`,
    [billId]
  );

  const row = bRes.rows[0];
  const bill = {
    id: row.id, company_id: row.company_id, supplier_id: row.supplier_id,
    bill_number: row.bill_number, bill_date: row.bill_date,
    due_date: row.due_date, status: row.status, total: row.total,
    balance: row.balance, journal_entry_id: row.journal_entry_id,
    created_at: row.created_at, updated_at: row.updated_at,
  };

  const supplier = {
    id: row.supplier_id,
    name: row.supplier_name,
    email: row.supplier_email,
    phone: row.supplier_phone,
    address: row.supplier_address,
    vatNumber: row.supplier_vat_number,
    contactPerson: row.supplier_contact_person,
  };

  return { bill, supplier, lines: linesRes.rows };
}

function computeBillTotals(lines) {
  let netTotal = 0, vatTotal = 0, total = 0;
  for (const l of lines) {
    const qty = Number(l.quantity || 1);
    const unitCost = Number(l.unitCost || l.unit_cost || 0);
    const vatRate = Number(l.vatRate ?? l.vat_rate ?? 20);
    const lineNet = qty * unitCost;
    const lineVat = lineNet * (vatRate / 100);
    netTotal += lineNet;
    vatTotal += lineVat;
    total += (lineNet + lineVat);
  }
  return { netTotal, vatTotal, total };
}

async function applyBillStockMovement(client, companyId, billId,
  billNumber, lines, direction) {
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
      const err = new Error(`Stock cannot go negative for productId=${productId}. Current=${p.stock_qty}, change=${qtyChange}`);
      err.status = 400;
      throw err;
    }

    await client.query(`UPDATE products SET stock_qty=$1, updated_at=NOW() WHERE id=$2`, [newQty, productId]);

    await client.query(
      `INSERT INTO inventory_movements (company_id, product_id,
       movement_type, qty_change, reference_type, reference_id, note)
       VALUES ($1,$2,$3,$4,'BILL',$5,$6)`,
      [companyId, productId, direction === +1 ? "PURCHASE" : "REVERSAL",
       qtyChange, billId,
       `${direction === +1 ? "Bill" : "Bill reversal"} ${billNumber}`]
    );
  }
}

async function createBill({ companyId, supplierId, billNumber,
  billDate, dueDate, lines }) {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    const totals = computeBillTotals(lines);

    const bRes = await client.query(
      `INSERT INTO bills (company_id, supplier_id, bill_number,
       bill_date, due_date, status, total, balance)
       VALUES ($1,$2,$3,$4,$5,'UNPAID',$6,$6)
       RETURNING *`,
      [companyId, supplierId, billNumber, billDate, dueDate || null, totals.total]
    );
    const bill = bRes.rows[0];

    for (const l of lines) {
      const qty = Number(l.quantity || 1);
      const unit = Number(l.unitCost || 0);
      const vatRate = Number(l.vatRate ?? 20);
      const desc = l.description || "";
      const productId = l.productId ? Number(l.productId) : null;
      const lineTotal = qty * unit;

      await client.query(
        `INSERT INTO bill_lines (bill_id, product_id, description,
         quantity, unit_cost, line_total, vat_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [bill.id, productId, desc, qty, unit, lineTotal, vatRate]
      );
    }

    await applyBillStockMovement(client, companyId, bill.id,
      bill.bill_number, lines, +1);

    // Journal Posting
    try {
      const expId = await getAccountIdByCode(client, companyId, '6000');
      const vatId = await getAccountIdByCode(client, companyId, '2100');
      const apId = await getAccountIdByCode(client, companyId, '2000');

      const journalId = await createJournalEntry(client, {
        companyId,
        entryDate: bill.bill_date,
        referenceType: 'BILL',
        referenceId: bill.id,
        memo: `Bill ${bill.bill_number}`,
        lines: [
          { accountId: expId, description: 'Purchases/Expenses net', debit: totals.netTotal, credit: 0 },
          { accountId: vatId, description: 'VAT on purchases', debit: totals.vatTotal, credit: 0 },
          { accountId: apId, description: 'Accounts payable total', debit: 0, credit: totals.total },
        ],
      });

      await client.query(
        `UPDATE bills SET journal_entry_id=$1 WHERE id=$2`,
        [journalId, bill.id]
      );
    } catch (e) {
      console.warn('Journal posting skipped:', e.message);
    }

    await client.query("COMMIT");
    return bill;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function listBills({ companyId, supplierId, status, dateFrom,
  dateTo, limit = 100, offset = 0 }) {
  const filters = [`company_id=$1`];
  const values = [companyId];
  let idx = values.length;

  if (supplierId) { idx++; filters.push(`supplier_id=$${idx}`); values.push(supplierId); }
  if (status) { idx++; filters.push(`status=$${idx}`); values.push(status); }
  if (dateFrom) { idx++; filters.push(`bill_date >= $${idx}`); values.push(dateFrom); }
  if (dateTo) { idx++; filters.push(`bill_date <= $${idx}`); values.push(dateTo); }

  idx++; values.push(limit);
  idx++; values.push(offset);

  const q = `
    SELECT * FROM bills
    WHERE ${filters.join(" AND ")}
    ORDER BY bill_date DESC, id DESC
    LIMIT $${idx - 1} OFFSET $${idx}
  `;

  const res = await db.query(q, values);
  return res.rows;
}

async function getBillDetail({ companyId, billId }) {
  const client = await db.getClient();
  try {
    return await getBillWithLines(client, companyId, billId);
  } finally {
    client.release();
  }
}

async function updateBill({ companyId, billId, patch }) {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    const existing = await getBillWithLines(client, companyId, billId);
    if (!existing) {
      const err = new Error("Bill not found");
      err.status = 404;
      throw err;
    }

    await applyBillStockMovement(client, companyId, billId,
      existing.bill.bill_number, existing.lines, -1);

    await client.query(`DELETE FROM bill_lines WHERE bill_id=$1`, [billId]);

    const newLines = patch.lines || [];
    if (!Array.isArray(newLines) || newLines.length === 0) {
      const err = new Error('"lines" required when updating bill');
      err.status = 400;
      throw err;
    }

    const totals = computeBillTotals(newLines);
    const billNumber = patch.billNumber || existing.bill.bill_number;
    const billDate = patch.billDate || existing.bill.bill_date;
    const dueDate = patch.dueDate ?? existing.bill.due_date;
    const status = patch.status || existing.bill.status;

    const upd = await client.query(
      `UPDATE bills SET bill_number=$1, bill_date=$2, due_date=$3,
       status=$4, total=$5, updated_at=NOW()
       WHERE company_id=$6 AND id=$7 RETURNING *`,
      [billNumber, billDate, dueDate, status, totals.total, companyId, billId]
    );

    for (const l of newLines) {
      const qty = Number(l.quantity || 1);
      const unit = Number(l.unitCost || 0);
      const vatRate = Number(l.vatRate ?? 20);
      const desc = l.description || "";
      const productId = l.productId ? Number(l.productId) : null;
      const lineTotal = qty * unit;

      await client.query(
        `INSERT INTO bill_lines (bill_id, product_id, description,
         quantity, unit_cost, line_total, vat_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [billId, productId, desc, qty, unit, lineTotal, vatRate]
      );
    }

    await applyBillStockMovement(client, companyId, billId,
      billNumber, newLines, +1);

    await client.query("COMMIT");
    return upd.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function deleteBill({ companyId, billId }) {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    const existing = await getBillWithLines(client, companyId, billId);
    if (!existing) {
      const err = new Error("Bill not found");
      err.status = 404;
      throw err;
    }

    // Check for linked payments
    const paymentsCheck = await client.query(
      `SELECT id FROM payments WHERE bill_id=$1`, [billId]
    );
    const allocCheck = await client.query(
      `SELECT id FROM payment_allocations WHERE bill_id=$1`, [billId]
    );

    if (paymentsCheck.rowCount > 0 || allocCheck.rowCount > 0) {
      if (existing.bill.status === "PAID") {
        const err = new Error("Cannot delete a PAID bill that has payments recorded against it. Void it instead by updating status to VOID.");
        err.status = 400;
        throw err;
      }
      await client.query(`DELETE FROM payment_allocations WHERE bill_id=$1`, [billId]);
      await client.query(`DELETE FROM payments WHERE bill_id=$1`, [billId]);
    }

    // Delete linked journal entries
    if (existing.bill.journal_entry_id) {
      await client.query(`DELETE FROM journal_entries WHERE id=$1`, [existing.bill.journal_entry_id]);
    }

    // Delete linked attachments
    await client.query(
      `DELETE FROM attachments WHERE parent_type='bill' AND parent_id=$1 AND company_id=$2`,
      [billId, companyId]
    );

    // Reverse stock movements
    await applyBillStockMovement(client, companyId, billId,
      existing.bill.bill_number, existing.lines, -1);

    await client.query(`DELETE FROM bills WHERE company_id=$1 AND id=$2`,
      [companyId, billId]);

    await client.query("COMMIT");
    return { deleted: true };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { createBill, listBills, getBillDetail, updateBill, deleteBill };
