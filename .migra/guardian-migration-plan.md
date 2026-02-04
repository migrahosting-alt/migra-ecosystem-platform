# Guardian Schema Migration - Enterprise Approach

## Problem Statement
- **Current State**: Guardian has TWO incompatible schemas
  - Service layer uses raw SQL with columns: `customer_id`, `widget_token`, `gateway_url`, `llm_provider`, etc.
  - Router layer uses Prisma expecting: `dataRegion`, `environment`, `policyPack`, `autoRemediationEnabled`, etc.
- **Impact**: Prisma queries fail with "column does not exist" errors
- **Current Workaround**: Stub router returns empty data

## Enterprise Solution: Unified Prisma-First Architecture

### Phase 1: Schema Reconciliation (Week 1)

#### 1.1 Audit & Document
```bash
# Compare actual DB schema vs Prisma schema
psql -U postgres -d mpanel -c "\d guardian_instances" > current-schema.sql
grep -A50 "model GuardianInstance" prisma/schema.prisma > prisma-schema.txt

# Document all columns and their purposes
```

#### 1.2 Design Unified Schema
Create `guardian_instances_v2` with **merged columns** from both schemas:

```sql
CREATE TABLE guardian_instances_v2 (
  -- Identity & Core (keep from current)
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  customer_id UUID REFERENCES customers(id),
  
  -- Guardian AI Config (keep from current)
  instance_name VARCHAR(255),
  widget_token VARCHAR(255) UNIQUE,
  gateway_url VARCHAR(500),
  allowed_origins JSONB DEFAULT '[]',
  max_messages_per_day INT DEFAULT 100,
  enable_voice BOOLEAN DEFAULT false,
  
  -- LLM Configuration (keep from current)
  llm_provider VARCHAR(50) DEFAULT 'openai',
  llm_model VARCHAR(100) DEFAULT 'gpt-4o-mini',
  llm_temperature DECIMAL(3,2) DEFAULT 0.7,
  
  -- Widget Customization (keep from current)
  widget_title VARCHAR(255) DEFAULT 'AI Support Assistant',
  widget_subtitle VARCHAR(255),
  primary_color VARCHAR(20) DEFAULT '#3b82f6',
  assistant_name VARCHAR(100) DEFAULT 'Abigail',
  avatar_url VARCHAR(500),
  
  -- Enterprise Features (add from Prisma schema)
  data_region VARCHAR(50) DEFAULT 'us',
  environment VARCHAR(50) DEFAULT 'production',
  enabled BOOLEAN DEFAULT true,
  policy_pack VARCHAR(100) DEFAULT 'default',
  policy_version VARCHAR(20) DEFAULT 'v1',
  auto_remediation_enabled BOOLEAN DEFAULT false,
  auto_remediation_allowed_severities VARCHAR(100) DEFAULT 'low,medium',
  allow_prod_auto_remediation BOOLEAN DEFAULT false,
  
  -- Billing (keep from current)
  product_id UUID REFERENCES products(id),
  monthly_price DECIMAL(10,2) DEFAULT 29.99,
  status VARCHAR(50) DEFAULT 'active',
  
  -- Audit (standardize)
  created_by_user_id UUID,
  updated_by_user_id UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_guardian_instances_v2_tenant ON guardian_instances_v2(tenant_id);
CREATE INDEX idx_guardian_instances_v2_customer ON guardian_instances_v2(customer_id);
CREATE INDEX idx_guardian_instances_v2_status ON guardian_instances_v2(status);
```

