const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../db");
const nodemailer = require("nodemailer");

const router = express.Router();

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

router.post("/register", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const companyName = req.body.companyName || req.body.company_name || null;

    if (!email || password.length < 6) {
      return res.status(400).json({ error: "Email and password (min 6 chars) required" });
    }

    const hash = await bcrypt.hash(password, 10);

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // If companyId is provided, join that company; otherwise create a new one
      let companyId;
      if (req.body.companyId) {
        companyId = Number(req.body.companyId);
      } else {
        // Create a new company for this user
        const companyResult = await client.query(
          `INSERT INTO companies (name) VALUES ($1) RETURNING id`,
          [companyName || `${email.split("@")[0]}'s Company`]
        );
        companyId = companyResult.rows[0].id;

        // Seed default chart of accounts for the new company
        const defaultAccounts = [
          ['1000', 'Bank - Main', 'ASSET', 'BANK'],
          ['1100', 'Accounts Receivable', 'ASSET', 'RECEIVABLE'],
          ['1200', 'Inventory', 'ASSET', 'INVENTORY'],
          ['2000', 'Accounts Payable', 'LIABILITY', 'PAYABLE'],
          ['2100', 'VAT Control', 'LIABILITY', 'VAT'],
          ['3000', 'Owner Equity', 'EQUITY', null],
          ['4000', 'Sales', 'INCOME', null],
          ['5000', 'Cost of Sales', 'EXPENSE', 'COGS'],
          ['6000', 'Operating Expenses', 'EXPENSE', null],
          ['7000', 'Payroll Expenses', 'EXPENSE', 'PAYROLL'],
        ];
        for (const [code, name, type, subType] of defaultAccounts) {
          await client.query(
            `INSERT INTO chart_of_accounts (company_id, code, name, type, sub_type) VALUES ($1,$2,$3,$4,$5)`,
            [companyId, code, name, type, subType]
          );
        }
      }

      const result = await client.query(
        `INSERT INTO users (company_id, email, password_hash)
         VALUES ($1,$2,$3)
         RETURNING id, company_id, email, role`,
        [companyId, email, hash]
      );

      await client.query("COMMIT");

      const user = result.rows[0];
      const token = jwt.sign(
        { userId: user.id, companyId: user.company_id, email: user.email, role: user.role },
        process.env.JWT_SECRET || "dev_secret_change_me",
        { expiresIn: "7d" }
      );

      res.json({ user, token });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    if (String(e.message).includes("users_company_id_email")) {
      return res.status(409).json({ error: "User already exists" });
    }
    next(e);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || 1);
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const result = await db.query(
      `SELECT id, company_id, email, role, password_hash
       FROM users WHERE company_id=$1 AND email=$2`,
      [companyId, email]
    );

    if (result.rowCount === 0) return res.status(401).json({ error: "Invalid credentials" });

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { userId: user.id, companyId: user.company_id, email: user.email, role: user.role },
      process.env.JWT_SECRET || "dev_secret_change_me",
      { expiresIn: "7d" }
    );

    res.json({
      user: { id: user.id, companyId: user.company_id, email: user.email, role: user.role },
      token,
    });
  } catch (e) {
    next(e);
  }
});

