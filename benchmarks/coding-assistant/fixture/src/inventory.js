'use strict';

class OutOfStockError extends Error {
  constructor(sku, requested, available) {
    super(`insufficient stock for ${sku}: requested ${requested}, available ${available}`);
    this.name = 'OutOfStockError';
    this.sku = sku;
  }
}

class Inventory {
  constructor(stock = {}) {
    this.stock = { ...stock };
    this.reservations = new Map();
  }

  available(sku) {
    return this.stock[sku] ?? 0;
  }

  /** Reserve every line atomically: if any line cannot be met, nothing is held. */
  reserve(orderId, lines) {
    for (const line of lines) {
      if (this.available(line.sku) < line.quantity) {
        throw new OutOfStockError(line.sku, line.quantity, this.available(line.sku));
      }
    }
    for (const line of lines) {
      this.stock[line.sku] -= line.quantity;
    }
    this.reservations.set(orderId, lines.map((line) => ({ sku: line.sku, quantity: line.quantity })));
    return true;
  }

  /** Give stock back. Safe to call for an order that holds nothing. */
  release(orderId) {
    const held = this.reservations.get(orderId);
    if (!held) return false;
    for (const line of held) {
      this.stock[line.sku] = this.available(line.sku) + line.quantity;
    }
    this.reservations.delete(orderId);
    return true;
  }
}

module.exports = { Inventory, OutOfStockError };
