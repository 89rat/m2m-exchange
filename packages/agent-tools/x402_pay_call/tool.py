"""pay_and_call: search → deterministic policy gate → paid call instructions."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx

ATLAS = "https://atlas.code402.dev"


@dataclass
class AtlasClient:
    base_url: str = ATLAS
    timeout: float = 15.0

    def search(self, q: str, price_max_usd: float | None = None, alive_only: bool = True) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"q": q, "limit": 10, "alive_only": str(alive_only).lower()}
        if price_max_usd is not None:
            params["price_max_usd"] = price_max_usd
        r = httpx.get(f"{self.base_url}/v1/search", params=params, timeout=self.timeout)
        r.raise_for_status()
        return r.json()["results"]

    def plan(self, endpoint_url: str, budget_usd: float | None = None,
             price_ceiling_usd: float | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"endpoint_url": endpoint_url}
        if budget_usd is not None:
            body["budget_usd"] = budget_usd
        if price_ceiling_usd is not None:
            body["price_ceiling_usd"] = price_ceiling_usd
        r = httpx.post(f"{self.base_url}/v1/plan", json=body, timeout=self.timeout)
        r.raise_for_status()
        return r.json()


class PayAndCallTool:
    """LangChain/CrewAI-compatible tool: search, gate, and pay instructions.

    Usage as a plain tool::

        tool = PayAndCallTool(budget_usd=5.0, price_ceiling_usd=0.05)
        print(tool._run("web search"))

    Wrap for your framework::

        from langchain.tools import Tool
        lc_tool = Tool(name="pay_and_call", func=tool._run,
                       description="Find and price machine-payable APIs; safe to spend within budget")
    """

    def __init__(self, budget_usd: float | None = None, price_ceiling_usd: float | None = None,
                 client: AtlasClient | None = None):
        self.budget_usd = budget_usd
        self.price_ceiling_usd = price_ceiling_usd
        self.client = client or AtlasClient()

    def _run(self, query: str) -> str:
        results = self.client.search(query, price_max_usd=self.price_ceiling_usd)
        if not results:
            return json.dumps({"error": "NO_RESULTS", "query": query})
        out = []
        for hit in results[:5]:
            plan = self.client.plan(hit["baseUrl"] + hit["endpointPath"], self.budget_usd, self.price_ceiling_usd)
            if plan.get("decision") == "ACCEPT":
                out.append({
                    "decision": "ACCEPT", "endpoint": hit["baseUrl"] + hit["endpointPath"],
                    "price_usd": plan["terms"]["price_usd"], "summary": plan["human_summary"],
                    "pay": "send request -> 402 -> sign EIP-3009 -> retry with X-PAYMENT",
                })
        return json.dumps({"query": query, "cleared": out} if out else
                          {"query": query, "cleared": [], "note": "nothing passed the policy gate"})
