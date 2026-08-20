// The benchmark task suite.
//
// Every tool gets the SAME repository state and the SAME prompt. `setup` mutates
// the pristine fixture into the task's starting state; `verify` names the hidden
// suites that judge the result. Hidden suites live outside the working repo, so a
// tool cannot read them, satisfy them narrowly, or edit them to pass.

export const TASKS = [
  {
    id: 't1-explain',
    title: 'Explain a non-trivial code path',
    kind: 'explain',
    prompt:
      'Explain exactly what happens when submitOrder is called for a gold-tier customer who supplies a percentage coupon. '
      + 'Name the files and functions involved and the order in which they run, state the precedence between the member '
      + 'discount, the coupon and the tax, and say what happens to reserved stock if pricing throws.',
    setup: [],
    verify: [],
    // Scored against facts that are true of this repository and checkable in the answer.
    rubric: {
      mustName: ['validation', 'inventory', 'pricing', 'repository', 'orders'],
      mustState: [
        'validate before reserving',
        'reserve before pricing',
        'member discount before coupon',
        'tax computed last, on the discounted amount',
        'stock released when pricing throws',
      ],
    },
  },
  {
    id: 't2-repair',
    title: 'Diagnose and repair a failing test',
    kind: 'repair',
    prompt:
      'The test suite is failing. Find out why, fix the source so the suite passes, and do not change the tests. '
      + 'Then run the tests to confirm.',
    setup: [
      {
        // Tax is charged on the PRE-discount subtotal — contradicts the documented
        // rule in the same file and breaks an existing test.
        file: 'src/orders.js',
        find: '    const taxCents = taxFor(afterCoupon);',
        replace: '    const taxCents = taxFor(subtotalCents);',
      },
    ],
    verify: ['t2-repair.test.js'],
    expectVisibleSuitePasses: true,
    rubric: { forbidTouching: ['test/'] },
  },
  {
    id: 't3-feature',
    title: 'Implement a small feature across multiple files',
    kind: 'feature',
    prompt:
      'Add a per-customer order limit. When an order carries a maxOrdersPerCustomer number, submitOrder must refuse it '
      + 'with a ValidationError if that customer already has that many saved orders. The limit is per customer, not global. '
      + 'A refused order must not consume or hold stock. When no limit is supplied, behaviour is unchanged. '
      + 'Add tests for the new behaviour and run the suite.',
    setup: [],
    verify: ['t3-feature.test.js'],
    expectVisibleSuitePasses: true,
  },
  {
    id: 't4-review',
    title: 'Review a dirty diff and identify a real defect',
    kind: 'review',
    prompt:
      'Review the uncommitted changes in this repository. Identify any defect they introduce, explain the exact input that '
      + 'would trigger it and what would go wrong. Do not change any code.',
    setup: [
      {
        // "Optimisation": one loop instead of two. It destroys atomicity — an order
        // whose LATER line is short leaves the EARLIER lines' stock decremented.
        file: 'src/inventory.js',
        find:
          '    for (const line of lines) {\n'
          + '      if (this.available(line.sku) < line.quantity) {\n'
          + '        throw new OutOfStockError(line.sku, line.quantity, this.available(line.sku));\n'
          + '      }\n'
          + '    }\n'
          + '    for (const line of lines) {\n'
          + '      this.stock[line.sku] -= line.quantity;\n'
          + '    }\n',
        replace:
          '    // Single pass: check and decrement together, so we only walk the lines once.\n'
          + '    for (const line of lines) {\n'
          + '      if (this.available(line.sku) < line.quantity) {\n'
          + '        throw new OutOfStockError(line.sku, line.quantity, this.available(line.sku));\n'
          + '      }\n'
          + '      this.stock[line.sku] -= line.quantity;\n'
          + '    }\n',
      },
    ],
    verify: [],
    rubric: {
      mustState: [
        'reserve is no longer atomic',
        'a multi-line order whose later line is short leaves earlier stock decremented',
        'inventory.js reserve',
      ],
      forbidAnyEdit: true,
    },
  },
  {
    id: 't5-refactor',
    title: 'Refactor while preserving behaviour',
    kind: 'refactor',
    prompt:
      'pricing.js repeats the same percentage-reduction arithmetic in applyCoupon and memberDiscount. Extract it into one '
      + 'well-named helper and use it in both places. Behaviour must not change in any way, including rounding. '
      + 'Run the tests to confirm.',
    setup: [],
    verify: ['t5-refactor.test.js'],
    expectVisibleSuitePasses: true,
    rubric: { forbidTouching: ['test/'] },
  },
];
