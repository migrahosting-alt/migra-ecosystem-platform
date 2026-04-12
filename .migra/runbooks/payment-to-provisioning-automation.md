# Payment → Provisioning Automation - Full System Audit & Implementation Plan

**Date**: 2026-01-25  
**Status**: 🟡 PARTIAL - Needs product-specific automation  
**Goal**: Every product/service auto-provisions when payment succeeds

---

## Executive Summary

**Problem**: Customer orders product → payment succeeds → manual provisioning required  
**Goal**: Fully automated: Payment → Script triggers → Service created → Account configured  
**Current State**: Generic provisioning exists, product-specific logic missing  

---

## Current System Architecture

### 1. Payment Flow (✅ WORKING)

```
Customer Order → Stripe Checkout → checkout.session.completed webhook
                                         ↓
                          server/lib/stripe-webhook.js
                                         ↓
                     handleCheckoutCompleted() function
                                         ↓
                  server/services/tenantProvisioningService.js
                                         ↓
                           provisionTenant()
```

**Location**: `migrahosting-marketing-site/server/lib/stripe-webhook.js`  
**Webhook Handler**: `handleCheckoutCompleted()`  
**Status**: ✅ Working - fires on successful payment  

### 2. Product Catalog (✅ COMPLETE)

**Location**: `migrahosting-marketing-site/apps/website/src/config/plansConfig.ts`

| Product Family | Plans | Stripe Integration | mPanel Mapping |
|----------------|-------|-------------------|----------------|
| **CloudPods** | Student, Starter, Standard, Premium, Business | ✅ Yes | ✅ Yes |
| **WordPress** | Starter, Growth, Agency | ✅ Yes | ✅ Yes |
| **Email** | Basic, Pro, Business | ✅ Yes | ✅ Yes |
| **VPS** | VPS-1 through VPS-6 | ✅ Yes | ✅ Yes |
| **Cloud** | Starter, Business, Enterprise | ✅ Yes | ✅ Yes |
| **Storage** | Personal, Team, Business | ✅ Yes | ✅ Yes |
| **Bundles** | (Multiple combinations) | ⚠️ Partial | ❌ No |

---

## Current Provisioning Status

### ✅ WORKING: Generic Tenant Creation

**File**: `server/services/tenantProvisioningService.js`

```javascript
provisionTenant({
  subscriptionId,
  email,
  name,
  planConfig,
  stripeCustomerId,
  metadata
}) {
  // 1. Create mPanel tenant account (generic)
  // 2. Provision services (stub - not product-specific)
  // 3. Send welcome email
}
```

**What it does**:
- ✅ Creates tenant account in mPanel
- ✅ Stores subscription in database
- ✅ Sends welcome email with reset link
- ❌ Does NOT create actual services (pods, email, etc.)

---

### ✅ WORKING: CloudPod Provisioning (Panel API)

**File**: `apps/panel-api/src/index.ts` (line ~11227)

```typescript
app.post("/cloudpods/provision", async (request, reply) => {
  // Creates serviceInstance, triggers BullMQ job
  // BullMQ worker provisions pod on Proxmox
});
```

**Status**: ✅ Works when called directly via API  
**Problem**: ❌ NOT called automatically from Stripe webhook

---

### ❌ MISSING: Product-Specific Provisioning

| Product | Provisioning Script | Webhook Integration | Status |
|---------|-------------------|---------------------|--------|
| **CloudPods** | `POST /cloudpods/provision` | ❌ Not connected | Manual |
| **WordPress** | ❌ Does not exist | ❌ Not connected | Manual |
| **Email** | ❌ Does not exist | ❌ Not connected | Manual |
| **VPS** | ❌ Does not exist | ❌ Not connected | Manual |
| **Cloud** | ❌ Does not exist | ❌ Not connected | Manual |
| **Storage** | ❌ Does not exist | ❌ Not connected | Manual |
| **Bundles** | ❌ Does not exist | ❌ Not connected | Manual |

---

## Gap Analysis

### Critical Gaps

1. **No Product Type Detection**
   - Webhook receives generic `planConfig`
   - Doesn't know if it's WordPress, Email, VPS, etc.
   - Solution: Add `productType` field to plan configs

2. **No Product-Specific Handlers**
   - `provisionServices()` is a stub
   - Needs switch/case for each product type
   - Each product needs dedicated provisioning logic

3. **No Provisioning Scripts for Most Products**
   - CloudPod: ✅ Exists (`/cloudpods/provision`)
   - WordPress: ❌ Missing
   - Email: ❌ Missing
   - VPS: ❌ Missing
   - Storage: ❌ Missing

