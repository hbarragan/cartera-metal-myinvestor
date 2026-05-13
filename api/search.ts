import { INDEX_FUNDS, normalizeAssetKind, requestHeaders, type AssetKind } from "./lib/market";

type SearchResult = {
  kind: AssetKind;
  symbol: string;
  name: string;
  exchange?: string;
  type?: string;
  source: string;
};

type YahooSearchQuote = {
  symbol?: string;
  longname?: string;
  shortname?: string;
  exchDisp?: string;
  quoteType?: string;
};

function yahooAllowed(kind: AssetKind, quoteType = "") {
  const type = quoteType.toUpperCase();
  if (kind === "crypto") return type === "CRYPTOCURRENCY";
  if (kind === "indices") return ["ETF", "MUTUALFUND", "INDEX"].includes(type);
  return ["EQUITY", "ETF"].includes(type);
}

async function yahooSearch(kind: AssetKind, query: string): Promise<SearchResult[]> {
  if (!query) return [];
  const url =
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}` +
    "&quotesCount=12&newsCount=0";
  const response = await fetch(url, { headers: requestHeaders });
  if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}`);
  const payload = await response.json();
  const quotes: YahooSearchQuote[] = Array.isArray(payload?.quotes) ? payload.quotes : [];

  return quotes
    .filter((quote) => quote?.symbol && yahooAllowed(kind, quote.quoteType))
    .map((quote) => ({
      kind,
      symbol: String(quote.symbol).toUpperCase(),
      name: String(quote.longname ?? quote.shortname ?? quote.symbol),
      exchange: quote.exchDisp ? String(quote.exchDisp) : undefined,
      type: quote.quoteType ? String(quote.quoteType) : undefined,
      source: "Yahoo Finance",
    }));
}

function indexFundSearch(query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return INDEX_FUNDS.map((fund) => ({
      kind: "indices" as const,
      symbol: fund.symbol,
      name: fund.name,
      exchange: fund.provider === "blackrock" ? "BlackRock" : "Quefondos",
      type: "FONDO",
      source: fund.provider === "blackrock" ? "BlackRock" : "Quefondos",
    }));
  }

  return INDEX_FUNDS.filter(
    (fund) => fund.symbol.toLowerCase().includes(q) || fund.name.toLowerCase().includes(q),
  ).map((fund) => ({
    kind: "indices" as const,
    symbol: fund.symbol,
    name: fund.name,
    exchange: fund.provider === "blackrock" ? "BlackRock" : "Quefondos",
    type: "FONDO",
    source: fund.provider === "blackrock" ? "BlackRock" : "Quefondos",
  }));
}

export default async function handler(request: { url?: string }, response: any) {
  try {
    const url = new URL(request.url ?? "", "https://local.app");
    const kind = normalizeAssetKind(url.searchParams.get("kind"));
    const query = url.searchParams.get("q")?.trim() ?? "";

    const [funds, yahoo] = await Promise.all([
      Promise.resolve(kind === "indices" ? indexFundSearch(query) : []),
      yahooSearch(kind, query),
    ]);

    const results = [...new Map([...funds, ...yahoo].map((item) => [`${item.kind}:${item.symbol}`, item])).values()].slice(0, 14);

    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
    response.status(200).json({ results });
  } catch (error) {
    response.status(500).json({
      results: [],
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
}
