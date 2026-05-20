require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const authRoutes = require("./routes/auth.routes");
const productsRoutes = require("./routes/products.routes");
const invoicesRoutes = require("./routes/invoices.routes");
const billsRoutes = require("./routes/bills.routes");
const attachmentsRoutes = require("./routes/attachments.routes");
const inventoryRoutes = require("./routes/inventory.routes");
const reportsRoutes = require("./routes/reports.routes");
const paymentsRoutes = require("./routes/payments.routes");
const accountsRoutes = require("./routes/accounts.routes");
const vatRoutes = require("./routes/vat.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const employeesRoutes = require("./routes/employees.routes");
const emailRoutes = require("./routes/email.routes");
const customersRoutes = require("./routes/customers.routes");
const suppliersRoutes = require("./routes/suppliers.routes");
const bankAccountsRoutes = require("./routes/bank-accounts.routes");
const payrollRunsRoutes = require("./routes/payroll-runs.routes");
const bankTransactionsRoutes = require("./routes/bank-transactions.routes");
const payslipsRoutes = require("./routes/payslips.routes");
const pipeSizingRoutes = require("./routes/pipe-sizing.routes");
const merchantsRoutes = require("./routes/merchants.routes");
const ocrRoutes = require("./routes/ocr.routes");
const hmrcRoutes = require("./routes/hmrc.routes");
const teamRoutes = require("./routes/team.routes");
const cisRoutes = require("./routes/cis.routes");
const adminRoutes = require("./routes/admin.routes");
const engineersRoutes = require("./routes/engineers.routes");
const jobsRoutes = require("./routes/jobs.routes");
const remindersRoutes = require("./routes/reminders.routes");
const companyRoutes = require("./routes/company.routes");
const chatRoutes = require("./routes/chat.routes");
const estimatesRoutes = require("./routes/estimates.routes");
const { requireAuth } = require("./middleware/auth");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(morgan("dev"));

// Public routes
app.use("/auth", authRoutes);
app.get("/health", (_, res) => res.json({ ok: true }));
app.use("/uploads", express.static("uploads"));

// HMRC OAuth callback - must be public (browser redirect from HMRC, no JWT)
app.get("/hmrc/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).json({ error: "Missing authorization code" });
    const companyId = state ? parseInt(state.split("_")[0]) : null;
    if (!companyId) return res.status(400).json({ error: "Invalid state parameter" });

    const https = require("https");
    const db = require("./db");
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
        hostname: url.hostname, path: url.pathname, method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(postData) },
      };
      const r = https.request(options, (response) => {
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      });
      r.on("error", reject);
      r.write(postData);
      r.end();
    });

    if (!tokenRes.access_token) return res.status(400).json({ error: "Token exchange failed", details: tokenRes });

    const expiresAt = new Date(Date.now() + tokenRes.expires_in * 1000);
    await db.query(
      `INSERT INTO hmrc_tokens (company_id, access_token, refresh_token, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id) DO UPDATE SET access_token=$2, refresh_token=$3, expires_at=$4, updated_at=NOW()`,
      [companyId, tokenRes.access_token, tokenRes.refresh_token, expiresAt]
    );
    res.send("HMRC connected successfully! You can close this window and return to the app.");
  } catch (err) {
    console.error(err);
    res.status(500).send("HMRC connection failed. Please try again.");
  }
});

// Protected routes
app.use("/products", requireAuth, productsRoutes);
app.use("/invoices", requireAuth, invoicesRoutes);
app.use("/bills", requireAuth, billsRoutes);
app.use("/", requireAuth, attachmentsRoutes);
app.use("/inventory", requireAuth, inventoryRoutes);
app.use("/reports", requireAuth, reportsRoutes);
app.use("/payments", requireAuth, paymentsRoutes);
app.use("/accounts", requireAuth, accountsRoutes);
app.use("/vat", requireAuth, vatRoutes);
app.use("/dashboard", requireAuth, dashboardRoutes);
app.use("/employees", requireAuth, employeesRoutes);
app.use("/email", requireAuth, emailRoutes);
app.use("/customers", requireAuth, customersRoutes);
app.use("/suppliers", requireAuth, suppliersRoutes);
app.use("/bank-accounts", requireAuth, bankAccountsRoutes);
app.use("/payroll-runs", requireAuth, payrollRunsRoutes);
app.use("/bank-transactions", requireAuth, bankTransactionsRoutes);
app.use("/payslips", requireAuth, payslipsRoutes);
app.use("/pipe-sizing", requireAuth, pipeSizingRoutes);
app.use("/merchants", requireAuth, merchantsRoutes);
app.use("/ocr", requireAuth, ocrRoutes);
app.use("/hmrc", requireAuth, hmrcRoutes);
app.use("/team", requireAuth, teamRoutes);
app.use("/cis", requireAuth, cisRoutes);
app.use("/admin", requireAuth, adminRoutes);
app.use("/company", requireAuth, companyRoutes);
app.use("/chat", requireAuth, chatRoutes);
app.use("/estimates", requireAuth, estimatesRoutes);
app.use("/", requireAuth, engineersRoutes);
app.use("/", requireAuth, jobsRoutes);
app.use("/", requireAuth, remindersRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || "Server error",
  });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API running on :${port}`));
