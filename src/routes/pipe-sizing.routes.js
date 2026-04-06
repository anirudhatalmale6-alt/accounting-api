const express = require("express");
const router = express.Router();

// Pipe sizing data tables
const PIPE_MATERIALS = {
  copper: { roughness: 0.0015, label: "Copper" },
  plastic: { roughness: 0.007, label: "Plastic (PVC/CPVC)" },
  pex: { roughness: 0.007, label: "PEX" },
  steel: { roughness: 0.045, label: "Galvanized Steel" },
  stainless: { roughness: 0.015, label: "Stainless Steel" },
};

// Common UK pipe sizes in mm (internal diameter)
const PIPE_SIZES = [
  { nominal: "10mm", internalDia: 8.8, material: "copper" },
  { nominal: "15mm", internalDia: 13.6, material: "copper" },
  { nominal: "22mm", internalDia: 20.2, material: "copper" },
  { nominal: "28mm", internalDia: 26.2, material: "copper" },
  { nominal: "35mm", internalDia: 32.6, material: "copper" },
  { nominal: "42mm", internalDia: 39.6, material: "copper" },
  { nominal: "54mm", internalDia: 51.6, material: "copper" },
  { nominal: "15mm", internalDia: 13.2, material: "plastic" },
  { nominal: "22mm", internalDia: 19.8, material: "plastic" },
  { nominal: "28mm", internalDia: 25.4, material: "plastic" },
  { nominal: "32mm", internalDia: 29.0, material: "plastic" },
  { nominal: "40mm", internalDia: 36.2, material: "plastic" },
  { nominal: "50mm", internalDia: 46.4, material: "plastic" },
  { nominal: "10mm", internalDia: 8.0, material: "pex" },
  { nominal: "15mm", internalDia: 12.0, material: "pex" },
  { nominal: "22mm", internalDia: 18.0, material: "pex" },
  { nominal: "28mm", internalDia: 23.0, material: "pex" },
];

// Fixture loading units (UK Water Regulations Guide)
const FIXTURE_UNITS = {
  basin: { loadingUnits: 1.5, flowRate: 0.15, label: "Wash Basin" },
  bath: { loadingUnits: 10, flowRate: 0.30, label: "Bath" },
  shower: { loadingUnits: 3, flowRate: 0.20, label: "Shower" },
  wc: { loadingUnits: 2, flowRate: 0.10, label: "WC (Toilet)" },
  sink: { loadingUnits: 5, flowRate: 0.20, label: "Kitchen Sink" },
  dishwasher: { loadingUnits: 3, flowRate: 0.15, label: "Dishwasher" },
  washingMachine: { loadingUnits: 3, flowRate: 0.20, label: "Washing Machine" },
  outsideTap: { loadingUnits: 5, flowRate: 0.30, label: "Outside Tap" },
  bidet: { loadingUnits: 1.5, flowRate: 0.15, label: "Bidet" },
  urinal: { loadingUnits: 1.5, flowRate: 0.10, label: "Urinal" },
};

// Calculate friction factor using Colebrook-White equation (iterative)
function colebrookWhite(roughness, diameter, velocity) {
  const Re = (velocity * diameter) / 1.004e-6; // Reynolds number (water at ~20C)
  if (Re < 2300) {
    return 64 / Re; // Laminar flow
  }
  // Iterative solution for turbulent flow
  let f = 0.02;
  for (let i = 0; i < 50; i++) {
    const rhs = -2 * Math.log10((roughness / (3.7 * diameter * 1000)) + (2.51 / (Re * Math.sqrt(f))));
    f = 1 / (rhs * rhs);
  }
  return f;
}

// Calculate pressure drop using Darcy-Weisbach
function pressureDrop(flowRate, diameter, length, roughness) {
  const area = Math.PI * Math.pow(diameter / 2000, 2); // m2
  const velocity = flowRate / area; // m/s
  const f = colebrookWhite(roughness, diameter, velocity);
  // Delta P = f * (L/D) * (rho * v^2 / 2) in Pa, convert to kPa
  const dp = f * (length / (diameter / 1000)) * (998 * velocity * velocity / 2) / 1000;
  return { pressureDropKpa: dp, velocity, frictionFactor: f };
}