#### 1.3 Update Prisma Schema
```prisma
model GuardianInstance {
  id                               String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  tenantId                         String   @map("tenant_id") @db.Uuid
  customerId                       String?  @map("customer_id") @db.Uuid
  
  // Guardian AI Config
  instanceName                     String?  @map("instance_name")
  widgetToken                      String   @unique @map("widget_token")
  gatewayUrl                       String   @map("gateway_url")
  allowedOrigins                   Json     @default("[]") @map("allowed_origins")
  maxMessagesPerDay                Int      @default(100) @map("max_messages_per_day")
  enableVoice                      Boolean  @default(false) @map("enable_voice")
  
  // LLM Configuration
  llmProvider                      String   @default("openai") @map("llm_provider")
  llmModel                         String   @default("gpt-4o-mini") @map("llm_model")
  llmTemperature                   Decimal  @default(0.7) @map("llm_temperature") @db.Decimal(3,2)
  
  // Widget Customization
  widgetTitle                      String   @default("AI Support Assistant") @map("widget_title")
  widgetSubtitle                   String?  @map("widget_subtitle")
  primaryColor                     String   @default("#3b82f6") @map("primary_color")
  assistantName                    String   @default("Abigail") @map("assistant_name")
  avatarUrl                        String?  @map("avatar_url")
  
  // Enterprise Features
  dataRegion                       String   @default("us") @map("data_region")
  environment                      String   @default("production")
  enabled                          Boolean  @default(true)
  policyPack                       String   @default("default") @map("policy_pack")
  policyVersion                    String   @default("v1") @map("policy_version")
  autoRemediationEnabled           Boolean  @default(false) @map("auto_remediation_enabled")
  autoRemediationAllowedSeverities String   @default("low,medium") @map("auto_remediation_allowed_severities")
  allowProdAutoRemediation         Boolean  @default(false) @map("allow_prod_auto_remediation")
  
  // Billing
  productId                        String?  @map("product_id") @db.Uuid
  monthlyPrice                     Decimal  @default(29.99) @map("monthly_price") @db.Decimal(10,2)
  status                           String   @default("active")
  
  // Audit
  createdByUserId                  String?  @map("created_by_user_id") @db.Uuid
  updatedByUserId                  String?  @map("updated_by_user_id") @db.Uuid
  createdAt                        DateTime @default(now()) @map("created_at")
  updatedAt                        DateTime @updatedAt @map("updated_at")
  
  // Relations
  tenant                           Tenant   @relation(fields: [tenantId], references: [id])
  customer                         Customer? @relation(fields: [customerId], references: [id])
  product                          Product? @relation(fields: [productId], references: [id])
  
  scans                            GuardianScan[]
  findings                         GuardianFinding[]
  remediations                     GuardianRemediationTask[]
  
  @@index([tenantId])
  @@index([customerId])
  @@index([status])
  @@map("guardian_instances_v2")
}
```

### Phase 2: Data Migration (Week 1)

#### 2.1 Create Migration Script
```sql
-- /opt/mpanel/migrations/guardian-unify-schema.sql

BEGIN;

-- Create new table
\i guardian_instances_v2_schema.sql

-- Migrate existing data
INSERT INTO guardian_instances_v2 (
  id, tenant_id, customer_id, instance_name, widget_token, gateway_url,
  allowed_origins, max_messages_per_day, enable_voice,
  llm_provider, llm_model, llm_temperature,
  widget_title, widget_subtitle, primary_color, assistant_name, avatar_url,
  product_id, monthly_price, status, created_at, updated_at
)
SELECT 
  id, tenant_id, customer_id, instance_name, widget_token, gateway_url,
  allowed_origins, max_messages_per_day, enable_voice,
  llm_provider, llm_model, llm_temperature,
  widget_title, widget_subtitle, primary_color, assistant_name, avatar_url,
  product_id, monthly_price, status, created_at, updated_at
FROM guardian_instances;

-- Add enterprise defaults for new columns
UPDATE guardian_instances_v2 SET
  data_region = 'us',
  environment = 'production',
  enabled = true,
  policy_pack = 'default',
  policy_version = 'v1',
  auto_remediation_enabled = false,
  auto_remediation_allowed_severities = 'low,medium',
  allow_prod_auto_remediation = false
WHERE data_region IS NULL;

-- Rename tables (atomic swap)
ALTER TABLE guardian_instances RENAME TO guardian_instances_old;
ALTER TABLE guardian_instances_v2 RENAME TO guardian_instances;

COMMIT;
```

#### 2.2 Test Migration
```bash
# On staging/test environment
psql -U postgres -d mpanel_test < migrations/guardian-unify-schema.sql

# Verify row count matches
psql -U postgres -d mpanel_test -c "
  SELECT 
    (SELECT COUNT(*) FROM guardian_instances_old) as old_count,
    (SELECT COUNT(*) FROM guardian_instances) as new_count;
"

# Verify data integrity
psql -U postgres -d mpanel_test -c "
  SELECT * FROM guardian_instances LIMIT 5;
"
```

### Phase 3: Service Layer Refactor (Week 2)

