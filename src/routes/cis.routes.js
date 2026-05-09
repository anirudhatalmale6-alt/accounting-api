const express = require("express");
const db = require("../db");

const router = express.Router();

// ============================================================
// SUBCONTRACTOR MANAGEMENT
// ============================================================

// GET /cis/subcontractors - List all subcontractors
router.get("/subcontractors", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const result = await db.query(
      `SELECT * FROM cis_subcontractors WHERE company_id=$1 ORDER BY name`,
      [companyId]
    );
    res.json({ subcontractors: result.rows });
  } catch (e) { next(e); }
});

// GET /cis/subcontractors/:id - Get single subcontractor
router.get("/subcontractors/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const id = Number(req.params.id);
    const result = await db.query(
      `SELECT * FROM cis_subcontractors WHERE id=$1 AND company_id=$2`,
      [id, companyId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Subcontractor not found" });
    res.json(result.rows[0]);
  } catch (e) { next(e); }
});

// POST /cis/subcontractors - Add a subcontractor
router.post("/subcontractors", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const { name, trading_name, company_details, utr, nino, national_insurance_number,
            company_reg, phone, email, address, address_line1, address_line2, city, postcode } = req.body;

    if (!name) return res.status(400).json({ error: "Name is required" });

    const result = await db.query(
      `INSERT INTO cis_subcontractors
       (company_id, name, trading_name, utr, nino, company_reg, phone, email,
        address_line1, address_line2, city, postcode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [companyId, name,
       trading_name || company_details || null,
       utr || null,
       nino || national_insurance_number || null,
       company_reg || null,
       phone || null,
       email || null,
       address_line1 || address || null,
       address_line2 || null,
       city || null,
       postcode || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    if (String(e.message).includes("cis_subcontractors_company_id_utr_key")) {
      return res.status(400).json({ error: "A subcontractor with this UTR already exists" });
    }
    next(e);
  }
});

// PUT /cis/subcontractors/:id - Update a subcontractor
router.put("/subcontractors/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const id = Number(req.params.id);
    const { name, trading_name, company_details, utr, nino, national_insurance_number,
            company_reg, phone, email, address, address_line1, address_line2,
            city, postcode, deduction_rate } = req.body;

    const result = await db.query(
      `UPDATE cis_subcontractors SET
        name=COALESCE($3, name), trading_name=COALESCE($4, trading_name),
        utr=COALESCE($5, utr), nino=COALESCE($6, nino),
        company_reg=COALESCE($7, company_reg), phone=COALESCE($8, phone),
        email=COALESCE($9, email), address_line1=COALESCE($10, address_line1),
        address_line2=COALESCE($11, address_line2), city=COALESCE($12, city),
        postcode=COALESCE($13, postcode),
        deduction_rate=COALESCE($14, deduction_rate),
        updated_at=NOW()
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [id, companyId, name, trading_name || company_details,
       utr, nino || national_insurance_number, company_reg,
       phone, email, address_line1 || address, address_line2, city, postcode,
       deduction_rate != null ? deduction_rate : null]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Subcontractor not found" });
    res.json(result.rows[0]);
  } catch (e) { next(e); }
});

