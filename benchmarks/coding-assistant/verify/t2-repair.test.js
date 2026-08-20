'use strict';
// HIDDEN. The tool never sees this file. It checks that the repair fixed the real
// rule (member discount, then coupon, then tax) rather than editing the test to pass.
const test = require('node:test');
const assert = require('node:assert/strict');
const { submitOrder } = require('../src/orders.js');
const { Inventory } = require('../src/inventory.js');
const { OrderRepository } = require('../src/repository.js');
const { applyCoupon } = require('../src/pricing.js');

const ctx = () => ({ inventory: new Inventory({ widget: 100 }), repository: new OrderRepository() });

test('HIDDEN: percent coupon reduces the subtotal, not the total', () => {
  assert.equal(applyCoupon(10000, { kind: 'percent', value: 25 }), 7500);
});

test('HIDDEN: fixed coupon never takes a line below zero', () => {
  assert.equal(applyCoupon(500, { kind: 'fixed', value: 900 }), 0);
});

test('HIDDEN: gold member + 25% coupon compose, then tax is charged on what is paid', () => {
  const saved = submitOrder(
    { customerId: 'c1', tier: 'gold', coupon: { kind: 'percent', value: 25 },
      lines: [{ sku: 'widget', quantity: 1, unitPriceCents: 10000 }] },
    ctx(),
  );
  assert.equal(saved.discountedCents, 6750, 'subtotal 10000 -> gold 9000 -> 25% off 6750');
  assert.equal(saved.taxCents, 557, 'tax is charged on 6750');
  assert.equal(saved.totalCents, 7307);
});

test('HIDDEN: stock is released when pricing throws', () => {
  const c = ctx();
  assert.throws(() => submitOrder(
    { customerId: 'c1', coupon: { kind: 'mystery', value: 1 },
      lines: [{ sku: 'widget', quantity: 4, unitPriceCents: 100 }] }, c));
  assert.equal(c.inventory.available('widget'), 100, 'reservation must be released');
});
