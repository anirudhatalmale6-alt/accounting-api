const express = require("express");
const {
  createBill, listBills, getBillDetail, updateBill, deleteBill,
} = require("../services/bills.service");

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const { supplierId, billNumber, billDate, dueDate, lines } = req.body;

    if (!supplierId || !billNumber || !billDate ||
      !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const bill = await createBill({ companyId, supplierId, billNumber,
      billDate, dueDate, lines });
    res.json({ bill });
  } catch (e) { next(e); }
});

router.get("/", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const data = await listBills({
      companyId,
      supplierId: req.query.supplierId ? Number(req.query.supplierId) : null,
      status: req.query.status || null,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      limit: req.query.limit ? Number(req.query.limit) : 100,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    res.json({ bills: data });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const billId = Number(req.params.id);
    const detail = await getBillDetail({ companyId, billId });
    if (!detail) return res.status(404).json({ error: "Bill not found" });
    res.json(detail);
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const billId = Number(req.params.id);
    const updated = await updateBill({ companyId, billId, patch: req.body });
    res.json({ bill: updated });
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const billId = Number(req.params.id);
    const out = await deleteBill({ companyId, billId });
    res.json(out);
  } catch (e) { next(e); }
});

module.exports = router;
