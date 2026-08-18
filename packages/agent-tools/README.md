# x402-pay-call — `pay_and_call` for AI agents

Search 209+ machine-payable APIs (probe-verified prices), gate every purchase
through a deterministic policy check (ACCEPT/REJECT/ESCALATE), then pay per call
via x402 (HTTP 402 / EIP-3009 USDC). No LLM in the money path.

```python
from x402_pay_call import PayAndCallTool
tool = PayAndCallTool(budget_usd=5.0)
print(tool._run("web search"))
```

LangChain: wrap `tool._run` in `Tool(...)`. CrewAI: `Tool(name="pay_and_call", func=tool._run, ...)`.

- Index: https://atlas.code402.dev · MCP: `atlas.code402.dev/mcp`
- Protocol: https://github.com/89rat/m2m-exchange
