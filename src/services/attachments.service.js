const db = require("../db");

async function addAttachment({ companyId, parentType, parentId, file }) {
  const res = await db.query(
    `INSERT INTO attachments (company_id, parent_type, parent_id,
      file_name, file_path, mime_type, size_bytes)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`,
    [companyId, parentType, parentId, file.originalname, file.path, file.mimetype, file.size]
  );
  return res.rows[0];
}

async function listAttachments({ companyId, parentType, parentId }) {
  const res = await db.query(
    `SELECT * FROM attachments WHERE company_id=$1 AND parent_type=$2
      AND parent_id=$3 ORDER BY created_at DESC`,
    [companyId, parentType, parentId]
  );
  return res.rows;
}

async function deleteAttachment({ companyId, attachmentId }) {
  const res = await db.query(
    `DELETE FROM attachments WHERE company_id=$1 AND id=$2 RETURNING *`,
    [companyId, attachmentId]
  );
  return res.rows[0] || null;
}

module.exports = { addAttachment, listAttachments, deleteAttachment };
