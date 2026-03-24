CREATE TABLE IF NOT EXISTS bank_transactions (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_account_id INT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  transaction_date DATE NOT NULL,
  type TEXT NOT NULL DEFAULT 'DEPOSIT',
  amount NUMERIC(12,2) NOT NULL,
  description TEXT,
  reference TEXT,
  category TEXT,
  invoice_id INT REFERENCES invoices(id),
  bill_id INT REFERENCES bills(id),
  payment_id INT REFERENCES payments(id),
  is_reconciled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_company ON bank_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_bank_account ON bank_transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON bank_transactions(transaction_date);
