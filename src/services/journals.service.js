const db = require("../db");

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

async function getAccountIdByCode(client, companyId, code) {
  const res = await client.query(
    `SELECT id FROM chart_of_accounts WHERE company_id=$1 AND code=$2 AND is_active=true`,
    [companyId, code]
  );
  if (res.rowCount === 0) {
    const err = new Error(`Account code not found: ${code}`);
    err.status = 400;
    throw err;
  }
  return res.rows[0].id;
}

function validateBalanced(lines) {
  const debit = round2(lines.reduce((s, l) => s + Number(l.debit || 0), 0));
  const credit = round2(lines.reduce((s, l) => s + Number(l.credit || 0), 0));
  if (debit !== credit) {
    const err = new Error(`Journal not balanced. Debit=${debit} Credit=${credit}`);
    err.status = 400;
    throw err;
  }
}

async function createJournalEntry(client, { companyId, entryDate,
  referenceType, referenceId, memo, lines }) {
  validateBalanced(lines);

  const je = await client.query(
    `INSERT INTO journal_entries (company_id, entry_date, reference_type, reference_id, memo)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [companyId, entryDate, referenceType || null, referenceId || null, memo || null]
  );

  const journalEntryId = je.rows[0].id;

  for (const l of lines) {
    await client.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, account_id, description, debit, credit)
       VALUES ($1,$2,$3,$4,$5)`,
      [journalEntryId, l.accountId, l.description || null, round2(l.debit || 0), round2(l.credit || 0)]
    );
  }

  return journalEntryId;
}

module.exports = { getAccountIdByCode, createJournalEntry };
