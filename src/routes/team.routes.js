const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const nodemailer = require("nodemailer");

const router = express.Router();

// POST /team/invite - Owner invites an accountant
router.post("/invite", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const userId = Number(req.user.userId);
    const email = String(req.body.email || "").trim().toLowerCase();
    const role = req.body.role || "accountant";

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Only owners can invite
    if (req.user.role !== "owner") {
      return res.status(403).json({ error: "Only the company owner can invite team members" });
    }

    // Check if user already exists in this company
    const existingUser = await db.query(
      `SELECT id FROM users WHERE company_id=$1 AND email=$2`,
      [companyId, email]
    );
    if (existingUser.rowCount > 0) {
      return res.status(409).json({ error: "This user is already a member of your company" });
    }

    // Check for existing pending invite
    const existingInvite = await db.query(
      `SELECT id FROM invitations WHERE company_id=$1 AND email=$2 AND status='pending'`,
      [companyId, email]
    );
    if (existingInvite.rowCount > 0) {
      return res.status(409).json({ error: "An invitation has already been sent to this email" });
    }

    const inviteCode = crypto.randomBytes(24).toString("hex");

    await db.query(
      `INSERT INTO invitations (company_id, email, role, invite_code, invited_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [companyId, email, role, inviteCode, userId]
    );

    // Get company name for the email
    const companyResult = await db.query(
      `SELECT name FROM companies WHERE id=$1`, [companyId]
    );
    const companyName = companyResult.rows[0]?.name || "a company";

    // Try to send invitation email
    let emailSent = false;
    if (process.env.SMTP_HOST) {
      try {
        const smtpConfig = {
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_SECURE === "true",
        };
        if (process.env.SMTP_USER) {
          smtpConfig.auth = {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          };
        }
        const transporter = nodemailer.createTransport(smtpConfig);

        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: email,
          subject: `You've been invited to ${companyName} on Gas Man Accounting`,
          text: `You have been invited as ${role} to ${companyName}.\n\nYour invitation code is: ${inviteCode}\n\nUse this code when registering in the Gas Man app to accept the invitation.`,
          html: `<h2>Invitation to ${companyName}</h2>
            <p>You have been invited as <strong>${role}</strong> to <strong>${companyName}</strong> on Gas Man Accounting.</p>
            <p>Your invitation code is: <strong style="font-size:18px;letter-spacing:2px">${inviteCode}</strong></p>
            <p>Use this code when registering in the Gas Man app to accept the invitation.</p>`,
        });
        emailSent = true;
      } catch (emailErr) {
        console.warn("Failed to send invite email:", emailErr.message);
      }
    }

    res.json({
      message: "Invitation sent",
      inviteCode,
      emailSent,
      role,
      email,
    });
  } catch (e) { next(e); }
});

// GET /team/members - List team members for the company
router.get("/members", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);

    const result = await db.query(
      `SELECT id, email, role, created_at FROM users WHERE company_id=$1 ORDER BY created_at`,
      [companyId]
    );

    res.json({ members: result.rows });
  } catch (e) { next(e); }
});

// GET /team/invitations - List pending invitations
router.get("/invitations", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);

    const result = await db.query(
      `SELECT id, email, role, status, created_at, accepted_at
       FROM invitations WHERE company_id=$1 ORDER BY created_at DESC`,
      [companyId]
    );

    res.json({ invitations: result.rows });
  } catch (e) { next(e); }
});

// DELETE /team/members/:id - Remove a team member (owner only)
router.delete("/members/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const memberId = Number(req.params.id);

    if (req.user.role !== "owner") {
      return res.status(403).json({ error: "Only the company owner can remove team members" });
    }

    // Can't remove yourself
    if (memberId === req.user.userId) {
      return res.status(400).json({ error: "You cannot remove yourself from the company" });
    }

    const result = await db.query(
      `DELETE FROM users WHERE id=$1 AND company_id=$2 AND role != 'owner' RETURNING id`,
      [memberId, companyId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Member not found or cannot be removed" });
    }

    res.json({ deleted: true });
  } catch (e) { next(e); }
});

// DELETE /team/invitations/:id - Cancel a pending invitation
router.delete("/invitations/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const inviteId = Number(req.params.id);

    const result = await db.query(
      `DELETE FROM invitations WHERE id=$1 AND company_id=$2 AND status='pending' RETURNING id`,
      [inviteId, companyId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Invitation not found" });
    }

    res.json({ deleted: true });
  } catch (e) { next(e); }
});

module.exports = router;

// DELETE /team/delete-account - Permanently delete user's account and all company data
router.delete("/delete-account", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const userId = Number(req.user.userId);

    if (req.user.role !== "owner") {
      return res.status(403).json({ error: "Only the company owner can delete the account" });
    }

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // Delete in order respecting foreign keys (children first)
      // Line items and allocations
      await client.query(`DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id=$1)`, [companyId]);
      await client.query(`DELETE FROM bill_lines WHERE bill_id IN (SELECT id FROM bills WHERE company_id=$1)`, [companyId]);
      await client.query(`DELETE FROM payroll_run_lines WHERE payroll_run_id IN (SELECT id FROM payroll_runs WHERE company_id=$1)`, [companyId]);
      await client.query(`DELETE FROM payment_allocations WHERE company_id=$1`, [companyId]);

      // Bank transactions (references invoices/bills)
      await client.query(`DELETE FROM bank_transactions WHERE company_id=$1`, [companyId]);

      // Payments (references invoices/bills)
      await client.query(`DELETE FROM payments WHERE company_id=$1`, [companyId]);

      // Main records
      await client.query(`DELETE FROM invoices WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM bills WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM payroll_runs WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM products WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM customers WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM suppliers WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM employees WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM bank_accounts WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM attachments WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM inventory_movements WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE company_id=$1)`, [companyId]);
      await client.query(`DELETE FROM journal_entries WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM chart_of_accounts WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM email_logs WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM hmrc_tokens WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM vat_adjustments WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM vat_period_locks WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM vat_submissions WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM cis_deductions WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM cis_returns WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM cis_subcontractors WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM job_reminders WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM jobs WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM engineers WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM team_members WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM invitations WHERE company_id=$1`, [companyId]);

      // Password reset OTPs for all users in this company
      await client.query(`DELETE FROM password_reset_otps WHERE user_id IN (SELECT id FROM users WHERE company_id=$1)`, [companyId]);

      // Users and company
      await client.query(`DELETE FROM users WHERE company_id=$1`, [companyId]);
      await client.query(`DELETE FROM companies WHERE id=$1`, [companyId]);

      await client.query("COMMIT");

      res.json({ deleted: true, message: "Account and all data permanently deleted" });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});
