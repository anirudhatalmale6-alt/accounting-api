const express = require("express");
const crypto = require("crypto");
const https = require("https");
const os = require("os");
const db = require("../db");

const router = express.Router();

// --- Helpers ---

// Build HMRC fraud prevention headers from request
function buildFraudHeaders(req) {
  const headers = {};

  // Connection method - mobile app via server
  headers["Gov-Client-Connection-Method"] = "MOBILE_APP_VIA_SERVER";

  // Device ID - from app or generate from user
  headers["Gov-Client-Device-ID"] = req.headers["gov-client-device-id"]
    || req.headers["x-device-id"]
    || crypto.createHash("md5").update(String(req.user?.companyId || "unknown")).digest("hex");

  // User IDs - encode the app user identifier
  const email = req.user?.email || "unknown";
  headers["Gov-Client-User-IDs"] = `app=${encodeURIComponent(email)}`;

  // Timezone - from app or default to Europe/London
  headers["Gov-Client-Timezone"] = req.headers["gov-client-timezone"]
    || req.headers["x-timezone"]
    || "UTC+00:00";

  // Client public IP - the IP of the mobile device
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers["x-real-ip"]
    || req.ip
    || "127.0.0.1";
  headers["Gov-Client-Public-IP"] = clientIp;

  // Client public port
  headers["Gov-Client-Public-Port"] = String(req.headers["x-forwarded-port"] || req.socket?.remotePort || "0");

  // Screen resolution - from app
  headers["Gov-Client-Screens"] = req.headers["gov-client-screens"]
    || req.headers["x-screen-resolution"]
    || "width=360&height=800";

  // User agent - from mobile app
  headers["Gov-Client-User-Agent"] = req.headers["user-agent"] || "GasManBusiness/1.0";

  // Local IPs and timestamp - from app or use server values
  headers["Gov-Client-Local-IPs"] = req.headers["gov-client-local-ips"]
    || req.headers["x-local-ip"]
    || clientIp;

  headers["Gov-Client-Local-IPs-Timestamp"] = req.headers["gov-client-local-ips-timestamp"]
    || req.headers["x-local-ip-timestamp"]
    || new Date().toISOString();

  // Vendor details - our server info
  const serverIps = Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i && !i.internal && i.family === "IPv4")
    .map(i => i.address)
    .join(",") || "89.167.18.163";

  headers["Gov-Vendor-Public-IP"] = serverIps.split(",")[0];
  headers["Gov-Vendor-Version"] = "GasManBusiness=1.0";
  headers["Gov-Vendor-Product-Name"] = "Gas+Man+Business";

  // Multi-factor - from app
  if (req.headers["gov-client-multi-factor"]) {
    headers["Gov-Client-Multi-Factor"] = req.headers["gov-client-multi-factor"];
  }

  return headers;
}

function hmrcRequest(method, path, accessToken, body, fraudHeaders) {
  return new Promise((resolve, reject) => {
    const baseUrl = process.env.HMRC_BASE_URL || "https://test-api.service.hmrc.gov.uk";
    const url = new URL(path, baseUrl);

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        "Accept": "application/vnd.hmrc.1.0+json",
        "Content-Type": "application/json",
      },
    };

    if (accessToken) {
      options.headers["Authorization"] = `Bearer ${accessToken}`;
    }

    // Add fraud prevention headers
    if (fraudHeaders) {
      Object.assign(options.headers, fraudHeaders);
    }

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) {
            return reject({ status: res.statusCode, data: parsed });
          }
          resolve(parsed);
        } catch (e) {
          reject({ status: res.statusCode, data: data });
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Get valid access token (auto-refresh if expired)
async function getValidAccessToken(companyId) {
  const result = await db.query(
    "SELECT * FROM hmrc_tokens WHERE company_id = $1",
    [companyId]
  );

  if (!result.rows.length) {
    throw new Error("HMRC not connected");
  }

  let token = result.rows[0];
  const isExpired = new Date(token.expires_at) < new Date();

  if (!isExpired) return token.access_token;

  // Refresh token
  const baseUrl = process.env.HMRC_BASE_URL || "https://test-api.service.hmrc.gov.uk";

  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.HMRC_CLIENT_ID,
      client_secret: process.env.HMRC_CLIENT_SECRET,
      refresh_token: token.refresh_token,
    }).toString();

    const url = new URL("/oauth/token", baseUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", async () => {
        try {
          const newToken = JSON.parse(data);
          if (res.statusCode >= 400) {
            return reject(new Error("Token refresh failed: " + data));
          }

          const newExpires = new Date(Date.now() + newToken.expires_in * 1000);

          await db.query(
            `UPDATE hmrc_tokens
             SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = NOW()
             WHERE company_id = $4`,
            [newToken.access_token, newToken.refresh_token, newExpires, companyId]
          );

          resolve(newToken.access_token);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

// --- Routes ---

// GET /hmrc/status - Check if HMRC is connected
router.get("/status", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const result = await db.query(
      "SELECT id, expires_at, updated_at FROM hmrc_tokens WHERE company_id = $1",
      [companyId]
    );

    if (!result.rows.length) {
      return res.json({ connected: false });
    }

    const token = result.rows[0];
    const isExpired = new Date(token.expires_at) < new Date();

    res.json({
      connected: true,
      tokenExpired: isExpired,
      lastUpdated: token.updated_at,
    });
  } catch (e) { next(e); }
});

