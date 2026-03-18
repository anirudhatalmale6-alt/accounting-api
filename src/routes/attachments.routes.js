const express = require("express");
const { upload } = require("../middleware/upload");
const { addAttachment, listAttachments, deleteAttachment } = require("../services/attachments.service");

const router = express.Router();

router.get("/:type(invoice|bill)/:id/attachments", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const parentType = req.params.type;
    const parentId = Number(req.params.id);
    const attachments = await listAttachments({ companyId, parentType, parentId });
    res.json({ attachments });
  } catch (e) { next(e); }
});

router.post("/:type(invoice|bill)/:id/attachments",
  upload.single("file"), async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const parentType = req.params.type;
    const parentId = Number(req.params.id);

    if (!req.file) {
      const err = new Error("No file uploaded");
      err.status = 400;
      throw err;
    }

    const attachment = await addAttachment({ companyId, parentType, parentId, file: req.file });
    res.json({ attachment });
  } catch (e) { next(e); }
});

router.delete("/attachments/:attachmentId", async (req, res, next) => {
  try {
    const companyId = Number(req.query.companyId || req.user.companyId || 1);
    const attachmentId = Number(req.params.attachmentId);

    const deleted = await deleteAttachment({ companyId, attachmentId });
    if (!deleted) {
      const err = new Error("Attachment not found");
      err.status = 404;
      throw err;
    }
    res.json({ deleted });
  } catch (e) { next(e); }
});

module.exports = router;
