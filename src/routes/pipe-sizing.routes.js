const express = require("express");
const router = express.Router();

// BS 6891:2015 Gas Pipe Sizing Calculator
// With multi-section support, AUTO/LOCKED pipe sizing, expanded fittings

const GAS_TYPES = {
  natural: {
    label: "Natural Gas",
    specificGravity: 0.6,
    calorificGross: 38.76,
    calorificNet: 34.89,
    maxPressureDrop: 1.0
  },
  lpg: {
    label: "LPG (Propane)",
    specificGravity: 1.5,
    calorificGross: 93.1,
    calorificNet: 85.8,
    maxPressureDrop: 2.5
  }
};

// Pipe internal diameters and volumes per metre (litres) - BS 6891
const PIPE_DATA = {
  copper: {
    label: "Copper",
    sizes: [
      { nominal: "8mm",  internalDia: 6.8,  volumePerM: 0.03632 },
      { nominal: "10mm", internalDia: 8.8,  volumePerM: 0.06082 },
      { nominal: "12mm", internalDia: 10.8, volumePerM: 0.09161 },
      { nominal: "15mm", internalDia: 13.6, volumePerM: 0.14527 },
      { nominal: "22mm", internalDia: 20.2, volumePerM: 0.32047 },
      { nominal: "28mm", internalDia: 26.2, volumePerM: 0.53898 },
      { nominal: "35mm", internalDia: 32.6, volumePerM: 0.83424 },
      { nominal: "42mm", internalDia: 39.6, volumePerM: 1.23100 },
      { nominal: "54mm", internalDia: 51.6, volumePerM: 2.09100 }
    ]
  },
  steel: {
    label: "Steel (Low Carbon)",
    sizes: [
      { nominal: "15mm (1/2\")",   internalDia: 16.1, volumePerM: 0.20358 },
      { nominal: "20mm (3/4\")",   internalDia: 21.6, volumePerM: 0.36644 },
      { nominal: "25mm (1\")",     internalDia: 27.3, volumePerM: 0.58541 },
      { nominal: "32mm (1 1/4\")", internalDia: 36.0, volumePerM: 1.01788 },
      { nominal: "40mm (1 1/2\")", internalDia: 41.9, volumePerM: 1.37886 },
      { nominal: "50mm (2\")",     internalDia: 53.0, volumePerM: 2.20618 }
    ]
  }
};

// BS 6891 Table 6 - Equivalent lengths for fittings (metres)
// Expanded: formBend90, formBend45 (copper formed bends), elbow90 (machined),
//           teeEntering (flow into branch), teeExiting (flow straight through)
const FITTING_EQ_LENGTHS = {
  copper: {
    "8mm":  { formBend90: 0.15, formBend45: 0.10, elbow90: 0.25, teeEntering: 0.50, teeExiting: 0.30 },
    "10mm": { formBend90: 0.20, formBend45: 0.12, elbow90: 0.30, teeEntering: 0.60, teeExiting: 0.35 },
    "12mm": { formBend90: 0.22, formBend45: 0.14, elbow90: 0.35, teeEntering: 0.60, teeExiting: 0.35 },
    "15mm": { formBend90: 0.25, formBend45: 0.15, elbow90: 0.40, teeEntering: 0.80, teeExiting: 0.50 },
    "22mm": { formBend90: 0.30, formBend45: 0.20, elbow90: 0.50, teeEntering: 1.00, teeExiting: 0.60 },
    "28mm": { formBend90: 0.40, formBend45: 0.25, elbow90: 0.60, teeEntering: 1.20, teeExiting: 0.70 },
    "35mm": { formBend90: 0.50, formBend45: 0.30, elbow90: 0.80, teeEntering: 1.50, teeExiting: 0.90 },
    "42mm": { formBend90: 0.60, formBend45: 0.40, elbow90: 1.00, teeEntering: 1.80, teeExiting: 1.10 },
    "54mm": { formBend90: 0.75, formBend45: 0.50, elbow90: 1.20, teeEntering: 2.20, teeExiting: 1.30 }
  },
  steel: {
    "15mm (1/2\")":   { elbow90: 0.50, formBend45: 0.30, teeEntering: 0.80, teeExiting: 0.50 },
    "20mm (3/4\")":   { elbow90: 0.60, formBend45: 0.40, teeEntering: 1.00, teeExiting: 0.60 },
    "25mm (1\")":     { elbow90: 0.80, formBend45: 0.50, teeEntering: 1.20, teeExiting: 0.70 },
    "32mm (1 1/4\")": { elbow90: 1.00, formBend45: 0.60, teeEntering: 1.50, teeExiting: 0.90 },
    "40mm (1 1/2\")": { elbow90: 1.20, formBend45: 0.80, teeEntering: 1.80, teeExiting: 1.10 },
    "50mm (2\")":     { elbow90: 1.50, formBend45: 1.00, teeEntering: 2.50, teeExiting: 1.50 }
  }
};

