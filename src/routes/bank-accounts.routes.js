const express = require("express");
const db = require("../db");

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const { accountName, bankName, accountNumber, sortCode, iban, swiftBic, currency, openingBalance, isDefault } = req.body;
    if (!accountName) return res.status(400).json({ error: "accountName is required" });

    const balance = openingBalance || 0;
    const out = await db.query(
      `INSERT INTO bank_accounts (company_id, account_name, bank_name, account_number, sort_code, iban, swift_bic, currency, opening_balance, current_balance, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10)
       RETURNING *`,
      [companyId, accountName, bankName || null, accountNumber || null, sortCode || null, iban || null, swiftBic || null, currency || 'GBP', balance, isDefault || false]
    );
    res.json({ bankAccount: out.rows[0] });
  } catch (e) { next(e); }
});

router.get("/", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const out = await db.query(
      `SELECT * FROM bank_accounts WHERE company_id=$1 ORDER BY is_default DESC, account_name`,
      [companyId]
    );
    res.json({ bankAccounts: out.rows });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const out = await db.query(
      `SELECT * FROM bank_accounts WHERE id=$1 AND company_id=$2`,
      [Number(req.params.id), companyId]
    );
    if (out.rowCount === 0) return res.status(404).json({ error: "Bank account not found" });
    res.json({ bankAccount: out.rows[0] });
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const { accountName, bankName, accountNumber, sortCode, iban, swiftBic, currency, currentBalance, isDefault, isActive } = req.body;
    const out = await db.query(
      `UPDATE bank_accounts SET
         account_name=COALESCE($3,account_name), bank_name=COALESCE($4,bank_name),
         account_number=COALESCE($5,account_number), sort_code=COALESCE($6,sort_code),
         iban=COALESCE($7,iban), swift_bic=COALESCE($8,swift_bic),
         currency=COALESCE($9,currency), current_balance=COALESCE($10,current_balance),
         is_default=COALESCE($11,is_default), is_active=COALESCE($12,is_active),
         updated_at=NOW()
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [Number(req.params.id), companyId, accountName, bankName, accountNumber, sortCode, iban, swiftBic, currency, currentBalance, isDefault, isActive]
    );
    if (out.rowCount === 0) return res.status(404).json({ error: "Bank account not found" });
    res.json({ bankAccount: out.rows[0] });
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const out = await db.query(
      `DELETE FROM bank_accounts WHERE id=$1 AND company_id=$2 RETURNING id`,
      [Number(req.params.id), companyId]
    );
    if (out.rowCount === 0) return res.status(404).json({ error: "Bank account not found" });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

module.exports = router;