// Forgot Password - sends OTP
router.post("/forgot-password", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const companyId = Number(req.body.companyId || 1);

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Find user
    const userResult = await db.query(
      `SELECT id, email FROM users WHERE email=$1 AND company_id=$2`,
      [email, companyId]
    );

    if (userResult.rowCount === 0) {
      // Don't reveal if user exists or not (security)
      return res.json({ message: "If the email exists, an OTP has been sent.", otpSent: true });
    }

    const user = userResult.rows[0];
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Invalidate any existing OTPs for this user
    await db.query(
      `UPDATE password_reset_otps SET is_used=true WHERE user_id=$1 AND is_used=false`,
      [user.id]
    );

    // Store OTP
    await db.query(
      `INSERT INTO password_reset_otps (user_id, email, otp, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [user.id, email, otp, expiresAt]
    );

    // Try to send OTP via email if SMTP is configured
    let emailSent = false;
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_SECURE === "true",
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });

        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: email,
          subject: "Password Reset OTP",
          text: `Your password reset OTP is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, please ignore this email.`,
          html: `<h2>Password Reset</h2><p>Your OTP is: <strong style="font-size:24px;letter-spacing:4px">${otp}</strong></p><p>This code expires in 10 minutes.</p><p>If you did not request this, please ignore this email.</p>`,
        });
        emailSent = true;
      } catch (emailErr) {
        console.warn("Failed to send OTP email:", emailErr.message);
      }
    }

    // Return OTP in response for mobile app to display/send via its own channel
    // In production with SMTP configured, you'd remove otp from response
    const response = {
      message: "OTP generated successfully",
      otpSent: true,
      expiresIn: "10 minutes",
      emailSent,
    };

    // Include OTP in response if SMTP is not configured (for dev/mobile app usage)
    if (!emailSent) {
      response.otp = otp;
      response.note = "SMTP not configured. OTP returned in response for the app to handle delivery.";
    }

    res.json(response);
  } catch (e) { next(e); }
});

// Verify OTP
router.post("/verify-otp", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const otp = String(req.body.otp || "").trim();
    const companyId = Number(req.body.companyId || 1);

    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required" });
    }

    const result = await db.query(
      `SELECT o.*, u.company_id FROM password_reset_otps o
       JOIN users u ON u.id = o.user_id
       WHERE o.email=$1 AND o.otp=$2 AND o.is_used=false AND u.company_id=$3
       ORDER BY o.created_at DESC LIMIT 1`,
      [email, otp, companyId]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    const otpRecord = result.rows[0];

    if (new Date() > new Date(otpRecord.expires_at)) {
      return res.status(400).json({ error: "OTP has expired. Please request a new one." });
    }

    // Generate a reset token (valid for 15 minutes)
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpiry = new Date(Date.now() + 15 * 60 * 1000);

    // Mark OTP as used and store reset token
    await db.query(
      `UPDATE password_reset_otps SET is_used=true WHERE id=$1`,
      [otpRecord.id]
    );

    // Store reset token in a new OTP record (reusing the table)
    await db.query(
      `INSERT INTO password_reset_otps (user_id, email, otp, expires_at, is_used)
       VALUES ($1, $2, $3, $4, false)`,
      [otpRecord.user_id, email, resetToken, resetExpiry]
    );

    res.json({
      message: "OTP verified successfully",
      verified: true,
      resetToken,
      expiresIn: "15 minutes",
    });
  } catch (e) { next(e); }
});

// Reset Password (using reset token from verify-otp)
router.post("/reset-password", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const resetToken = String(req.body.resetToken || "").trim();
    const newPassword = String(req.body.newPassword || "");
    const companyId = Number(req.body.companyId || 1);

    if (!email || !resetToken || !newPassword) {
      return res.status(400).json({ error: "Email, resetToken, and newPassword are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Find valid reset token
    const result = await db.query(
      `SELECT o.*, u.company_id FROM password_reset_otps o
       JOIN users u ON u.id = o.user_id
       WHERE o.email=$1 AND o.otp=$2 AND o.is_used=false AND u.company_id=$3
       ORDER BY o.created_at DESC LIMIT 1`,
      [email, resetToken, companyId]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    const tokenRecord = result.rows[0];

    if (new Date() > new Date(tokenRecord.expires_at)) {
      return res.status(400).json({ error: "Reset token has expired. Please start over." });
    }

    // Hash new password and update
    const hash = await bcrypt.hash(newPassword, 10);
    await db.query(
      `UPDATE users SET password_hash=$1 WHERE id=$2`,
      [hash, tokenRecord.user_id]
    );

    // Mark reset token as used
    await db.query(
      `UPDATE password_reset_otps SET is_used=true WHERE id=$1`,
      [tokenRecord.id]
    );

    // Invalidate all remaining OTPs/tokens for this user
    await db.query(
      `UPDATE password_reset_otps SET is_used=true WHERE user_id=$1 AND is_used=false`,
      [tokenRecord.user_id]
    );

    res.json({ message: "Password reset successfully", success: true });
  } catch (e) { next(e); }
});

module.exports = router;
