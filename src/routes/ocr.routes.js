const express = require("express");
const multer = require("multer");
const https = require("https");
const fs = require("fs");
const path = require("path");

const router = express.Router();

// Configure multer for image uploads (max 10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files (JPEG, PNG, WebP, HEIC) are allowed"));
    }
  },
});

// Models to try in order (fallback chain)
const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
];

const PROMPT = `You are an expert invoice and receipt parser. Analyze this image of an invoice or receipt and extract the following information in JSON format. Be very precise with the numbers and dates.

Return ONLY valid JSON (no markdown, no code blocks) with this exact structure:
{
  "supplierName": "the company/supplier name from the invoice header",
  "invoiceNumber": "the invoice or receipt number",
  "date": "the invoice date in YYYY-MM-DD format",
  "currency": "GBP or USD or EUR etc",
  "lineItems": [
    {
      "description": "item description",
      "productCode": "product/SKU code if visible",
      "quantity": 1,
      "unitPrice": 0.00,
      "vatRate": 20,
      "lineTotal": 0.00
    }
  ],
  "netTotal": 0.00,
  "vatAmount": 0.00,
  "grossTotal": 0.00,
  "supplierAddress": "full address if visible",
  "supplierPhone": "phone number if visible",
  "supplierVatNumber": "VAT registration number if visible",
  "paymentMethod": "payment method if visible",
  "notes": "any other relevant info"
}

Rules:
- For netTotal use the net/subtotal BEFORE VAT
- For vatAmount use the total VAT charged
- For grossTotal use the final total INCLUDING VAT
- If a field is not visible or not applicable, use null
- For date, convert from any format (DD/MM/YYYY, etc) to YYYY-MM-DD
- For UK receipts, VAT is typically 20%
- Extract ALL line items visible on the receipt
- unitPrice should be the price per single unit BEFORE VAT`;

// Single Gemini API call
function callGeminiModel(base64Image, mimeType, model, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mimeType, data: base64Image } },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    });

    const options = {
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            return reject(new Error(`[${model}] ${parsed.error.message || "API error"}`));
          }
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) {
            return reject(new Error(`[${model}] No response text`));
          }
          // Clean up response - remove markdown code blocks if present
          let cleaned = text.trim();
          if (cleaned.startsWith("```")) {
            cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
          }
          const result = JSON.parse(cleaned);
          resolve(result);
        } catch (e) {
          reject(new Error(`[${model}] Parse error: ${e.message}`));
        }
      });
    });

    req.on("error", (e) => reject(new Error(`[${model}] Network error: ${e.message}`)));
    req.write(body);
    req.end();
  });
}

// Call Gemini with retry and model fallback
async function callGemini(base64Image, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const errors = [];

  for (const model of MODELS) {
    // Try each model up to 4 times with increasing delay
    const delays = [2000, 4000, 6000];
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const result = await callGeminiModel(base64Image, mimeType, model, apiKey);
        return result;
      } catch (e) {
        errors.push(e.message);
        console.warn(`OCR attempt ${attempt + 1} with ${model} failed: ${e.message}`);
        // Check if it's a quota error (0 limit) - skip to next model immediately
        if (e.message.includes("limit: 0")) break;
        // Wait with increasing delay before retry
        if (attempt < 3) await new Promise(r => setTimeout(r, delays[attempt] || 6000));
      }
    }
  }

  throw new Error(`All models failed. Please try again in a few seconds.`);
}

// POST /ocr/parse-invoice - Parse invoice/receipt image
router.post("/parse-invoice", upload.single("image"), async (req, res) => {
  try {
    let base64Image;
    let mimeType;

    if (req.file) {
      // File uploaded via multipart form
      base64Image = req.file.buffer.toString("base64");
      mimeType = req.file.mimetype;
    } else if (req.body.image) {
      // Base64 image in JSON body
      base64Image = req.body.image;
      mimeType = req.body.mimeType || "image/jpeg";
      // Strip data URI prefix if present
      if (base64Image.startsWith("data:")) {
        const match = base64Image.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          base64Image = match[2];
        }
      }
    } else {
      return res.status(400).json({
        error: "No image provided. Send as multipart file (field: image) or base64 in JSON body (field: image)",
      });
    }

    const result = await callGemini(base64Image, mimeType);

    res.json({
      success: true,
      data: result,
    });
  } catch (e) {
    console.error("OCR parse error:", e.message);
    res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

// POST /ocr/parse-invoice-base64 - Convenience endpoint for Flutter (JSON body only)
router.post("/parse-invoice-base64", async (req, res) => {
  try {
    const { image, mimeType } = req.body;

    if (!image) {
      return res.status(400).json({
        error: "image (base64 string) is required in request body",
      });
    }

    let base64 = image;
    let mime = mimeType || "image/jpeg";

    // Strip data URI prefix if present
    if (base64.startsWith("data:")) {
      const match = base64.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mime = match[1];
        base64 = match[2];
      }
    }

    const result = await callGemini(base64, mime);

    res.json({
      success: true,
      data: result,
    });
  } catch (e) {
    console.error("OCR parse error:", e.message);
    res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

module.exports = router;