// DELETE /cis/subcontractors/:id - Delete a subcontractor
router.delete("/subcontractors/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const id = Number(req.params.id);

    // Check for existing deductions
    const deductions = await db.query(
      `SELECT COUNT(*) as count FROM cis_deductions WHERE subcontractor_id=$1 AND company_id=$2`,
      [id, companyId]
    );
    if (Number(deductions.rows[0].count) > 0) {
      return res.status(400).json({ error: "Cannot delete subcontractor with existing deductions. Remove deductions first." });
    }

    const result = await db.query(
      `DELETE FROM cis_subcontractors WHERE id=$1 AND company_id=$2 RETURNING id`,
      [id, companyId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Subcontractor not found" });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

// POST /cis/subcontractors/:id/verify - Verify subcontractor with HMRC
router.post("/subcontractors/:id/verify", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const id = Number(req.params.id);

    const sub = await db.query(
      `SELECT * FROM cis_subcontractors WHERE id=$1 AND company_id=$2`,
      [id, companyId]
    );
    if (sub.rowCount === 0) return res.status(404).json({ error: "Subcontractor not found" });

    const subcontractor = sub.rows[0];
    if (!subcontractor.utr) {
      return res.status(400).json({ error: "UTR is required for HMRC verification" });
    }

    // Check HMRC tokens
    const tokenResult = await db.query(
      `SELECT * FROM hmrc_tokens WHERE company_id=$1`, [companyId]
    );
    if (tokenResult.rowCount === 0) {
      return res.status(400).json({ error: "HMRC not connected. Please connect HMRC first." });
    }

    const hmrcToken = tokenResult.rows[0];
    const baseUrl = process.env.HMRC_BASE_URL || "https://test-api.service.hmrc.gov.uk";

    // Build verification request
    const verifyBody = {
      utr: subcontractor.utr,
      nino: subcontractor.nino || undefined,
      companyRegistrationNumber: subcontractor.company_reg || undefined
    };

    const https = require("https");
    const url = new URL("/organisations/cis/verify", baseUrl);
    const postData = JSON.stringify(verifyBody);

    const hmrcRes = await new Promise((resolve, reject) => {
      const options = {
        hostname: url.hostname, path: url.pathname, method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + hmrcToken.access_token,
          "Accept": "application/vnd.hmrc.1.0+json",
          "Content-Length": Buffer.byteLength(postData)
        }
      };
      const r = https.request(options, (response) => {
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => {
          try { resolve({ status: response.statusCode, body: JSON.parse(data) }); }
          catch (e) { resolve({ status: response.statusCode, body: data }); }
        });
      });
      r.on("error", reject);
      r.write(postData);
      r.end();
    });

    if (hmrcRes.status === 200 && hmrcRes.body) {
      const verificationNumber = hmrcRes.body.verificationNumber || null;
      let deductionRate = 30.00; // default unverified
      let status = "unverified";

      if (hmrcRes.body.taxTreatment === "gross") {
        deductionRate = 0;
        status = "gross";
      } else if (hmrcRes.body.taxTreatment === "net") {
        deductionRate = 20.00;
        status = "verified";
      } else if (hmrcRes.body.taxTreatment === "unmatched") {
        deductionRate = 30.00;
        status = "unverified";
      }

      await db.query(
        `UPDATE cis_subcontractors SET
          verification_status=$3, verification_number=$4,
          deduction_rate=$5, gross_payment_status=$6,
          verified_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND company_id=$2`,
        [id, companyId, status, verificationNumber, deductionRate,
         deductionRate === 0]
      );

      const updated = await db.query(
        `SELECT * FROM cis_subcontractors WHERE id=$1`, [id]
      );

      res.json({
        message: "Verification complete",
        hmrcResponse: hmrcRes.body,
        subcontractor: updated.rows[0]
      });
    } else {
      // HMRC returned error - store for debugging but don't crash
      console.error("HMRC CIS verify error:", hmrcRes);
      res.status(hmrcRes.status || 500).json({
        error: "HMRC verification failed",
        details: hmrcRes.body
      });
    }
  } catch (e) { next(e); }
});


// ============================================================
// CIS DEDUCTIONS
// ============================================================

// Helper to calculate tax month (6th to 5th)
function getTaxMonth(date) {
  const d = new Date(date);
  let month = d.getMonth(); // 0-11
  let year = d.getFullYear();
  if (d.getDate() <= 5) {
    month = month - 1;
    if (month < 0) { month = 11; year--; }
  }
  const monthNames = ["01","02","03","04","05","06","07","08","09","10","11","12"];
  return year + "-" + monthNames[month];
}

// GET /cis/deductions - List deductions (optional filters: month, subcontractor_id)
router.get("/deductions", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const { month, subcontractor_id, from, to } = req.query;

    let sql = `SELECT d.*, s.name as subcontractor_name, s.utr as subcontractor_utr
                FROM cis_deductions d
                JOIN cis_subcontractors s ON s.id = d.subcontractor_id
                WHERE d.company_id=$1`;
    const params = [companyId];
    let idx = 2;

    if (month) {
      sql += ` AND d.tax_month=$${idx}`;
      params.push(month);
      idx++;
    }
    if (subcontractor_id) {
      sql += ` AND d.subcontractor_id=$${idx}`;
      params.push(Number(subcontractor_id));
      idx++;
    }
    if (from) {
      sql += ` AND d.date >= $${idx}`;
      params.push(from);
      idx++;
    }
    if (to) {
      sql += ` AND d.date <= $${idx}`;
      params.push(to);
      idx++;
    }

    sql += " ORDER BY d.date DESC";

    const result = await db.query(sql, params);
    res.json({ deductions: result.rows });
  } catch (e) { next(e); }
});

