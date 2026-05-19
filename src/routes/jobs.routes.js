const express = require("express");
const db = require("../db");
const nodemailer = require("nodemailer");

const router = express.Router();

const statusMessages = {
  on_the_way: {
    subject: "Your engineer is on the way",
    message: "is now on the way to your location",
  },
  arrived: {
    subject: "Your engineer has arrived",
    message: "has arrived at your location",
  },
  in_progress: {
    subject: "Work has started on your job",
    message: "has started work on your job",
  },
  completed: {
    subject: "Your job is complete",
    message: "has completed your job",
  },
};

async function notifyCustomer(companyId, job, newStatus) {
  if (!statusMessages[newStatus]) return;
  if (!job.customer_id) return;
  if (!process.env.SMTP_HOST) return;

  try {
    const customer = await db.query(
      `SELECT name, email, phone FROM customers WHERE id=$1 AND company_id=$2`,
      [job.customer_id, companyId]
    );
    if (customer.rowCount === 0 || !customer.rows[0].email) return;

    const cust = customer.rows[0];

    const company = await db.query(
      `SELECT business_name, name FROM companies WHERE id=$1`, [companyId]
    );
    const companyName = company.rows[0]?.business_name || company.rows[0]?.name || "Our Company";

    const engineer = job.engineer_id
      ? await db.query(`SELECT name FROM engineers WHERE id=$1`, [job.engineer_id])
      : null;
    const engineerName = engineer?.rows[0]?.name || "Your engineer";

    const { subject, message } = statusMessages[newStatus];
    const jobTitle = job.title || "your scheduled job";
    const jobAddress = job.address ? `\nJob address: ${job.address}` : "";

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
      to: cust.email,
      subject: `${companyName} - ${subject}`,
      text: `Hi ${cust.name || "there"},\n\n${engineerName} ${message}.\n\nJob: ${jobTitle}${jobAddress}\n\nThank you,\n${companyName}`,
      html: `<h2>${companyName}</h2>
        <p>Hi ${cust.name || "there"},</p>
        <p><strong>${engineerName}</strong> ${message}.</p>
        <p><strong>Job:</strong> ${jobTitle}${job.address ? `<br><strong>Address:</strong> ${job.address}` : ""}</p>
        <p>Thank you,<br>${companyName}</p>`,
    });

    await db.query(
      `INSERT INTO email_logs (company_id, to_email, subject, body, status)
       VALUES ($1, $2, $3, $4, 'SENT')`,
      [companyId, cust.email, `${companyName} - ${subject}`, `${engineerName} ${message}`]
    );
  } catch (err) {
    console.warn("Failed to send job status email:", err.message);
  }
}

async function syncJobReminders(companyId, jobId, startTime, { customerReminder, engineerReminder, customerReminderMinutes, engineerReminderMinutes }) {
  const defaultMinutes = 60;

  if (customerReminder !== undefined) {
    await db.query(`DELETE FROM job_reminders WHERE job_id=$1 AND recipient_type='customer'`, [jobId]);
    if (customerReminder) {
      const mins = customerReminderMinutes || defaultMinutes;
      const remindAt = new Date(new Date(startTime).getTime() - mins * 60 * 1000);
      await db.query(
        `INSERT INTO job_reminders (company_id, job_id, remind_at, remind_type, recipient_type)
         VALUES ($1, $2, $3, 'email', 'customer')`,
        [companyId, jobId, remindAt]
      );
    }
  }

  if (engineerReminder !== undefined) {
    await db.query(`DELETE FROM job_reminders WHERE job_id=$1 AND recipient_type='engineer'`, [jobId]);
    if (engineerReminder) {
      const mins = engineerReminderMinutes || defaultMinutes;
      const remindAt = new Date(new Date(startTime).getTime() - mins * 60 * 1000);
      await db.query(
        `INSERT INTO job_reminders (company_id, job_id, remind_at, remind_type, recipient_type)
         VALUES ($1, $2, $3, 'email', 'engineer')`,
        [companyId, jobId, remindAt]
      );
    }
  }
}