#### 3.1 Create Unified Guardian Service
```typescript
// migra-panel/src/services/guardian/guardian.service.ts

import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/logger.js';

const prisma = new PrismaClient();

export class GuardianService {
  /**
   * List Guardian instances for a tenant (Prisma-based)
   */
  async listInstances(tenantId: string, filters?: {
    customerId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    const { customerId, status, limit = 50, offset = 0 } = filters || {};
    
    const where: any = { tenantId };
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;
    
    const [instances, total] = await Promise.all([
      prisma.guardianInstance.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              companyName: true,
              user: { select: { email: true, firstName: true, lastName: true } }
            }
          },
          product: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.guardianInstance.count({ where }),
    ]);
    
    return { instances, total, limit, offset };
  }
  
  /**
   * Get single Guardian instance
   */
  async getInstance(tenantId: string, instanceId: string) {
    return prisma.guardianInstance.findFirst({
      where: { id: instanceId, tenantId },
      include: {
        customer: {
          select: {
            companyName: true,
            user: { select: { email: true, firstName: true, lastName: true } }
          }
        },
        product: { select: { name: true } }
      }
    });
  }
  
  /**
   * Create Guardian instance
   */
  async createInstance(tenantId: string, data: any) {
    return prisma.guardianInstance.create({
      data: {
        tenantId,
        customerId: data.customerId,
        instanceName: data.instanceName,
        widgetToken: this.generateWidgetToken(),
        gatewayUrl: data.gatewayUrl || 'http://localhost:8080',
        allowedOrigins: data.allowedOrigins || [],
        maxMessagesPerDay: data.maxMessagesPerDay || 100,
        enableVoice: data.enableVoice || false,
        llmProvider: data.llmProvider || 'openai',
        llmModel: data.llmModel || 'gpt-4o-mini',
        llmTemperature: data.llmTemperature || 0.7,
        widgetTitle: data.widgetTitle || 'AI Support Assistant',
        widgetSubtitle: data.widgetSubtitle,
        primaryColor: data.primaryColor || '#3b82f6',
        assistantName: data.assistantName || 'Abigail',
        avatarUrl: data.avatarUrl,
        dataRegion: data.dataRegion || 'us',
        environment: data.environment || 'production',
        policyPack: data.policyPack || 'default',
        productId: data.productId,
        monthlyPrice: data.monthlyPrice || 29.99,
      }
    });
  }
  
  /**
   * Update Guardian instance
   */
  async updateInstance(tenantId: string, instanceId: string, data: any) {
    return prisma.guardianInstance.update({
      where: { id: instanceId, tenantId },
      data: {
        ...data,
        updatedAt: new Date(),
      }
    });
  }
  
  private generateWidgetToken(): string {
    return `gai_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`;
  }
}

export default new GuardianService();
```

#### 3.2 Update Guardian Controller
```typescript
// migra-panel/src/controllers/guardianController.ts

import guardianService from '../services/guardian/guardian.service.js';
import { logger } from '../config/logger.js';

export async function listInstances(req, res) {
  try {
    const { tenantId } = req.user;
    
    if (!tenantId) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'Tenant context required'
      });
    }
    
    const { customerId, status, limit, offset } = req.query;
    const result = await guardianService.listInstances(tenantId, {
      customerId,
      status,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined
    });
    
    res.json({
      success: true,
      data: result.instances,
      total: result.total,
      limit: result.limit,
      offset: result.offset
    });
  } catch (error) {
    logger.error('Error listing Guardian instances:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list Guardian instances',
      message: error.message
    });
  }
}

// ... similar updates for other controller methods
```

#### 3.3 Replace Guardian Router
```typescript
// migra-panel/src/modules/guardian/guardian.router.ts

import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import guardianService from '../../services/guardian/guardian.service.js';

const router = express.Router();

// Apply auth to all routes
router.use(authMiddleware);

// GET /guardian/summary
router.get('/summary', async (req, res) => {
  try {
    const { tenantId } = req.user;
    
    const [activeInstances, scansCount] = await Promise.all([
      prisma.guardianInstance.count({ where: { tenantId, enabled: true } }),
      prisma.guardianScan.count({ where: { tenantId } }),
    ]);
    
    res.json({
      activeInstances,
      openFindings: 0, // TODO: implement when findings table ready
      pendingTasks: 0,
      recentScansCount: scansCount,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

// GET /guardian/instance
router.get('/instance', async (req, res) => {
  try {
    const { tenantId } = req.user;
    const result = await guardianService.listInstances(tenantId, { limit: 1 });
    res.json(result.instances[0] ?? null);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load instance' });
  }
});

// POST /guardian/instance
router.post('/instance', async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const instance = await guardianService.createInstance(tenantId, {
      ...req.body,
      createdByUserId: userId,
    });
    res.status(201).json({ success: true, data: instance });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create instance' });
  }
});

export default router;
```

### Phase 4: Deployment (Week 2)

