const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /chat/group - Get group chat messages (paginated)
router.get("/group", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const before = req.query.before ? Number(req.query.before) : null;
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    let query, params;
    if (before) {
      query = `SELECT m.id, m.message, m.created_at,
                      m.sender_id, u.email AS sender_email, u.role AS sender_role
               FROM chat_messages m
               JOIN users u ON u.id = m.sender_id
               WHERE m.company_id = $1
                 AND m.recipient_id IS NULL
                 AND m.id < $2
               ORDER BY m.id DESC LIMIT $3`;
      params = [companyId, before, limit];
    } else {
      query = `SELECT m.id, m.message, m.created_at,
                      m.sender_id, u.email AS sender_email, u.role AS sender_role
               FROM chat_messages m
               JOIN users u ON u.id = m.sender_id
               WHERE m.company_id = $1
                 AND m.recipient_id IS NULL
               ORDER BY m.id DESC LIMIT $2`;
      params = [companyId, limit];
    }

    const result = await db.query(query, params);
    res.json({ messages: result.rows.reverse() });
  } catch (e) { next(e); }
});

// POST /chat/group - Send a group message
router.post("/group", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const senderId = Number(req.user.userId);
    const message = String(req.body.message || "").trim();

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const result = await db.query(
      `INSERT INTO chat_messages (company_id, sender_id, recipient_id, message)
       VALUES ($1, $2, NULL, $3)
       RETURNING id, message, created_at`,
      [companyId, senderId, message]
    );

    const row = result.rows[0];
    res.json({
      id: row.id,
      message: row.message,
      created_at: row.created_at,
      sender_id: senderId,
      sender_email: req.user.email,
      sender_role: req.user.role,
    });
  } catch (e) { next(e); }
});

// GET /chat/direct/:userId - Get direct messages with a user (paginated)
router.get("/direct/:userId", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const myId = Number(req.user.userId);
    const otherId = Number(req.params.userId);
    const before = req.query.before ? Number(req.query.before) : null;
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    let query, params;
    if (before) {
      query = `SELECT m.id, m.message, m.created_at,
                      m.sender_id, u.email AS sender_email, u.role AS sender_role
               FROM chat_messages m
               JOIN users u ON u.id = m.sender_id
               WHERE m.company_id = $1
                 AND m.id < $5
                 AND ((m.sender_id = $2 AND m.recipient_id = $3)
                   OR (m.sender_id = $3 AND m.recipient_id = $2))
               ORDER BY m.id DESC LIMIT $4`;
      params = [companyId, myId, otherId, limit, before];
    } else {
      query = `SELECT m.id, m.message, m.created_at,
                      m.sender_id, u.email AS sender_email, u.role AS sender_role
               FROM chat_messages m
               JOIN users u ON u.id = m.sender_id
               WHERE m.company_id = $1
                 AND ((m.sender_id = $2 AND m.recipient_id = $3)
                   OR (m.sender_id = $3 AND m.recipient_id = $2))
               ORDER BY m.id DESC LIMIT $4`;
      params = [companyId, myId, otherId, limit];
    }

    const result = await db.query(query, params);
    res.json({ messages: result.rows.reverse() });
  } catch (e) { next(e); }
});

// POST /chat/direct/:userId - Send a direct message
router.post("/direct/:userId", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const senderId = Number(req.user.userId);
    const recipientId = Number(req.params.userId);
    const message = String(req.body.message || "").trim();

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (senderId === recipientId) {
      return res.status(400).json({ error: "Cannot send a message to yourself" });
    }

    // Verify recipient is in the same company
    const recipient = await db.query(
      `SELECT id FROM users WHERE id = $1 AND company_id = $2`,
      [recipientId, companyId]
    );
    if (recipient.rowCount === 0) {
      return res.status(404).json({ error: "Recipient not found" });
    }

    const result = await db.query(
      `INSERT INTO chat_messages (company_id, sender_id, recipient_id, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, message, created_at`,
      [companyId, senderId, recipientId, message]
    );

    const row = result.rows[0];
    res.json({
      id: row.id,
      message: row.message,
      created_at: row.created_at,
      sender_id: senderId,
      sender_email: req.user.email,
      sender_role: req.user.role,
      recipient_id: recipientId,
    });
  } catch (e) { next(e); }
});

// GET /chat/contacts - List team members for DM
router.get("/contacts", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const myId = Number(req.user.userId);

    const result = await db.query(
      `SELECT u.id, u.email, u.role,
              (SELECT m.message FROM chat_messages m
               WHERE m.company_id = $1
                 AND ((m.sender_id = $2 AND m.recipient_id = u.id)
                   OR (m.sender_id = u.id AND m.recipient_id = $2))
               ORDER BY m.id DESC LIMIT 1) AS last_message,
              (SELECT m.created_at FROM chat_messages m
               WHERE m.company_id = $1
                 AND ((m.sender_id = $2 AND m.recipient_id = u.id)
                   OR (m.sender_id = u.id AND m.recipient_id = $2))
               ORDER BY m.id DESC LIMIT 1) AS last_message_at
       FROM users u
       WHERE u.company_id = $1 AND u.id != $2
       ORDER BY last_message_at DESC NULLS LAST, u.email`,
      [companyId, myId]
    );

    res.json({ contacts: result.rows });
  } catch (e) { next(e); }
});

module.exports = router;
