const express = require("express");
const router = express.Router();

// BS 6891:2015 Gas Pipe Sizing Calculator

// Gas properties
const GAS_TYPES = {
  natural: { label: "Natural Gas", specificGravity: 0.6, calorificGross: 38.76, calorificNet: 34.89, maxPressureDrop: 1.0 },
  lpg: { label: "LPG (Propane)", specificGravity: 1.5, calorificGross: 93.1, calorificNet: 85.8, maxPressureDrop: 2.5 }
};

// Pipe internal diameters (mm) - BS 6891
const PIPE_DATA = {
  copper: {
    label: "Copper",
    sizes: [
      { nominal: "8mm", internalDia: 6.8, volume: 0.0000363 },
      { nominal: "10mm", internalDia: 8.8, volume: 0.0000608 },
      { nominal: "12mm", internalDia: 10.8, volume: 0.0000916 },
      { nominal: "15mm", internalDia: 13.6, volume: 0.0001453 },
      { nominal: "22mm", internalDia: 20.2, volume: 0.0003205 },
      { nominal: "28mm", internalDia: 26.2, volume: 0.0005390 },
      { nominal: "35mm", internalDia: 32.6, volume: 0.0008342 },
      { nominal: "42mm", internalDia: 39.6, volume: 0.001231 },
      { nominal: "54mm", internalDia: 51.6, volume: 0.002091 }
    ]
  },
  steel: {
    label: "Steel (Low Carbon)",
    sizes: [
      { nominal: "15mm (1/2\")", internalDia: 16.1, volume: 0.0002035 },
      { nominal: "20mm (3/4\")", internalDia: 21.6, volume: 0.0003664 },
      { nominal: "25mm (1\")", internalDia: 27.3, volume: 0.0005854 },
      { nominal: "32mm (1 1/4\")", internalDia: 36.0, volume: 0.001018 },
      { nominal: "40mm (1 1/2\")", internalDia: 41.9, volume: 0.001379 },
      { nominal: "50mm (2\")", internalDia: 53.0, volume: 0.002206 }
    ]
  }
};

// Equivalent lengths for fittings (metres) - BS 6891 Table 6
const FITTING_EQUIVALENT_LENGTHS = {
  copper: {
    "8mm":  { elbow90: 0.25, elbow45: 0.15, tee: 0.50 },
    "10mm": { elbow90: 0.30, elbow45: 0.20, tee: 0.60 },
    "12mm": { elbow90: 0.35, elbow45: 0.20, tee: 0.60 },
    "15mm": { elbow90: 0.40, elbow45: 0.25, tee: 0.80 },
    "22mm": { elbow90: 0.50, elbow45: 0.30, tee: 1.00 },
    "28mm": { elbow90: 0.60, elbow45: 0.40, tee: 1.20 },
    "35mm": { elbow90: 0.80, elbow45: 0.50, tee: 1.50 },
    "42mm": { elbow90: 1.00, elbow45: 0.60, tee: 1.80 },
    "54mm": { elbow90: 1.20, elbow45: 0.80, tee: 2.20 }
  },
  steel: {
    "15mm (1/2\")":   { elbow90: 0.50, elbow45: 0.30, tee: 0.80 },
    "20mm (3/4\")":   { elbow90: 0.60, elbow45: 0.40, tee: 1.00 },
    "25mm (1\")":     { elbow90: 0.80, elbow45: 0.50, tee: 1.20 },
    "32mm (1 1/4\")": { elbow90: 1.00, elbow45: 0.60, tee: 1.50 },
    "40mm (1 1/2\")": { elbow90: 1.20, elbow45: 0.80, tee: 1.80 },
    "50mm (2\")":     { elbow90: 1.50, elbow45: 1.00, tee: 2.50 }
  }
};

// Meter volumes (litres)
const METER_VOLUMES = {
  U6:  { volume: 3.06, label: "U6 Diaphragm" },
  E6:  { volume: 3.06, label: "E6 Diaphragm" },
  U16: { volume: 7.50, label: "U16 Diaphragm" },
  U25: { volume: 12.00, label: "U25 Diaphragm" },
  U40: { volume: 18.00, label: "U40 Diaphragm" }
};

