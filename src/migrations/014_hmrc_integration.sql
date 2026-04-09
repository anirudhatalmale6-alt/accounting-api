-- HMRC MTD Integration tables

-- Store HMRC OAuth tokens per company
CREATE TABLE IF NOT EXISTS hmrc_tokens (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL UNIQUE,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- VAT submission records
CREATE TABLE IF NOT EXISTS vat_submissions (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL,
  period_key TEXT NOT NULL,
  vat_data JSONB,
  hmrc_response JSONB,
  status TEXT DEFAULT 'SUBMITTED',
  submitted_at TIMESTAMP DEFAULT NOW()
);

-- Lock VAT periods after submission
CREATE TABLE IF NOT EXISTS vat_period_locks (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL,
  period_key TEXT NOT NULL,
  locked BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(company_id, period_key)
);

-- VAT adjustments (for amending submitted returns)
CREATE TABLE IF NOT EXISTS vat_adjustments (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL,
  period_key TEXT NOT NULL,
  adjustment JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
