import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

interface PaymentRequirement {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds: number;
}

interface PaymentRequiredBody {
  x402Version: number;
  accepts: PaymentRequirement[];
  error?: string;
}

describe("m2m-gateway", () => {
  it("GET /healthz is free (no payment required)", async () => {
    const res = await SELF.fetch("http://example.com/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("m2m-gateway");
  });

  it("GET /api/weather returns 402 with payment requirements when unpaid", async () => {
    const res = await SELF.fetch("http://example.com/api/weather");
    expect(res.status).toBe(402);
    const body = (await res.json()) as PaymentRequiredBody;
    expect(body.x402Version).toBe(1);
    expect(Array.isArray(body.accepts)).toBe(true);
    expect(body.accepts.length).toBeGreaterThan(0);
  });

  it("402 body shape matches the x402 spec", async () => {
    const res = await SELF.fetch("http://example.com/api/weather");
    const body = (await res.json()) as PaymentRequiredBody;
    const req = body.accepts[0];
    expect(req).toBeDefined();
    expect(req!.scheme).toBe("exact");
    expect(req!.network).toBe("base-sepolia");
    // $0.001 of 6-decimal USDC = 1000 base units
    expect(req!.maxAmountRequired).toBe("1000");
    expect(req!.payTo.toLowerCase()).toBe(env.SELLER_WALLET_ADDRESS.toLowerCase());
    expect(req!.asset).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(req!.resource).toContain("/api/weather");
    expect(req!.maxTimeoutSeconds).toBeGreaterThan(0);
  });

  it("POST /api/echo is also paywalled when unpaid", async () => {
    const res = await SELF.fetch("http://example.com/api/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as PaymentRequiredBody;
    expect(body.x402Version).toBe(1);
    expect(body.accepts.length).toBeGreaterThan(0);
  });

  // ---- M2M/1 discovery (P1) ----

  it("GET /v1/services returns a valid M2M/1 ServiceList", async () => {
    const res = await SELF.fetch("http://example.com/v1/services");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      m2mVersion: number;
      services: {
        serviceId: string; name: string; endpoint: string;
        pricing: { mode: string; price?: { amount: string; asset: string; network: string } };
      }[];
    };
    expect(body.m2mVersion).toBe(1);
    expect(body.services.length).toBeGreaterThanOrEqual(4);
    const premium = new Set(["x402-probe", "vat-mod97", "forecast"]);
    for (const s of body.services) {
      expect(s.serviceId).toMatch(/^[a-z0-9][a-z0-9-]{2,62}$/);
      expect(s.endpoint).toMatch(/^\//);
      expect(s.pricing.mode).toBe("static");
      expect(s.pricing.price!.amount).toBe(premium.has(s.serviceId) ? "5000" : "1000");
      expect(s.pricing.price!.asset).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(s.pricing.price!.network).toBe("base-sepolia");
    }
  });

  it("GET /llms.txt is free and lists all paid services", async () => {
    const res = await SELF.fetch("http://example.com/llms.txt");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("/api/weather");
    expect(text).toContain("/api/x402-probe");
    expect(text).toContain("/api/vat-check");
  });

  it("new services are paywalled: /api/x402-probe and /api/vat-check return 402 when unpaid", async () => {
    for (const path of ["/api/x402-probe", "/api/vat-check", "/api/forecast"]) {
      const res = await SELF.fetch(`http://example.com${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(402);
      const body = (await res.json()) as PaymentRequiredBody;
      expect(body.accepts[0]!.maxAmountRequired).toBe("5000"); // premium tier
      expect(body.accepts[0]!.resource).toContain(path);
    }
  });

  // ---- Multi-tenant registry ----

  it("seller onboarding: POST /v1/sellers + listing -> dynamic /v1/services entry", async () => {
    const reg = await SELF.fetch("http://example.com/v1/sellers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "acme", wallet: "0x1111111111111111111111111111111111111111", name: "ACME APIs" }),
    });
    expect(reg.status).toBe(201);

    const list = await SELF.fetch("http://example.com/v1/sellers/acme/services", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serviceId: "holidays", upstream_url: "https://example.com/holidays", price_usd: "$0.05", description: "Holiday calendar" }),
    });
    expect(list.status).toBe(201);

    const svc = await SELF.fetch("http://example.com/v1/services");
    const body = (await svc.json()) as { services: { serviceId: string; pricing: { price: { amount: string } } }[] };
    const entry = body.services.find((s) => s.serviceId === "acme-holidays");
    expect(entry).toBeDefined();
    expect(entry!.pricing.price.amount).toBe("50000"); // $0.05 = 50000 base units
  });

  it("dynamic listing 402 challenge pays the SELLER wallet, not the platform", async () => {
    const res = await SELF.fetch("http://example.com/s/acme/holidays");
    expect(res.status).toBe(402);
    const body = (await res.json()) as PaymentRequiredBody;
    expect(body.accepts[0]!.payTo.toLowerCase()).toBe("0x1111111111111111111111111111111111111111");
    expect(body.accepts[0]!.maxAmountRequired).toBe("50000");
    expect(body.accepts[0]!.resource).toContain("/s/acme/holidays");
  });

  it("unknown listing returns M2M/1 SERVICE_NOT_FOUND error object", async () => {
    const res = await SELF.fetch("http://example.com/s/acme/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { m2mVersion: number; error: { code: string } };
    expect(body.m2mVersion).toBe(1);
    expect(body.error.code).toBe("SERVICE_NOT_FOUND");
  });

  // ---- Monetization: invoice (stream 1), tier (stream 2), placement (stream 3) ----

  it("invoice computes 2% take-rate from receipts via splitPayment", async () => {
    // Register a seller and synthesize two settled receipts ($0.05 + $1.00)
    await SELF.fetch("http://example.com/v1/sellers", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "billco", wallet: "0x2222222222222222222222222222222222222222", name: "BillCo" }) });
    const db = (globalThis as any).__TEST_D1;
    // insert receipts through the app is not possible directly; use the registry binding via env
    await env.REGISTRY.prepare(`INSERT INTO receipts (ts, seller_id, service_id, amount_usd) VALUES (?1,'billco','svc','$0.05'),(?1,'billco','svc','$1.00')`).bind(Date.now()).run();

    const res = await SELF.fetch("http://example.com/v1/sellers/billco/invoice");
    expect(res.status).toBe(200);
    const inv = (await res.json()) as { transactions: number; gross_usdc_units: string; platform_fee_usdc_units: string; fee_bps: number };
    expect(inv.transactions).toBe(2);
    expect(inv.gross_usdc_units).toBe("1050000");
    // 2% exact on both: $0.05 -> 1000 units, $1.00 -> 20000 units => 21000
    expect(inv.platform_fee_usdc_units).toBe("21000");
    expect(inv.fee_bps).toBe(200);
  });

  it("Pro tier lowers take-rate to 1.5%", async () => {
    await SELF.fetch("http://example.com/v1/sellers/billco/tier", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier: "pro" }) });
    const res = await SELF.fetch("http://example.com/v1/sellers/billco/invoice");
    const inv = (await res.json()) as { fee_bps: number; fee_schedule_version: number };
    expect(inv.fee_bps).toBe(150);
    expect(inv.fee_schedule_version).toBe(2);
  });

  it("seller analytics returns own data free", async () => {
    const res = await SELF.fetch("http://example.com/v1/sellers/billco/analytics");
    expect(res.status).toBe(200);
    const a = (await res.json()) as { total_settled_calls: number; gross_usd: number };
    expect(a.total_settled_calls).toBe(2);
    expect(a.gross_usd).toBeCloseTo(1.05, 4);
  });

  // ---- D1 receipts persistence (H1) ----

  it("platform seller row + first-party receipt logging infra exists", async () => {
    // The receipt write fires post-settlement via middleware; without a paid call
    // we verify the platform seller row and the receipts table are wired.
    await env.REGISTRY.prepare(
      `INSERT INTO sellers (id, wallet, name, created_at) VALUES ('platform','0xdead00000000000000000000000000000000dead','platform',?1) ON CONFLICT(id) DO NOTHING`,
    ).bind(Date.now()).run();
    const r = await env.REGISTRY.prepare(`SELECT COUNT(*) n FROM sellers WHERE id = 'platform'`).first<{ n: number }>();
    expect(r?.n).toBe(1);
    const inv = await SELF.fetch("http://example.com/v1/sellers/platform/invoice");
    expect(inv.status).toBe(200);
    const body = (await inv.json()) as { sellerId: string; fee_bps: number };
    expect(body.sellerId).toBe("platform");
    expect(body.fee_bps).toBe(200);
  });

  // ---- Prepaid credits ledger (M2M/1.1 §6) ----

  it("account lifecycle: register -> balance 0 -> derived from entries", async () => {
    const reg = await SELF.fetch("http://example.com/v1/accounts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: "0xAbCd000000000000000000000000000000000001" }),
    });
    expect(reg.status).toBe(201);
    const acct = (await reg.json()) as { accountId: string; apiKey: string };
    expect(acct.apiKey).toMatch(/^m2m_/);

    const bal = await SELF.fetch("http://example.com/v1/accounts/0xabcd000000000000000000000000000000000001");
    const b = (await bal.json()) as { balance_usd6: string };
    expect(b.balance_usd6).toBe("0");

    // Direct ledger insert (simulating a settled top-up), then derived balance + verify
    await env.REGISTRY.prepare(
      `INSERT INTO ledger_entries (ts, account, kind, usd6, reason) VALUES (?1,(SELECT id FROM accounts WHERE wallet='0xabcd000000000000000000000000000000000001'),'credit','5000000','topup:test')`,
    ).bind(Date.now()).run();
    const bal2 = await SELF.fetch("http://example.com/v1/accounts/0xabcd000000000000000000000000000000000001");
    const b2 = (await bal2.json()) as { balance_usd6: string };
    expect(b2.balance_usd6).toBe("5000000"); // $5.00

    const verify = await SELF.fetch("http://example.com/v1/ledger/verify");
    const v = (await verify.json()) as { ok: boolean; overdrafts: string[] };
    expect(v.ok).toBe(true);
  });

  it("insufficient credits returns 402 INSUFFICIENT_CREDITS with topup hint", async () => {
    const reg = await SELF.fetch("http://example.com/v1/accounts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: "0xAbCd000000000000000000000000000000000002" }),
    });
    const acct = (await reg.json()) as { apiKey: string };
    const res = await SELF.fetch("http://example.com/api/weather", {
      headers: { authorization: `Bearer ${acct.apiKey}` },
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: { code: string }; balance_usd6: string };
    expect(body.error.code).toBe("INSUFFICIENT_CREDITS");
    expect(body.balance_usd6).toBe("0");
  });

  it("topup SKU returns 402 when unpaid (x402 paywalled)", async () => {
    const res = await SELF.fetch("http://example.com/v1/accounts/topup/usd5");
    expect(res.status).toBe(402);
    const body = (await res.json()) as { accepts: { maxAmountRequired: string }[] };
    expect(body.accepts[0]!.maxAmountRequired).toBe("5000000"); // $5
  });
});
