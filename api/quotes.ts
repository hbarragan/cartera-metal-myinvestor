import {
  INDEX_FUNDS,
  type AssetKind,
  type FundSource,
  eurRateFor,
  fetchHtml,
  htmlText,
  numberFromText,
  requestHeaders,
  yahooChart,
} from "./lib/market.js";

export type MarketQuote = {
  id: string;
  kind: AssetKind;
  symbol: string;
  name: string;
  shortName: string;
  category?: string;
  currency: string;
  price: number | null;
  priceEUR: number | null;
  priceDate: string | null;
  changePercent: number | null;
  source: string;
  sourceUrl: string;
  status: "ok" | "error";
  error?: string;
};

async function quoteFromBlackRock(fund: FundSource): Promise<MarketQuote> {
  const html = await fetchHtml(fund.url);
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  const row = rows.find((entry) => entry.includes(fund.symbol));
  const cells = row
    ? [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => htmlText(match[1]))
    : [];
  const price = numberFromText(cells[2]);

  if (!price) throw new Error("No se encontro VAL en BlackRock");

  return {
    id: `indices:${fund.symbol}`,
    kind: "indices",
    symbol: fund.symbol,
    name: fund.name,
    shortName: fund.shortName,
    category: fund.category,
    currency: "EUR",
    price,
    priceEUR: price,
    priceDate: cells[5] || null,
    changePercent: numberFromText(cells[4]),
    source: "BlackRock",
    sourceUrl: fund.url,
    status: "ok",
  };
}

async function quoteFromQueFondos(fund: FundSource): Promise<MarketQuote> {
  const html = await fetchHtml(fund.url);
  const nav = html.match(/Valor liquidativo:\s*<\/span><span class="floatright">([^<]+)/i);
  const date = html.match(/Fecha:\s*<\/span><span class="floatright">([^<]+)/i);
  const dayChange = html.match(
    /1 d(?:&iacute;|i|Ã­|ÃƒÂ­)a:\s*<\/span><span class="floatright"><span class="(?:mas|menos|igual)">([^<]+)/i,
  );
  const price = numberFromText(nav?.[1]);

  if (!price) throw new Error("No se encontro VAL en Quefondos");

  return {
    id: `indices:${fund.symbol}`,
    kind: "indices",
    symbol: fund.symbol,
    name: fund.name,
    shortName: fund.shortName,
    category: fund.category,
    currency: "EUR",
    price,
    priceEUR: price,
    priceDate: date ? htmlText(date[1]) : null,
    changePercent: numberFromText(dayChange?.[1]),
    source: "Quefondos / VDOS",
    sourceUrl: fund.url,
    status: "ok",
  };
}

async function quoteIndex(symbol: string): Promise<MarketQuote> {
  const fund = INDEX_FUNDS.find((item) => item.symbol === symbol);
  if (!fund) throw new Error(`Indice no registrado: ${symbol}`);
  return fund.provider === "blackrock" ? quoteFromBlackRock(fund) : quoteFromQueFondos(fund);
}

async function quoteYahoo(kind: AssetKind, symbol: string): Promise<MarketQuote> {
  const normalized = symbol.trim().toUpperCase();
  const result = await yahooChart(normalized);
  const meta = result.meta ?? {};
  const price = Number(meta.regularMarketPrice ?? meta.previousClose);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Sin precio para ${normalized}`);

  const currency = String(meta.currency ?? (normalized.endsWith("-EUR") ? "EUR" : "USD")).toUpperCase();
  const rate = await eurRateFor(currency);
  const previous = Number(meta.previousClose ?? meta.chartPreviousClose);

  return {
    id: `${kind}:${normalized}`,
    kind,
    symbol: normalized,
    name: String(meta.longName ?? meta.shortName ?? normalized),
    shortName: String(meta.shortName ?? normalized),
    currency,
    price,
    priceEUR: price * rate,
    priceDate: new Date(Number(meta.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
    changePercent: Number.isFinite(previous) && previous > 0 ? (price / previous - 1) * 100 : null,
    source: "Yahoo Finance",
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(normalized)}`,
    status: "ok",
  };
}

export async function quoteFor(kind: AssetKind, symbol: string): Promise<MarketQuote> {
  try {
    if (kind === "indices") {
      const fund = INDEX_FUNDS.find((item) => item.symbol === symbol);
      return fund ? await quoteIndex(symbol) : await quoteYahoo(kind, symbol);
    }
    return await quoteYahoo(kind, symbol);
  } catch (error) {
    return {
      id: `${kind}:${symbol}`,
      kind,
      symbol,
      name: symbol,
      shortName: symbol,
      currency: "EUR",
      price: null,
      priceEUR: null,
      priceDate: null,
      changePercent: null,
      source: kind === "indices" ? "Fondos" : "Yahoo Finance",
      sourceUrl: "",
      status: "error",
      error: error instanceof Error ? error.message : "Error desconocido",
    };
  }
}

function parseAssets(url = "") {
  const parsed = new URL(url, "https://local.app");
  const assets = parsed.searchParams.get("assets");
  if (!assets) {
    return INDEX_FUNDS.map((fund) => ({ kind: "indices" as const, symbol: fund.symbol }));
  }

  return assets
    .split(",")
    .map((entry) => {
      const [kind, symbol] = entry.split(":");
      if (!["indices", "crypto", "stocks"].includes(kind) || !symbol) return null;
      return { kind: kind as AssetKind, symbol: decodeURIComponent(symbol).trim().toUpperCase() };
    })
    .filter(Boolean) as Array<{ kind: AssetKind; symbol: string }>;
}

export default async function handler(request: { url?: string }, response: any) {
  const assets = parseAssets(request.url);
  const uniqueAssets = [...new Map(assets.map((asset) => [`${asset.kind}:${asset.symbol}`, asset])).values()];
  const quotes = await Promise.all(uniqueAssets.map((asset) => quoteFor(asset.kind, asset.symbol)));

  response.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  response.status(200).json({
    refreshedAt: new Date().toISOString(),
    quotes,
    indexFunds: INDEX_FUNDS,
  });
}
