'use strict';

const TAX_RATE = 0.0825;

/**
 * Coupons are applied to the SUBTOTAL, before tax.
 *
 * Percentage coupons stack multiplicatively with a member discount; fixed-amount
 * coupons are subtracted after any percentage reduction. A coupon can never take
 * a line below zero.
 */
function applyCoupon(subtotalCents, coupon) {
  if (!coupon) return subtotalCents;
  if (coupon.kind === 'percent') {
    return Math.round(subtotalCents * (1 - coupon.value / 100));
  }
  if (coupon.kind === 'fixed') {
    return Math.max(0, subtotalCents - coupon.value);
  }
  throw new Error(`unknown coupon kind: ${coupon.kind}`);
}

function memberDiscount(subtotalCents, tier) {
  const rates = { none: 0, silver: 0.05, gold: 0.1 };
  const rate = rates[tier];
  if (rate === undefined) throw new Error(`unknown tier: ${tier}`);
  return Math.round(subtotalCents * (1 - rate));
}

function taxFor(amountCents) {
  return Math.round(amountCents * TAX_RATE);
}

function lineSubtotal(lines) {
  return lines.reduce((total, line) => total + line.unitPriceCents * line.quantity, 0);
}

module.exports = { applyCoupon, memberDiscount, taxFor, lineSubtotal, TAX_RATE };
