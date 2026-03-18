-- 007_email_logs.sql
CREATE TABLE IF NOT EXISTS email_logs (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  attachment_name TEXT,
  reference_type TEXT,
  reference_id INT,
  status TEXT NOT NULL DEFAULT 'SENT',
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