// POST /cis/deductions - Record a CIS deduction
router.post("/deductions", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const { subcontractor_id, date, description, gross_amount,
            materials_amount, invoice_ref } = req.body;

    if (!subcontractor_id || !date || !gross_amount) {
      return res.status(400).json({ error: "subcontractor_id, date, and gross_amount are required" });
    }

    // Get subcontractor deduction rate
    const sub = await db.query(
      `SELECT * FROM cis_subcontractors WHERE id=$1 AND company_id=$2`,
      [Number(subcontractor_id), companyId]
    );
    if (sub.rowCount === 0) return res.status(404).json({ error: "Subcontractor not found" });

    const rate = Number(sub.rows[0].deduction_rate);
    const gross = Number(gross_amount);
    const materials = Number(materials_amount || 0);
    const labour = gross - materials;

    if (labour < 0) {
      return res.status(400).json({ error: "Materials amount cannot exceed gross amount" });
    }

    // CIS deduction only applies to labour portion
    const deduction = Number((labour * (rate / 100)).toFixed(2));
    const netPayment = Number((gross - deduction).toFixed(2));
    const taxMonth = getTaxMonth(date);

    // Check if this month's return is already submitted
    const existingReturn = await db.query(
      `SELECT status FROM cis_returns WHERE company_id=$1 AND tax_month=$2`,
      [companyId, taxMonth]
    );
    if (existingReturn.rowCount > 0 && existingReturn.rows[0].status === "submitted") {
      return res.status(400).json({ error: "Cannot add deductions to a submitted tax month" });
    }

    const result = await db.query(
      `INSERT INTO cis_deductions
       (company_id, subcontractor_id, date, description, gross_amount,
        materials_amount, labour_amount, deduction_rate, deduction_amount,
        net_payment, tax_month, invoice_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [companyId, Number(subcontractor_id), date, description || null,
       gross, materials, labour, rate, deduction, netPayment, taxMonth,
       invoice_ref || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (e) { next(e); }
});

// PUT /cis/deductions/:id - Update a deduction
router.put("/deductions/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const id = Number(req.params.id);

    // Check deduction exists and return is not submitted
    const existing = await db.query(
      `SELECT d.*, r.status as return_status FROM cis_deductions d
       LEFT JOIN cis_returns r ON r.id = d.cis_return_id
       WHERE d.id=$1 AND d.company_id=$2`,
      [id, companyId]
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: "Deduction not found" });
    if (existing.rows[0].return_status === "submitted") {
      return res.status(400).json({ error: "Cannot edit deductions in a submitted return" });
    }

    const { subcontractor_id, date, description, gross_amount,
            materials_amount, invoice_ref } = req.body;

    const subId = subcontractor_id ? Number(subcontractor_id) : existing.rows[0].subcontractor_id;

    // Get rate from subcontractor
    const sub = await db.query(
      `SELECT deduction_rate FROM cis_subcontractors WHERE id=$1 AND company_id=$2`,
      [subId, companyId]
    );
    if (sub.rowCount === 0) return res.status(404).json({ error: "Subcontractor not found" });

    const rate = Number(sub.rows[0].deduction_rate);
    const gross = Number(gross_amount || existing.rows[0].gross_amount);
    const materials = Number(materials_amount != null ? materials_amount : existing.rows[0].materials_amount);
    const labour = gross - materials;
    const deduction = Number((labour * (rate / 100)).toFixed(2));
    const netPayment = Number((gross - deduction).toFixed(2));
    const useDate = date || existing.rows[0].date;
    const taxMonth = getTaxMonth(useDate);

    const result = await db.query(
      `UPDATE cis_deductions SET
        subcontractor_id=$3, date=$4, description=$5, gross_amount=$6,
        materials_amount=$7, labour_amount=$8, deduction_rate=$9,
        deduction_amount=$10, net_payment=$11, tax_month=$12,
        invoice_ref=$13, updated_at=NOW()
       WHERE id=$1 AND company_id=$2 RETURNING *`,
      [id, companyId, subId, useDate, description !== undefined ? description : existing.rows[0].description,
       gross, materials, labour, rate, deduction, netPayment, taxMonth,
       invoice_ref !== undefined ? invoice_ref : existing.rows[0].invoice_ref]
    );

    res.json(result.rows[0]);
  } catch (e) { next(e); }
});

// DELETE /cis/deductions/:id - Delete a deduction
router.delete("/deductions/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const id = Number(req.params.id);

    const existing = await db.query(
      `SELECT d.*, r.status as return_status FROM cis_deductions d
       LEFT JOIN cis_returns r ON r.id = d.cis_return_id
       WHERE d.id=$1 AND d.company_id=$2`,
      [id, companyId]
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: "Deduction not found" });
    if (existing.rows[0].return_status === "submitted") {
      return res.status(400).json({ error: "Cannot delete deductions from a submitted return" });
    }

    await db.query(`DELETE FROM cis_deductions WHERE id=$1 AND company_id=$2`, [id, companyId]);
    res.json({ deleted: true });
  } catch (e) { next(e); }
});


// ============================================================
// CIS RETURNS (CIS300)
// ============================================================

// GET /cis/returns - List all CIS returns
router.get("/returns", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const result = await db.query(
      `SELECT * FROM cis_returns WHERE company_id=$1 ORDER BY tax_month DESC`,
      [companyId]
    );
    res.json({ returns: result.rows });
  } catch (e) { next(e); }
});

// GET /cis/returns/:taxMonth - Get or generate return for a tax month
router.get("/returns/:taxMonth", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const taxMonth = req.params.taxMonth; // format: 2026-04

    if (!/^\d{4}-\d{2}$/.test(taxMonth)) {
      return res.status(400).json({ error: "Invalid tax month format. Use YYYY-MM" });
    }

    // Calculate period dates (6th to 5th)
    const [year, month] = taxMonth.split("-").map(Number);
    const periodStart = new Date(year, month - 1, 6);
    let endMonth = month;
    let endYear = year;
    if (endMonth === 12) { endMonth = 1; endYear++; } else { endMonth++; }
    const periodEnd = new Date(endYear, endMonth - 1, 5);

    const startStr = periodStart.toISOString().split("T")[0];
    const endStr = periodEnd.toISOString().split("T")[0];

    // Get deductions for this month
    const deductions = await db.query(
      `SELECT d.*, s.name as subcontractor_name, s.utr as subcontractor_utr,
              s.verification_number, s.nino
       FROM cis_deductions d
       JOIN cis_subcontractors s ON s.id = d.subcontractor_id
       WHERE d.company_id=$1 AND d.tax_month=$2
       ORDER BY d.date`,
      [companyId, taxMonth]
    );

    // Calculate totals
    let totalGross = 0, totalMaterials = 0, totalLabour = 0, totalDeductions = 0, totalNet = 0;
    const subcontractorSet = new Set();
    for (const d of deductions.rows) {
      totalGross += Number(d.gross_amount);
      totalMaterials += Number(d.materials_amount);
      totalLabour += Number(d.labour_amount);
      totalDeductions += Number(d.deduction_amount);
      totalNet += Number(d.net_payment);
      subcontractorSet.add(d.subcontractor_id);
    }

    // Check if return already exists
    let cisReturn = null;
    const existing = await db.query(
      `SELECT * FROM cis_returns WHERE company_id=$1 AND tax_month=$2`,
      [companyId, taxMonth]
    );

    if (existing.rowCount > 0) {
      cisReturn = existing.rows[0];
      // Update totals if draft
      if (cisReturn.status === "draft") {
        await db.query(
          `UPDATE cis_returns SET total_gross=$3, total_materials=$4,
           total_labour=$5, total_deductions=$6, total_net=$7,
           subcontractor_count=$8, updated_at=NOW()
           WHERE id=$1 AND company_id=$2`,
          [cisReturn.id, companyId, totalGross.toFixed(2), totalMaterials.toFixed(2),
           totalLabour.toFixed(2), totalDeductions.toFixed(2), totalNet.toFixed(2),
           subcontractorSet.size]
        );
      }
    } else {
      // Create draft return
      const ins = await db.query(
        `INSERT INTO cis_returns
         (company_id, tax_month, period_start, period_end, total_gross,
          total_materials, total_labour, total_deductions, total_net,
          subcontractor_count, nil_return)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [companyId, taxMonth, startStr, endStr, totalGross.toFixed(2),
         totalMaterials.toFixed(2), totalLabour.toFixed(2),
         totalDeductions.toFixed(2), totalNet.toFixed(2),
         subcontractorSet.size, deductions.rows.length === 0]
      );
      cisReturn = ins.rows[0];
    }

    res.json({
      cisReturn,
      deductions: deductions.rows,
      period: { start: startStr, end: endStr }
    });
  } catch (e) { next(e); }
});

