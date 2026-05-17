const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const result = await db.query(
      `SELECT id, name, business_name, address, phone, email, vrn,
              company_reg, utr, website, logo_url,
              currency_code, currency_symbol, default_reminder_hours
       FROM companies WHERE id = $1`,
      [companyId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Company not found" });
    }

    res.json(result.rows[0]);
  } catch (e) { next(e); }
});

router.put("/", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const {
      name, businessName, address, phone, email, vrn,
      companyReg, utr, website, logoUrl,
      currencyCode, currencySymbol, defaultReminderHours,
    } = req.body;

    const result = await db.query(
      `UPDATE companies SET
        name = COALESCE($2, name),
        business_name = COALESCE($3, business_name),
        address = COALESCE($4, address),
        phone = COALESCE($5, phone),
        email = COALESCE($6, email),
        vrn = COALESCE($7, vrn),
        company_reg = COALESCE($8, company_reg),
        utr = COALESCE($9, utr),
        website = COALESCE($10, website),
        logo_url = COALESCE($11, logo_url),
        currency_code = COALESCE($12, currency_code),
        currency_symbol = COALESCE($13, currency_symbol),
        default_reminder_hours = COALESCE($14, default_reminder_hours)
      WHERE id = $1
      RETURNING *`,
      [
        companyId,
        name || null,
        businessName || null,
        address || null,
        phone || null,
        email || null,
        vrn || null,
        companyReg || null,
        utr || null,
        website || null,
        logoUrl || null,
        currencyCode || null,
        currencySymbol || null,
        defaultReminderHours != null ? defaultReminderHours : null,
      ]
    );

    res.json(result.rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
