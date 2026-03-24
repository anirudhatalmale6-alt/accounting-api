const express = require("express");
const db = require("../db");

const router = express.Router();

// Create bank transaction
router.post("/", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const { bankAccountId, transactionDate, type, amount, description, reference, category, invoiceId, billId, paymentId } = req.body;

    if (!bankAccountId || !transactionDate || !amount) {
      return res.status(400).json({ error: "bankAccountId, transactionDate, and amount are required" });
    }

    const txType = type || "DEPOSIT";
    if (!["DEPOSIT", "WITHDRAWAL", "TRANSFER", "REFUND", "FEE", "INTEREST"].includes(txType)) {
      return res.status(400).json({ error: "type must be DEPOSIT, WITHDRAWAL, TRANSFER, REFUND, FEE, or INTEREST" });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const out = await client.query(
        `INSERT INTO bank_transactions (company_id, bank_account_id, transaction_date, type, amount, description, reference, category, invoice_id, bill_id, payment_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [companyId, bankAccountId, transactionDate, txType, amount, description || null, reference || null, category || null, invoiceId || null, billId || null, paymentId || null]
      );

      // Update bank account balance
      const balanceChange = ["DEPOSIT", "REFUND", "INTEREST"].includes(txType) ? Number(amount) : -Number(amount);
      await client.query(
        `UPDATE bank_accounts SET current_balance = current_balance + $2, updated_at=NOW() WHERE id=$1`,
        [bankAccountId, balanceChange]
      );

      await client.query("COMMIT");
      res.json({ transaction: out.rows[0] });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// List bank transactions
router.get("/", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const bankAccountId = req.query.bankAccountId ? Number(req.query.bankAccountId) : null;
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const type = req.query.type || null;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    let q = `SELECT bt.*, ba.account_name AS bank_account_name
             FROM bank_transactions bt
             JOIN bank_accounts ba ON ba.id=bt.bank_account_id
             WHERE bt.company_id=$1`;
    const params = [companyId];
    let paramIdx = 2;

    if (bankAccountId) {
      q += ` AND bt.bank_account_id=$${paramIdx++}`;
      params.push(bankAccountId);
    }
    if (dateFrom) {
      q += ` AND bt.transaction_date >= $${paramIdx++}`;
      params.push(dateFrom);
    }
    if (dateTo) {
      q += ` AND bt.transaction_date <= $${paramIdx++}`;
      params.push(dateTo);
    }
    if (type) {
      q += ` AND bt.type=$${paramIdx++}`;
      params.push(type);
    }

    q += ` ORDER BY bt.transaction_date DESC, bt.id DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);

    const out = await db.query(q, params);
    res.json({ transactions: out.rows });
  } catch (e) { next(e); }
});

// Get single transaction
router.get("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const out = await db.query(
      `SELECT bt.*, ba.account_name AS bank_account_name
       FROM bank_transactions bt
       JOIN bank_accounts ba ON ba.id=bt.bank_account_id
       WHERE bt.id=$1 AND bt.company_id=$2`,
      [Number(req.params.id), companyId]
    );
    if (out.rowCount === 0) return res.status(404).json({ error: "Transaction not found" });
    res.json({ transaction: out.rows[0] });
  } catch (e) { next(e); }
});

// Update transaction
router.put("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const txId = Number(req.params.id);
    const { description, reference, category, isReconciled } = req.body;

    const out = await db.query(
      `UPDATE bank_transactions SET
         description=COALESCE($3,description), reference=COALESCE($4,reference),
         category=COALESCE($5,category), is_reconciled=COALESCE($6,is_reconciled),
         updated_at=NOW()
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [txId, companyId, description, reference, category, isReconciled]
    );
    if (out.rowCount === 0) return res.status(404).json({ error: "Transaction not found" });
    res.json({ transaction: out.rows[0] });
  } catch (e) { next(e); }
});

// Delete transaction (reverses balance change)
router.delete("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const txId = Number(req.params.id);

    const existing = await db.query(
      `SELECT * FROM bank_transactions WHERE id=$1 AND company_id=$2`,
      [txId, companyId]
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: "Transaction not found" });

    const tx = existing.rows[0];
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Reverse the balance change
      const reverseAmount = ["DEPOSIT", "REFUND", "INTEREST"].includes(tx.type) ? -Number(tx.amount) : Number(tx.amount);
      await client.query(
        `UPDATE bank_accounts SET current_balance = current_balance + $2, updated_at=NOW() WHERE id=$1`,
        [tx.bank_account_id, reverseAmount]
      );

      await client.query(`DELETE FROM bank_transactions WHERE id=$1`, [txId]);

      await client.query("COMMIT");
      res.json({ deleted: true });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

// Reconcile multiple transactions
router.post("/reconcile", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const { transactionIds } = req.body;

    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.status(400).json({ error: "transactionIds array is required" });
    }

    const out = await db.query(
      `UPDATE bank_transactions SET is_reconciled=true, updated_at=NOW()
       WHERE company_id=$1 AND id=ANY($2)
       RETURNING id`,
      [companyId, transactionIds]
    );
    res.json({ reconciled: out.rowCount });
  } catch (e) { next(e); }
});

module.exports = router;
