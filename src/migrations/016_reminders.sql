CREATE TABLE IF NOT EXISTS job_reminders (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL,
  job_id INT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  remind_at TIMESTAMP NOT NULL,
  remind_type TEXT NOT NULL DEFAULT 'email',
  recipient_type TEXT NOT NULL DEFAULT 'customer',
  recipient_email TEXT,
  message TEXT,
  is_sent BOOLEAN DEFAULT false,
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_reminders_pending
  ON job_reminders (remind_at) WHERE is_sent = false;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS default_reminder_hours INT DEFAULT 24;
