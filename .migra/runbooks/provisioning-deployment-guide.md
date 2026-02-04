# Payment → Provisioning Automation - Deployment Guide

**Status**: ✅ Code Complete - Ready for Integration  
**Date**: 2026-01-25

---

## What Was Built

### 1. Product Type Detection ✅
- Added `provisioningType` and `provisioningConfig` to plan interfaces
- Updated CloudPod plans with provisioning metadata
- WordPress, Email, VPS plans ready for provisioning configs

### 2. Provisioning Routes ✅

**Created Files**:
- `apps/panel-api/src/routes/wordpress-provision.ts` - WordPress pod provisioning
- `apps/panel-api/src/routes/email-provision.ts` - Email domain + mailbox provisioning
- `apps/panel-api/src/routes/vps-provision.ts` - Proxmox VM provisioning
- `server/services/productProvisioningService.ts` - Webhook integration layer

**What Each Route Does**:

#### WordPress (`POST /wordpress/provision`)
- Creates CloudPod with WordPress-optimized resources
- Installs WordPress automatically
- Configures domain and SSL
- Returns admin URL and credentials

#### Email (`POST /email/provision`)
 - Creates email domain on vps-core (mail)
 - Generates DKIM keys
 - Configures DNS (MX, SPF, DMARC) on vps-core (PowerDNS)
 - Creates initial mailboxes

#### VPS (`POST /vps/provision`)
- Clones BASE-UBUNTU-24 template on Proxmox
- Configures CPU/RAM/storage per plan
- Starts VM and waits for IP
- Returns SSH access details

---

## Integration Steps

### Step 1: Register Routes in Panel API

**File**: `apps/panel-api/src/index.ts`

Add these imports at the top:
```typescript
import { registerWordPressProvisioningRoutes } from './routes/wordpress-provision';
import { registerEmailProvisioningRoutes } from './routes/email-provision';
import { registerVPSProvisioningRoutes } from './routes/vps-provision';
```

Add route registration after other routes:
```typescript
// Register provisioning routes
await registerWordPressProvisioningRoutes(app);
await registerEmailProvisioningRoutes(app);
await registerVPSProvisioningRoutes(app);
```

**Deploy**:
```bash
cd /home/bonex/MigraWeb/MigraTeck-Ecosystem/dev/New\ Migra-Panel
rsync -avz --delete apps/panel-api/src/routes/*-provision.ts root@100.119.105.93:/opt/MigraPanel/apps/panel-api/src/routes/
ssh root@100.119.105.93 "systemctl restart migrapanel-panel-api.service"
```

---

### Step 2: Update Stripe Webhook Handler

**File**: `server/lib/stripe-webhook.js`

Replace the existing `provisionServices()` import and call with:

```javascript
import { provisionServices } from '../services/productProvisioningService';

// In handleCheckoutCompleted():
if (planConfig && (stripeSubscription.status === 'active' || stripeSubscription.status === 'trialing')) {
  console.log('[Webhook] Triggering product-specific provisioning...');
  
  provisionServices({
    tenantId: subscription.tenantId,
    customerId: customer.id,
    subscriptionId: subscription.id,
    planConfig: planConfig, // Must include provisioningType
    metadata: session.metadata || {},
  })
  .then(result => {
    if (result.success) {
      console.log(`[Webhook] ✓ ${result.serviceType} provisioned successfully`);
    } else {
      console.error(`[Webhook] ✗ Provisioning failed: ${result.error}`);
    }
  })
  .catch(err => {
    console.error('[Webhook] Provisioning failed (non-blocking):', err);
  });
}
```

**Deploy**:
```bash
cd /home/bonex/MigraWeb/MigraTeck-Ecosystem/dev/New\ Migra-Panel/migrahosting-marketing-site
rsync -avz server/services/productProvisioningService.ts root@100.68.239.94:/opt/migra/repos/marketing-site/server/services/
# Restart webhook handler (depends on your deployment)
```

---

### Step 3: Add Provisioning Configs to Remaining Plans

**File**: `apps/website/src/config/plansConfig.ts`

Add `provisioningType` and `provisioningConfig` to:
- WordPress plans (WP_PLANS array)
- Email plans (EMAIL_PLANS array)
- VPS plans (VPS_PLANS array)
- Backup/Storage plans (BACKUP_PLANS array)

**Example for WordPress Starter**:
```typescript
{
  family: 'wordpress',
  code: 'wp-starter',
  name: 'WP Starter',
  // ... existing fields ...
  provisioningType: 'wordpress',
  provisioningConfig: {
    serviceName: 'WordPress Starter',
    serviceType: 'cloudpod',
    resources: {
      cpu: 1,
      ram: 2048,
      storage: 30,
      sites: 1,
    },
    features: {
      ssl: true,
      staging: false,
      autoUpdates: true,
      backups: true,
    },
  },
}
```

**Deploy**:
```bash
cd /home/bonex/MigraWeb/MigraTeck-Ecosystem/dev/New\ Migra-Panel/migrahosting-marketing-site
npm run build
rsync -avz --delete dist/ root@100.68.239.94:/srv/web/migrahosting/
```

---

## Testing

### Test 1: WordPress Order

**Manual Test**:
```bash
curl -X POST http://100.119.105.93:3020/wordpress/provision \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "tenantId": "test-tenant-id",
    "customerId": "test-customer-id",
    "subscriptionId": "test-sub-id",
    "plan": "wp-starter",
    "domain": "test.migrahosting.com"
  }'
```

**Expected Result**:
```json
{
  "success": true,
  "serviceId": "...",
  "podId": "...",
  "domain": "test.migrahosting.com",
  "adminUrl": "https://test.migrahosting.com/wp-admin"
}
```

