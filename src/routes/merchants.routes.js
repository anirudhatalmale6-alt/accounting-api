const express = require("express");
const db = require("../db");
const router = express.Router();

// Default UK plumbing merchants data
const DEFAULT_MERCHANTS = [
  {
    name: "Screwfix",
    category: "General Plumbing & Tools",
    website: "https://www.screwfix.com",
    phone: "03330 112 112",
    description: "Wide range of plumbing supplies, tools and fittings. Click & collect available at 800+ stores.",
    specialties: ["Pipes & Fittings", "Boiler Parts", "Bathroom", "Tools", "PPE"],
    deliveryAvailable: true,
    tradeAccount: true,
  },
  {
    name: "Toolstation",
    category: "General Plumbing & Tools",
    website: "https://www.toolstation.com",
    phone: "0330 333 3303",
    description: "Competitive prices on plumbing, heating, and tool supplies with trade counter and delivery.",
    specialties: ["Pipes & Fittings", "Heating", "Tools", "Bathroom", "Drainage"],
    deliveryAvailable: true,
    tradeAccount: true,
  },
  {
    name: "Plumb Center (Wolseley)",
    category: "Specialist Plumbing & Heating",
    website: "https://www.wolseley.co.uk",
    phone: "0330 123 0151",
    description: "UK's leading specialist plumbing and heating merchant. Trade-only branches nationwide.",
    specialties: ["Boilers", "Radiators", "Underfloor Heating", "Copper Pipe", "Valves"],
    deliveryAvailable: true,
    tradeAccount: true,
  },
  {
    name: "City Plumbing",
    category: "Specialist Plumbing & Heating",
    website: "https://www.cityplumbing.co.uk",
    phone: "0344 346 0007",
    description: "Over 300 branches across the UK. Specialist in plumbing, heating and bathroom supplies.",
    specialties: ["Boilers", "Cylinders", "Radiators", "Bathroom Suites", "Commercial Heating"],
    deliveryAvailable: true,
    tradeAccount: true,
  },
  {
    name: "Plumbase",
    category: "Specialist Plumbing & Heating",
    website: "https://www.plumbase.co.uk",
    phone: "0800 014 2836",
    description: "Part of Travis Perkins group. Good range of plumbing and heating products.",
    specialties: ["Pipes & Fittings", "Boilers", "Bathroom", "Valves", "Drainage"],
    deliveryAvailable: true,
    tradeAccount: true,
  },
  {
    name: "Travis Perkins",
    category: "Builders Merchant",
    website: "https://www.travisperkins.co.uk",
    phone: "0333 321 8036",
    description: "Major builders merchant with comprehensive plumbing section. Good for large projects.",
    specialties: ["Pipes & Fittings", "Drainage", "Soil & Waste", "Guttering", "Insulation"],
    deliveryAvailable: true,
    tradeAccount: true,
  },
  {
    name: "Jewson",
    category: "Builders Merchant",
    website: "https://www.jewson.co.uk",
    phone: "0330 333 5562",
    description: "Nationwide builders merchant. Good stock of plumbing and drainage supplies.",
    specialties: ["Drainage", "Soil & Waste", "Pipes", "Guttering", "Bathroom"],
    deliveryAvailable: true,
    tradeAccount: true,
  },
  {
    name: "Graham Plumbers Merchant",
    category: "Specialist Plumbing & Heating",
    website: null,
    phone: "028 9026 1311",
    description: "Major plumbing and heating merchant, strong presence in Northern Ireland and expanding in England.",
    specialties: ["Heating Systems", "Renewable Energy", "Boilers", "Bathrooms", "Commercial"],
    deliveryAvailable: true,
    tradeAccount: true,
  },
  {
    name: "BES (British Engineering Services)",
    category: "Commercial & Industrial",
    website: null,
    phone: "0114 225 0600",
    description: "Specialist in commercial HVAC, ventilation, and industrial plumbing supplies.",
    specialties: ["Commercial HVAC", "Ventilation", "Industrial Valves", "Pumps", "Controls"],
    deliveryAvailable: true,
    tradeAccount: true,
  },
  {
    name: "Flame Heating Spares",
    category: "Boiler & Heating Parts",
    website: null,
    phone: "0330 058 0093",
    description: "Specialist boiler and heating spare parts supplier. Wide range of OEM parts.",
    specialties: ["Boiler Spares", "Heating Controls", "Pumps", "Valves", "Thermostats"],
    deliveryAvailable: true,
    tradeAccount: true,
  },
];

// GET /merchants - list recommended plumbing merchants
router.get("/", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const category = req.query.category || null;
    const search = req.query.search || null;

    // Check if company has custom merchants in DB
    let customMerchants = [];
    try {
      const result = await db.query(
        `SELECT * FROM recommended_merchants WHERE company_id=$1 ORDER BY name`,
        [companyId]
      );
      customMerchants = result.rows;
    } catch (e) {
      // Table may not exist yet - that's fine, use defaults
    }

    let merchants = customMerchants.length > 0 ? customMerchants : DEFAULT_MERCHANTS;

    // Apply filters
    if (category) {
      merchants = merchants.filter(m =>
        (m.category || "").toLowerCase().includes(category.toLowerCase())
      );
    }
    if (search) {
      const s = search.toLowerCase();
      merchants = merchants.filter(m =>
        (m.name || "").toLowerCase().includes(s) ||
        (m.description || "").toLowerCase().includes(s) ||
        (m.specialties || []).some(sp => sp.toLowerCase().includes(s))
      );
    }

    res.json({
      merchants,
      isCustom: customMerchants.length > 0,
      totalCount: merchants.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /merchants - add a custom recommended merchant
router.post("/", async (req, res, next) => {
  try {
    const companyId = Number(req.body.companyId || req.user.companyId || 1);
    const { name, category, website, phone, description, specialties, deliveryAvailable, tradeAccount } = req.body;

    if (!name) return res.status(400).json({ error: "name is required" });

    // Create table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS recommended_merchants (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(255),
        website VARCHAR(500),
        phone VARCHAR(50),
        description TEXT,
        specialties TEXT[],
        delivery_available BOOLEAN DEFAULT true,
        trade_account BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const result = await db.query(
      `INSERT INTO recommended_merchants (company_id, name, category, website, phone, description, specialties, delivery_available, trade_account)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [companyId, name, category || null, website || null, phone || null, description || null,
       specialties || null, deliveryAvailable !== false, tradeAccount !== false]
    );

    res.json({ merchant: result.rows[0] });
  } catch (e) { next(e); }
});

// DELETE /merchants/:id - remove a custom merchant
router.delete("/:id", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const id = Number(req.params.id);

    const result = await db.query(
      `DELETE FROM recommended_merchants WHERE id=$1 AND company_id=$2 RETURNING id`,
      [id, companyId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Merchant not found" });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

// GET /merchants/categories - list available categories
router.get("/categories", (req, res) => {
  const categories = [...new Set(DEFAULT_MERCHANTS.map(m => m.category))];
  res.json({ categories });
});

module.exports = router;
