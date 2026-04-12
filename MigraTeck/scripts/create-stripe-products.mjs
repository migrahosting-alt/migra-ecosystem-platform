/**
 * Creates Stripe products and prices for the MigraTeck product catalog.
 * Run once: STRIPE_SECRET_KEY=sk_live_... node scripts/create-stripe-products.mjs
 */
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Prices updated 2026-04-01 — synced to canonical product pricing pages.
const products = [
  {
    productKey: "MIGRAHOSTING",
    name: "MigraHosting",
    description: "Managed hosting environments, pod-backed service delivery, domain provisioning, and infrastructure operations for client workloads.",
    prices: [
      { name: "Starter", amount: 499, interval: "month" },   // matches MigraHosting Starter plan ($4.99/mo)
      { name: "Premium", amount: 599, interval: "month" },   // matches MigraHosting Premium plan ($5.99/mo)
      { name: "Business", amount: 799, interval: "month" },  // matches MigraHosting Business plan ($7.99/mo)
    ],
  },
  {
    productKey: "MIGRAVOICE",
    name: "MigraVoice",
    description: "Carrier-ready communications stack with voice, IVR, and analytics.",
    prices: [
      { name: "Starter", amount: 1500, interval: "month" },
      { name: "Business", amount: 3900, interval: "month" },
      { name: "Enterprise", amount: 9900, interval: "month" },
    ],
  },
  {
    productKey: "MIGRAMAIL",
    name: "MigraMail",
    description: "Mailbox, routing, and deliverability operations inside the MigraTeck ecosystem.",
    prices: [
      { name: "Starter", amount: 700, interval: "month" },
      { name: "Business", amount: 1500, interval: "month" },
      { name: "Enterprise", amount: 2900, interval: "month" },
    ],
  },
  {
    productKey: "MIGRAMARKET",
    name: "MigraMarket",
    description: "Marketing campaigns, automation, social publishing, and growth operations platform.",
    prices: [
      { name: "Local Visibility", amount: 650, interval: "month" },
      { name: "Social + Email", amount: 900, interval: "month" },
      { name: "Full Growth Engine", amount: 2200, interval: "month" },
    ],
  },
  {
    productKey: "MIGRAPILOT",
    name: "MigraPilot",
    description: "Command and automation platform for agents, runners, extension tooling, and workflow execution.",
    prices: [
      { name: "Starter", amount: 1500, interval: "month" },
      { name: "Business", amount: 4900, interval: "month" },
      { name: "Enterprise", amount: 14900, interval: "month" },
    ],
  },
  {
    productKey: "MIGRADRIVE",
    name: "MigraDrive",
    description: "File, object, backup, and document storage services with S3-compatible API and team collaboration.",
    prices: [
      { name: "Starter", amount: 499, interval: "month" },
      { name: "Business", amount: 1299, interval: "month" },
      { name: "Enterprise", amount: 2999, interval: "month" },
    ],
  },
  {
    productKey: "MIGRAINVOICE",
    name: "MigraInvoice",
    description: "Professional invoicing, quoting, and payment processing platform with multi-language and multi-currency support.",
    prices: [
      { name: "Starter",      amount: 1500,  interval: "month" }, // $15 — below FreshBooks Lite ($19)
      { name: "Professional", amount: 3900,  interval: "month" }, // $39 — matches HoneyBook entry, below FreshBooks Plus ($33 promo → $60)
      { name: "Advanced",     amount: 7900,  interval: "month" }, // $79 — below QuickBooks Simple Start ($90)
      // Enterprise is contact-sales — no Stripe price created
    ],
  },
];

const bindings = []; // Will output SQL for BillingEntitlementBinding

for (const product of products) {
  console.log(`\nCreating product: ${product.name}`);

  const stripeProduct = await stripe.products.create({
    name: product.name,
    description: product.description,
    metadata: {
      productKey: product.productKey,
      platform: "migrateck",
    },
  });

  console.log(`  Product ID: ${stripeProduct.id}`);

  for (const tier of product.prices) {
    if (tier.amount === 0) {
      console.log(`  Skipping free tier (no Stripe price needed)`);
      continue;
    }

    const price = await stripe.prices.create({
      product: stripeProduct.id,
      unit_amount: tier.amount,
      currency: "usd",
      recurring: { interval: tier.interval },
      metadata: {
        productKey: product.productKey,
        tierName: tier.name,
      },
    });

    console.log(`  Price: ${tier.name} = $${(tier.amount / 100).toFixed(2)}/mo → ${price.id}`);

    bindings.push({
      provider: "STRIPE",
      externalPriceId: price.id,
      product: product.productKey,
      statusOnActive: "ACTIVE",
      notes: `${product.name} ${tier.name}`,
    });
  }
}

console.log("\n=== Price Bindings (for BillingEntitlementBinding table) ===\n");
for (const b of bindings) {
  console.log(`INSERT INTO "BillingEntitlementBinding" (id, provider, "externalPriceId", product, "statusOnActive", notes, "createdAt", "updatedAt") VALUES (gen_random_uuid(), '${b.provider}', '${b.externalPriceId}', '${b.product}', '${b.statusOnActive}', '${b.notes}', now(), now());`);
}

console.log("\n=== JSON bindings ===\n");
console.log(JSON.stringify(bindings, null, 2));

console.log("\nDone! Copy the SQL above and run it against the migrateck database.");
