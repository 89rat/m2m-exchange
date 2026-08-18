import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          // Deterministic throwaway address, used only in tests.
          SELLER_WALLET_ADDRESS: "0x000000000000000000000000000000000000dEaD",
        },
        d1Databases: { REGISTRY: "registry" },
      },
    }),
  ],
});
