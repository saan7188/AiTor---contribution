import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchPolymarketEvents() {
  const res = await fetch(
    "https://gamma-api.polymarket.com/events?closed=false&limit=30&active=true&order=volume24hr&ascending=false",
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) },
  );
  if (!res.ok) throw new Error(`Polymarket API error: ${res.status}`);
  const events = await res.json();
  if (!Array.isArray(events)) throw new Error("Polymarket returned an unexpected event payload");

  return events.map((event: any) => {
    // Keep every market in an event; taking only markets[0] silently discarded
    // multi-market events and most outcome-level data.
    const markets = (Array.isArray(event.markets) ? event.markets : []).map((market: any) => {
      const outcomes = parseArray(market?.outcomes).map(String);
      const prices = parseArray(market?.outcomePrices);
      const tokenIds = parseArray(market?.clobTokenIds);
      const outcomeRows = outcomes.map((name, index) => ({
        name,
        price: finiteNumber(prices[index]),
        // Gamma does not guarantee a per-outcome 24h change field on every
        // market. Return null rather than manufacturing a change value.
        priceChange24h: finiteNumber(
          Array.isArray(market?.oneDayPriceChanges)
            ? market.oneDayPriceChanges[index]
            : parseArray(market?.oneDayPriceChanges)[index],
        ),
        tokenId: typeof tokenIds[index] === "string" ? tokenIds[index] : null,
      }));
      const bestBid = finiteNumber(market?.bestBid);
      const bestAsk = finiteNumber(market?.bestAsk);
      return {
        id: String(market?.id ?? ""),
        question: String(market?.question ?? event?.title ?? "Untitled market"),
        slug: market?.slug ?? null,
        outcomes: outcomeRows,
        liquidity: finiteNumber(market?.liquidity),
        volume24hr: finiteNumber(market?.volume24hr),
        totalVolume: finiteNumber(market?.volume),
        bestBid,
        bestAsk,
        spread: bestBid !== null && bestAsk !== null ? Number((bestAsk - bestBid).toFixed(4)) : null,
        endDate: market?.endDate ?? event?.endDate ?? null,
        closed: Boolean(market?.closed),
      };
    });

    const primary = markets[0];
    return {
      id: String(event?.id ?? ""),
      title: String(event?.title ?? "Unknown Event"),
      description: String(event?.description ?? "").slice(0, 200),
      category: event?.tag ?? event?.category ?? "General",
      // Backward-compatible fields for existing consumers.
      outcomes: primary?.outcomes.map((row: any) => row.name) ?? [],
      outcomePrices: primary?.outcomes.map((row: any) => row.price) ?? [],
      liquidity: primary?.liquidity ?? null,
      volume24hr: primary?.volume24hr ?? null,
      totalVolume: primary?.totalVolume ?? null,
      bestBid: primary?.bestBid ?? null,
      bestAsk: primary?.bestAsk ?? null,
      spread: primary?.spread ?? null,
      markets,
      endDate: event?.endDate ?? null,
      image: event?.image ?? null,
      slug: event?.slug ?? null,
      source: "polymarket",
    };
  });
}

async function fetchCoinGeckoTrending() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/search/trending");
    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
    const data = await res.json();
    return (data.coins || []).map((c: any) => ({
      id: c.item?.id || crypto.randomUUID(),
      title: `${c.item?.name} (${c.item?.symbol?.toUpperCase()})`,
      description: `Rank #${c.item?.market_cap_rank || "?"} — trending on CoinGecko`,
      category: "Crypto",
      price: c.item?.data?.price,
      priceChange24h: c.item?.data?.price_change_percentage_24h?.usd,
      sparkline: c.item?.data?.sparkline,
      image: c.item?.thumb || c.item?.small,
      marketCap: c.item?.data?.market_cap,
      volume: c.item?.data?.total_volume,
      source: "coingecko",
    }));
  } catch (e) {
    console.error("CoinGecko fetch error:", e);
    return [];
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "all";

    let result: any = {};

    if (action === "polymarket" || action === "all") {
      result.polymarket = await fetchPolymarketEvents();
    }
    if (action === "trending" || action === "all") {
      result.trending = await fetchCoinGeckoTrending();
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("crypto-signals error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