// POST /cis/returns/:taxMonth/submit - Submit CIS300 to HMRC
router.post("/returns/:taxMonth/submit", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const taxMonth = req.params.taxMonth;

    // Get the return
    const retResult = await db.query(
      `SELECT * FROM cis_returns WHERE company_id=$1 AND tax_month=$2`,
      [companyId, taxMonth]
    );
    if (retResult.rowCount === 0) {
      return res.status(404).json({ error: "Return not found. View the return first to generate it." });
    }

    const cisReturn = retResult.rows[0];
    if (cisReturn.status === "submitted") {
      return res.status(400).json({ error: "This return has already been submitted" });
    }

    // Check HMRC tokens
    const tokenResult = await db.query(
      `SELECT * FROM hmrc_tokens WHERE company_id=$1`, [companyId]
    );
    if (tokenResult.rowCount === 0) {
      return res.status(400).json({ error: "HMRC not connected. Please connect HMRC first." });
    }

    const hmrcToken = tokenResult.rows[0];
    const baseUrl = process.env.HMRC_BASE_URL || "https://test-api.service.hmrc.gov.uk";

    // Get deductions with subcontractor details
    const deductions = await db.query(
      `SELECT d.*, s.name, s.utr, s.nino, s.verification_number, s.deduction_rate
       FROM cis_deductions d
       JOIN cis_subcontractors s ON s.id = d.subcontractor_id
       WHERE d.company_id=$1 AND d.tax_month=$2`,
      [companyId, taxMonth]
    );

    // Group deductions by subcontractor for the return
    const subMap = {};
    for (const d of deductions.rows) {
      if (!subMap[d.subcontractor_id]) {
        subMap[d.subcontractor_id] = {
          name: d.name, utr: d.utr, nino: d.nino,
          verificationNumber: d.verification_number,
          totalGross: 0, totalMaterials: 0, totalDeductions: 0
        };
      }
      subMap[d.subcontractor_id].totalGross += Number(d.gross_amount);
      subMap[d.subcontractor_id].totalMaterials += Number(d.materials_amount);
      subMap[d.subcontractor_id].totalDeductions += Number(d.deduction_amount);
    }

    // Build HMRC submission
    const submission = {
      periodEnd: cisReturn.period_end,
      contractorUtr: req.body.contractorUtr,
      nilReturn: cisReturn.nil_return,
      subcontractors: Object.values(subMap).map(s => ({
        name: s.name,
        utr: s.utr,
        nino: s.nino,
        verificationNumber: s.verificationNumber,
        grossAmountPaid: s.totalGross,
        costOfMaterials: s.totalMaterials,
        deductionAmount: s.totalDeductions
      }))
    };

    const https = require("https");
    const url = new URL("/organisations/cis/return", baseUrl);
    const postData = JSON.stringify(submission);

    const hmrcRes = await new Promise((resolve, reject) => {
      const options = {
        hostname: url.hostname, path: url.pathname, method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + hmrcToken.access_token,
          "Accept": "application/vnd.hmrc.1.0+json",
          "Content-Length": Buffer.byteLength(postData)
        }
      };
      const r = https.request(options, (response) => {
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => {
          try { resolve({ status: response.statusCode, body: JSON.parse(data) }); }
          catch (e) { resolve({ status: response.statusCode, body: data }); }
        });
      });
      r.on("error", reject);
      r.write(postData);
      r.end();
    });

    if (hmrcRes.status >= 200 && hmrcRes.status < 300) {
      // Mark as submitted
      await db.query(
        `UPDATE cis_returns SET status='submitted', submitted_at=NOW(),
         hmrc_response=$3, updated_at=NOW()
         WHERE id=$1 AND company_id=$2`,
        [cisReturn.id, companyId, JSON.stringify(hmrcRes.body)]
      );

      // Link deductions to this return
      await db.query(
        `UPDATE cis_deductions SET cis_return_id=$3
         WHERE company_id=$1 AND tax_month=$2`,
        [companyId, taxMonth, cisReturn.id]
      );

      res.json({ message: "CIS return submitted successfully", hmrcResponse: hmrcRes.body });
    } else {
      console.error("HMRC CIS return error:", hmrcRes);
      res.status(hmrcRes.status || 500).json({
        error: "HMRC submission failed",
        details: hmrcRes.body
      });
    }
  } catch (e) { next(e); }
});


