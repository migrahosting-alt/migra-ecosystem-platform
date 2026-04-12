-- Guardian Schema Migration - Unified Schema
-- Created: 2026-01-13
-- Purpose: Create guardian_instances table with unified schema combining
--          raw SQL service columns + Prisma router columns

BEGIN;

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create guardian_instances table with UNIFIED schema
CREATE TABLE IF NOT EXISTS guardian_instances (
  -- Identity & Core
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  customer_id UUID,
  
  -- Guardian AI Configuration (from raw SQL service)
  instance_name VARCHAR(255),
  widget_token VARCHAR(255) UNIQUE NOT NULL,
  gateway_url VARCHAR(500) NOT NULL DEFAULT 'http://localhost:8080',
  allowed_origins JSONB DEFAULT '[]'::jsonb,
  max_messages_per_day INTEGER DEFAULT 100,
  enable_voice BOOLEAN DEFAULT false,
  
  -- LLM Configuration (from raw SQL service)
  llm_provider VARCHAR(50) DEFAULT 'openai',
  llm_model VARCHAR(100) DEFAULT 'gpt-4o-mini',
  llm_temperature NUMERIC(3,2) DEFAULT 0.7,
  
  -- Widget Customization (from raw SQL service)
  widget_title VARCHAR(255) DEFAULT 'AI Support Assistant',
  widget_subtitle VARCHAR(255),
  primary_color VARCHAR(20) DEFAULT '#3b82f6',
  assistant_name VARCHAR(100) DEFAULT 'Abigail',
  avatar_url VARCHAR(500),
  
  -- Enterprise Features (from Prisma schema)
  data_region VARCHAR(50) DEFAULT 'us' NOT NULL,
  environment VARCHAR(50) DEFAULT 'production' NOT NULL,
  enabled BOOLEAN DEFAULT true NOT NULL,
  policy_pack VARCHAR(100) DEFAULT 'default' NOT NULL,
  policy_version VARCHAR(20) DEFAULT 'v1' NOT NULL,
  auto_remediation_enabled BOOLEAN DEFAULT false NOT NULL,
  auto_remediation_allowed_severities VARCHAR(100) DEFAULT 'low,medium' NOT NULL,
  allow_prod_auto_remediation BOOLEAN DEFAULT false NOT NULL,
  
  -- Billing (from raw SQL service)
  product_id UUID,
  monthly_price NUMERIC(10,2) DEFAULT 29.99,
  status VARCHAR(50) DEFAULT 'active' NOT NULL,
  
  -- Audit Fields
  created_by_user_id UUID,
  updated_by_user_id UUID,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for performance
CREATE INDEX idx_guardian_instances_tenant ON guardian_instances(tenant_id);
CREATE INDEX idx_guardian_instances_customer ON guardian_instances(customer_id);
CREATE INDEX idx_guardian_instances_status ON guardian_instances(status);
CREATE INDEX idx_guardian_instances_data_region ON guardian_instances(data_region);
CREATE INDEX idx_guardian_instances_enabled ON guardian_instances(enabled);
CREATE INDEX idx_guardian_instances_widget_token ON guardian_instances(widget_token);

-- Add foreign key constraints (after ensuring referenced tables exist)
-- Note: Uncomment when running in production with existing tenants/customers tables
-- ALTER TABLE guardian_instances ADD CONSTRAINT fk_guardian_tenant 
--   FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
-- ALTER TABLE guardian_instances ADD CONSTRAINT fk_guardian_customer 
--   FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
-- ALTER TABLE guardian_instances ADD CONSTRAINT fk_guardian_product 
--   FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_guardian_instances_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER guardian_instances_updated_at
  BEFORE UPDATE ON guardian_instances
  FOR EACH ROW
  EXECUTE FUNCTION update_guardian_instances_updated_at();

-- Insert sample data for testing (optional)
-- INSERT INTO guardian_instances (tenant_id, instance_name, widget_token, gateway_url, data_region)
-- VALUES (
--   '00000000-0000-0000-0000-000000000001',
--   'Demo Guardian Instance',
--   'gai_demo_' || gen_random_uuid(),
--   'https://guardian.migrahosting.com',
--   'us'
-- );

COMMIT;

-- Verification queries
SELECT 
  table_name, 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'guardian_instances'
ORDER BY ordinal_position;

SELECT COUNT(*) as guardian_instances_count FROM guardian_instances;
