/**
 * Number-order planning, as seen by the Control Center.
 *
 * The Telnyx API key lives on panel-api and deliberately does not exist in
 * this app, so the console cannot search for numbers itself. It asks
 * panel-api what is available and what it would cost.
 *
 * Planning only. There is no function here that orders a number.
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
  monthlyCost: string | null;
  upfrontCost: string | null;
  currency: string | null;
  reservable: boolean;
  features: string[];
  emergencyCapable: boolean;
};

export type NumberOrderPlan = {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  candidates: PlannedNumber[];
  totals: { monthly: string; upfront: string; currency: string } | null;
  identityStamp: { customerReference: string; connectionId: string | null };
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
