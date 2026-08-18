import type { Bindings } from "./src/index";

declare global {
  namespace Cloudflare {
    // Bindings available to tests via `env` from "cloudflare:test".
    interface Env extends Bindings {}
  }
}

export {};