function addRecurrenceInterval(date, recurrence, interval) {
  const d = new Date(date);
  const n = interval || 1;
  switch (recurrence) {
    case "daily": d.setDate(d.getDate() + n); break;
    case "weekly": d.setDate(d.getDate() + 7 * n); break;
    case "monthly": d.setMonth(d.getMonth() + n); break;
    case "yearly": d.setFullYear(d.getFullYear() + n); break;
  }
  return d;
}

router.post("/jobs", async (req, res, next) => {
  try {
    if (!["owner", "admin"].includes(req.user.role)) {
      return res.status(403).json({ error: "Only owner or admin can create jobs" });
    }
    const companyId = req.user.companyId;
    const b = req.body;
    const customerId = b.customerId || b.customer_id;
    const engineerId = b.engineerId || b.engineer_id;
    const title = b.title;
    const description = b.description;
    const jobType = b.jobType || b.job_type;
    const status = b.status;
    const startTime = b.startTime || b.start_time;
    const endTime = b.endTime || b.end_time;
    const address = b.address;
    const notes = b.notes;
    const recurrence = b.recurrence;
    const recurrenceEnd = b.recurrenceEnd || b.recurrence_end;
    const recurrenceInterval = b.recurrenceInterval || b.recurrence_interval;
    const customerReminder = b.customerReminder ?? b.customer_reminder;
    const engineerReminder = b.engineerReminder ?? b.engineer_reminder;
    const customerReminderMinutes = b.customerReminderMinutes || b.customer_reminder_minutes;
    const engineerReminderMinutes = b.engineerReminderMinutes || b.engineer_reminder_minutes;

    if (!title || !startTime) {
      return res.status(400).json({ error: "Title and startTime are required" });
    }

    const result = await db.query(
      `INSERT INTO jobs
       (company_id, customer_id, engineer_id, title, description, job_type, status,
        start_time, end_time, address, notes, recurrence, recurrence_end, recurrence_interval)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        companyId,
        customerId || null,
        engineerId || null,
        title,
        description || null,
        jobType || null,
        status || "scheduled",
        startTime,
        endTime || null,
        address || null,
        notes || null,
        recurrence || "none",
        recurrenceEnd || null,
        recurrenceInterval || 1,
      ]
    );

    const parentJob = result.rows[0];

    await syncJobReminders(companyId, parentJob.id, startTime, {
      customerReminder, engineerReminder, customerReminderMinutes, engineerReminderMinutes,
    });

    if (recurrence && recurrence !== "none") {
      const duration = endTime && startTime
        ? new Date(endTime) - new Date(startTime)
        : null;
      const endDate = recurrenceEnd ? new Date(recurrenceEnd) : null;
      const maxOccurrences = 52;
      let currentStart = new Date(startTime);
      let count = 0;

      while (count < maxOccurrences) {
        currentStart = addRecurrenceInterval(currentStart, recurrence, recurrenceInterval || 1);
        if (endDate && currentStart > endDate) break;
        const childEnd = duration ? new Date(currentStart.getTime() + duration) : null;

        const childResult = await db.query(
          `INSERT INTO jobs
           (company_id, customer_id, engineer_id, title, description, job_type, status,
            start_time, end_time, address, notes, recurrence, parent_job_id)
           VALUES ($1,$2,$3,$4,$5,$6,'scheduled',$7,$8,$9,$10,$11,$12)
           RETURNING id`,
          [
            companyId, customerId || null, engineerId || null,
            title, description || null, jobType || null,
            currentStart.toISOString(), childEnd ? childEnd.toISOString() : null,
            address || null, notes || null, recurrence, parentJob.id,
          ]
        );
        await syncJobReminders(companyId, childResult.rows[0].id, currentStart.toISOString(), {
          customerReminder, engineerReminder, customerReminderMinutes, engineerReminderMinutes,
        });
        count++;
      }
    }

    res.json({ job: parentJob });
  } catch (e) { next(e); }
});

router.get("/jobs", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { dateFrom, dateTo } = req.query;

    const result = await db.query(
      `SELECT
        j.*,
        c.name AS customer_name,
        e.name AS engineer_name,
        e.colour AS engineer_colour,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='customer') AS customer_reminder_set,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='customer' AND r.is_sent=true) AS customer_reminder_sent,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='engineer') AS engineer_reminder_set,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='engineer' AND r.is_sent=true) AS engineer_reminder_sent
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN engineers e ON e.id = j.engineer_id
       WHERE j.company_id=$1
       AND ($2::timestamp IS NULL OR j.start_time >= $2)
       AND ($3::timestamp IS NULL OR j.start_time <= $3)
       ORDER BY j.start_time ASC`,
      [companyId, dateFrom || null, dateTo || null]
    );
    res.json({ jobs: result.rows });
  } catch (e) { next(e); }
});

router.get("/jobs/today", async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
        j.*,
        c.name AS customer_name,
        e.name AS engineer_name,
        e.colour AS engineer_colour,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='customer') AS customer_reminder_set,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='customer' AND r.is_sent=true) AS customer_reminder_sent,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='engineer') AS engineer_reminder_set,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='engineer' AND r.is_sent=true) AS engineer_reminder_sent
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN engineers e ON e.id = j.engineer_id
       WHERE j.company_id=$1
       AND DATE(j.start_time)=CURRENT_DATE
       AND j.status != 'cancelled'
       ORDER BY j.start_time ASC`,
      [req.user.companyId]
    );
    res.json({ jobs: result.rows });
  } catch (e) { next(e); }
});

