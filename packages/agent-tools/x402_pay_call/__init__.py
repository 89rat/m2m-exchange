"""
x402-pay-call: the `pay_and_call` capability for AI agents.

Three deterministic steps, no LLM in the decision path:
  1. SEARCH  — find machine-payable endpoints (Atlas, 209+ verified services)
  2. PLAN    — deterministic purchase gate: ACCEPT / REJECT / ESCALATE
  3. CALL    — hit the endpoint; a 402 challenge returns machine-readable
               payment terms for the caller's x402 wallet to sign (EIP-3009)

Designed as a LangChain/CrewAI tool:

    from x402_pay_call import PayAndCallTool
    tool = PayAndCallTool()                 # or PayAndCallTool(budget_usd=5.0)
    results = tool.search("web search")     # step 1+2 combined, safe for agents
"""

from .tool import PayAndCallTool, AtlasClient

__all__ = ["PayAndCallTool", "AtlasClient"]
__version__ = "0.1.0"