4. **No Bundle Handling**
   - Customer orders "Hosting + Email + Domain"
   - System needs to provision all 3 services
   - Currently: Only first service gets created

---

## Implementation Plan

### Phase 1: Add Product Type Detection (2 hours)

**File**: `apps/website/src/config/plansConfig.ts`

```typescript
export interface BasePlan {
  family: 'cloudpods' | 'wordpress' | 'email' | 'vps' | 'backup' | 'addon';
  code: string;
  name: string;
  // Add this:
  provisioningType: 'cloudpod' | 'wordpress' | 'email' | 'vps' | 'storage' | 'bundle';
  provisioningConfig: {
    serviceName: string;
    resources: {
      cpu?: number;
      ram?: number;
      storage?: number;
    };
    features: Record<string, any>;
  };
}
```

**Tasks**:
- [ ] Add `provisioningType` to all plan definitions
- [ ] Add `provisioningConfig` with service-specific parameters
- [ ] Update `getPlanConfig()` to include new fields

---

### Phase 2: Create Product-Specific Provisioning Routes (8 hours)

#### A) WordPress Provisioning

**File**: `apps/panel-api/src/routes/wordpress-provision.ts` (NEW)

```typescript
export async function provisionWordPress({
  tenantId,
  customerId,
  subscriptionId,
  planConfig,
  domain,
}) {
  // 1. Create CloudPod (WordPress pods run on CloudPods)
  const pod = await provisionCloudPod({
    tenantId,
    customerId,
    plan: planConfig.podPlan, // e.g., "cloudpods-standard"
    domain,
    appType: "wordpress"
  });

  // 2. Install WordPress via script
  await installWordPress({
    podId: pod.id,
    domain,
    adminEmail: tenantEmail,
    wpVersion: "latest",
    theme: planConfig.defaultTheme || "twentytwentyfour"
  });

  // 3. Configure WordPress-specific features
  await configureWordPressFeatures({
    podId: pod.id,
    features: planConfig.features, // auto-updates, staging, security
  });

  return { serviceId: pod.id, domain, status: "active" };
}
```

**Tasks**:
- [ ] Create `apps/panel-api/src/routes/wordpress-provision.ts`
- [ ] Add `POST /wordpress/provision` route to index.ts
- [ ] Create WordPress installation script for pods
- [ ] Add staging environment setup
- [ ] Configure auto-updates and backups

---

#### B) Email Provisioning

**File**: `apps/panel-api/src/routes/email-provision.ts` (NEW)

```typescript
export async function provisionEmail({
  tenantId,
  customerId,
  subscriptionId,
  planConfig,
  domain,
}) {
  // 1. Create email domain in dns-mail-core
  const emailDomain = await createEmailDomain({
    domain,
    tenantId,
    dkimEnabled: true,
    spfRecord: `v=spf1 include:mail.migrahosting.com ~all`,
  });

  // 2. Create mailboxes based on plan
  const mailboxes = [];
  for (let i = 0; i < planConfig.mailboxCount; i++) {
    const mailbox = await createMailbox({
      domain: emailDomain.id,
      tenantId,
      storageGb: planConfig.storagePerMailbox,
    });
    mailboxes.push(mailbox);
  }

  // 3. Configure DNS records on dns-mail-core (PowerDNS)
  await configureDNSRecords({
    domain,
    records: [
      { type: "MX", value: "mail.migrahosting.com", priority: 10 },
      { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=quarantine" },
      { type: "TXT", name: "default._domainkey", value: emailDomain.dkimKey },
    ],
  });

  return { serviceId: emailDomain.id, mailboxes, status: "active" };
}
```

**Tasks**:
- [ ] Create `apps/panel-api/src/routes/email-provision.ts`
- [ ] Add `POST /email/provision` route
- [ ] Create email domain setup script for dns-mail-core
- [ ] Auto-configure DNS records on dns-mail-core (PowerDNS)
- [ ] Generate DKIM keys and SPF/DMARC records

---

#### C) VPS Provisioning

**File**: `apps/panel-api/src/routes/vps-provision.ts` (NEW)

```typescript
export async function provisionVPS({
  tenantId,
  customerId,
  subscriptionId,
  planConfig,
}) {
  // 1. Clone VM template on Proxmox
  const nextVMID = await getNextProxmoxVMID();
  await cloneProxmoxVM({
    templateId: 200, // BASE-UBUNTU-24
    newVMID: nextVMID,
    name: `vps-${tenantId}-${nextVMID}`,
    cores: planConfig.cpu,
    memory: planConfig.ramMB,
    storage: planConfig.storageGB,
  });

  // 2. Start VM and wait for IP
  await startProxmoxVM(nextVMID);
  const vmIP = await waitForVMIP(nextVMID);

  // 3. Configure firewall and assign to tenant
  await configureVPSFirewall({
    vmIP,
    tenantId,
    allowedPorts: [22, 80, 443],
  });

  return { serviceId: nextVMID, ipAddress: vmIP, status: "active" };
}
```

