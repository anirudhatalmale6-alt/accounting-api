const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("../db");

const router = express.Router();

const logoDir = path.join(__dirname, "../../uploads/logos");
if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir, { recursive: true });

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, logoDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".png";
      cb(null, `company_${req.user.companyId}_${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

router.get("/", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const result = await db.query(
      `SELECT id, name, business_name, address, phone, email, vrn,
              company_reg, utr, website, logo_url,
              currency_code, currency_symbol, default_reminder_hours,
              payment_details, gas_safe_number, postal_code, invoice_prefix
       FROM companies WHERE id = $1`,
      [companyId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Company not found" });
    }

    res.json(result.rows[0]);
  } catch (e) { next(e); }
});

router.put("/", logoUpload.single("logo"), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const {
      name, businessName, address, phone, email, vrn,
      companyReg, utr, website,
      currencyCode, currencySymbol, defaultReminderHours,
      paymentDetails, gasSafeNumber, postalCode, invoicePrefix,
    } = req.body;

    let logoUrl = null;
    if (req.file) {
      logoUrl = `/uploads/logos/${req.file.filename}`;
    }

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
        default_reminder_hours = COALESCE($14, default_reminder_hours),
        payment_details = COALESCE($15, payment_details),
        gas_safe_number = COALESCE($16, gas_safe_number),
        postal_code = COALESCE($17, postal_code),
        invoice_prefix = COALESCE($18, invoice_prefix)
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
        logoUrl,
        currencyCode || null,
        currencySymbol || null,
        defaultReminderHours != null ? defaultReminderHours : null,
        paymentDetails || null,
        gasSafeNumber || null,
        postalCode || null,
        invoicePrefix || null,
      ]
    );

    res.json(result.rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
