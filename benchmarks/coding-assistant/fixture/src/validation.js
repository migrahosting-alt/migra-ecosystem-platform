'use strict';

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

function validateOrder(order) {
  if (!order || typeof order !== 'object') throw new ValidationError('order must be an object', 'order');
  if (!Array.isArray(order.lines) || order.lines.length === 0) {
    throw new ValidationError('an order needs at least one line', 'lines');
  }
  for (const [index, line] of order.lines.entries()) {
    if (!line.sku) throw new ValidationError(`line ${index} has no sku`, 'sku');
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new ValidationError(`line ${index} quantity must be a positive integer`, 'quantity');
    }
    if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
      throw new ValidationError(`line ${index} unitPriceCents must be a non-negative integer`, 'unitPriceCents');
    }
  }
  if (order.customerId === undefined || order.customerId === null || order.customerId === '') {
    throw new ValidationError('customerId is required', 'customerId');
  }
  return true;
}

module.exports = { validateOrder, ValidationError };
