const db = require("../db");

async function recomputeInvoiceBalance(client, companyId, invoiceId) {
  const inv = await client.query(
    `SELECT total FROM invoices WHERE company_id=$1 AND id=$2`,
    [companyId, invoiceId]
  );
  if (inv.rowCount === 0) return;

  const alloc = await client.query(
    `SELECT COALESCE(SUM(amount),0) AS paid
     FROM payment_allocations
     WHERE company_id=$1 AND invoice_id=$2`,
    [companyId, invoiceId]
  );

  const total = Number(inv.rows[0].total);
  const paid = Number(alloc.rows[0].paid);
  const balance = Math.max(0, total - paid);

  const newStatus = balance <= 0 ? 'PAID' : 'SENT';

  await client.query(
    `UPDATE invoices SET balance=$1, status=$2, updated_at=NOW()
     WHERE company_id=$3 AND id=$4`,
    [balance, newStatus, companyId, invoiceId]
  );
}

async function recomputeBillBalance(client, companyId, billId) {
  const bill = await client.query(
    `SELECT total FROM bills WHERE company_id=$1 AND id=$2`,
    [companyId, billId]
  );
  if (bill.rowCount === 0) return;

  const alloc = await client.query(
    `SELECT COALESCE(SUM(amount),0) AS paid
     FROM payment_allocations
     WHERE company_id=$1 AND bill_id=$2`,
    [companyId, billId]
  );

  const total = Number(bill.rows[0].total);
  const paid = Number(alloc.rows[0].paid);
  const balance = Math.max(0, total - paid);

  const newStatus = balance <= 0 ? 'PAID' : 'UNPAID';

  await client.query(
    `UPDATE bills SET balance=$1, status=$2, updated_at=NOW()
     WHERE company_id=$3 AND id=$4`,
    [balance, newStatus, companyId, billId]
  );
}

module.exports = { recomputeInvoiceBalance, recomputeBillBalance };
