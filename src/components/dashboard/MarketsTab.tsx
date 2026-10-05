import { useState, useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, ExternalLink, Search, ChartBar as BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface HistoryPoint { t: number; p: number; }

interface Outcome {
  name: string;
  price: number | null;
  priceChange24h: number | null;
  tokenId: string | null;
}

interface Market {
  id: string;
  title: string;
  description: string;
  category: string;
  outcomes: string[] | null;
  outcomePrices: string[] | null;
  liquidity: number | null;
  volume24hr: number | null;
  totalVolume: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  endDate: string | null;
  image: string | null;
  slug: string | null;
  markets?: Array<{
    id: string;
    conditionId?: string | null;
    question: string;
    slug: string | null;
    outcomes: Outcome[];
    liquidity: number | null;
    volume24hr: number | null;
    totalVolume: number | null;
    bestBid: number | null;
    bestAsk: number | null;
    lastTradePrice?: number | null;
    spread: number | null;
    oneDayPriceChange?: number | null;
    endDate: string | null;
    closed: boolean;
    active?: boolean;
    acceptingOrders?: boolean;
    enableOrderBook?: boolean;
    negRisk?: boolean;
    resolutionSource?: string | null;
  }>;
}

const CATEGORIES = ["All", "Politics", "Crypto", "Sports", "Tech", "Culture", "World"];
const POLYMARKET_REF = "aitor";

const formatVolume = (n: number | null | undefined) => {
  const val = typeof n === "number" && Number.isFinite(n) ? n : 0;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
};

function Sparkline({ points }: { points?: HistoryPoint[] }) {
  if (!points || points.length < 2) {
    return <span className="text-[8px] font-mono text-muted-foreground/35">history unavailable</span>;
  }

  const min = Math.min(...points.map((p) => p.p));
  const max = Math.max(...points.map((p) => p.p));
  const range = Math.max(max - min, 0.0001);
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * 64;
    const y = 18 - ((p.p - min) / range) * 16;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg viewBox="0 0 64 20" className="w-16 h-5 shrink-0" aria-label="24 hour price history">
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function MarketsTab() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [history, setHistory] = useState<Record<string, { points: HistoryPoint[]; change24h: number | null }>>({});
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");

  const fetchHistory = async (events: Market[]) => {
    const tokenIds = events.flatMap((event) =>
      (event.markets || []).flatMap((market) => market.outcomes.map((outcome) => outcome.tokenId).filter(Boolean) as string[])
    );
    const unique = Array.from(new Set(tokenIds));
    if (!unique.length) return;

    const next: Record<string, { points: HistoryPoint[]; change24h: number | null }> = {};
    for (let i = 0; i < unique.length; i += 80) {
      const batch = unique.slice(i, i + 80);
      try {
        const { data, error } = await supabase.functions.invoke("crypto-signals", {
          body: { action: "polymarket-history", tokenIds: batch },
        });
        if (error) throw error;
        Object.assign(next, data?.history || {});
      } catch (error) {
        console.warn("Polymarket history batch failed:", error);
      }
    }
    setHistory(next);
  };

  const fetchMarkets = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("crypto-signals", {
        body: { action: "polymarket" },
      });
      if (error) throw error;
      const nextMarkets = data?.polymarket || [];
      setMarkets(nextMarkets);
      setHistory({});
      void fetchHistory(nextMarkets);
    } catch (e) {
      console.error(e);
      toast.error("Failed to fetch markets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchMarkets();
    const interval = setInterval(() => void fetchMarkets(), 60000);
    return () => clearInterval(interval);
  }, []);

  const filtered = useMemo(() => markets.filter((m) => {
    const matchCat = category === "All" || m.category?.toLowerCase().includes(category.toLowerCase());
    const matchSearch = !search || m.title.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  }), [markets, category, search]);

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-heading text-primary uppercase tracking-wider">Markets Browser</h2>
          <Badge variant="outline" className="text-[7px] font-mono border-secondary/30 text-secondary bg-secondary/5">LIVE</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => void fetchMarkets()} disabled={loading} className="h-7 text-[10px]">
          <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
        <Input
          placeholder="Search markets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 pl-8 text-xs bg-muted/20 border-border/30"
        />
      </div>

      <div className="flex gap-1 mb-4 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-3 py-1.5 text-[10px] font-heading uppercase tracking-wider rounded-full transition-all ${
              category === cat
                ? "bg-primary/20 text-primary border border-primary/30"
                : "text-muted-foreground/50 hover:text-foreground/70 border border-transparent hover:border-border/40"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && markets.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 text-primary animate-spin" />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((market) => {
            const nestedMarkets = market.markets?.length ? market.markets : [{
              id: market.id,
              question: market.title,
              slug: market.slug,
              outcomes: (market.outcomes || []).map((name, i) => ({
                name,
                price: market.outcomePrices?.[i] == null ? null : Number(market.outcomePrices[i]),
                priceChange24h: null,
                tokenId: null,
              })),
              liquidity: market.liquidity,
              volume24hr: market.volume24hr,
              totalVolume: market.totalVolume,
              bestBid: market.bestBid,
              bestAsk: market.bestAsk,
              spread: market.spread,
              endDate: market.endDate,
              closed: false,
              acceptingOrders: true,
            }];

            return (
              <div key={market.id} className="p-4 rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm hover:bg-card/50 hover:border-primary/20 transition-all flex flex-col">
                <div className="flex items-start gap-3 mb-3">
                  {market.image && <img src={market.image} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 border border-border/30" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground/90 line-clamp-2 leading-relaxed">{market.title}</p>
                    {market.category && <Badge variant="outline" className="text-[7px] px-1 py-0 h-3.5 font-mono border-border/30 text-muted-foreground/50 mt-1">{market.category}</Badge>}
                  </div>
                </div>

                <div className="space-y-3 mb-3">
                  {nestedMarkets.map((submarket) => (
                    <div key={submarket.id || submarket.question} className="rounded-lg border border-border/25 p-2.5">
                      {nestedMarkets.length > 1 && <p className="text-[10px] font-medium text-foreground/80 mb-2">{submarket.question}</p>}
                      <div className="space-y-2">
                        {submarket.outcomes.map((outcome, i) => {
                          const current = outcome.tokenId ? history[outcome.tokenId] : undefined;
                          const percent = outcome.price !== null ? Math.round(outcome.price * 100) : null;
                          const change = current?.change24h ?? outcome.priceChange24h;
                          return (
                            <div key={outcome.tokenId || outcome.name || i} className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] font-mono text-muted-foreground/70 w-16 truncate" title={outcome.name}>{outcome.name}</span>
                                <div className="flex-1 h-2.5 bg-muted/20 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full transition-all bg-primary/60" style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }} />
                                </div>
                                <span className="text-[11px] font-mono font-bold text-foreground/80 w-10 text-right">{percent !== null ? `${percent}%` : "—"}</span>
                                <span className={`text-[9px] font-mono w-12 text-right ${
                                  change == null ? "text-muted-foreground/40" : change > 0 ? "text-emerald-400" : change < 0 ? "text-rose-400" : "text-muted-foreground"
                                }`}>
                                  {change == null ? "—" : `${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}%`}
                                </span>
                                <Sparkline points={current?.points} />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 pt-2 border-t border-border/15">
                        <span className="text-[9px] font-mono text-cyan-300/70">Liq: {formatVolume(submarket.liquidity)}</span>
                        <span className="text-[9px] font-mono text-muted-foreground/50">24h: {formatVolume(submarket.volume24hr)}</span>
                        <span className="text-[9px] font-mono text-muted-foreground/50">Total: {formatVolume(submarket.totalVolume)}</span>
                        {submarket.spread !== null && <span className="text-[9px] font-mono text-muted-foreground/40">Spread: {submarket.spread.toFixed(3)}</span>}
                        {submarket.acceptingOrders === false && <span className="text-[8px] font-mono text-amber-400">NOT ACCEPTING ORDERS</span>}
                        {submarket.slug && (
                          <a href={`https://polymarket.com/event/${submarket.slug}?ref=${POLYMARKET_REF}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[9px] font-mono text-primary/60 hover:text-primary transition-colors ml-auto">
                            Open <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {!loading && filtered.length === 0 && <p className="text-xs text-muted-foreground/50 text-center py-8">No markets found.</p>}
      </div>
    </div>
  );
}