const METER_VOLUMES = {
  U6:  { volume: 3.06, label: "U6 Diaphragm" },
  E6:  { volume: 3.06, label: "E6 Diaphragm" },
  U16: { volume: 7.50, label: "U16 Diaphragm" },
  U25: { volume: 12.00, label: "U25 Diaphragm" },
  U40: { volume: 18.00, label: "U40 Diaphragm" }
};

// Convert kW to gas rate m³/hr (using gross calorific value)
function kwToM3hr(kw, gasType) {
  const gas = GAS_TYPES[gasType] || GAS_TYPES.natural;
  return kw / gas.calorificGross;
}

// Convert m³/hr to kW
function m3hrToKw(m3hr, gasType) {
  const gas = GAS_TYPES[gasType] || GAS_TYPES.natural;
  return m3hr * gas.calorificGross;
}

// Pole formula pressure drop (BS 6891)
// H = s * L * (Q / (0.001978 * D^2.667))^2
function pressureDrop(Q, D, L, s) {
  if (D <= 0 || L <= 0 || Q <= 0) return 0;
  const k = 0.001978 * Math.pow(D, 2.667);
  return s * L * Math.pow(Q / k, 2);
}

// Calculate equivalent length of all fittings for a section
function fittingEquivLength(fittings, material, pipeSize) {
  if (!fittings) return 0;
  const table = (FITTING_EQ_LENGTHS[material] || {})[pipeSize] || {};
  let total = 0;

  // Map all fitting types
  const fittingMap = {
    formBend90:   "formBend90",
    formBend45:   "formBend45",
    elbow90:      "elbow90",
    teeEntering:  "teeEntering",
    teeExiting:   "teeExiting",
    // Backwards compatibility with old field names
    elbow45:      "formBend45",
    tee:          "teeEntering"
  };

  for (const [inputKey, tableKey] of Object.entries(fittingMap)) {
    const count = Number(fittings[inputKey]) || 0;
    if (count > 0 && table[tableKey]) {
      total += count * table[tableKey];
    }
  }

  return total;
}

// Find minimum pipe size that keeps pressure drop within budget
function autoSelectPipe(gasRateM3hr, straightLength, fittings, material, specificGravity, maxPD) {
  const pipes = PIPE_DATA[material] || PIPE_DATA.copper;

  for (const pipe of pipes.sizes) {
    const eqLen = fittingEquivLength(fittings, material, pipe.nominal);
    const effLen = straightLength + eqLen;
    const pd = pressureDrop(gasRateM3hr, pipe.internalDia, effLen, specificGravity);
    if (pd <= maxPD) {
      return {
        pipe,
        equivalentLength: eqLen,
        effectiveLength: effLen,
        pressureDrop: pd
      };
    }
  }

  // Largest pipe still exceeds - return it with warning
  const largest = pipes.sizes[pipes.sizes.length - 1];
  const eqLen = fittingEquivLength(fittings, material, largest.nominal);
  const effLen = straightLength + eqLen;
  const pd = pressureDrop(gasRateM3hr, largest.internalDia, effLen, specificGravity);
  return {
    pipe: largest,
    equivalentLength: eqLen,
    effectiveLength: effLen,
    pressureDrop: pd,
    warning: "Largest available pipe size may be insufficient"
  };
}