// Calculate gas rate from kW
function kwToGasRate(kw, gasType) {
  const gas = GAS_TYPES[gasType] || GAS_TYPES.natural;
  return kw / gas.calorificGross; // m3/hr
}

// Calculate pressure drop using Pole formula (BS 6891)
// H = (s * L * Q^2) / (D^5 * C)
// Simplified: Q = 0.001978 * D^2.667 * sqrt(H / (s * L))
// Rearranged: H = s * L * (Q / (0.001978 * D^2.667))^2
function calculatePressureDrop(gasRateM3hr, internalDiaMm, effectiveLengthM, specificGravity) {
  const D = internalDiaMm;
  const Q = gasRateM3hr;
  const s = specificGravity;
  const L = effectiveLengthM;

  if (D <= 0 || L <= 0 || Q <= 0) return 0;

  const denominator = 0.001978 * Math.pow(D, 2.667);
  const pressureDrop = s * L * Math.pow(Q / denominator, 2);

  return pressureDrop; // mbar
}

// Find minimum pipe size for given constraints
function findMinPipeSize(gasRateM3hr, effectiveLengthM, specificGravity, maxPressureDrop, material) {
  const pipes = PIPE_DATA[material] || PIPE_DATA.copper;
  for (const pipe of pipes.sizes) {
    const pd = calculatePressureDrop(gasRateM3hr, pipe.internalDia, effectiveLengthM, specificGravity);
    if (pd <= maxPressureDrop) {
      return { ...pipe, pressureDrop: Math.round(pd * 1000) / 1000 };
    }
  }
  return { ...pipes.sizes[pipes.sizes.length - 1], pressureDrop: null, warning: "Largest available pipe may be insufficient" };
}

// Calculate effective length (actual length + equivalent length of fittings)
function calculateEffectiveLength(actualLength, fittings, material, pipeSize) {
  let equivalentLength = 0;
  const fittingData = (FITTING_EQUIVALENT_LENGTHS[material] || {})[pipeSize] || {};

  if (fittings) {
    if (fittings.elbow90) equivalentLength += (fittings.elbow90 || 0) * (fittingData.elbow90 || 0.5);
    if (fittings.elbow45) equivalentLength += (fittings.elbow45 || 0) * (fittingData.elbow45 || 0.3);
    if (fittings.tee) equivalentLength += (fittings.tee || 0) * (fittingData.tee || 1.0);
  }

  return { actualLength, equivalentLength, effectiveLength: actualLength + equivalentLength };
}

