CREATE TABLE IF NOT EXISTS payroll_runs (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  run_date DATE NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  total_gross NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_ni NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_net NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_company ON payroll_runs(company_id);

CREATE TABLE IF NOT EXISTS payroll_run_lines (
  id SERIAL PRIMARY KEY,
  payroll_run_id INT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  basic_pay NUMERIC(12,2) NOT NULL DEFAULT 0,
  overtime NUMERIC(12,2) NOT NULL DEFAULT 0,
  bonus NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_pay NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  ni_employee NUMERIC(12,2) NOT NULL DEFAULT 0,
  ni_employer NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_run_lines_run ON payroll_run_lines(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_run_lines_employee ON payroll_run_lines(employee_id);
