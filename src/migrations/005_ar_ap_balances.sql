-- 005_ar_ap_balances.sql

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS balance NUMERIC(12,2);
ALTER TABLE bills ADD COLUMN IF NOT EXISTS balance NUMERIC(12,2);

-- Initialize balance = total for existing rows
UPDATE invoices SET balance = total WHERE balance IS NULL;
UPDATE bills SET balance = total WHERE balance IS NULL;
