-- 004_payments.sql

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  type TEXT NOT NULL, -- CUSTOMER_RECEIPT, SUPPLIER_PAYMENT
  customer_id INT REFERENCES customers(id),
  supplier_id INT REFERENCES suppliers(id),
  invoice_id INT REFERENCES invoices(id),
  bill_id INT REFERENCES bills(id),
  amount NUMERIC(12,2) NOT NULL,
  memo TEXT,
  journal_entry_id INT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payment_id INT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id INT REFERENCES invoices(id),
  bill_id INT REFERENCES bills(id),
  amount NUMERIC(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_company ON payments(company_id);
CREATE INDEX IF NOT EXISTS idx_payment_alloc_payment ON payment_allocations(payment_id);
