import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("code402 landing worker", () => {
  it("serves the landing page with the seller CTA", async () => {
    const res = await SELF.fetch("https://code402.dev/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Turn any API into");
    expect(html).toContain("POST"); // onboarding snippet present
    expect(html).toContain("gateway.code402.dev/v1/sellers");
    expect(html).toContain("402 Payment Required"); // hero terminal
    expect(html).toContain("Integer money only"); // engineering-standard section
    expect(html).toContain("hello@code402.dev"); // enterprise contact
  });

  it("serves llms.txt for LLM crawlers", async () => {
    const res = await SELF.fetch("https://code402.dev/llms.txt");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("# code402");
    expect(body).toContain("/v1/services");
  });

  it("serves the .well-known/x402.json estate manifest", async () => {
    const res = await SELF.fetch("https://code402.dev/.well-known/x402.json");
    expect(res.status).toBe(200);
    const manifest = (await res.json()) as Record<string, string>;
    expect(manifest.services).toBe("https://gateway.code402.dev/v1/services");
    expect(manifest.sellers_api).toBe("https://gateway.code402.dev/v1/sellers");
    expect(manifest.discovery_index).toBe("https://atlas.code402.dev");
  });

  it("healthz responds ok", async () => {
    const res = await SELF.fetch("https://code402.dev/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "code402-landing" });
  });

  it("short links redirect", async () => {
    const res = await SELF.fetch("https://code402.dev/sell", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://gateway.code402.dev/v1/sellers");
  });
});
