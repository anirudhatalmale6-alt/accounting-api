-- 003_chart_of_accounts_and_journals.sql

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  sub_type TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  reference_type TEXT,
  reference_id INT,
  memo TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id SERIAL PRIMARY KEY,
  journal_entry_id INT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES chart_of_accounts(id),
  description TEXT,
  debit NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_je_company_date ON
  journal_entries(company_id, entry_date);

CREATE INDEX IF NOT EXISTS idx_jel_account ON
  journal_entry_lines(account_id);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS journal_entry_id INT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS journal_entry_id INT;

INSERT INTO chart_of_accounts (company_id, code, name, type, sub_type)
VALUES
  (1, '1000', 'Bank - Main', 'ASSET', 'BANK'),
  (1, '1100', 'Accounts Receivable', 'ASSET', 'AR'),
  (1, '1200', 'Inventory', 'ASSET', 'INVENTORY'),
  (1, '2000', 'Accounts Payable', 'LIABILITY', 'AP'),
  (1, '2100', 'VAT Control', 'LIABILITY', 'VAT'),
  (1, '2200', 'PAYE/NI Control', 'LIABILITY', 'PAYROLL_TAX'),
  (1, '3000', 'Owner Equity', 'EQUITY', 'EQUITY'),
  (1, '4000', 'Sales', 'INCOME', 'SALES'),
  (1, '5000', 'Cost of Goods Sold', 'EXPENSE', 'COGS'),
  (1, '6000', 'Purchases / Expenses', 'EXPENSE', 'EXPENSES')
ON CONFLICT (company_id, code) DO NOTHING;