// POST /pipe-sizing/calculate
router.post("/calculate", (req, res) => {
  try {
    const {
      flowRate,         // litres per second
      pipeLength,       // metres
      material,         // copper, plastic, pex, steel
      pipeDiameter,     // mm (optional - if not provided, recommends size)
      fixtures,         // optional array of { type, count } to auto-calc flow rate
    } = req.body;

    const mat = material || "copper";
    const roughness = (PIPE_MATERIALS[mat] || PIPE_MATERIALS.copper).roughness;
    const length = pipeLength || 10;

    // Calculate flow rate from fixtures if provided
    let calcFlowRate = flowRate;
    let fixtureBreakdown = null;

    if (fixtures && Array.isArray(fixtures) && fixtures.length > 0) {
      let totalLoadingUnits = 0;
      fixtureBreakdown = [];
      for (const f of fixtures) {
        const fu = FIXTURE_UNITS[f.type];
        if (fu) {
          const count = Number(f.count) || 1;
          totalLoadingUnits += fu.loadingUnits * count;
          fixtureBreakdown.push({
            type: f.type,
            label: fu.label,
            count,
            loadingUnits: fu.loadingUnits * count,
            flowRate: fu.flowRate * count,
          });
        }
      }
      // Approximate simultaneous demand using square root method
      calcFlowRate = 0.114 * Math.pow(totalLoadingUnits, 0.488);
      if (calcFlowRate < 0.1) calcFlowRate = 0.1;
    }

    if (!calcFlowRate || calcFlowRate <= 0) {
      return res.status(400).json({
        error: "Provide flowRate (l/s) or fixtures array to calculate pipe sizing",
      });
    }

    // If specific diameter given, calculate for that size
    if (pipeDiameter) {
      const result = pressureDrop(calcFlowRate / 1000, pipeDiameter, length, roughness);
      return res.json({
        input: { flowRate: calcFlowRate, pipeLength: length, material: mat, pipeDiameter },
        fixtureBreakdown,
        result: {
          pipeDiameter,
          velocity: Math.round(result.velocity * 100) / 100,
          pressureDropKpa: Math.round(result.pressureDropKpa * 100) / 100,
          pressureDropBar: Math.round(result.pressureDropKpa / 100 * 1000) / 1000,
          velocityOk: result.velocity >= 0.5 && result.velocity <= 2.0,
          recommendation: result.velocity > 2.0
            ? "Velocity too high - use larger pipe"
            : result.velocity < 0.5
            ? "Velocity low - smaller pipe may be adequate"
            : "Good velocity range (0.5-2.0 m/s)",
        },
      });
    }

    // Auto-recommend: test all pipe sizes for this material
    const candidates = PIPE_SIZES.filter(p => p.material === mat);
    const recommendations = [];

    for (const pipe of candidates) {
      const result = pressureDrop(calcFlowRate / 1000, pipe.internalDia, length, roughness);
      const velocityOk = result.velocity >= 0.5 && result.velocity <= 2.0;
      recommendations.push({
        nominal: pipe.nominal,
        internalDia: pipe.internalDia,
        velocity: Math.round(result.velocity * 100) / 100,
        pressureDropKpa: Math.round(result.pressureDropKpa * 100) / 100,
        pressureDropBar: Math.round(result.pressureDropKpa / 100 * 1000) / 1000,
        velocityOk,
        suitable: velocityOk && result.pressureDropKpa < 100,
      });
    }

    const recommended = recommendations.find(r => r.suitable) || recommendations[recommendations.length - 1];

    res.json({
      input: { flowRate: calcFlowRate, pipeLength: length, material: mat },
      fixtureBreakdown,
      recommended,
      allSizes: recommendations,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /pipe-sizing/fixtures - list available fixture types
router.get("/fixtures", (req, res) => {
  const fixtures = Object.entries(FIXTURE_UNITS).map(([key, val]) => ({
    type: key,
    label: val.label,
    loadingUnits: val.loadingUnits,
    flowRateLps: val.flowRate,
  }));
  res.json({ fixtures });
});

// GET /pipe-sizing/materials - list available pipe materials
router.get("/materials", (req, res) => {
  const materials = Object.entries(PIPE_MATERIALS).map(([key, val]) => ({
    type: key,
    label: val.label,
    roughnessMm: val.roughness,
  }));
  res.json({ materials });
});

// GET /pipe-sizing/sizes - list pipe sizes by material
router.get("/sizes", (req, res) => {
  const material = req.query.material || null;
  let sizes = PIPE_SIZES;
  if (material) {
    sizes = sizes.filter(s => s.material === material);
  }
  res.json({ sizes });
});

module.exports = router;