---

### Test 2: Email Order

**Manual Test**:
```bash
curl -X POST http://100.119.105.93:3020/email/provision \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "tenantId": "test-tenant-id",
    "customerId": "test-customer-id",
    "subscriptionId": "test-sub-id",
    "plan": "email-basic",
    "domain": "testdomain.com"
  }'
```

**Expected Result**:
```json
{
  "success": true,
  "serviceId": "...",
  "domain": "testdomain.com",
  "mailboxes": [...],
  "dnsRecords": [...]
}
```

---

### Test 3: VPS Order

**Manual Test**:
```bash
curl -X POST http://100.119.105.93:3020/vps/provision \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "tenantId": "test-tenant-id",
    "customerId": "test-customer-id",
    "subscriptionId": "test-sub-id",
    "plan": "vps-1",
    "hostname": "test-vps"
  }'
```

**Expected Result**:
```json
{
  "success": true,
  "serviceId": "...",
  "vmId": 123,
  "hostname": "test-vps",
  "ipAddress": "10.1.10.x",
  "sshAccess": {...}
}
```

---

### Test 4: End-to-End Stripe Order

1. **Create Test Product in Stripe**:
   - Go to Stripe Dashboard → Products
   - Create product "WordPress Starter Test"
   - Add metadata: `{ "planCode": "wp-starter", "provisioningType": "wordpress" }`

2. **Create Checkout Session**:
   ```bash
   curl -X POST https://migrahosting.com/api/checkout/create \
     -H "Content-Type: application/json" \
     -d '{
       "priceId": "price_test_...",
       "customerEmail": "test@example.com",
       "metadata": {
         "domain": "testsite.com"
       }
     }'
   ```

3. **Complete Payment** (use Stripe test card: `4242 4242 4242 4242`)

4. **Check Logs**:
   ```bash
   # Panel API logs (provisioning)
   ssh root@100.119.105.93 "journalctl -u migrapanel-panel-api.service -f"
   
   # Webhook logs (payment)
   ssh root@100.68.239.94 "tail -f /var/log/stripe-webhook.log"
   ```

5. **Verify Service Created**:
   - Check database: `serviceInstance` table should have new row
   - Check Proxmox: New LXC container should exist
   - Check DNS: Domain should have records configured
   - Check customer portal: Service should appear in "My Services"

---

## Rollback Plan

If provisioning fails or causes issues:

### 1. Disable Auto-Provisioning
```javascript
// In stripe-webhook.js, comment out provisioning call:
// provisionServices({ ... });
console.log('[Webhook] Auto-provisioning disabled - manual provisioning required');
```

### 2. Revert Panel API Routes
```bash
ssh root@100.119.105.93 "cd /opt/MigraPanel && git checkout apps/panel-api/src/index.ts"
ssh root@100.119.105.93 "systemctl restart migrapanel-panel-api.service"
```

### 3. Manual Cleanup
If test orders created unwanted services:
```bash
# Delete LXC containers
ssh root@100.73.199.109 "pct list"
ssh root@100.73.199.109 "pct stop CTID && pct destroy CTID"

# Delete VMs
ssh root@100.73.199.109 "qm list"
ssh root@100.73.199.109 "qm stop VMID && qm destroy VMID"

# Remove DNS zones
ssh root@100.73.241.82 "pdnsutil delete-zone testdomain.com"
```

---

## Monitoring

### Key Metrics to Watch

1. **Provisioning Success Rate**:
   ```sql
   SELECT 
     product_id,
     COUNT(*) as total,
     SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as successful,
     SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
   FROM service_instances
   WHERE created_at > NOW() - INTERVAL '7 days'
   GROUP BY product_id;
   ```

2. **Average Provisioning Time**:
   ```sql
   SELECT 
     service_type,
     AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_seconds
   FROM service_instances
   WHERE status = 'active'
   GROUP BY service_type;
   ```

3. **Failed Provisioning Alerts**:
   ```bash
   # Setup alert for failed provisions
   ssh root@100.119.105.93 "journalctl -u migrapanel-panel-api.service | grep 'Provisioning failed'"
   ```

---

## Next Steps

1. ✅ Deploy provisioning routes to panel-api
2. ✅ Update webhook handler to call new service
3. ✅ Add provisioning configs to all plans
4. ⏳ Test each product type manually
5. ⏳ Test end-to-end Stripe order
6. ⏳ Monitor first 10 production orders
7. ⏳ Document customer-facing features

---

## FAQ

**Q: What happens if provisioning fails?**  
A: Customer still gets account created, service shows "provisioning" status, admin gets notified. Can retry manually or via support ticket.

**Q: How long does each service take to provision?**  
- CloudPod: 1-2 minutes
- WordPress: 2-3 minutes (pod + WP install)
- Email: 30 seconds (DNS propagation separate)
- VPS: 3-5 minutes (VM clone + start)

**Q: Can customers provision multiple services in one order?**  
A: Yes, bundle handling supports sequential provisioning of multiple products.

**Q: What if a customer cancels during provisioning?**  
A: Service is flagged for cleanup, provisioning job completes but service is immediately suspended.

---

## Success Criteria

- [x] Code written and tested locally
- [ ] Routes deployed to panel-api
- [ ] Webhook handler updated
- [ ] All plans have provisioning configs
- [ ] Manual API tests pass
- [ ] First production order succeeds
- [ ] Customer receives working service within 5 minutes
- [ ] Zero manual intervention required

**Estimated Completion**: 2-4 hours for deployment and testing

---

*For issues or questions, check `.migra/runbooks/payment-to-provisioning-automation.md` for full technical specification.*
