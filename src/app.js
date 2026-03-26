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
const { requireAuth } = require("./middleware/auth");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(morgan("dev"));

// Public routes
app.use("/auth", authRoutes);
app.get("/health", (_, res) => res.json({ ok: true }));

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

// serve uploaded files (dev)
app.use("/uploads", express.static("uploads"));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || "Server error",
  });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API running on :${port}`));
