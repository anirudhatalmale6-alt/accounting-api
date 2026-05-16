const express = require("express");
const db = require("../db");

const router = express.Router();

router.post("/reminders", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { jobId, remindAt, remindType, recipientType, recipientEmail, message } = req.body;

    if (!jobId || !remindAt) {
      return res.status(400).json({ error: "jobId and remindAt are required" });
    }

    const job = await db.query(
      `SELECT id FROM jobs WHERE id=$1 AND company_id=$2`,
      [jobId, companyId]
    );
    if (!job.rowCount) {
      return res.status(404).json({ error: "Job not found" });
    }

    let email = recipientEmail;
    if (!email && recipientType === "customer") {
      const cust = await db.query(
        `SELECT c.email FROM jobs j JOIN customers c ON c.id=j.customer_id WHERE j.id=$1`,
        [jobId]
      );
      email = cust.rows[0]?.email || null;
    }
    if (!email && recipientType === "engineer") {
      const eng = await db.query(
        `SELECT e.email FROM jobs j JOIN engineers e ON e.id=j.engineer_id WHERE j.id=$1`,
        [jobId]
      );
      email = eng.rows[0]?.email || null;
    }

    const result = await db.query(
      `INSERT INTO job_reminders (company_id, job_id, remind_at, remind_type, recipient_type, recipient_email, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [companyId, jobId, remindAt, remindType || "email", recipientType || "customer", email, message || null]
    );
    res.json({ reminder: result.rows[0] });
  } catch (e) { next(e); }
});

router.get("/reminders", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { jobId } = req.query;

    let query = `SELECT r.*, j.title AS job_title, j.start_time AS job_start_time
                 FROM job_reminders r
                 JOIN jobs j ON j.id = r.job_id
                 WHERE r.company_id=$1`;
    const params = [companyId];

    if (jobId) {
      query += ` AND r.job_id=$2`;
      params.push(jobId);
    }
    query += ` ORDER BY r.remind_at ASC`;

    const result = await db.query(query, params);
    res.json({ reminders: result.rows });
  } catch (e) { next(e); }
});

router.put("/reminders/:id", async (req, res, next) => {
  try {
    const { remindAt, recipientType, recipientEmail, message } = req.body;
    const result = await db.query(
      `UPDATE job_reminders SET
        remind_at=COALESCE($1, remind_at),
        recipient_type=COALESCE($2, recipient_type),
        recipient_email=COALESCE($3, recipient_email),
        message=COALESCE($4, message)
       WHERE id=$5 AND company_id=$6 AND is_sent=false
       RETURNING *`,
      [remindAt, recipientType, recipientEmail, message, req.params.id, req.user.companyId]
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: "Reminder not found or already sent" });
    }
    res.json({ reminder: result.rows[0] });
  } catch (e) { next(e); }
});

router.delete("/reminders/:id", async (req, res, next) => {
  try {
    await db.query(
      `DELETE FROM job_reminders WHERE id=$1 AND company_id=$2`,
      [req.params.id, req.user.companyId]
    );
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.get("/reminders/settings", async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT default_reminder_hours FROM companies WHERE id=$1`,
      [req.user.companyId]
    );
    res.json({ defaultReminderHours: result.rows[0]?.default_reminder_hours || 24 });
  } catch (e) { next(e); }
});

router.put("/reminders/settings", async (req, res, next) => {
  try {
    const { defaultReminderHours } = req.body;
    await db.query(
      `UPDATE companies SET default_reminder_hours=$1 WHERE id=$2`,
      [defaultReminderHours || 24, req.user.companyId]
    );
    res.json({ defaultReminderHours: defaultReminderHours || 24 });
  } catch (e) { next(e); }
});

router.post("/reminders/auto-create", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { jobId } = req.body;

    if (!jobId) return res.status(400).json({ error: "jobId is required" });

    const job = await db.query(
      `SELECT j.*, c.email AS customer_email, c.name AS customer_name,
              e.email AS engineer_email, e.name AS engineer_name
       FROM jobs j
       LEFT JOIN customers c ON c.id=j.customer_id
       LEFT JOIN engineers e ON e.id=j.engineer_id
       WHERE j.id=$1 AND j.company_id=$2`,
      [jobId, companyId]
    );
    if (!job.rowCount) return res.status(404).json({ error: "Job not found" });

    const j = job.rows[0];
    const company = await db.query(`SELECT default_reminder_hours FROM companies WHERE id=$1`, [companyId]);
    const hours = company.rows[0]?.default_reminder_hours || 24;
    const remindAt = new Date(new Date(j.start_time).getTime() - hours * 60 * 60 * 1000);

    const created = [];

    if (j.customer_email) {
      const r = await db.query(
        `INSERT INTO job_reminders (company_id, job_id, remind_at, remind_type, recipient_type, recipient_email, message)
         VALUES ($1,$2,$3,email,customer,$4,$5)
         ON CONFLICT DO NOTHING RETURNING *`,
        [companyId, jobId, remindAt, j.customer_email,
         `Reminder: You have a ${j.title} appointment on ${new Date(j.start_time).toLocaleString("en-GB")}`]
      );
      if (r.rowCount) created.push(r.rows[0]);
    }

    if (j.engineer_email) {
      const r = await db.query(
        `INSERT INTO job_reminders (company_id, job_id, remind_at, remind_type, recipient_type, recipient_email, message)
         VALUES ($1,$2,$3,email,engineer,$4,$5)
         ON CONFLICT DO NOTHING RETURNING *`,
        [companyId, jobId, remindAt, j.engineer_email,
         `Reminder: You have a job "${j.title}" at ${j.address || "TBC"} on ${new Date(j.start_time).toLocaleString("en-GB")}`]
      );
      if (r.rowCount) created.push(r.rows[0]);
    }

    res.json({ created });
  } catch (e) { next(e); }
});

module.exports = router;
