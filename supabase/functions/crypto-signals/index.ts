import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";

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

async function fetchJson(url: string, timeoutMs = 12_000) {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function fetchPolymarketEvents() {
  const events = await fetchJson(
    `${GAMMA_API}/events?closed=false&limit=30&active=true&order=volume24hr&ascending=false`,
  );
  if (!Array.isArray(events)) throw new Error("Polymarket returned an unexpected event payload");

  return events.map((event: any) => {
    const markets = (Array.isArray(event.markets) ? event.markets : []).map((market: any) => {
      const outcomes = parseArray(market?.outcomes).map(String);
      const prices = parseArray(market?.outcomePrices);
      const tokenIds = parseArray(market?.clobTokenIds);

      const outcomeRows = outcomes.map((name, index) => ({
        name,
        price: finiteNumber(prices[index]),
        // Outcome-level 24h changes are populated by the dedicated history action.
        // Never manufacture a change from an unrelated event-level value.
        priceChange24h: null,
        tokenId: typeof tokenIds[index] === "string" ? tokenIds[index] : null,
      }));

      const bestBid = finiteNumber(market?.bestBid);
      const bestAsk = finiteNumber(market?.bestAsk);

      return {
        id: String(market?.id ?? ""),
        conditionId: market?.conditionId ?? null,
        question: String(market?.question ?? event?.title ?? "Untitled market"),
        slug: market?.slug ?? null,
        outcomes: outcomeRows,
        liquidity: finiteNumber(market?.liquidityNum ?? market?.liquidity),
        volume24hr: finiteNumber(market?.volume24hr),
        totalVolume: finiteNumber(market?.volumeNum ?? market?.volume),
        bestBid,
        bestAsk,
        lastTradePrice: finiteNumber(market?.lastTradePrice),
        spread: bestBid !== null && bestAsk !== null
          ? Number((bestAsk - bestBid).toFixed(4))
          : finiteNumber(market?.spread),
        oneDayPriceChange: finiteNumber(market?.oneDayPriceChange),
        endDate: market?.endDate ?? event?.endDate ?? null,
        closed: Boolean(market?.closed),
        active: Boolean(market?.active),
        acceptingOrders: Boolean(market?.acceptingOrders),
        enableOrderBook: Boolean(market?.enableOrderBook),
        negRisk: Boolean(market?.negRisk),
        resolutionSource: market?.resolutionSource ?? null,
      };
    });

    const primary = markets[0];

    return {
      id: String(event?.id ?? ""),
      title: String(event?.title ?? "Unknown Event"),
      description: String(event?.description ?? "").slice(0, 300),
      category: event?.tag ?? event?.category ?? event?.tags?.[0]?.label ?? "General",
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

async function fetchTokenHistory(tokenId: string) {
  try {
    const payload = await fetchJson(
      `${CLOB_API}/prices-history?market=${encodeURIComponent(tokenId)}&interval=1d&fidelity=60`,
      7_000,
    );

    const rawHistory = Array.isArray(payload?.history) ? payload.history : [];
    const history = rawHistory
      .map((point: any) => ({
        t: finiteNumber(point?.t),
        p: finiteNumber(point?.p),
      }))
      .filter((point: { t: number | null; p: number | null }) => point.t !== null && point.p !== null)
      .slice(-48);

    if (history.length < 2) {
      return { tokenId, points: history, change24h: null };
    }

    const first = history[0].p as number;
    const last = history[history.length - 1].p as number;

    return {
      tokenId,
      points: history,
      change24h: Number((last - first).toFixed(6)),
    };
  } catch (error) {
    console.warn(`Polymarket history unavailable for token ${tokenId}:`, error);
    return { tokenId, points: [], change24h: null };
  }
}

async function fetchPolymarketHistory(tokenIds: unknown) {
  const ids = Array.from(new Set(
    Array.isArray(tokenIds)
      ? tokenIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [],
  )).slice(0, 80);

  // CLOB history is public read-only data. Batch the browser request while
  // keeping upstream concurrency bounded so one slow token does not block all data.
  const results: Record<string, { points: Array<{ t: number; p: number }>; change24h: number | null }> = {};

  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const rows = await Promise.all(batch.map(fetchTokenHistory));
    rows.forEach((row) => {
      results[row.tokenId] = {
        points: row.points,
        change24h: row.change24h,
      };
    });
  }

  return results;
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

    if (action === "polymarket-history") {
      result.history = await fetchPolymarketHistory(body.tokenIds);
    }

    if (action === "all" || action === "trending") {
      result.trending = await fetchCoinGeckoTrending();
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("crypto-signals error:", e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