router.get("/jobs/upcoming", async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
        j.*,
        c.name AS customer_name,
        e.name AS engineer_name,
        e.colour AS engineer_colour,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='customer') AS customer_reminder_set,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='customer' AND r.is_sent=true) AS customer_reminder_sent,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='engineer') AS engineer_reminder_set,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='engineer' AND r.is_sent=true) AS engineer_reminder_sent
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN engineers e ON e.id = j.engineer_id
       WHERE j.company_id=$1
       AND j.start_time >= NOW()
       AND j.status != 'cancelled'
       ORDER BY j.start_time ASC
       LIMIT 10`,
      [req.user.companyId]
    );
    res.json({ jobs: result.rows });
  } catch (e) { next(e); }
});

router.get("/jobs/:id", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const id = Number(req.params.id);

    const result = await db.query(
      `SELECT
        j.*,
        c.name AS customer_name,
        e.name AS engineer_name,
        e.colour AS engineer_colour,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='customer') AS customer_reminder_set,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='customer' AND r.is_sent=true) AS customer_reminder_sent,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='engineer') AS engineer_reminder_set,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='engineer' AND r.is_sent=true) AS engineer_reminder_sent
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN engineers e ON e.id = j.engineer_id
       WHERE j.id=$1 AND j.company_id=$2`,
      [id, companyId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json({ job: result.rows[0] });
  } catch (e) { next(e); }
});

router.put("/jobs/:id", async (req, res, next) => {
  try {
    const isStatusOnlyUpdate = Object.keys(req.body).length === 1 && req.body.status;
    if (!["owner", "admin"].includes(req.user.role) && !isStatusOnlyUpdate) {
      return res.status(403).json({ error: "Only owner or admin can edit jobs" });
    }
    const companyId = req.user.companyId;
    const id = req.params.id;
    const b = req.body;
    const customerId = b.customerId || b.customer_id;
    const engineerId = b.engineerId || b.engineer_id;
    const title = b.title;
    const description = b.description;
    const jobType = b.jobType || b.job_type;
    const status = b.status;
    const startTime = b.startTime || b.start_time;
    const endTime = b.endTime || b.end_time;
    const address = b.address;
    const notes = b.notes;
    const recurrence = b.recurrence;
    const customerReminder = b.customerReminder ?? b.customer_reminder;
    const engineerReminder = b.engineerReminder ?? b.engineer_reminder;
    const customerReminderMinutes = b.customerReminderMinutes || b.customer_reminder_minutes;
    const engineerReminderMinutes = b.engineerReminderMinutes || b.engineer_reminder_minutes;

    // Get old status before updating
    const oldJob = await db.query(
      `SELECT status FROM jobs WHERE id=$1 AND company_id=$2`,
      [id, companyId]
    );
    const oldStatus = oldJob.rows[0]?.status;

    const result = await db.query(
      `UPDATE jobs SET
        customer_id=$1, engineer_id=$2, title=$3, description=$4,
        job_type=$5, status=$6, start_time=$7, end_time=$8,
        address=$9, notes=$10, recurrence=$11, updated_at=NOW()
       WHERE id=$12 AND company_id=$13
       RETURNING *`,
      [
        customerId || null,
        engineerId || null,
        title,
        description || null,
        jobType || null,
        status || "scheduled",
        startTime,
        endTime || null,
        address || null,
        notes || null,
        recurrence || "none",
        id,
        companyId,
      ]
    );

    const updatedJob = result.rows[0];

    if (updatedJob) {
      await syncJobReminders(companyId, updatedJob.id, updatedJob.start_time, {
        customerReminder, engineerReminder, customerReminderMinutes, engineerReminderMinutes,
      });
    }

    // Notify customer if status changed
    if (updatedJob && status && status !== oldStatus) {
      notifyCustomer(companyId, updatedJob, status).catch(() => {});
    }

    res.json({ job: updatedJob });
  } catch (e) { next(e); }
});

router.patch("/jobs/:id/reschedule", async (req, res, next) => {
  try {
    const { startTime, endTime, engineerId } = req.body;
    if (!startTime) {
      return res.status(400).json({ error: "startTime is required" });
    }
    const result = await db.query(
      `UPDATE jobs SET
        start_time=$1, end_time=$2,
        engineer_id=COALESCE($3, engineer_id),
        updated_at=NOW()
       WHERE id=$4 AND company_id=$5
       RETURNING *`,
      [startTime, endTime || null, engineerId || null, req.params.id, req.user.companyId]
    );
    res.json({ job: result.rows[0] });
  } catch (e) { next(e); }
});

router.delete("/jobs/:id", async (req, res, next) => {
  try {
    if (!["owner", "admin"].includes(req.user.role)) {
      return res.status(403).json({ error: "Only owner or admin can delete jobs" });
    }
    const deleteAll = req.query.series === "true";
    if (deleteAll) {
      await db.query(
        `DELETE FROM jobs WHERE (id=$1 OR parent_job_id=$1) AND company_id=$2`,
        [req.params.id, req.user.companyId]
      );
    } else {
      await db.query(
        `DELETE FROM jobs WHERE id=$1 AND company_id=$2`,
        [req.params.id, req.user.companyId]
      );
    }
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.get("/dispatch/live-board", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;

    const engineers = await db.query(
      `SELECT id, name, email, phone, colour
       FROM engineers
       WHERE company_id=$1 AND is_active=true
       ORDER BY name ASC`,
      [companyId]
    );

    const jobs = await db.query(
      `SELECT
        j.*,
        c.name AS customer_name,
        e.name AS engineer_name,
        e.colour AS engineer_colour,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='customer') AS customer_reminder_set,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='customer' AND r.is_sent=true) AS customer_reminder_sent,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='engineer') AS engineer_reminder_set,
        EXISTS(SELECT 1 FROM job_reminders r WHERE r.job_id=j.id AND r.recipient_type='engineer' AND r.is_sent=true) AS engineer_reminder_sent
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN engineers e ON e.id = j.engineer_id
       WHERE j.company_id=$1
       AND DATE(j.start_time)=CURRENT_DATE
       AND j.status != 'cancelled'
       ORDER BY j.start_time ASC`,
      [companyId]
    );

    const now = new Date();
    const activeStatuses = ["on_the_way", "arrived", "in_progress", "confirmed"];
    const board = engineers.rows.map((engineer) => {
      const engineerJobs = jobs.rows.filter(
        (j) => j.engineer_id === engineer.id
      );
      // Busy if any job has an active status OR falls within current time window
      const currentJob = engineerJobs.find((j) => {
        if (activeStatuses.includes(j.status)) return true;
        const start = new Date(j.start_time);
        const end = j.end_time
          ? new Date(j.end_time)
          : new Date(start.getTime() + 60 * 60 * 1000);
        return start <= now && end >= now;
      });
      const nextJob = engineerJobs.find((j) => {
        if (j === currentJob) return false;
        const start = new Date(j.start_time);
        return start > now || j.status === "scheduled";
      });
      return {
        engineer,
        status: currentJob ? "busy" : "free",
        currentJob: currentJob || null,
        nextJob: nextJob || null,
        jobsToday: engineerJobs,
      };
    });

    res.json({ board });
  } catch (e) { next(e); }
});

module.exports = router;