// ============================================================
// CIS STATEMENTS & SUMMARY
// ============================================================

// GET /cis/summary - CIS summary for dashboard
router.get("/summary", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);

    const subCount = await db.query(
      `SELECT COUNT(*) as count FROM cis_subcontractors WHERE company_id=$1`,
      [companyId]
    );

    // Current tax month
    const now = new Date();
    const currentMonth = getTaxMonth(now.toISOString().split("T")[0]);

    const monthDeductions = await db.query(
      `SELECT COALESCE(SUM(gross_amount),0) as total_gross,
              COALESCE(SUM(deduction_amount),0) as total_deductions,
              COALESCE(SUM(net_payment),0) as total_net,
              COUNT(*) as count
       FROM cis_deductions WHERE company_id=$1 AND tax_month=$2`,
      [companyId, currentMonth]
    );

    // Year to date (tax year starts April 6)
    const taxYearStart = now.getMonth() >= 3 && now.getDate() >= 6
      ? new Date(now.getFullYear(), 3, 6)
      : new Date(now.getFullYear() - 1, 3, 6);
    const ytdStart = taxYearStart.toISOString().split("T")[0];

    const ytdDeductions = await db.query(
      `SELECT COALESCE(SUM(gross_amount),0) as total_gross,
              COALESCE(SUM(deduction_amount),0) as total_deductions,
              COALESCE(SUM(net_payment),0) as total_net,
              COUNT(*) as count
       FROM cis_deductions WHERE company_id=$1 AND date >= $2`,
      [companyId, ytdStart]
    );

    const pendingReturns = await db.query(
      `SELECT COUNT(*) as count FROM cis_returns
       WHERE company_id=$1 AND status='draft'`,
      [companyId]
    );

    res.json({
      subcontractorCount: Number(subCount.rows[0].count),
      currentMonth: {
        month: currentMonth,
        ...monthDeductions.rows[0]
      },
      yearToDate: ytdDeductions.rows[0],
      pendingReturns: Number(pendingReturns.rows[0].count)
    });
  } catch (e) { next(e); }
});

