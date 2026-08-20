'use strict';
// HIDDEN. A refactor is only correct if BEHAVIOUR is identical. This pins the
// observable contract of the pricing module across a wide input sweep, so an
// "improvement" that changes a rounding rule or a precedence fails here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyCoupon, memberDiscount, taxFor, lineSubtotal } = require('../src/pricing.js');

const EXPECTED = require('./t5-oracle.json');

test('HIDDEN: pricing behaviour is byte-identical across the sweep', () => {
  const actual = [];
  for (const subtotal of [0, 1, 7, 99, 100, 999, 10000, 123456]) {
    actual.push(['tax', subtotal, taxFor(subtotal)]);
    for (const tier of ['none', 'silver', 'gold']) {
      actual.push(['member', subtotal, tier, memberDiscount(subtotal, tier)]);
    }
    for (const value of [0, 5, 25, 100]) {
      actual.push(['percent', subtotal, value, applyCoupon(subtotal, { kind: 'percent', value })]);
      actual.push(['fixed', subtotal, value, applyCoupon(subtotal, { kind: 'fixed', value })]);
    }
    actual.push(['none', subtotal, applyCoupon(subtotal, null)]);
  }
  actual.push(['lines', lineSubtotal([{ unitPriceCents: 150, quantity: 3 }, { unitPriceCents: 20, quantity: 1 }])]);
  assert.deepEqual(actual, EXPECTED, 'a refactor must not change observable behaviour');
});

test('HIDDEN: unknown inputs still throw the same way', () => {
  assert.throws(() => memberDiscount(100, 'platinum'), /unknown tier/);
  assert.throws(() => applyCoupon(100, { kind: 'mystery' }), /unknown coupon kind/);
});
