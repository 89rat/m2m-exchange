/**
 * code402.dev root landing page.
 *
 * Positioning (see STRATEGY.md + the x402 assay): sell the seller OUTCOME
 * (revenue ops: listing, metering, receipts, invoicing, payout direct to the
 * seller's wallet) — never the payment rail itself, which is a free commodity.
 * One conversion goal: POST /v1/sellers. Everything else routes or reassures.
 */

const GATEWAY = "https://gateway.code402.dev";
const ATLAS = "https://atlas.code402.dev";
const GITHUB = "https://github.com/89rat/m2m-exchange";

export function landingHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>code402 — turn any API into agent revenue</title>
<meta name="description" content="List your API in 60 seconds. AI agents pay per call in USDC over x402 — settled on Base, direct to your wallet, non-custodial. Verified discovery, receipts, and invoicing included.">
<link rel="canonical" href="https://code402.dev/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebSite","name":"code402","url":"https://code402.dev/","description":"Machine-to-machine commerce: sell any API to AI agents over x402, non-custodial, on the open M2M/1 protocol."}
</script>
<style>
  :root{
    --ground:#0D1210; --raised:#141B17; --raised2:#1A231E;
    --text:#E8EDE9; --muted:#95A59B; --faint:#5F6F66;
    --green:#3FCB8B; --green-dim:rgba(63,203,139,.12);
    --amber:#E3AC3A; --amber-dim:rgba(227,172,58,.12);
    --rule:#25302A;
    --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--ground);color:var(--text);font-family:var(--sans);font-size:16.5px;line-height:1.6;-webkit-font-smoothing:antialiased}
  a{color:var(--green);text-decoration:none}
  a:hover{text-decoration:underline;text-underline-offset:3px}
  a:focus-visible,button:focus-visible{outline:2px solid var(--green);outline-offset:2px}
  .wrap{max-width:66rem;margin:0 auto;padding:0 1.4rem}
  code,pre{font-family:var(--mono)}
  h1,h2,h3{text-wrap:balance}
  h2{font-family:var(--mono);font-size:1.35rem;font-weight:600;letter-spacing:-.01em;margin:0 0 .4rem}
  .eyebrow{font-family:var(--mono);font-size:.72rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--amber)}
  section{padding:3.4rem 0;border-top:1px solid var(--rule)}
  .lede{color:var(--muted);max-width:44rem;margin:.3rem 0 1.6rem}

  /* nav */
  nav{display:flex;align-items:center;gap:1.6rem;padding:1.1rem 0;flex-wrap:wrap}
  nav .brand{font-family:var(--mono);font-weight:700;font-size:1.05rem;color:var(--text)}
  nav .brand b{color:var(--amber)}
  nav a.item{color:var(--muted);font-size:.9rem}
  nav .spacer{flex:1}
  .btn{display:inline-block;font-family:var(--mono);font-size:.88rem;font-weight:600;padding:.55rem 1.1rem;border-radius:6px;border:1px solid var(--rule)}
  .btn.primary{background:var(--green);color:#08120D;border-color:var(--green)}
  .btn.primary:hover{text-decoration:none;filter:brightness(1.08)}
  .btn.ghost{color:var(--text)}
  .btn.ghost:hover{text-decoration:none;border-color:var(--green)}

  /* hero */
  .hero{display:grid;grid-template-columns:1.05fr .95fr;gap:3rem;align-items:center;padding:3.6rem 0 3.2rem}
  .hero h1{font-size:clamp(2rem,4.6vw,3.1rem);line-height:1.12;font-weight:700;letter-spacing:-.02em;margin:.7rem 0 1rem}
  .hero h1 em{font-style:normal;color:var(--green)}
  .hero p.sub{color:var(--muted);font-size:1.08rem;max-width:32rem;margin:0 0 1.6rem}
  .hero .ctas{display:flex;gap:.8rem;flex-wrap:wrap}

  /* terminal */
  .term{background:#0A0F0C;border:1px solid var(--rule);border-radius:10px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.4)}
  .term .bar{display:flex;gap:.4rem;padding:.6rem .9rem;border-bottom:1px solid var(--rule)}
  .term .bar i{width:.65rem;height:.65rem;border-radius:50%;background:var(--rule);display:block}
  .term pre{margin:0;padding:1rem 1.1rem;font-size:.78rem;line-height:1.75;overflow-x:auto}
  .t-cmd{color:var(--text)} .t-dim{color:var(--faint)} .t-402{color:var(--amber);font-weight:600} .t-ok{color:var(--green);font-weight:600}

  /* live strip */
  .live{display:flex;gap:2.4rem;flex-wrap:wrap;padding:1.1rem 1.4rem;background:var(--raised);border:1px solid var(--rule);border-radius:10px;margin-top:-1rem}
  .live div b{display:block;font-family:var(--mono);font-size:1.25rem;font-variant-numeric:tabular-nums}
  .live div span{font-size:.76rem;color:var(--faint);text-transform:uppercase;letter-spacing:.1em;font-family:var(--mono)}
  .dot{display:inline-block;width:.55rem;height:.55rem;border-radius:50%;background:var(--faint);margin-right:.4rem;vertical-align:baseline}
  .dot.up{background:var(--green)}

  /* doors */
  .doors{display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:1rem;margin-top:1.6rem}
  .door{background:var(--raised);border:1px solid var(--rule);border-radius:10px;padding:1.3rem 1.4rem;display:flex;flex-direction:column;gap:.5rem}
  .door h3{font-family:var(--mono);font-size:1rem;margin:0}
  .door p{margin:0;color:var(--muted);font-size:.92rem;flex:1}
  .door a{font-family:var(--mono);font-size:.85rem}

  /* steps */
  .step{display:grid;grid-template-columns:2.6rem 1fr;gap:1rem;margin-top:1.6rem}
  .step .n{font-family:var(--mono);font-weight:700;font-size:1.3rem;color:var(--amber)}
  .step h3{font-family:var(--mono);font-size:1rem;margin:0 0 .4rem}
  .step p{margin:.5rem 0 0;color:var(--muted);font-size:.92rem;max-width:42rem}
  .snippet{background:#0A0F0C;border:1px solid var(--rule);border-radius:8px;padding:.85rem 1rem;font-size:.78rem;line-height:1.7;overflow-x:auto;margin:.4rem 0 0}
  .snippet code{white-space:pre}

  /* pricing */
  .tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1rem;margin-top:1.6rem}
  .tier{background:var(--raised);border:1px solid var(--rule);border-radius:10px;padding:1.3rem 1.4rem}
  .tier.pro{border-color:var(--green)}
  .tier h3{font-family:var(--mono);font-size:.95rem;margin:0}
  .tier .rate{font-family:var(--mono);font-size:1.7rem;font-weight:700;margin:.5rem 0}
  .tier .rate small{font-size:.85rem;font-weight:400;color:var(--muted)}
  .tier ul{margin:.6rem 0 0;padding-left:1.1rem;color:var(--muted);font-size:.88rem}
  .tier li{margin:.25rem 0}

  /* laws */
  .laws{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1rem;margin-top:1.6rem}
  .law{border-left:3px solid var(--green);background:var(--green-dim);padding:.9rem 1.1rem;border-radius:0 8px 8px 0}
  .law b{font-family:var(--mono);font-size:.9rem;display:block;margin-bottom:.2rem}
  .law p{margin:0;font-size:.86rem;color:var(--muted)}

  footer{border-top:1px solid var(--rule);padding:2.4rem 0 3.5rem;margin-top:3.4rem}
  footer .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:1.6rem}
  footer h4{font-family:var(--mono);font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin:0 0 .6rem}
  footer ul{list-style:none;margin:0;padding:0}
  footer li{margin:.3rem 0;font-size:.88rem}
  footer a{color:var(--muted)} footer a:hover{color:var(--green)}
  footer .fine{margin-top:2rem;font-size:.78rem;color:var(--faint);max-width:46rem}

  @media (max-width:820px){ .hero{grid-template-columns:1fr;gap:2rem} }
</style>
</head>
<body>
<div class="wrap">

<nav>
  <span class="brand">code<b>402</b></span>
  <a class="item" href="#sell">Sell</a>
  <a class="item" href="${ATLAS}">Directory</a>
  <a class="item" href="#trust">Trust</a>
  <a class="item" href="${GITHUB}">Protocol</a>
  <span class="spacer"></span>
  <a class="btn primary" href="#sell">Start selling</a>
</nav>

<div class="hero">
  <div>
    <span class="eyebrow">HTTP/1.1 402 Payment Required</span>
    <h1>Turn any API into <em>agent revenue</em>.</h1>
    <p class="sub">List your endpoint in 60 seconds. AI agents discover it, pay per call in USDC, and every payment settles directly to <b>your</b> wallet. We route, meter, and attest — we never hold your money.</p>
    <div class="ctas">
      <a class="btn primary" href="#sell">Start selling →</a>
      <a class="btn ghost" href="${ATLAS}">Browse the verified directory</a>
    </div>
  </div>
  <div class="term" aria-label="Example x402 payment flow">
    <div class="bar"><i></i><i></i><i></i></div>
    <pre><span class="t-dim">$</span> <span class="t-cmd">curl ${GATEWAY}/s/acme/lookup</span>
<span class="t-402">HTTP/1.1 402 Payment Required</span>
<span class="t-dim">{ "accepts": [{ "scheme": "exact", "network": "base",
    "maxAmountRequired": "50000", "payTo": "0xacme…" }] }</span>

<span class="t-dim">$</span> <span class="t-cmd">curl -H "X-PAYMENT: &lt;signed EIP-3009&gt;" …/s/acme/lookup</span>
<span class="t-ok">HTTP/1.1 200 OK</span>
<span class="t-dim">X-PAYMENT-RESPONSE: { "payer": "0xagent…", "transaction": "0x…" }
{ "data": { … }, "receipt": { "price": "$0.05", "settledAt": … } }</span></pre>
  </div>
</div>

<div class="live" id="live">
  <div><b><span class="dot" id="gw-dot"></span><span id="gw-status">checking…</span></b><span>gateway</span></div>
  <div><b id="svc-count">—</b><span>services listed</span></div>
  <div><b id="settled-count">—</b><span>settled payments</span></div>
  <div><b id="net">—</b><span>settlement network</span></div>
  <div><b style="color:var(--green)">0%</b><span>custody of your funds</span></div>
</div>

<section id="sell">
  <span class="eyebrow">Sell</span>
  <h2>Three requests to your first paid call</h2>
  <p class="lede">No signup form, no dashboard required, no keys held by us. Register a wallet, point us at your upstream, and the paywall, metering, receipts, and monthly invoice are handled.</p>

  <div class="step">
    <div class="n">1</div>
    <div>
      <h3>Register your seller id + wallet</h3>
      <div class="snippet"><code>curl -X POST ${GATEWAY}/v1/sellers \\
  -H 'content-type: application/json' \\
  -d '{"id":"acme","wallet":"0xYourWallet","name":"Acme Data API"}'</code></div>
      <p>Prove wallet ownership any time with an EIP-191 signature (<code>POST /v1/sellers/acme/verify-challenge</code>) to earn the verified badge.</p>
    </div>
  </div>

  <div class="step">
    <div class="n">2</div>
    <div>
      <h3>List an endpoint with a price</h3>
      <div class="snippet"><code>curl -X POST ${GATEWAY}/v1/sellers/acme/services \\
  -H 'content-type: application/json' \\
  -d '{"serviceId":"lookup","upstream_url":"https://api.acme.com/lookup","price_usd":"$0.05"}'</code></div>
      <p>Your service goes live at <code>/s/acme/lookup</code> and appears in the machine storefront (<code>GET /v1/services</code>), the estate manifest, and <code>llms.txt</code> — where agents actually look.</p>
    </div>
  </div>

  <div class="step">
    <div class="n">3</div>
    <div>
      <h3>Get paid — and see everything</h3>
      <div class="snippet"><code>curl ${GATEWAY}/v1/sellers/acme/analytics   # calls, gross, unique buyers — free, forever
curl ${GATEWAY}/v1/sellers/acme/invoice     # settled receipts × your tier's fee</code></div>
      <p>Every settled call writes a durable receipt (timestamp, payer, tx hash). Receipts are your books, your reputation, and our invoice basis — nothing is sampled, nothing is dropped.</p>
    </div>
  </div>
</section>

<section id="pricing">
  <span class="eyebrow">Pricing</span>
  <h2>Buyers always ride free. Sellers pay when they earn.</h2>
  <p class="lede">No fee on top of the payment rail itself — the 2% is invoiced monthly against settled receipts, not skimmed in-flight. Your money never routes through us.</p>
  <div class="tiers">
    <div class="tier">
      <h3>Free</h3>
      <div class="rate">2%<small> of settled volume</small></div>
      <ul><li>Unlimited listings</li><li>Receipts + analytics included</li><li>Machine storefront + llms.txt placement</li></ul>
    </div>
    <div class="tier pro">
      <h3>Pro</h3>
      <div class="rate">1.5%<small> + $29/mo</small></div>
      <ul><li>Everything in Free</li><li>Lower take-rate from the first call</li><li>Priority placement eligibility</li></ul>
    </div>
    <div class="tier">
      <h3>Enterprise</h3>
      <div class="rate">Custom</div>
      <ul><li>Counterparty screening posture</li><li>Audit exports + daily reconciliation</li><li>SLA</li></ul>
    </div>
  </div>
</section>

<section id="find">
  <span class="eyebrow">Find</span>
  <h2>A directory where everything is actually alive</h2>
  <p class="lede">Most x402 indexes are graveyards — across the ecosystem, roughly 4 in 5 listed routes fail a live check. Atlas probes every listing on a schedule and shows its verification state, so an agent budgeting real money never pays a dead endpoint.</p>
  <div class="doors">
    <div class="door"><h3>atlas.code402.dev</h3><p>Human-browsable directory of machine-payable services, each with a liveness badge and last-probed timestamp.</p><a href="${ATLAS}">Browse →</a></div>
    <div class="door"><h3>/directory.md + MCP</h3><p>The same directory as agent-readable markdown and an MCP server your agent can query (and pay through) directly.</p><a href="${ATLAS}/directory.md">directory.md →</a></div>
    <div class="door"><h3>GET /v1/services</h3><p>The raw machine storefront on the gateway: M2M/1 ServiceDescriptors with integer-unit USDC pricing.</p><a href="${GATEWAY}/v1/services">v1/services →</a></div>
  </div>
</section>

<section id="trust">
  <span class="eyebrow">Trust</span>
  <h2>The rules we can't break — by design</h2>
  <p class="lede">Agent commerce fails on trust before it fails on payments. These are structural properties of the platform, not policies.</p>
  <div class="laws">
    <div class="law"><b>Never custodial</b><p>Buyer USDC settles on-chain directly to the seller's wallet (payTo is yours). There is no platform balance to freeze, lose, or run away with.</p></div>
    <div class="law"><b>Receipts are never dropped</b><p>Financial state transitions are awaited, not fire-and-forget. Every settled call has a durable receipt with payer and tx hash.</p></div>
    <div class="law"><b>Sellers are verifiable</b><p>EIP-191 challenge/response proves wallet ownership. Verified sellers are labeled; unverified ones are visibly unverified.</p></div>
    <div class="law"><b>Mainnet means discipline</b><p>Real-money operation sits behind a published gate: hardware keys, screening plan, daily receipts-vs-chain reconciliation. No exceptions.</p></div>
  </div>
</section>

<footer>
  <div class="cols">
    <div><h4>For machines</h4><ul>
      <li><a href="${GATEWAY}/v1/services">GET /v1/services</a></li>
      <li><a href="${GATEWAY}/.well-known/x402.json">.well-known/x402.json</a></li>
      <li><a href="${GATEWAY}/llms.txt">llms.txt</a></li>
      <li><a href="${ATLAS}/mcp">MCP endpoint</a></li>
    </ul></div>
    <div><h4>For sellers</h4><ul>
      <li><a href="${GATEWAY}/v1/sellers">Registration guide</a></li>
      <li><a href="#pricing">Pricing</a></li>
      <li><a href="${ATLAS}/sellers/claim">Claim your profile</a></li>
    </ul></div>
    <div><h4>Protocol</h4><ul>
      <li><a href="${GITHUB}">M2M/1 spec + source (GitHub)</a></li>
      <li><a href="${GITHUB}/blob/main/protocol/PROTOCOL.md">PROTOCOL.md</a></li>
      <li><a href="https://x402.org">x402.org</a></li>
    </ul></div>
  </div>
  <p class="fine">code402 is an open commerce layer on the x402 payment protocol (HTTP 402 + USDC). The M2M/1 spec is free and open; the platform monetizes sellers only. Currently settling on Base Sepolia (testnet) — mainnet flips behind the published gate.</p>
  <p class="fine">Operated by JUANA LIMITED, a company registered in England &amp; Wales (Company No. 14043409). Registered office: Unit 7, Edison Building, Electric Wharf, Coventry, CV1 4JA, United Kingdom.</p>
</footer>

</div>
<script>
(function () {
  var gw = ${JSON.stringify(GATEWAY)};
  function txt(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  fetch(gw + "/healthz").then(function (r) { return r.json(); }).then(function (h) {
    txt("gw-status", "live"); txt("net", h.network || "base");
    var d = document.getElementById("gw-dot"); if (d) d.className = "dot up";
  }).catch(function () { txt("gw-status", "unreachable"); });
  fetch(gw + "/v1/services").then(function (r) { return r.json(); }).then(function (s) {
    txt("svc-count", String((s.services || []).length));
  }).catch(function () {});
  fetch(gw + "/v1/stats").then(function (r) { return r.json(); }).then(function (s) {
    if (typeof s.total_settled_calls === "number") txt("settled-count", s.total_settled_calls.toLocaleString());
  }).catch(function () {});
})();
</script>
</body>
</html>
`;
}

/** Root-domain llms.txt: routes LLM crawlers across the estate. */
export function llmsTxt(): string {
  return [
    "# code402 — machine-to-machine commerce on x402",
    "> Sell any API to AI agents: per-call USDC over x402 (HTTP 402), settled direct to the seller wallet, non-custodial. Open M2M/1 protocol.",
    "",
    `- [Machine storefront](${GATEWAY}/v1/services): M2M/1 ServiceDescriptors for every payable service`,
    `- [Sell your API](${GATEWAY}/v1/sellers): POST {id, wallet, name}, then list services with a price — payments go direct to your wallet`,
    `- [Verified directory](${ATLAS}): liveness-probed listings; agent-readable at ${ATLAS}/directory.md; MCP at ${ATLAS}/mcp`,
    `- [Estate manifest](${GATEWAY}/.well-known/x402.json): x402-native self-description`,
    `- [Protocol spec](${GITHUB}): M2M/1 (state machine, messages, fees) — free and open`,
    "",
    "Pay: plain HTTP request -> 402 challenge -> retry with X-PAYMENT (EIP-3009 USDC).",
  ].join("\n");
}

/** Root-domain x402 self-manifest (mirrors the gateway's, from the estate root). */
export function x402Manifest(): Record<string, string> {
  return {
    name: "code402",
    description:
      "Open M2M/1 commerce estate on x402: gateway (sell any API to agents, non-custodial), verified discovery (atlas), free protocol spec.",
    operator: "JUANA LIMITED (England & Wales, Company No. 14043409), Unit 7, Edison Building, Electric Wharf, Coventry, CV1 4JA, UK",
    gateway: GATEWAY,
    services: `${GATEWAY}/v1/services`,
    sellers_api: `${GATEWAY}/v1/sellers`,
    discovery_index: ATLAS,
    directory: `${ATLAS}/directory.md`,
    protocol: GITHUB,
  };
}