**Tasks**:
- [ ] Create `apps/panel-api/src/routes/vps-provision.ts`
- [ ] Add `POST /vps/provision` route
- [ ] Create Proxmox VM cloning script
- [ ] Auto-configure firewall rules
- [ ] Setup SSH key injection

---

#### D) Storage Provisioning

**File**: `apps/panel-api/src/routes/storage-provision.ts` (NEW)

```typescript
export async function provisionStorage({
  tenantId,
  customerId,
  subscriptionId,
  planConfig,
}) {
  // 1. Create S3 bucket on MigraDrive
  const bucket = await createS3Bucket({
    name: `tenant-${tenantId}-storage`,
    quotaGB: planConfig.storageGB,
    region: "srv1",
  });

  // 2. Generate access credentials
  const credentials = await generateS3Credentials({
    bucketId: bucket.id,
    tenantId,
    permissions: ["read", "write", "delete"],
  });

  // 3. Setup backup retention policy
  await configureBackupPolicy({
    bucketId: bucket.id,
    retentionDays: planConfig.backupRetentionDays || 30,
  });

  return { serviceId: bucket.id, credentials, status: "active" };
}
```

**Tasks**:
- [ ] Create `apps/panel-api/src/routes/storage-provision.ts`
- [ ] Add `POST /storage/provision` route
- [ ] Create S3 bucket provisioning script
- [ ] Generate and secure access keys
- [ ] Configure backup policies

---

### Phase 3: Update Webhook Handler (4 hours)

**File**: `server/services/tenantProvisioningService.js`

**Current Code**:
```javascript
async function provisionServices({ tenantId, planConfig, subscriptionId }) {
  // STUB - doesn't do anything product-specific
  console.log('[Provisioning] Provisioning services...');
  return { success: true };
}
```

**New Code**:
```javascript
async function provisionServices({ tenantId, planConfig, subscriptionId, metadata }) {
  const productType = planConfig.provisioningType;
  
  switch (productType) {
    case 'cloudpod':
      return await provisionCloudPod({
        tenantId,
        subscriptionId,
        planConfig,
        domain: metadata.domain || null,
      });
      
    case 'wordpress':
      return await provisionWordPress({
        tenantId,
        subscriptionId,
        planConfig,
        domain: metadata.domain || `${tenantId}.migrahosting.com`,
      });
      
    case 'email':
      return await provisionEmail({
        tenantId,
        subscriptionId,
        planConfig,
        domain: metadata.domain || metadata.emailDomain,
      });
      
    case 'vps':
      return await provisionVPS({
        tenantId,
        subscriptionId,
        planConfig,
      });
      
    case 'storage':
      return await provisionStorage({
        tenantId,
        subscriptionId,
        planConfig,
      });
      
    case 'bundle':
      return await provisionBundle({
        tenantId,
        subscriptionId,
        planConfig,
        metadata,
      });
      
    default:
      throw new Error(`Unknown product type: ${productType}`);
  }
}
```

**Tasks**:
- [ ] Update `provisionServices()` with product type routing
- [ ] Add API calls to panel-api provisioning routes
- [ ] Add error handling and retry logic
- [ ] Log provisioning status for each product

---

### Phase 4: Bundle Handling (4 hours)

**File**: `server/services/bundleProvisioningService.js` (NEW)

```javascript
async function provisionBundle({ tenantId, subscriptionId, planConfig, metadata }) {
  const results = [];
  
  // Parse bundle components
  const components = planConfig.bundleComponents || [];
  
  for (const component of components) {
    try {
      const result = await provisionServices({
        tenantId,
        subscriptionId,
        planConfig: {
          ...component,
          provisioningType: component.productType,
        },
        metadata,
      });
      
      results.push({ component: component.name, success: true, result });
    } catch (error) {
      results.push({ component: component.name, success: false, error: error.message });
    }
  }
  
  // Return summary
  const allSuccess = results.every(r => r.success);
  return {
    success: allSuccess,
    components: results,
  };
}
```

**Tasks**:
- [ ] Create `bundleProvisioningService.js`
- [ ] Define bundle component structure in plan configs
- [ ] Add sequential provisioning with dependency handling
- [ ] Handle partial failures gracefully

