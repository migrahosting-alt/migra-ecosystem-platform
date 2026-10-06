/**
 * Number-order planning, as seen by the Control Center.
 *
 * The Telnyx API key lives on panel-api and deliberately does not exist in
 * this app, so the console cannot search for numbers itself. It asks
 * panel-api what is available and what it would cost.
 *
 * Planning is non-destructive. Ordering is a separate, explicit commit that
 * requires a recent server-owned plan plus an idempotency key.
 *
 * Every failure is returned as a described state rather than thrown or
 * flattened into an empty list. "panel-api is unreachable" and "there are no
 * numbers in that area code" are different facts and the operator has to be
 * able to tell them apart — rendering the first as the second is how an
 * operator concludes a working area code is sold out.
 */

export type PlannedNumber = {
  e164: string;
  display: string;
  monthlyCost: number | null;
  upfrontCost: number | null;
  currency: string | null;
  reservable: boolean;
  features?: string[];
  emergencyCapable: boolean;
};

export type NumberOrderPlan = {
  planId: string | null;
  expiresAt?: string | null;
  blockers: string[];
  warnings: string[];
  candidates: PlannedNumber[];
  totals: { monthly: number | null; upfront: number | null; currency: string | null } | null;
  identityStamp: {
    tenantId?: string;
    customerId?: string;
    customerReference: string;
    connectionId: string | null;
  };
  mode: "plan";
};

export type PlanOutcome =
  /** The console is missing the configuration needed to ask at all. */
  | { state: "not_configured"; missing: string[] }
  /** panel-api could not be reached, or answered in a way we cannot use. */
  | { state: "unavailable"; detail: string }
  /** panel-api answered. The plan itself may still carry blockers. */
  | { state: "planned"; plan: NumberOrderPlan };

export type PlanQuery = {
  tenantId: string;
  customerId: string;
  numberType: "local" | "toll-free";
  areaCode: string;
  quantity: number;
  prefix?: string;
  bestEffort?: boolean;
};

export type CommitNumberOrderInput = {
  tenantId: string;
  customerId: string;
  planId: string;
  selectedNumbers: string[];
  idempotencyKey: string;
  subscriptionId?: string;
  createdByOperatorId?: string;
};

export type CommitOutcome =
  | {
      state: "committed";
      idempotentReplay: boolean;
      order: { id: string; status: string };
      numbers: Array<{
        id: string;
        e164: string;
        displaynumber?: string;
        status: string;
        ismain?: boolean;
      }>;
      activation?: {
        status?: string;
        portalPath?: string;
        next?: string;
      };
    }
  | { state: "unavailable"; detail: string; status?: number };

const base = (): string => (process.env.PANEL_API_BASE || "").replace(/\/+$/, "");
const token = (): string => process.env.PANEL_INTERNAL_TOKEN || "";

/** Which required settings are absent. Empty means the module can run. */
export const missingConfig = (): string[] => {
  const missing: string[] = [];
  if (!base()) missing.push("PANEL_API_BASE");
  if (!token()) missing.push("PANEL_INTERNAL_TOKEN");
  return missing;
};

export const isNumberOrderingConfigured = (): boolean => missingConfig().length === 0;

export const planNumberOrder = async (query: PlanQuery): Promise<PlanOutcome> => {
  const missing = missingConfig();
  if (missing.length > 0) return { state: "not_configured", missing };

  let res: Response;
  try {
    res = await fetch(`${base()}/internal/business-phone/number-order/plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": token(),
      },
      body: JSON.stringify(query),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return {
      state: "unavailable",
      detail: err instanceof Error ? err.message : "panel-api could not be reached",
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { state: "unavailable", detail: `panel-api returned a non-JSON response (${res.status})` };
  }

  const payload = body as { ok?: boolean; plan?: NumberOrderPlan; error?: string; detail?: string };

  if (!res.ok || payload.ok !== true || !payload.plan) {
    // Note the status: a 401 here means the console's token is wrong, which an
    // operator would otherwise read as "no numbers available".
    const reason = payload.detail || payload.error || `HTTP ${res.status}`;
    return { state: "unavailable", detail: reason };
  }

  return { state: "planned", plan: payload.plan };
};

export const commitNumberOrder = async (
  input: CommitNumberOrderInput,
): Promise<CommitOutcome> => {
  const missing = missingConfig();
  if (missing.length > 0) {
    return {
      state: "unavailable",
      detail: `Missing configuration: ${missing.join(", ")}`,
    };
  }

  let res: Response;
  try {
    res = await fetch(`${base()}/internal/business-phone/number-order/commit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": token(),
      },
      body: JSON.stringify({ ...input, confirm: true }),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    return {
      state: "unavailable",
      detail: err instanceof Error ? err.message : "panel-api could not be reached",
    };
  }

  let body: any;
  try {
    body = await res.json();
  } catch {
    return {
      state: "unavailable",
      detail: `panel-api returned a non-JSON response (${res.status})`,
      status: res.status,
    };
  }

  if (!res.ok || body?.ok !== true || !body?.order) {
    return {
      state: "unavailable",
      detail: body?.message || body?.error || `HTTP ${res.status}`,
      status: res.status,
    };
  }

  return {
    state: "committed",
    idempotentReplay: body.idempotentReplay === true,
    order: {
      id: String(body.order.id || ""),
      status: String(body.order.status || "unknown"),
    },
    numbers: Array.isArray(body.numbers) ? body.numbers : [],
    activation: body.activation,
  };
};