// POST /pipe-sizing/calculate - Calculate pipe sizing for multiple sections
router.post("/calculate", (req, res) => {
  try {
    const { gasType, sections } = req.body;

    if (!sections || !Array.isArray(sections) || sections.length === 0) {
      return res.status(400).json({ error: "At least one section is required" });
    }

    const gas = GAS_TYPES[gasType] || GAS_TYPES.natural;
    const results = [];
    let totalPressureDrop = 0;
    let totalActualLength = 0;
    let totalEffectiveLength = 0;
    let totalGasRate = 0;
    let totalPipeVolume = 0;

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const {
        name,
        pipeLength,
        material,
        pipeDiameter,
        fittings,
        gasRateKw,
        gasRateM3hr,
        applianceName
      } = section;

      const mat = material || "copper";
      const length = Number(pipeLength) || 1;

      // Get gas rate (from kW or direct m3/hr)
      let gasRate = 0;
      if (gasRateKw) {
        gasRate = kwToGasRate(Number(gasRateKw), gasType || "natural");
      } else if (gasRateM3hr) {
        gasRate = Number(gasRateM3hr);
      } else {
        return res.status(400).json({ error: `Section ${i + 1}: gasRateKw or gasRateM3hr is required` });
      }

      totalGasRate += gasRate;

      // If pipe diameter specified, calculate for that size
      if (pipeDiameter) {
        const pipes = PIPE_DATA[mat] || PIPE_DATA.copper;
        const pipeInfo = pipes.sizes.find(p => p.nominal === pipeDiameter) || pipes.sizes.find(p => p.internalDia === Number(pipeDiameter));

        if (!pipeInfo) {
          return res.status(400).json({ error: `Section ${i + 1}: Invalid pipe diameter ${pipeDiameter} for ${mat}` });
        }

        const lengths = calculateEffectiveLength(length, fittings, mat, pipeInfo.nominal);
        const pd = calculatePressureDrop(gasRate, pipeInfo.internalDia, lengths.effectiveLength, gas.specificGravity);
        const pipeVolume = (pipeInfo.volume || 0) * length;

        totalPressureDrop += pd;
        totalActualLength += length;
        totalEffectiveLength += lengths.effectiveLength;
        totalPipeVolume += pipeVolume;

        results.push({
          section: i + 1,
          name: name || applianceName || `Section ${i + 1}`,
          applianceName: applianceName || null,
          gasRateKw: gasRateKw ? Number(gasRateKw) : null,
          gasRateM3hr: Math.round(gasRate * 10000) / 10000,
          material: mat,
          pipeSize: pipeInfo.nominal,
          internalDia: pipeInfo.internalDia,
          actualLength: length,
          equivalentLength: Math.round(lengths.equivalentLength * 100) / 100,
          effectiveLength: Math.round(lengths.effectiveLength * 100) / 100,
          fittings: fittings || {},
          pressureDrop: Math.round(pd * 1000) / 1000,
          pressureDropOk: pd <= gas.maxPressureDrop,
          pipeVolume: Math.round(pipeVolume * 10000000) / 10000000
        });
      } else {
        // Auto-recommend pipe size
        // First estimate effective length with a mid-size pipe for fitting equivalents
        const pipes = PIPE_DATA[mat] || PIPE_DATA.copper;
        const midPipe = pipes.sizes[Math.floor(pipes.sizes.length / 2)];
        const estLengths = calculateEffectiveLength(length, fittings, mat, midPipe.nominal);

        const recommended = findMinPipeSize(gasRate, estLengths.effectiveLength, gas.specificGravity, gas.maxPressureDrop, mat);

        // Recalculate with actual recommended pipe for accurate fitting equivalents
        const finalLengths = calculateEffectiveLength(length, fittings, mat, recommended.nominal);
        const finalPd = calculatePressureDrop(gasRate, recommended.internalDia, finalLengths.effectiveLength, gas.specificGravity);
        const pipeVolume = (recommended.volume || 0) * length;

        totalPressureDrop += finalPd;
        totalActualLength += length;
        totalEffectiveLength += finalLengths.effectiveLength;
        totalPipeVolume += pipeVolume;

        results.push({
          section: i + 1,
          name: name || applianceName || `Section ${i + 1}`,
          applianceName: applianceName || null,
          gasRateKw: gasRateKw ? Number(gasRateKw) : null,
          gasRateM3hr: Math.round(gasRate * 10000) / 10000,
          material: mat,
          recommendedPipeSize: recommended.nominal,
          internalDia: recommended.internalDia,
          actualLength: length,
          equivalentLength: Math.round(finalLengths.equivalentLength * 100) / 100,
          effectiveLength: Math.round(finalLengths.effectiveLength * 100) / 100,
          fittings: fittings || {},
          pressureDrop: Math.round(finalPd * 1000) / 1000,
          pressureDropOk: finalPd <= gas.maxPressureDrop,
          pipeVolume: Math.round(pipeVolume * 10000000) / 10000000,
          warning: recommended.warning || null
        });
      }
    }

    res.json({
      gasType: gasType || "natural",
      gasTypeLabel: gas.label,
      maxAllowablePressureDrop: gas.maxPressureDrop,
      sections: results,
      totals: {
        totalGasRateM3hr: Math.round(totalGasRate * 10000) / 10000,
        totalGasRateKw: Math.round(totalGasRate * gas.calorificGross * 100) / 100,
        totalActualLength: Math.round(totalActualLength * 100) / 100,
        totalEffectiveLength: Math.round(totalEffectiveLength * 100) / 100,
        totalPressureDrop: Math.round(totalPressureDrop * 1000) / 1000,
        pressureDropOk: totalPressureDrop <= gas.maxPressureDrop,
        totalPipeVolume: Math.round(totalPipeVolume * 10000000) / 10000000
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /pipe-sizing/tightness-test - Calculate tightness testing values
router.post("/tightness-test", (req, res) => {
  try {
    const { meterType, customMeterVolume, sections } = req.body;

    // Get meter volume
    let meterVolume = 0;
    if (meterType && METER_VOLUMES[meterType]) {
      meterVolume = METER_VOLUMES[meterType].volume;
    } else if (customMeterVolume) {
      meterVolume = Number(customMeterVolume);
    }

    // Calculate total installation pipe volume from sections
    let totalPipeVolumeLitres = 0;
    if (sections && Array.isArray(sections)) {
      for (const section of sections) {
        const mat = section.material || "copper";
        const pipes = PIPE_DATA[mat] || PIPE_DATA.copper;
        const pipeInfo = pipes.sizes.find(p => p.nominal === section.pipeDiameter);
        if (pipeInfo) {
          totalPipeVolumeLitres += (pipeInfo.volume || 0) * (Number(section.pipeLength) || 0) * 1000;
        }
      }
    }

    const totalInstallationVolume = meterVolume + totalPipeVolumeLitres;

    // IGEM/UP/1B Edition 4 permissible drop calculations
    let permissibleDrop;
    let testDuration;
    if (totalInstallationVolume <= 0.01) {
      permissibleDrop = 8;
      testDuration = "1 minute";
    } else if (totalInstallationVolume <= 0.05) {
      permissibleDrop = 4;
      testDuration = "2 minutes";
    } else {
      permissibleDrop = 1;
      testDuration = "2 minutes";
    }

    // Purge volume = total pipe volume (not including meter)
    const purgeVolumeLitres = totalPipeVolumeLitres;
    const purgeVolumeM3 = purgeVolumeLitres / 1000;

    res.json({
      meterType: meterType || "custom",
      meterVolumeLitres: meterVolume,
      pipeVolumeLitres: Math.round(totalPipeVolumeLitres * 1000) / 1000,
      totalInstallationVolumeLitres: Math.round(totalInstallationVolume * 1000) / 1000,
      totalInstallationVolumeM3: Math.round(totalInstallationVolume / 1000 * 10000) / 10000,
      permissibleDropMbar: permissibleDrop,
      testDuration,
      purgeVolumeLitres: Math.round(purgeVolumeLitres * 1000) / 1000,
      purgeVolumeM3: Math.round(purgeVolumeM3 * 10000) / 10000
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /pipe-sizing/gas-types - list gas types
router.get("/gas-types", (req, res) => {
  const types = Object.entries(GAS_TYPES).map(([key, val]) => ({
    type: key,
    label: val.label,
    maxPressureDrop: val.maxPressureDrop,
    calorificGross: val.calorificGross,
    calorificNet: val.calorificNet
  }));
  res.json({ gasTypes: types });
});

// GET /pipe-sizing/materials - list pipe materials and sizes
router.get("/materials", (req, res) => {
  const materials = Object.entries(PIPE_DATA).map(([key, val]) => ({
    type: key,
    label: val.label,
    sizes: val.sizes.map(s => ({ nominal: s.nominal, internalDia: s.internalDia }))
  }));
  res.json({ materials });
});

// GET /pipe-sizing/meter-types - list meter types for tightness testing
router.get("/meter-types", (req, res) => {
  const meters = Object.entries(METER_VOLUMES).map(([key, val]) => ({
    type: key,
    label: val.label,
    volumeLitres: val.volume
  }));
  res.json({ meterTypes: meters });
});

// GET /pipe-sizing/fittings - list fitting types and equivalent lengths
router.get("/fittings", (req, res) => {
  res.json({ fittingEquivalentLengths: FITTING_EQUIVALENT_LENGTHS });
});

module.exports = router;
