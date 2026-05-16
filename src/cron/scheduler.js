require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const db = require("../db");
const nodemailer = require("nodemailer");

let transporter = null;
if (process.env.SMTP_HOST) {
  const config = {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
  };
  if (process.env.SMTP_USER) {
    config.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  }
  transporter = nodemailer.createTransport(config);
}

async function sendPendingReminders() {
  const pending = await db.query(
    `SELECT r.*, j.title AS job_title, j.start_time, j.address,
            c.name AS customer_name, e.name AS engineer_name,
            co.name AS company_name
     FROM job_reminders r
     JOIN jobs j ON j.id = r.job_id
     LEFT JOIN customers c ON c.id = j.customer_id
     LEFT JOIN engineers e ON e.id = j.engineer_id
     LEFT JOIN companies co ON co.id = r.company_id
     WHERE r.is_sent = false AND r.remind_at <= NOW()
     ORDER BY r.remind_at ASC
     LIMIT 50`
  );

  if (!pending.rowCount) return 0;

  let sent = 0;
  for (const r of pending.rows) {
    if (!r.recipient_email || !transporter) {
      await db.query(`UPDATE job_reminders SET is_sent=true, sent_at=NOW() WHERE id=$1`, [r.id]);
      continue;
    }

    const subject = `Reminder: ${r.job_title} - ${new Date(r.start_time).toLocaleDateString("en-GB")}`;
    const text = r.message || `You have an upcoming job: ${r.job_title} on ${new Date(r.start_time).toLocaleString("en-GB")}${r.address ? " at " + r.address : ""}`;

    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: r.recipient_email,
        subject,
        text,
        html: `<h3>${r.company_name || "Gas Man"} - Job Reminder</h3>
          <p><strong>Job:</strong> ${r.job_title}</p>
          <p><strong>Date:</strong> ${new Date(r.start_time).toLocaleString("en-GB")}</p>
          ${r.address ? "<p><strong>Address:</strong> " + r.address + "</p>" : ""}
          ${r.engineer_name ? "<p><strong>Engineer:</strong> " + r.engineer_name + "</p>" : ""}
          ${r.message ? "<p>" + r.message + "</p>" : ""}`,
      });
      await db.query(`UPDATE job_reminders SET is_sent=true, sent_at=NOW() WHERE id=$1`, [r.id]);
      sent++;
    } catch (err) {
      console.error(`Failed to send reminder ${r.id}:`, err.message);
    }
  }
  return sent;
}

async function generateRecurringJobs() {
  const recurring = await db.query(
    `SELECT j.*
     FROM jobs j
     WHERE j.recurrence != 'none'
     AND j.status != 'cancelled'
     AND j.start_time < NOW()
     ORDER BY j.start_time ASC`
  );

  let created = 0;
  for (const job of recurring.rows) {
    const lastStart = new Date(job.start_time);
    const lastEnd = job.end_time ? new Date(job.end_time) : null;
    const duration = lastEnd ? lastEnd.getTime() - lastStart.getTime() : 0;

    let nextStart = new Date(lastStart);
    if (job.recurrence === "weekly") {
      nextStart.setDate(nextStart.getDate() + 7);
    } else if (job.recurrence === "monthly") {
      nextStart.setMonth(nextStart.getMonth() + 1);
    } else if (job.recurrence === "yearly") {
      nextStart.setFullYear(nextStart.getFullYear() + 1);
    } else {
      continue;
    }

    while (nextStart <= new Date()) {
      if (job.recurrence === "weekly") nextStart.setDate(nextStart.getDate() + 7);
      else if (job.recurrence === "monthly") nextStart.setMonth(nextStart.getMonth() + 1);
      else if (job.recurrence === "yearly") nextStart.setFullYear(nextStart.getFullYear() + 1);
    }

    const exists = await db.query(
      `SELECT id FROM jobs WHERE company_id=$1 AND title=$2 AND DATE(start_time)=DATE($3)`,
      [job.company_id, job.title, nextStart]
    );
    if (exists.rowCount) continue;

    const nextEnd = duration ? new Date(nextStart.getTime() + duration) : null;

    await db.query(
      `INSERT INTO jobs (company_id, customer_id, engineer_id, title, description, job_type,
        status, start_time, end_time, address, notes, recurrence)
       VALUES ($1,$2,$3,$4,$5,$6,'scheduled',$7,$8,$9,$10,$11)`,
      [job.company_id, job.customer_id, job.engineer_id, job.title, job.description,
       job.job_type, nextStart, nextEnd, job.address, job.notes, job.recurrence]
    );
    created++;
  }
  return created;
}

async function run() {
  try {
    const reminders = await sendPendingReminders();
    const recurring = await generateRecurringJobs();
    if (reminders || recurring) {
      console.log(`[Scheduler] Sent ${reminders} reminders, created ${recurring} recurring jobs`);
    }
  } catch (err) {
    console.error("[Scheduler] Error:", err.message);
  }
  process.exit(0);
}

run();
