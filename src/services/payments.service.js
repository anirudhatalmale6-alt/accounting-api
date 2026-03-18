const db = require("../db");
const { getAccountIdByCode, createJournalEntry } = require("./journals.service");
const { recomputeInvoiceBalance, recomputeBillBalance } = require("./ar_ap.service");

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

async function createCustomerReceipt({ companyId, invoiceId, amount, paymentDate, memo }) {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    const inv = await client.query(
      `SELECT id, company_id, customer_id, invoice_number, total, balance
       FROM invoices WHERE company_id=$1 AND id=$2 FOR UPDATE`,
      [companyId, invoiceId]
    );
    if (inv.rowCount === 0) {
      const err = new Error("Invoice not found");
      err.status = 404;
      throw err;
    }

    const invoice = inv.rows[0];
    const alloc = Math.min(round2(amount), round2(Number(invoice.balance)));
    if (alloc <= 0) {
      const err = new Error("Invoice has no outstanding balance");
      err.status = 400;
      throw err;
    }

    const bankId = await getAccountIdByCode(client, companyId, "1000");
    const arId = await getAccountIdByCode(client, companyId, "1100");

    const journalId = await createJournalEntry(client, {
      companyId,
      entryDate: paymentDate,
      referenceType: 'PAYMENT',
      referenceId: invoiceId,
      memo: memo || `Customer receipt for ${invoice.invoice_number}`,
      lines: [
        { accountId: bankId, description: 'Money received', debit: alloc, credit: 0 },
        { accountId: arId, description: 'Reduce Accounts Receivable', debit: 0, credit: alloc },
      ],
    });

    const pay = await client.query(
      `INSERT INTO payments (company_id, payment_date, type,
       customer_id, invoice_id, amount, memo, journal_entry_id)
       VALUES ($1,$2,'CUSTOMER_RECEIPT',$3,$4,$5,$6,$7)
       RETURNING *`,
      [companyId, paymentDate, invoice.customer_id, invoiceId, alloc, memo || null, journalId]
    );

    await client.query(
      `INSERT INTO payment_allocations (company_id, payment_id, invoice_id, amount)
       VALUES ($1,$2,$3,$4)`,
      [companyId, pay.rows[0].id, invoiceId, alloc]
    );

    await recomputeInvoiceBalance(client, companyId, invoiceId);

    await client.query("COMMIT");
    return pay.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function createSupplierPayment({ companyId, billId, amount, paymentDate, memo }) {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    const bRes = await client.query(
      `SELECT id, supplier_id, bill_number, total, balance
       FROM bills WHERE company_id=$1 AND id=$2 FOR UPDATE`,
      [companyId, billId]
    );
    if (bRes.rowCount === 0) {
      const err = new Error("Bill not found");
      err.status = 404;
      throw err;
    }

    const bill = bRes.rows[0];
    const alloc = Math.min(round2(amount), round2(Number(bill.balance)));
    if (alloc <= 0) {
      const err = new Error("Bill has no outstanding balance");
      err.status = 400;
      throw err;
    }

    const bankId = await getAccountIdByCode(client, companyId, "1000");
    const apId = await getAccountIdByCode(client, companyId, "2000");

    const journalId = await createJournalEntry(client, {
      companyId,
      entryDate: paymentDate,
      referenceType: 'PAYMENT',
      referenceId: billId,
      memo: memo || `Supplier payment for ${bill.bill_number}`,
      lines: [
        { accountId: apId, description: 'Reduce Accounts Payable', debit: alloc, credit: 0 },
        { accountId: bankId, description: 'Money paid out', debit: 0, credit: alloc },
      ],
    });

    const pay = await client.query(
      `INSERT INTO payments (company_id, payment_date, type,
       supplier_id, bill_id, amount, memo, journal_entry_id)
       VALUES ($1,$2,'SUPPLIER_PAYMENT',$3,$4,$5,$6,$7)
       RETURNING *`,
      [companyId, paymentDate, bill.supplier_id, billId, alloc, memo || null, journalId]
    );

    await client.query(
      `INSERT INTO payment_allocations (company_id, payment_id, bill_id, amount)
       VALUES ($1,$2,$3,$4)`,
      [companyId, pay.rows[0].id, billId, alloc]
    );

    await recomputeBillBalance(client, companyId, billId);

    await client.query("COMMIT");
    return pay.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { createCustomerReceipt, createSupplierPayment };
