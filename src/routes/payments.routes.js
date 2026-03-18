const express = require("express");
const { createCustomerReceipt, createSupplierPayment } = require("../services/payments.service");

const router = express.Router();

router.post("/customer-receipt", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const { invoiceId, amount, paymentDate, memo } = req.body;

    if (!invoiceId || !amount || !paymentDate) {
      return res.status(400).json({ error: "invoiceId, amount, and paymentDate are required" });
    }

    const payment = await createCustomerReceipt({
      companyId, invoiceId: Number(invoiceId),
      amount: Number(amount), paymentDate, memo,
    });
    res.json({ payment });
  } catch (e) { next(e); }
});

router.post("/supplier-payment", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const { billId, amount, paymentDate, memo } = req.body;

    if (!billId || !amount || !paymentDate) {
      return res.status(400).json({ error: "billId, amount, and paymentDate are required" });
    }

    const payment = await createSupplierPayment({
      companyId, billId: Number(billId),
      amount: Number(amount), paymentDate, memo,
    });
    res.json({ payment });
  } catch (e) { next(e); }
});

module.exports = router;