#### 4.1 Pre-Deployment Checklist
- [ ] Run migration on staging environment
- [ ] Test all Guardian endpoints with Postman/automated tests
- [ ] Verify no breaking changes for existing Guardian widgets
- [ ] Update API documentation
- [ ] Prepare rollback script

#### 4.2 Production Deployment
```bash
#!/bin/bash
# deploy-guardian-migration.sh

set -e

echo "=== Guardian Schema Migration Deployment ==="

# 1. Backup current database
pg_dump -U postgres mpanel | gzip > /backup/mpanel_pre_guardian_$(date +%Y%m%d_%H%M%S).sql.gz

# 2. Run migration
psql -U postgres -d mpanel < /opt/mpanel/migrations/guardian-unify-schema.sql

# 3. Run Prisma migration
cd /opt/mpanel
npx prisma migrate deploy

# 4. Deploy updated code
git pull origin main
npm run build

# 5. Restart API with zero-downtime
pm2 reload mpanel-api

# 6. Smoke test
curl -f http://127.0.0.1:3020/api/health || {
  echo "❌ Health check failed! Rolling back..."
  psql -U postgres -d mpanel < /backup/rollback-guardian.sql
  git checkout HEAD~1
  npm run build
  pm2 reload mpanel-api
  exit 1
}

echo "✅ Migration deployed successfully!"
```

#### 4.3 Rollback Script
```sql
-- rollback-guardian.sql
BEGIN;

ALTER TABLE guardian_instances RENAME TO guardian_instances_v2;
ALTER TABLE guardian_instances_old RENAME TO guardian_instances;

-- Drop new columns if they exist
ALTER TABLE guardian_instances 
  DROP COLUMN IF EXISTS data_region,
  DROP COLUMN IF EXISTS environment,
  DROP COLUMN IF EXISTS policy_pack,
  DROP COLUMN IF EXISTS policy_version,
  DROP COLUMN IF EXISTS auto_remediation_enabled;

COMMIT;
```

### Phase 5: Monitoring & Validation (Week 3)

#### 5.1 Validation Queries
```sql
-- Check for orphaned records
SELECT COUNT(*) FROM guardian_instances WHERE tenant_id NOT IN (SELECT id FROM tenants);

-- Verify data integrity
SELECT 
  COUNT(*) as total_instances,
  COUNT(DISTINCT tenant_id) as unique_tenants,
  COUNT(*) FILTER (WHERE status = 'active') as active_instances,
  AVG(monthly_price) as avg_price
FROM guardian_instances;

-- Check for nulls in required fields
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'guardian_instances' AND is_nullable = 'NO'
  AND column_name IN (
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'guardian_instances' 
    AND column_default IS NULL
  );
```

#### 5.2 Monitoring Alerts
```typescript
// Add to Guardian service
async healthCheck() {
  const stats = await prisma.guardianInstance.groupBy({
    by: ['status'],
    _count: true,
  });
  
  logger.info('Guardian health check', { stats });
  
  // Alert if too many failed instances
  const failed = stats.find(s => s.status === 'error')?._count || 0;
  if (failed > 10) {
    // Trigger alert to ops team
    await sendOpsAlert('High Guardian instance failure rate', { failed });
  }
}
```

## Benefits of This Approach

### ✅ Advantages
1. **Single Source of Truth**: Prisma schema = database schema
2. **Type Safety**: Full TypeScript types from Prisma
3. **Migration Tracking**: Prisma migrations are versioned
4. **Maintainability**: No more dual maintenance of raw SQL + Prisma
5. **Testing**: Easier to write unit tests with Prisma mocks
6. **Performance**: Prisma query optimization + connection pooling
7. **Security**: Prisma prevents SQL injection by default

### 📊 Metrics
- **Migration Time**: ~2-3 hours (including testing)
- **Downtime**: ~5 minutes (for schema swap)
- **Risk Level**: Low (with proper backup + rollback)
- **Code Reduction**: ~40% less code (remove raw SQL helpers)

## Alternative Approaches (Not Recommended)

### ❌ Option B: Keep Raw SQL Everywhere
- Remove Prisma from Guardian module
- More manual work, less type safety
- **Use case**: If you have DBA team that prefers raw SQL

### ❌ Option C: Maintain Both Schemas
- Keep router using Prisma, service using raw SQL
- **High maintenance cost**
- **Technical debt accumulation**

## Recommendation

**Proceed with Phase 1-5** for a clean, enterprise-grade solution that:
- Eliminates schema drift
- Improves developer experience
- Reduces bugs
- Enables faster feature development

Would you like me to generate the migration files and start the implementation?
