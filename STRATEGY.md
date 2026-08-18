# THE BLUEPRINT: Own the payment layer of the machine economy

## The thesis (memorize this)

Within 5 years, most economic transactions will be initiated by software, not humans. Every one of those transactions needs a neutral, programmable, instant settlement rail. The card networks can't serve it (wrong economics), the megacorps can't be trusted to stay neutral (wrong incentives), and crypto alone can't serve it (no commerce semantics). **Whoever writes the protocol and runs the neutral registry becomes the Visa of the agent economy.** We're early enough to claim it, small enough to be neutral, and technical enough to prove it.

## The position to own

Not "an x402 project." Not "a crypto payment API." The position is:

> **The open, neutral commerce protocol for machines — any agent, any seller, any rail.**

Three words do the work: **open** (spec is free), **neutral** (no megacorp landlord), **protocol** (the standard, not a vendor).

## The five horizons

**H1 — Prove (now → month 2).** ✅ partially done
Live storefront on `gateway.code402.dev`, tiered pricing, discovery, take-rate engine tested. Remaining: public repo, D1 receipts persistence, first strangers transacting. *Metric: weekly stranger transactions > 0.*

**H2 — Real money (month 2–4).**
Mainnet gate passed (hardware keys, screening, legal opinion), first real dollar, 30 net-positive days, prepaid credits live (which is also the netting embryo). *Metric: revenue > costs, 30 days straight.*

**H3 — Two-sided (month 4–8).**
Self-serve seller onboarding, dynamic per-seller payTo, invoice take-rate live, invitation payloads in receipts, 5+ third-party sellers, one framework integration conversation landed. *Metric: K-factor rising toward 1; sellers who found us without us.*

**H4 — The moat (month 8–14).**
Netting ledger live (gas costs collapse → we undercut everyone), reputation graph productized (agent credit scores), splitter contract automating fees. *Metric: gas/call down 80%; enterprises paying for compliance tier.*

**H5 — The standard (year 2+).**
Multi-rail (x402 + AP2 + cards + chains under one M2M/1 roof), B2B physical procurement with escrow, agent credit lines on the reputation graph, the spec in every framework's docs and every LLM's context. *Metric: M2M/1 cited by projects we don't control; $B GMV run rate.*

## The four compounding assets (the real company)

Everything built must feed one of these; anything that feeds none is a distraction:

1. **The protocol (M2M/1)** — free, open, the Schelling point. Appreciates via adoption.
2. **The registry** — who sells what. Appreciates via liquidity.
3. **The reputation graph** — every receipt, forever. Appreciates via time; cannot be backfilled or forked. **This is the crown jewel.**
4. **The netting infrastructure** — cost advantage nobody can copy without rebuilding. Appreciates via volume.

## The moat stack (each horizon adds a layer competitors must cross)

```
H5  agent credit + treasury        ← decades to replicate (regulatory + data)
H4  reputation graph + netting     ← years to replicate (accumulated data)
H3  two-sided liquidity            ← months to replicate (network effects)
H2  compliant mainnet operation    ← months to replicate (legal + trust)
H1  working code + open spec       ← weeks to replicate (speed)
```

Incumbents start at the bottom of this stack every time they try to enter. We're climbing it now.

## The five numbers that run the company

Review weekly. When one stalls 3 weeks, that's where the problem is:

1. **Stranger transactions/week** (is it real?)
2. **GMV mix** — % of volume above $1/tx (are we moving up the value stack?)
3. **K-factor** (is it spreading?)
4. **Net revenue days** (is it a business?)
5. **Take-rate integrity** — fees collected / fees owed (are sellers honest?)

## The revenue streams, in activation order

| # | Stream | Mechanism | Status |
|---|---|---|---|
| 1 | Transaction take-rate | 2% invoice model → splitter contract later | ✅ invoice endpoint live |
| 2 | Seller tiers | Free 2% / Pro $29/mo 1.5% / Enterprise custom | ✅ tier switch live (billing at mainnet) |
| 3 | Registry placement | Promoted listing in /v1/services | ✅ ordering live (self-serve purchase later) |
| 4 | Reputation data API | Counterparty scores from the receipts graph | indexer build |
| 5 | Enterprise compliance tier | Screening, audit exports, SLA | first enterprise pilot |
| 6 | Netting-as-a-service | Share of gas savings | P2 ledger |
| 7 | Conformance certification | "M2M/1 Certified" | standard adopters |

Unit economics truth: **micropayments prove the rail; monetization lives at $1–$500/transaction.** 1M calls/day @ $0.005 = $36k/yr (hobby). 10k calls/day @ $5 = $365k/yr (business). 10k procurement tx/day @ $150 = $30k/day (unicorn shape). Court the value stack.

## The laws (never break, no matter the temptation)

1. **Never custody funds.** Payment channels and invoices, not balances.
2. **Buyers always ride free.** Monetize sellers only.
3. **The spec is never the product.** Open standard, proprietary registry + reputation + infrastructure.
4. **Stay cheap until H3.** Burn < $500/mo; optionality outlasts funded competitors.
5. **Mainnet means mainnet discipline.** No exceptions to the safety checklist.

## The honest odds

Execute H1–H3 flawlessly → most likely a profitable infrastructure business. "Big" requires the agent-economy wave to break — which we don't control. If it breaks, we're the default rail; if it ripples, we're still profitable; if it never comes, we lost months, not years. That's the best deal mathematics offers.

## Next actions

1. **Public repo** (secrets-audited ✅) + Foundation proposal for M2M/1 discovery extension
2. **Settlement indexer v1** — first-party Base settlement data (the reputation-graph file starts now)
3. **Mainnet gate** — hardware keys, screening, legal opinion; then the first real invoice