// GET /cis/statement/:subcontractorId - CIS statement for a subcontractor
router.get("/statement/:subcontractorId", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);
    const subId = Number(req.params.subcontractorId);
    const { from, to } = req.query;

    const sub = await db.query(
      `SELECT * FROM cis_subcontractors WHERE id=$1 AND company_id=$2`,
      [subId, companyId]
    );
    if (sub.rowCount === 0) return res.status(404).json({ error: "Subcontractor not found" });

    let sql = `SELECT * FROM cis_deductions
               WHERE company_id=$1 AND subcontractor_id=$2`;
    const params = [companyId, subId];
    let idx = 3;

    if (from) { sql += ` AND date >= $${idx}`; params.push(from); idx++; }
    if (to) { sql += ` AND date <= $${idx}`; params.push(to); idx++; }
    sql += " ORDER BY date";

    const deductions = await db.query(sql, params);

    let totalGross = 0, totalMaterials = 0, totalLabour = 0, totalDeductions = 0, totalNet = 0;
    for (const d of deductions.rows) {
      totalGross += Number(d.gross_amount);
      totalMaterials += Number(d.materials_amount);
      totalLabour += Number(d.labour_amount);
      totalDeductions += Number(d.deduction_amount);
      totalNet += Number(d.net_payment);
    }

    res.json({
      subcontractor: sub.rows[0],
      deductions: deductions.rows,
      totals: {
        gross: totalGross.toFixed(2),
        materials: totalMaterials.toFixed(2),
        labour: totalLabour.toFixed(2),
        deductions: totalDeductions.toFixed(2),
        net: totalNet.toFixed(2)
      }
    });
  } catch (e) { next(e); }
});

// GET /cis/tax-months - List available tax months with status
router.get("/tax-months", async (req, res, next) => {
  try {
    const companyId = Number(req.user.companyId);

    const result = await db.query(
      `SELECT tax_month, COUNT(*) as deduction_count,
              SUM(gross_amount) as total_gross,
              SUM(deduction_amount) as total_deductions
       FROM cis_deductions WHERE company_id=$1
       GROUP BY tax_month ORDER BY tax_month DESC`,
      [companyId]
    );

    // Get return statuses
    const returns = await db.query(
      `SELECT tax_month, status, submitted_at FROM cis_returns WHERE company_id=$1`,
      [companyId]
    );
    const returnMap = {};
    for (const r of returns.rows) { returnMap[r.tax_month] = r; }

    const months = result.rows.map(m => ({
      ...m,
      return_status: returnMap[m.tax_month]?.status || "not_created",
      submitted_at: returnMap[m.tax_month]?.submitted_at || null
    }));

    res.json({ taxMonths: months });
  } catch (e) { next(e); }
});

module.exports = router;
