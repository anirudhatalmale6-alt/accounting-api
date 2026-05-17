CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  recipient_id INTEGER REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_company_time ON chat_messages(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_direct ON chat_messages(company_id, sender_id, recipient_id, created_at DESC);
