-- 006_inventory_costing.sql
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS avg_cost NUMERIC(12,4) NOT NULL DEFAULT 0;

ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS value_change NUMERIC(12,2);
