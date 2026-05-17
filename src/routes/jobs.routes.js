const express = require("express");
const db = require("../db");

const router = express.Router();

router.post("/jobs", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const {
      customerId, engineerId, title, description,
      jobType, status, startTime, endTime,
      address, notes, recurrence,
    } = req.body;

    if (!title || !startTime) {
      return res.status(400).json({ error: "Title and startTime are required" });
    }

    const result = await db.query(
      `INSERT INTO jobs
       (company_id, customer_id, engineer_id, title, description, job_type, status,
        start_time, end_time, address, notes, recurrence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
      ]
    );
    res.json({ job: result.rows[0] });
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
        e.colour AS engineer_colour
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
        e.colour AS engineer_colour
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
        e.colour AS engineer_colour
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

router.put("/jobs/:id", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const id = req.params.id;
    const {
      customerId, engineerId, title, description,
      jobType, status, startTime, endTime,
      address, notes, recurrence,
    } = req.body;

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
    res.json({ job: result.rows[0] });
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
    await db.query(
      `DELETE FROM jobs WHERE id=$1 AND company_id=$2`,
      [req.params.id, req.user.companyId]
    );
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
        e.colour AS engineer_colour
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
