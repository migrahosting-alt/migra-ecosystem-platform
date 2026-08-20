'use strict';

class OrderRepository {
  constructor() {
    this.orders = new Map();
    this.sequence = 0;
  }

  nextId() {
    this.sequence += 1;
    return `ord_${String(this.sequence).padStart(5, '0')}`;
  }

  save(order) {
    this.orders.set(order.id, { ...order });
    return this.orders.get(order.id);
  }

  get(id) {
    return this.orders.get(id);
  }

  countForCustomer(customerId) {
    let count = 0;
    for (const order of this.orders.values()) {
      if (order.customerId === customerId) count += 1;
    }
    return count;
  }
}

module.exports = { OrderRepository };