// Round helper
function rd(val, dp) { return Math.round(val * Math.pow(10, dp)) / Math.pow(10, dp); }

// ----- ROUTES -----

// POST /pipe-sizing/calculate
router.post("/calculate", (req, res) => {
  try {
    const { gasType, totalGasRateM3hr, totalGasRateKw, sections } = req.body;

    if (!sections || !Array.isArray(sections) || sections.length === 0) {
      return res.status(400).json({ error: "At least one section is required" });
    }

    const gt = gasType || "natural";
    const gas = GAS_TYPES[gt] || GAS_TYPES.natural;

    // Resolve total gas rate (used as default for Section 1 if no per-section rate given)
    let totalRate = 0;
    if (totalGasRateM3hr) {
      totalRate = Number(totalGasRateM3hr);
    } else if (totalGasRateKw) {
      totalRate = kwToM3hr(Number(totalGasRateKw), gt);
    }

    const results = [];
    let cumulativePD = 0;
    let totalActualLen = 0;
    let totalEffLen = 0;
    let totalVolume = 0;

    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      const mat = s.material || "copper";
      const straightLen = Number(s.pipeLength) || 0;
      const mode = (s.pipeSizeMode || "auto").toLowerCase(); // "auto" or "locked"
      const fittings = s.fittings || {};

      // Determine gas rate for this section
      let sectionRateM3hr = 0;
      let grossKw = null;
      let netKw = null;

      if (s.gasRateM3hr) {
        sectionRateM3hr = Number(s.gasRateM3hr);
        grossKw = rd(m3hrToKw(sectionRateM3hr, gt), 2);
        netKw = rd(sectionRateM3hr * gas.calorificNet, 2);
      } else if (s.grossKw) {
        grossKw = Number(s.grossKw);
        sectionRateM3hr = kwToM3hr(grossKw, gt);
        netKw = rd(grossKw * (gas.calorificNet / gas.calorificGross), 2);
      } else if (s.netKw) {
        netKw = Number(s.netKw);
        grossKw = rd(netKw * (gas.calorificGross / gas.calorificNet), 2);
        sectionRateM3hr = kwToM3hr(grossKw, gt);
      } else if (s.gasRateKw) {
        grossKw = Number(s.gasRateKw);
        sectionRateM3hr = kwToM3hr(grossKw, gt);
        netKw = rd(grossKw * (gas.calorificNet / gas.calorificGross), 2);
      } else if (totalRate > 0 && i === 0) {
        // First section defaults to total gas rate if no per-section rate given
        sectionRateM3hr = totalRate;
        grossKw = rd(m3hrToKw(totalRate, gt), 2);
        netKw = rd(totalRate * gas.calorificNet, 2);
      } else {
        return res.status(400).json({
          error: `Section ${i + 1}: gas rate is required. Provide gasRateM3hr, grossKw, netKw, or gasRateKw`
        });
      }

      if (straightLen <= 0) {
        return res.status(400).json({ error: `Section ${i + 1}: pipeLength must be greater than 0` });
      }

      // How much pressure drop budget is left for this section?
      const pdBudgetRemaining = gas.maxPressureDrop - cumulativePD;

      let pipeNominal, internalDia, eqLen, effLen, pd, pipeWarning;

      if (mode === "locked" && s.pipeDiameter) {
        // LOCKED mode - user specified the pipe size
        const pipes = PIPE_DATA[mat] || PIPE_DATA.copper;
        const pipeInfo = pipes.sizes.find(p => p.nominal === s.pipeDiameter);
        if (!pipeInfo) {
          return res.status(400).json({ error: `Section ${i + 1}: invalid pipe diameter "${s.pipeDiameter}" for ${mat}` });
        }
        pipeNominal = pipeInfo.nominal;
        internalDia = pipeInfo.internalDia;
        eqLen = fittingEquivLength(fittings, mat, pipeNominal);
        effLen = straightLen + eqLen;
        pd = pressureDrop(sectionRateM3hr, internalDia, effLen, gas.specificGravity);
      } else {
        // AUTO mode - find minimum pipe size within remaining budget
        const auto = autoSelectPipe(
          sectionRateM3hr, straightLen, fittings, mat,
          gas.specificGravity,
          pdBudgetRemaining > 0 ? pdBudgetRemaining : gas.maxPressureDrop
        );
        pipeNominal = auto.pipe.nominal;
        internalDia = auto.pipe.internalDia;
        eqLen = auto.equivalentLength;
        effLen = auto.effectiveLength;
        pd = auto.pressureDrop;
        pipeWarning = auto.warning || null;
      }

      // Pipe volume for this section (litres)
      const pipes = PIPE_DATA[mat] || PIPE_DATA.copper;
      const pipeInfo = pipes.sizes.find(p => p.nominal === pipeNominal);
      const volumePerM = pipeInfo ? pipeInfo.volumePerM : 0;
      const sectionVolumeLitres = volumePerM * straightLen;

      cumulativePD += pd;
      totalActualLen += straightLen;
      totalEffLen += effLen;
      totalVolume += sectionVolumeLitres;

      results.push({
        section: i + 1,
        name: s.name || `Section ${i + 1}`,
        pipeSizeMode: mode,
        grossKw,
        netKw,
        gasRateM3hr: rd(sectionRateM3hr, 4),
        material: mat,
        pipeSize: pipeNominal,
        internalDiaMm: internalDia,
        straightLengthM: straightLen,
        fittings: {
          formBend45: Number(fittings.formBend45 || fittings.elbow45) || 0,
          formBend90: Number(fittings.formBend90) || 0,
          elbow90: Number(fittings.elbow90) || 0,
          teeEntering: Number(fittings.teeEntering || fittings.tee) || 0,
          teeExiting: Number(fittings.teeExiting) || 0
        },
        equivalentLengthM: rd(eqLen, 3),
        effectiveLengthM: rd(effLen, 3),
        pressureDropMbar: rd(pd, 4),
        cumulativePressureDropMbar: rd(cumulativePD, 4),
        pressureDropOk: cumulativePD <= gas.maxPressureDrop,
        pipeVolumeLitres: rd(sectionVolumeLitres, 3),
        warning: pipeWarning || null
      });
    }

    res.json({
      gasType: gt,
      gasTypeLabel: gas.label,
      maxAllowablePressureDropMbar: gas.maxPressureDrop,
      totalGasRateM3hr: totalRate > 0 ? rd(totalRate, 4) : null,
      totalGasRateKw: totalRate > 0 ? rd(m3hrToKw(totalRate, gt), 2) : null,
      sections: results,
      totals: {
        totalActualLengthM: rd(totalActualLen, 2),
        totalEffectiveLengthM: rd(totalEffLen, 2),
        totalPressureDropMbar: rd(cumulativePD, 4),
        pressureDropOk: cumulativePD <= gas.maxPressureDrop,
        totalPipeVolumeLitres: rd(totalVolume, 3),
        sectionCount: sections.length
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /pipe-sizing/tightness-test - IGEM/UP/1B Edition 4
router.post("/tightness-test", (req, res) => {
  try {
    const { meterType, customMeterVolume, sections } = req.body;

    let meterVolume = 0;
    if (meterType && METER_VOLUMES[meterType]) {
      meterVolume = METER_VOLUMES[meterType].volume;
    } else if (customMeterVolume) {
      meterVolume = Number(customMeterVolume);
    }

    let totalPipeVolume = 0;
    if (sections && Array.isArray(sections)) {
      for (const s of sections) {
        const mat = s.material || "copper";
        const pipes = PIPE_DATA[mat] || PIPE_DATA.copper;
        const pipeInfo = pipes.sizes.find(p => p.nominal === s.pipeDiameter);
        if (pipeInfo) {
          totalPipeVolume += pipeInfo.volumePerM * (Number(s.pipeLength) || 0);
        }
      }
    }

    const totalVolume = meterVolume + totalPipeVolume;

    // IGEM/UP/1B Edition 4 Table 1
    let permissibleDrop, testDuration;
    if (totalVolume <= 10) {
      permissibleDrop = 8;
      testDuration = "1 minute";
    } else if (totalVolume <= 50) {
      permissibleDrop = 4;
      testDuration = "2 minutes";
    } else {
      permissibleDrop = 1;
      testDuration = "2 minutes";
    }

    res.json({
      meterType: meterType || "custom",
      meterVolumeLitres: meterVolume,
      pipeVolumeLitres: rd(totalPipeVolume, 3),
      totalInstallationVolumeLitres: rd(totalVolume, 3),
      permissibleDropMbar: permissibleDrop,
      testDuration,
      purgeVolumeLitres: rd(totalPipeVolume, 3)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /pipe-sizing/gas-types
router.get("/gas-types", (req, res) => {
  res.json({
    gasTypes: Object.entries(GAS_TYPES).map(([k, v]) => ({
      type: k, label: v.label,
      maxPressureDropMbar: v.maxPressureDrop,
      calorificGross: v.calorificGross,
      calorificNet: v.calorificNet,
      m3hrPerKw: rd(1 / v.calorificGross, 6),
      kwPerM3hr: v.calorificGross
    }))
  });
});

// GET /pipe-sizing/materials
router.get("/materials", (req, res) => {
  res.json({
    materials: Object.entries(PIPE_DATA).map(([k, v]) => ({
      type: k, label: v.label,
      sizes: v.sizes.map(s => ({
        nominal: s.nominal,
        internalDiaMm: s.internalDia,
        volumePerMLitres: s.volumePerM
      }))
    }))
  });
});

// GET /pipe-sizing/meter-types
router.get("/meter-types", (req, res) => {
  res.json({
    meterTypes: Object.entries(METER_VOLUMES).map(([k, v]) => ({
      type: k, label: v.label, volumeLitres: v.volume
    }))
  });
});

// GET /pipe-sizing/fittings
router.get("/fittings", (req, res) => {
  res.json({
    fittingTypes: [
      { key: "formBend45", label: "45° Form Bends", description: "Copper tube bent on site at 45°", materials: ["copper"] },
      { key: "formBend90", label: "90° Form Bends", description: "Copper tube bent on site at 90°", materials: ["copper"] },
      { key: "elbow90", label: "90° Elbows", description: "Machined/compression elbow fitting", materials: ["copper", "steel"] },
      { key: "teeEntering", label: "Tee Flow Entering", description: "Tee with gas flow entering the branch", materials: ["copper", "steel"] },
      { key: "teeExiting", label: "Tee Flow Exiting", description: "Tee with gas flow going straight through", materials: ["copper", "steel"] }
    ],
    equivalentLengths: FITTING_EQ_LENGTHS
  });
});

// GET /pipe-sizing/convert - Convert between kW and m³/hr
router.get("/convert", (req, res) => {
  const { gasType, grossKw, netKw, gasRateM3hr } = req.query;
  const gt = gasType || "natural";
  const gas = GAS_TYPES[gt] || GAS_TYPES.natural;

  if (grossKw) {
    const kw = Number(grossKw);
    const rate = kwToM3hr(kw, gt);
    res.json({ grossKw: kw, netKw: rd(kw * gas.calorificNet / gas.calorificGross, 2), gasRateM3hr: rd(rate, 4) });
  } else if (netKw) {
    const nkw = Number(netKw);
    const gkw = rd(nkw * gas.calorificGross / gas.calorificNet, 2);
    res.json({ grossKw: gkw, netKw: nkw, gasRateM3hr: rd(kwToM3hr(gkw, gt), 4) });
  } else if (gasRateM3hr) {
    const rate = Number(gasRateM3hr);
    const gkw = rd(m3hrToKw(rate, gt), 2);
    res.json({ grossKw: gkw, netKw: rd(gkw * gas.calorificNet / gas.calorificGross, 2), gasRateM3hr: rate });
  } else {
    res.json({
      formula: "1 m³/hr = calorificGross kW",
      natural: { m3hrPerKw: rd(1 / GAS_TYPES.natural.calorificGross, 6), kwPerM3hr: GAS_TYPES.natural.calorificGross },
      lpg: { m3hrPerKw: rd(1 / GAS_TYPES.lpg.calorificGross, 6), kwPerM3hr: GAS_TYPES.lpg.calorificGross }
    });
  }
});

module.exports = router;