---

### Phase 5: Testing & Validation (4 hours)

#### Test Plan

| Product | Test Scenario | Expected Outcome |
|---------|--------------|------------------|
| **CloudPod** | Order Student plan | Pod created, domain configured, SSH access |
| **WordPress** | Order WP Starter | WordPress pod created, WP installed, admin account |
| **Email** | Order Email Basic | Domain added on dns-mail-core, DNS configured on dns-mail-core, mailbox created |
| **VPS** | Order VPS-1 | VM cloned, started, IP assigned, firewall configured |
| **Storage** | Order Storage Personal | S3 bucket created, credentials generated, quota set |
| **Bundle** | Order Hosting + Email | Both services provisioned, DNS linked |

**Tasks**:
- [ ] Create test Stripe checkout sessions
- [ ] Trigger webhooks manually with test data
- [ ] Verify each service provisions correctly
- [ ] Check tenant account has correct entitlements
- [ ] Validate welcome emails contain correct info

---

## Implementation Timeline

| Phase | Duration | Priority |
|-------|----------|----------|
| Phase 1: Product Type Detection | 2 hours | 🔴 Critical |
| Phase 2A: WordPress Provisioning | 3 hours | 🔴 Critical |
| Phase 2B: Email Provisioning | 3 hours | 🔴 Critical |
| Phase 2C: VPS Provisioning | 2 hours | 🟡 High |
| Phase 2D: Storage Provisioning | 2 hours | 🟡 High |
| Phase 3: Webhook Handler Update | 4 hours | 🔴 Critical |
| Phase 4: Bundle Handling | 4 hours | 🟢 Medium |
| Phase 5: Testing | 4 hours | 🔴 Critical |
| **Total** | **24 hours** | **~3 days** |

---

## Infrastructure Requirements

### DNS + Mail Core (dns-mail-core, 100.81.76.39)
- PowerDNS API access
- Auto-create zones for new domains
- Auto-configure MX, SPF, DKIM, DMARC records
- Postfix/Dovecot control API
- Mailbox creation scripts
- DKIM key generation

### Proxmox (100.73.199.109)
- VM template BASE-UBUNTU-24 (VMID 200)
- LXC template for CloudPods
- Auto-IP assignment from 10.1.10.0/24

### Panel API (100.119.105.93)
- Provisioning routes for each product
- BullMQ worker for async jobs
- Database for tracking provisioning status

---

## Rollout Strategy

### Week 1: Critical Path
1. ✅ Add product type detection to all plans
2. ✅ Build WordPress provisioning (most common product)
3. ✅ Build Email provisioning (bundled with WordPress)
4. ✅ Update webhook handler with product routing
5. ✅ Test WordPress + Email orders end-to-end

### Week 2: Expansion
1. ✅ Build VPS provisioning
2. ✅ Build Storage provisioning
3. ✅ Add bundle handling
4. ✅ Test all product combinations

### Week 3: Production
1. ✅ Deploy to production
2. ✅ Monitor first 10 orders
3. ✅ Fix edge cases
4. ✅ Document operational runbooks

---

## Success Metrics

### Before Automation
- Manual provisioning time: ~30 minutes per order
- Human error rate: ~5% (wrong plan, missing features)
- Customer wait time: 2-24 hours

### After Automation
- Provisioning time: <5 minutes
- Error rate: <0.1% (automated, consistent)
- Customer wait time: Immediate (real-time)

---

## Runbook: Adding a New Product

When adding a new product to the catalog:

1. **Define Plan in plansConfig.ts**
   ```typescript
   {
     family: 'newproduct',
     code: 'newproduct-starter',
     provisioningType: 'newproduct',
     provisioningConfig: { /* resources */ }
   }
   ```

2. **Create Provisioning Route**
   - `apps/panel-api/src/routes/newproduct-provision.ts`
   - Implement `provisionNewProduct()` function
   - Add `POST /newproduct/provision` route

3. **Update Webhook Handler**
   - Add case for 'newproduct' in `provisionServices()` switch

4. **Test End-to-End**
   - Create test checkout session
   - Trigger webhook
   - Verify service provisioned

---

## Next Steps

**Immediate Actions** (Start now):
1. Add `provisioningType` field to all plan configs
2. Create WordPress provisioning route
3. Create Email provisioning route
4. Update `provisionServices()` with product routing

**Owner**: MigraAgent  
**Estimated Completion**: 3 days (24 work hours)

---

*This runbook is the authoritative source for payment-to-provisioning automation. All implementations must follow this specification.*
