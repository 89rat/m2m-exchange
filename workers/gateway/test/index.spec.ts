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
});
