type AssetKind = "indices" | "crypto" | "stocks";

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

const INDEX_FUNDS = [
  { symbol: "IE000N4ZYX28", name: "iShares US Index Fund (IE) S Acc EUR", exchange: "BlackRock" },
  { symbol: "IE000N51F726", name: "iShares Developed World Screened Index Fund (IE) D Acc EUR", exchange: "BlackRock" },
  { symbol: "IE000QAZP7L2", name: "iShares Emerging Markets Index Fund (IE) S Acc EUR", exchange: "BlackRock" },
  { symbol: "IE00BYX5N771", name: "Fidelity MSCI Japan Index Fund P-Acc-EUR", exchange: "Quefondos" },
  { symbol: "IE00B1G3DH73", name: "Vanguard U.S. 500 Stock Index Fund EUR Hedged Acc", exchange: "Quefondos" },
  { symbol: "IE00BYX5MD61", name: "Fidelity MSCI Europe Index Fund P-Acc-EUR", exchange: "Quefondos" },
  { symbol: "IE00BDZVHT63", name: "Fidelity MSCI Pacific ex-Japan Index Fund P-Acc-USD", exchange: "Quefondos" },
];

const requestHeaders = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  accept: "application/json,text/plain,*/*",
};

function normalizeKind(value: string | null): AssetKind {
  return value === "indices" || value === "crypto" || value === "stocks" ? value : "stocks";
}

function yahooAllowed(kind: AssetKind, quoteType = "") {
  const type = quoteType.toUpperCase();
  if (kind === "crypto") return type === "CRYPTOCURRENCY";
  if (kind === "indices") return ["ETF", "MUTUALFUND", "INDEX"].includes(type);
  return ["EQUITY", "ETF"].includes(type);
}

async function yahooSearch(kind: AssetKind, query: string): Promise<SearchResult[]> {
  if (!query) return [];
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0`;
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
  if (!q) return INDEX_FUNDS.map((fund) => ({ kind: "indices" as const, ...fund, type: "FONDO", source: fund.exchange }));

  return INDEX_FUNDS.filter(
    (fund) => fund.symbol.toLowerCase().includes(q) || fund.name.toLowerCase().includes(q),
  ).map((fund) => ({ kind: "indices" as const, ...fund, type: "FONDO", source: fund.exchange }));
}

export default async function handler(request: { url?: string }, response: any) {
  try {
    const url = new URL(request.url ?? "", "https://local.app");
    const kind = normalizeKind(url.searchParams.get("kind"));
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
