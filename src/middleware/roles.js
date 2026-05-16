const db = require("../db");

function requireRole(allowedRoles = []) {
  return async (req, res, next) => {
    try {
      const companyId = req.user.companyId;
      const userId = req.user.id;

      const result = await db.query(
        `SELECT role FROM team_members
         WHERE company_id=$1 AND user_id=$2 AND is_active=true`,
        [companyId, userId]
      );

      if (!result.rows.length) {
        return res.status(403).json({ error: "No team access" });
      }

      const role = result.rows[0].role;
      req.user.role = role;

      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ error: "Permission denied" });
      }

      next();
    } catch (e) {
      next(e);
    }
  };
}

module.exports = { requireRole };