// GET /hmrc/auth-url - Generate HMRC OAuth URL
router.get("/auth-url", (req, res) => {
  const clientId = process.env.HMRC_CLIENT_ID;
  const redirectUri = process.env.HMRC_REDIRECT_URI;
  const authUrl = process.env.HMRC_AUTH_URL || "https://www.tax.service.gov.uk/oauth/authorize";

  if (!clientId || !redirectUri) {
    return res.status(500).json({ error: "HMRC not configured. Set HMRC_CLIENT_ID and HMRC_REDIRECT_URI." });
  }

  const state = req.user.companyId + "_" + crypto.randomBytes(16).toString("hex");

  const url =
    `${authUrl}?response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=read:vat+write:vat` +
    `&state=${state}`;

  res.json({ url });
});

// GET /hmrc/callback - Exchange auth code for tokens (PUBLIC - no auth needed)
router.get("/callback", async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code) {
      return res.status(400).json({ error: "Missing authorization code" });
    }
    // Extract companyId from state parameter
    const companyId = state ? parseInt(state.split("_")[0]) : null;
    if (!companyId) {
      return res.status(400).json({ error: "Invalid state parameter" });
    }

    const baseUrl = process.env.HMRC_BASE_URL || "https://test-api.service.hmrc.gov.uk";

    const postData = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.HMRC_CLIENT_ID,
      client_secret: process.env.HMRC_CLIENT_SECRET,
      redirect_uri: process.env.HMRC_REDIRECT_URI,
      code,
    }).toString();

    const url = new URL("/oauth/token", baseUrl);

    const tokenRes = await new Promise((resolve, reject) => {
      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(postData),
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on("error", reject);
      req.write(postData);
      req.end();
    });

    if (!tokenRes.access_token) {
      return res.status(400).json({ error: "Token exchange failed", details: tokenRes });
    }

    const data = tokenRes;
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    // Upsert token
    await db.query(
      `INSERT INTO hmrc_tokens (company_id, access_token, refresh_token, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id) DO UPDATE SET
         access_token = $2,
         refresh_token = $3,
         expires_at = $4,
         updated_at = NOW()`,
      [companyId, data.access_token, data.refresh_token, expiresAt]
    );

    res.send("HMRC connected successfully. You can close this window.");
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("HMRC connection failed");
  }
});

// POST /hmrc/disconnect - Remove HMRC connection
router.post("/disconnect", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    await db.query("DELETE FROM hmrc_tokens WHERE company_id = $1", [companyId]);
    res.json({ success: true, message: "HMRC disconnected" });
  } catch (e) { next(e); }
});

// POST /hmrc/vat-submit - Submit VAT return to HMRC
router.post("/vat-submit", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { vrn, vatData } = req.body;

    if (!vrn || !vatData) {
      return res.status(400).json({ error: "vrn and vatData are required" });
    }

    // Check if period is locked
    if (vatData.periodKey) {
      const lock = await db.query(
        "SELECT * FROM vat_period_locks WHERE company_id=$1 AND period_key=$2",
        [companyId, vatData.periodKey]
      );
      if (lock.rows.length) {
        return res.status(400).json({ error: "VAT period is locked and cannot be edited." });
      }
    }

    let accessToken;
    try {
      accessToken = await getValidAccessToken(companyId);
    } catch (tokenErr) {
      return res.status(400).json({ error: "HMRC not connected or token expired. Please reconnect HMRC in Settings before submitting." });
    }

    const fraudHeaders = buildFraudHeaders(req);

    const response = await hmrcRequest(
      "POST",
      `/organisations/vat/${vrn}/returns`,
      accessToken,
      vatData,
      fraudHeaders
    );

    // Store submission record
    await db.query(
      `INSERT INTO vat_submissions (company_id, period_key, vat_data, hmrc_response)
       VALUES ($1, $2, $3, $4)`,
      [companyId, vatData.periodKey, vatData, response]
    );

    // Lock the period
    await db.query(
      `INSERT INTO vat_period_locks (company_id, period_key)
       VALUES ($1, $2)
       ON CONFLICT (company_id, period_key) DO NOTHING`,
      [companyId, vatData.periodKey]
    );

    res.json({ success: true, hmrc: response });
  } catch (err) {
    console.error(err.response?.data || err.data || err.message);
    res.status(500).json({
      error: "VAT submission failed",
      details: err.data || err.message,
    });
  }
});

