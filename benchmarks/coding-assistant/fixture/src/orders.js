'use strict';

const { validateOrder } = require('./validation.js');
const { Inventory } = require('./inventory.js');
const { OrderRepository } = require('./repository.js');
const { applyCoupon, memberDiscount, taxFor, lineSubtotal } = require('./pricing.js');

/**
 * Submit an order.
 *
 * The pricing order is deliberate and is the rule the business cares about:
 *
 *   subtotal -> member discount -> coupon -> tax
 *
 * Tax is charged on what the customer actually pays, so it is computed LAST.
 * Stock is reserved before pricing, and released if anything downstream throws.
 */
function submitOrder(order, { inventory, repository }) {
  validateOrder(order);

  const id = repository.nextId();
  inventory.reserve(id, order.lines);

  try {
    const subtotalCents = lineSubtotal(order.lines);
    const afterMember = memberDiscount(subtotalCents, order.tier ?? 'none');
    const afterCoupon = applyCoupon(afterMember, order.coupon);
    const taxCents = taxFor(afterCoupon);

    return repository.save({
      id,
      customerId: order.customerId,
      lines: order.lines,
      subtotalCents,
      discountedCents: afterCoupon,
      taxCents,
      totalCents: afterCoupon + taxCents,
      status: 'confirmed',
    });
  } catch (error) {
    inventory.release(id);
    throw error;
  }
}

module.exports = { submitOrder, Inventory, OrderRepository };
