const multer = require("multer");
const path = require("path");
const fs = require("fs");

const baseDir = process.env.UPLOAD_DIR || "uploads/attachments";
fs.mkdirSync(baseDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, baseDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

module.exports = { upload };