// GET /hmrc/vat-obligations - Get VAT obligations from HMRC
router.get("/vat-obligations", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { vrn, from, to, status } = req.query;

    if (!vrn) {
      return res.json({ obligations: [] });
    }

    let accessToken;
    try {
      accessToken = await getValidAccessToken(companyId);
    } catch (tokenErr) {
      return res.json({ obligations: [], tokenError: true, message: "HMRC not connected or token expired. Please reconnect HMRC." });
    }

    const fraudHeaders = buildFraudHeaders(req);

    let path = `/organisations/vat/${vrn}/obligations?from=${from || "2024-01-01"}&to=${to || new Date().toISOString().slice(0, 10)}`;
    if (status) path += `&status=${status}`;

    const response = await hmrcRequest("GET", path, accessToken, null, fraudHeaders);
    res.json(response);
  } catch (err) {
    res.json({
      obligations: [],
      error: "Failed to fetch VAT obligations",
      details: err.data || err.message,
    });
  }
});

// GET /hmrc/vat-return/:periodKey - Get a specific VAT return from HMRC
router.get("/vat-return/:periodKey", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { vrn } = req.query;
    const { periodKey } = req.params;

    if (!vrn) {
      return res.json({ vatReturn: null, message: "VRN not configured" });
    }

    let accessToken;
    try {
      accessToken = await getValidAccessToken(companyId);
    } catch (tokenErr) {
      return res.json({ vatReturn: null, tokenError: true, message: "HMRC not connected or token expired. Please reconnect HMRC." });
    }

    const fraudHeaders = buildFraudHeaders(req);

    const response = await hmrcRequest(
      "GET",
      `/organisations/vat/${vrn}/returns/${periodKey}`,
      accessToken,
      null,
      fraudHeaders
    );
    res.json(response);
  } catch (err) {
    res.json({
      vatReturn: null,
      error: "Failed to fetch VAT return",
      details: err.data || err.message,
    });
  }
});

// GET /hmrc/vat-submissions - Get local submission history
router.get("/vat-submissions", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const result = await db.query(
      `SELECT * FROM vat_submissions
       WHERE company_id = $1
       ORDER BY submitted_at DESC`,
      [companyId]
    );
    res.json({ items: result.rows });
  } catch (e) { next(e); }
});

// GET /hmrc/period-locks - Get locked periods
router.get("/period-locks", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const result = await db.query(
      "SELECT * FROM vat_period_locks WHERE company_id = $1 ORDER BY created_at DESC",
      [companyId]
    );
    res.json({ locks: result.rows });
  } catch (e) { next(e); }
});

// POST /hmrc/vat-adjust - Submit a VAT adjustment
router.post("/vat-adjust", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { periodKey, adjustment } = req.body;

    if (!periodKey || !adjustment) {
      return res.status(400).json({ error: "periodKey and adjustment are required" });
    }

    await db.query(
      `INSERT INTO vat_adjustments (company_id, period_key, adjustment)
       VALUES ($1, $2, $3)`,
      [companyId, periodKey, adjustment]
    );

    res.json({ success: true });
  } catch (e) { next(e); }
});

// GET /hmrc/vat-adjustments - Get adjustments for a period
router.get("/vat-adjustments", async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const periodKey = req.query.periodKey;

    let query = "SELECT * FROM vat_adjustments WHERE company_id = $1";
    const params = [companyId];

    if (periodKey) {
      query += " AND period_key = $2";
      params.push(periodKey);
    }

    query += " ORDER BY created_at DESC";

    const result = await db.query(query, params);
    res.json({ adjustments: result.rows });
  } catch (e) { next(e); }
});

module.exports = router;
