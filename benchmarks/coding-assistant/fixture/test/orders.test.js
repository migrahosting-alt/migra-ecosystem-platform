'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { submitOrder } = require('../src/orders.js');
const { Inventory } = require('../src/inventory.js');
const { OrderRepository } = require('../src/repository.js');

function ctx(stock = { widget: 10, gizmo: 5 }) {
  return { inventory: new Inventory(stock), repository: new OrderRepository() };
}

test('a plain order is priced subtotal + tax', () => {
  const saved = submitOrder(
    { customerId: 'c1', lines: [{ sku: 'widget', quantity: 2, unitPriceCents: 1000 }] },
    ctx(),
  );
  assert.equal(saved.subtotalCents, 2000);
  assert.equal(saved.taxCents, 165);
  assert.equal(saved.totalCents, 2165);
});

test('stock is decremented on a confirmed order', () => {
  const c = ctx();
  submitOrder({ customerId: 'c1', lines: [{ sku: 'widget', quantity: 3, unitPriceCents: 500 }] }, c);
  assert.equal(c.inventory.available('widget'), 7);
});

test('a gold member gets 10% off before tax', () => {
  const saved = submitOrder(
    { customerId: 'c1', tier: 'gold', lines: [{ sku: 'widget', quantity: 1, unitPriceCents: 10000 }] },
    ctx(),
  );
  assert.equal(saved.discountedCents, 9000);
  assert.equal(saved.taxCents, 743);
});
