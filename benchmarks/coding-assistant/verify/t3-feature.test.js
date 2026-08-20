'use strict';
// HIDDEN. Verifies the per-customer order limit feature behaves as specified.
const test = require('node:test');
const assert = require('node:assert/strict');
const { submitOrder } = require('../src/orders.js');
const { Inventory } = require('../src/inventory.js');
const { OrderRepository } = require('../src/repository.js');

const line = { sku: 'widget', quantity: 1, unitPriceCents: 100 };
const ctx = () => ({ inventory: new Inventory({ widget: 1000 }), repository: new OrderRepository() });

test('HIDDEN: a customer may place up to the limit', () => {
  const c = ctx();
  for (let i = 0; i < 3; i += 1) submitOrder({ customerId: 'c1', lines: [line], maxOrdersPerCustomer: 3 }, c);
  assert.equal(c.repository.countForCustomer('c1'), 3);
});

test('HIDDEN: exceeding the limit is refused', () => {
  const c = ctx();
  for (let i = 0; i < 3; i += 1) submitOrder({ customerId: 'c1', lines: [line], maxOrdersPerCustomer: 3 }, c);
  assert.throws(
    () => submitOrder({ customerId: 'c1', lines: [line], maxOrdersPerCustomer: 3 }, c),
    (error) => error.name === 'ValidationError' || /limit/i.test(error.message),
  );
});

test('HIDDEN: the refusal does not consume stock', () => {
  const c = ctx();
  for (let i = 0; i < 3; i += 1) submitOrder({ customerId: 'c1', lines: [line], maxOrdersPerCustomer: 3 }, c);
  const before = c.inventory.available('widget');
  try { submitOrder({ customerId: 'c1', lines: [line], maxOrdersPerCustomer: 3 }, c); } catch { /* expected */ }
  assert.equal(c.inventory.available('widget'), before, 'a refused order must not hold stock');
});

test('HIDDEN: the limit is per customer, not global', () => {
  const c = ctx();
  for (let i = 0; i < 3; i += 1) submitOrder({ customerId: 'c1', lines: [line], maxOrdersPerCustomer: 3 }, c);
  const other = submitOrder({ customerId: 'c2', lines: [line], maxOrdersPerCustomer: 3 }, c);
  assert.equal(other.status, 'confirmed');
});

test('HIDDEN: no limit given means no limit enforced', () => {
  const c = ctx();
  for (let i = 0; i < 6; i += 1) submitOrder({ customerId: 'c1', lines: [line] }, c);
  assert.equal(c.repository.countForCustomer('c1'), 6);
});
