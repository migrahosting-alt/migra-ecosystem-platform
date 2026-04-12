import { afterEach, describe, expect, test, vi } from "vitest";
import { ProvisioningJobSource, ProvisioningJobStatus, ProvisioningJobType } from "@prisma/client";

const baseEnv = { ...process.env };

function buildJob(payloadOverrides: Record<string, unknown> = {}) {
  const now = new Date("2026-03-11T12:00:00.000Z");
  return {
    id: "job_test_001",
    orgId: "org_test_001",
    createdByActorId: null,
    source: ProvisioningJobSource.SYSTEM,
    type: ProvisioningJobType.PROVISION,
    status: ProvisioningJobStatus.PENDING,
    attempts: 0,
    maxAttempts: 3,
    notBefore: null,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    lastErrorAt: null,
    lockedAt: null,
    lockedBy: null,
    idempotencyKey: "idem_test_001",
    envelopeVersion: 1,
    payload: {
      action: "POD_CREATE",
      product: "MIGRAHOSTING",
      productLane: "MIGRAHOSTING",
      transitionId: "transition_001",
      ...payloadOverrides,
    },
    payloadHash: "payload_hash_001",
    signature: "signature_001",
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  process.env = { ...baseEnv };
});

describe("Webhook provisioning provider", () => {
  test("returns fatal failure when dispatch target is missing", async () => {
    process.env = {
      ...baseEnv,
      NODE_ENV: "test",
      PROVISIONING_ENGINE_DRY_RUN: "false",
    };
    delete process.env.PROVISIONING_DISPATCH_URL;
    delete process.env.PROVISIONING_DISPATCH_TOKEN;
    delete process.env.MIGRAHOSTING_PROVISION_URL;
    delete process.env.MIGRAHOSTING_PROVISION_TOKEN;

    const { getProvisioningProvider } = await import("../../src/lib/provisioning/provider");

    const result = await getProvisioningProvider().execute({
      job: buildJob(),
      idempotencyKey: "idem_test_001",
      workerId: "worker_test_001",
    });

    expect(result.kind).toBe("FATAL_FAILURE");
    if (result.kind !== "FATAL_FAILURE") {
      return;
    }

    expect(result.message).toBe("missing_dispatch_target");
  });


  test("routes MIGRAHOSTING pod creation to the hosting agent", async () => {
    process.env = {
      ...baseEnv,
      NODE_ENV: "test",
      PROVISIONING_ENGINE_DRY_RUN: "false",
      MIGRAHOSTING_AGENT_URL: "http://100.68.239.94:4080",
      MIGRAHOSTING_AGENT_KEY_ID: "k2",
      MIGRAHOSTING_AGENT_SECRET: "hosting-secret",
      PROVISIONING_DISPATCH_TIMEOUT_MS: "5000",
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"siteId":"site_001"}',
    });

    vi.stubGlobal("fetch", fetchMock);
    const { getProvisioningProvider } = await import("../../src/lib/provisioning/provider");

    const result = await getProvisioningProvider().execute({
      job: buildJob({
        tenantId: "tenant_ctx_001",
        serviceInstanceId: "svc_ctx_001",
        domain: "tenant.example.com",
        plan: "MigraHosting Starter",
        limits: { diskGb: 25 },
      }),
      idempotencyKey: "idem_test_001",
      workerId: "worker_test_001",
    });

    expect(result.kind).toBe("SUCCESS");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://100.68.239.94:4080/cloudpod/provision");
    expect(request.method).toBe("POST");
    expect(request.headers).toMatchObject({
      "content-type": "application/json",
      "x-migrapanel-key-id": "k2",
    });
    expect(request.headers).toHaveProperty("x-migrapanel-ts");
    expect(request.headers).toHaveProperty("x-migrapanel-nonce");
    expect(request.headers).toHaveProperty("x-migrapanel-sig");
    expect(JSON.parse(String(request.body))).toEqual({
      tenantId: "tenant_ctx_001",
      serviceInstanceId: "svc_ctx_001",
      domain: "tenant.example.com",
      planKey: "MigraHosting Starter",
      limits: { diskGb: 25 },
    });
  });

  test("routes MIGRAHOSTING dns provisioning to the edge agent", async () => {
    process.env = {
      ...baseEnv,
      NODE_ENV: "test",
      PROVISIONING_ENGINE_DRY_RUN: "false",
      MIGRAPANEL_EDGE_URL: "http://100.68.239.94:3200",
      PROVISIONING_DISPATCH_TIMEOUT_MS: "5000",
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"success":true}',
    });

    vi.stubGlobal("fetch", fetchMock);
    const { getProvisioningProvider } = await import("../../src/lib/provisioning/provider");

    const result = await getProvisioningProvider().execute({
      job: buildJob({
        action: "DNS_PROVISION",
        domain: "tenant.example.com",
        targetIp: "10.68.0.25",
      }),
      idempotencyKey: "idem_test_001",
      workerId: "worker_test_001",
    });

    expect(result.kind).toBe("SUCCESS");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://100.68.239.94:3200/internal/edge/nginx/proxy");
    expect(request.method).toBe("POST");
    expect(request.headers).toMatchObject({
      "content-type": "application/json",
    });
    expect(JSON.parse(String(request.body))).toEqual({
      domain: "tenant.example.com",
      targetIp: "10.68.0.25",
    });
  });

  test("routes MIGRAMAIL provisioning to the live mailcore-api contract", async () => {
    process.env = {
      ...baseEnv,
      NODE_ENV: "test",
      PROVISIONING_ENGINE_DRY_RUN: "false",
      MIGRAMAIL_CORE_URL: "http://100.81.76.39:9080",
      MIGRAMAIL_CORE_API_KEY: "mailcore-secret",
      PROVISIONING_DISPATCH_TIMEOUT_MS: "5000",
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => '{"success":true,"domain":"example.com"}',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => '{"success":true,"email":"admin@example.com"}',
      });

    vi.stubGlobal("fetch", fetchMock);
    const { getProvisioningProvider } = await import("../../src/lib/provisioning/provider");

    const result = await getProvisioningProvider().execute({
      job: buildJob({
        action: "MAIL_PROVISION",
        product: "MIGRAMAIL",
        productLane: "MIGRAMAIL",
        domain: "example.com",
        mailboxEmail: "admin@example.com",
        mailboxPassword: "StrongPass123!",
        mailboxName: "Admin",
        mailboxQuotaMb: 2048,
        mailDomainDescription: "Example Mail Domain",
        mailDomainMaxMailboxes: 25,
        mailDomainQuotaMb: 10240,
      }),
      idempotencyKey: "idem_test_001",
      workerId: "worker_test_001",
    });

    expect(result.kind).toBe("SUCCESS");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [domainUrl, domainRequest] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(domainUrl).toBe("http://100.81.76.39:9080/v1/domains/ensure");
    expect(domainRequest.method).toBe("POST");
    expect(domainRequest.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer mailcore-secret",
    });
    expect(JSON.parse(String(domainRequest.body))).toEqual({
      domain: "example.com",
      tenantId: undefined,
    });

    const [mailboxUrl, mailboxRequest] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(mailboxUrl).toBe("http://100.81.76.39:9080/v1/domains/example.com/mailboxes");
    expect(mailboxRequest.method).toBe("POST");
    expect(mailboxRequest.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer mailcore-secret",
    });
    expect(JSON.parse(String(mailboxRequest.body))).toEqual({
      tenantId: undefined,
      localPart: "admin",
      password: "StrongPass123!",
      quotaMb: 2048,
    });
  });

  test("routes MIGRAMAIL disable to the live mailcore-api contract", async () => {
    process.env = {
      ...baseEnv,
      NODE_ENV: "test",
      PROVISIONING_ENGINE_DRY_RUN: "false",
      MIGRAMAIL_CORE_URL: "http://100.81.76.39:9080",
      MIGRAMAIL_CORE_API_KEY: "mailcore-secret",
      PROVISIONING_DISPATCH_TIMEOUT_MS: "5000",
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"success":true}',
    });

    vi.stubGlobal("fetch", fetchMock);
    const { getProvisioningProvider } = await import("../../src/lib/provisioning/provider");

    const result = await getProvisioningProvider().execute({
      job: buildJob({
        action: "MAIL_DISABLE",
        product: "MIGRAMAIL",
        productLane: "MIGRAMAIL",
        mailboxEmail: "admin@example.com",
      }),
      idempotencyKey: "idem_test_001",
      workerId: "worker_test_001",
    });

    expect(result.kind).toBe("SUCCESS");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://100.81.76.39:9080/v1/mailboxes/admin%40example.com");
    expect(request.method).toBe("DELETE");
    expect(request.headers).toMatchObject({
      authorization: "Bearer mailcore-secret",
    });
  });



  test("treats legacy MIGRAHOSTING storage provisioning as handled by pod creation", async () => {
    process.env = {
      ...baseEnv,
      NODE_ENV: "test",
      PROVISIONING_ENGINE_DRY_RUN: "false",
    };

    const { getProvisioningProvider } = await import("../../src/lib/provisioning/provider");

    const result = await getProvisioningProvider().execute({
      job: buildJob({
        action: "STORAGE_PROVISION",
        tenantId: "tenant_ctx_001",
        serviceInstanceId: "svc_ctx_001",
        domain: "tenant.example.com",
      }),
      idempotencyKey: "idem_test_001",
      workerId: "worker_test_001",
    });

    expect(result.kind).toBe("SUCCESS");
    if (result.kind !== "SUCCESS") {
      return;
    }
    expect(result.metadata).toMatchObject({
      mode: "migrahosting_storage",
      status: "handled_by_pod_create",
    });
  });

  test("treats 409 dispatch responses as idempotent success", async () => {
    process.env = {
      ...baseEnv,
      NODE_ENV: "test",
      PROVISIONING_ENGINE_DRY_RUN: "false",
      PROVISIONING_DISPATCH_URL: "https://ops.example.com/provision",
      PROVISIONING_DISPATCH_TOKEN: "dispatch-token",
      PROVISIONING_DISPATCH_TIMEOUT_MS: "5000",
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => "already processed",
    });

    vi.stubGlobal("fetch", fetchMock);

    const { getProvisioningProvider } = await import("../../src/lib/provisioning/provider");

    const result = await getProvisioningProvider().execute({
      job: buildJob(),
      idempotencyKey: "idem_test_001",
      workerId: "worker_test_001",
    });

    expect(result.kind).toBe("SUCCESS");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ops.example.com/provision");
    expect(request.method).toBe("POST");
    expect(request.headers).toMatchObject({
      authorization: "Bearer dispatch-token",
      "content-type": "application/json",
      "x-idempotency-key": "idem_test_001",
      "x-product-lane": "MIGRAHOSTING",
    });
  });
});
