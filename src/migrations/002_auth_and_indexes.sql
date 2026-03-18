-- 002_auth_and_indexes.sql

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, email)
);

CREATE INDEX IF NOT EXISTS idx_invoices_company_customer_date
  ON invoices(company_id, customer_id, invoice_date);

CREATE INDEX IF NOT EXISTS idx_bills_company_supplier_date
  ON bills(company_id, supplier_id, bill_date);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_company_product_created
  ON inventory_movements(company_id, product_id, created_at);

CREATE INDEX IF NOT EXISTS idx_attachments_company_parent
  ON attachments(company_id, parent_type, parent_id);
