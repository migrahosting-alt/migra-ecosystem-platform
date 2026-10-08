-- Workforce identity + product access control plane.
-- MigraAuth remains the credential authority; workforce state is attached to
-- the canonical User and product access is an append-only grant ledger.

DO $$ BEGIN
  CREATE TYPE workforce_employment_status AS ENUM (
    'invited', 'active', 'leave', 'suspended', 'terminated'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workforce_employment_type AS ENUM (
    'employee', 'contractor', 'intern', 'vendor'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workforce_product AS ENUM (
    'frendelo', 'migrateck', 'migrahosting', 'migrapanel', 'pale',
    'migramail', 'migravoice', 'migradrive', 'migrapilot', 'migraintake',
    'migremarket', 'migrainvoice', 'migrabuilder'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workforce_provisioning_state AS ENUM ('pending', 'synced', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS workforce_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  staff_id VARCHAR(48) NOT NULL UNIQUE,
  employment_status workforce_employment_status NOT NULL DEFAULT 'invited',
  employment_type workforce_employment_type NOT NULL DEFAULT 'employee',
  job_title VARCHAR(120) NULL,
  department VARCHAR(120) NULL,
  team VARCHAR(120) NULL,
  manager_profile_id UUID NULL REFERENCES workforce_profiles(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NULL,
  ends_at TIMESTAMPTZ NULL,
  created_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  entitlement_revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workforce_profiles_employment_status_idx
  ON workforce_profiles (employment_status);
CREATE INDEX IF NOT EXISTS workforce_profiles_department_team_idx
  ON workforce_profiles (department, team);
CREATE INDEX IF NOT EXISTS workforce_profiles_manager_profile_id_idx
  ON workforce_profiles (manager_profile_id);

CREATE TABLE IF NOT EXISTS workforce_product_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workforce_profile_id UUID NOT NULL REFERENCES workforce_profiles(id) ON DELETE CASCADE,
  product workforce_product NOT NULL,
  role_key VARCHAR(80) NOT NULL,
  granted_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  revoked_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reason VARCHAR(1000) NULL,
  provisioning_state workforce_provisioning_state NOT NULL DEFAULT 'pending',
  last_provisioned_at TIMESTAMPTZ NULL,
  last_provision_error VARCHAR(1000) NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one live grant for a given staff/product/role tuple. Historical
-- revoked rows remain intact and do not block a later approved re-grant.
CREATE UNIQUE INDEX IF NOT EXISTS workforce_product_access_live_unique_idx
  ON workforce_product_access_grants (workforce_profile_id, product, role_key)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS workforce_product_access_profile_product_idx
  ON workforce_product_access_grants (workforce_profile_id, product, revoked_at);
CREATE INDEX IF NOT EXISTS workforce_product_access_product_role_idx
  ON workforce_product_access_grants (product, role_key, revoked_at);
CREATE INDEX IF NOT EXISTS workforce_product_access_provisioning_idx
  ON workforce_product_access_grants (provisioning_state, updated_at);

COMMENT ON TABLE workforce_profiles IS
  'Canonical MigraTeck workforce metadata attached to the central MigraAuth identity. staff_id is immutable and is the cross-product staff subject.';
COMMENT ON TABLE workforce_product_access_grants IS
  'Historical product-access assignments. MigraPanel decides who holds a product role; each product defines what that role can do.';
