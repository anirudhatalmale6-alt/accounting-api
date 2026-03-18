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
const { requireAuth } = require("./middleware/auth");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(morgan("dev"));

// Public routes
app.use("/auth", authRoutes);

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

// serve uploaded files (dev)
app.use("/uploads", express.static("uploads"));

app.get("/health", (_, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || "Server error",
  });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API running on :${port}`));
