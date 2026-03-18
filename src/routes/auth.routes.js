const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");

const router = express.Router();

router.post("/register", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || 1);
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || password.length < 6) {
      return res.status(400).json({ error: "Email and password (min 6 chars) required" });
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await db.query(
      `INSERT INTO users (company_id, email, password_hash)
       VALUES ($1,$2,$3)
       RETURNING id, company_id, email, role`,
      [companyId, email, hash]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { userId: user.id, companyId: user.company_id, email: user.email, role: user.role },
      process.env.JWT_SECRET || "dev_secret_change_me",
      { expiresIn: "7d" }
    );

    res.json({ user, token });
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

module.exports = router;
