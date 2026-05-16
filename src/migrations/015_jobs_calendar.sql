CREATE TABLE IF NOT EXISTS engineers (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  colour TEXT DEFAULT '#2563EB',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL,
  customer_id INT,
  engineer_id INT REFERENCES engineers(id),
  title TEXT NOT NULL,
  description TEXT,
  job_type TEXT,
  status TEXT DEFAULT 'scheduled',
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  address TEXT,
  notes TEXT,
  recurrence TEXT DEFAULT 'none',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL,
  user_id INT NOT NULL,
  role TEXT NOT NULL DEFAULT 'engineer',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(company_id, user_id)
);
