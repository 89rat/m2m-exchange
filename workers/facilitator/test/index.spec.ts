import { describe, expect, it } from "vitest";
import app, { decodePaymentHeader, isEstateResource, parseFacilitatorRequest } from "../src/index";
import type { PaymentPayload, PaymentRequirements } from "x402/types";

const ENV = { NETWORK: "base-sepolia" } as never;

function req(
  path: string,
  init?: RequestInit,
  env: Record<string, string> = ENV as never,
) {
  return app.request(path, init, env as never);
}

const VALID_PAYLOAD: PaymentPayload = {
  x402Version: 1,
  scheme: "exact",
  network: "base-sepolia",
  payload: {
    signature: "0x" + "ab".repeat(65),
    authorization: {
      from: "0x0000000000000000000000000000000000000001",
      to: "0x417Da74CDc0D3BabF6AdC851b6E5c638574c0D58",
      value: "1000",
      validAfter: "0",
      validBefore: "9999999999",
      nonce: "0x" + "00".repeat(32),
    },
  },
} as unknown as PaymentPayload;

const ESTATE_REQ = {
  scheme: "exact",
  network: "base-sepolia",
  maxAmountRequired: "1000",
  resource: "https://gateway.code402.dev/api/weather",
  payTo: "0x417Da74CDc0D3BabF6AdC851b6E5c638574c0D58",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as unknown as PaymentRequirements;

const header = btoa(JSON.stringify(VALID_PAYLOAD));

describe("facilitator worker", () => {
  it("GET /healthz reports ok + default testnet", async () => {
    const res = await req("/healthz");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.status).toBe("ok");
    expect(body.network).toBe("base-sepolia");
  });

  it("GET /supported advertises exact scheme on the configured network", async () => {
    const res = await req("/supported", undefined, { NETWORK: "base" } as never);
    const body: any = await res.json();
    expect(body.kinds[0].scheme).toBe("exact");
    expect(body.kinds[0].network).toBe("base");
  });

  it("rejects unsupported NETWORK config (fail closed)", async () => {
    const res = await req("/healthz", undefined, { NETWORK: "base-mainnet" } as never);
    expect(res.status).toBe(500);
  });

  it("POST /verify rejects malformed bodies with 400", async () => {
    const res = await req("/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.isValid).toBe(false);
  });

  it("POST /verify rejects undecodable payment headers", async () => {
    const res = await req("/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentHeader: "!!!not-base64!!!", paymentRequirements: ESTATE_REQ }),
    });
    expect(res.status).toBe(400);
  });

  it("enforces the shared-secret guard when FACILITATOR_KEY is set", async () => {
    const res = await req(
      "/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentHeader: header, paymentRequirements: ESTATE_REQ }),
      },
      { NETWORK: "base-sepolia", FACILITATOR_KEY: "s3cret" } as never,
    );
    expect(res.status).toBe(401);
  });

  it("POST /settle fails closed without a relayer key", async () => {
    const res = await req("/settle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentHeader: header, paymentRequirements: ESTATE_REQ }),
    });
    expect(res.status).toBe(500);
    const body: any = await res.json();
    expect(body.success).toBe(false);
  });

  it("POST /settle refuses non-estate resources (gas-abuse guard)", async () => {
    const foreign = { ...ESTATE_REQ, resource: "https://attacker.example.com/api" };
    const res = await req(
      "/settle",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentHeader: header, paymentRequirements: foreign }),
      },
      { NETWORK: "base-sepolia", RELAYER_PRIVATE_KEY: "0x" + "11".repeat(32) } as never,
    );
    expect(res.status).toBe(403);
  });
});

describe("decodePaymentHeader", () => {
  it("round-trips a valid payload", () => {
    const p = decodePaymentHeader(header);
    expect(p.scheme).toBe("exact");
    expect(p.network).toBe("base-sepolia");
  });

  it("throws on garbage", () => {
    expect(() => decodePaymentHeader("bm90IGpzb24")).toThrow();
  });
});

describe("isEstateResource", () => {
  it("accepts estate hosts", () => {
    expect(isEstateResource(ESTATE_REQ)).toBe(true);
    expect(
      isEstateResource({ ...ESTATE_REQ, resource: "https://mcp.code402.dev/mcp" } as never),
    ).toBe(true);
  });

  it("rejects foreign and malformed resources", () => {
    expect(
      isEstateResource({ ...ESTATE_REQ, resource: "https://code402.dev.evil.com/x" } as never),
    ).toBe(false);
    expect(isEstateResource({ ...ESTATE_REQ, resource: "not-a-url" } as never)).toBe(false);
    expect(isEstateResource({ ...ESTATE_REQ, resource: undefined } as never)).toBe(false);
  });
});

describe("parseFacilitatorRequest", () => {
  it("accepts the standard v1 wire shape", () => {
    const out = parseFacilitatorRequest({ paymentHeader: header, paymentRequirements: ESTATE_REQ });
    expect(out.payload.scheme).toBe("exact");
  });

  it("rejects non-object bodies and missing fields", () => {
    expect(() => parseFacilitatorRequest(null)).toThrow();
    expect(() => parseFacilitatorRequest({ paymentRequirements: ESTATE_REQ })).toThrow();
    expect(() => parseFacilitatorRequest({ paymentHeader: header })).toThrow();
  });
});
