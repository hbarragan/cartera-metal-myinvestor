type AssetKind = "indices" | "crypto" | "stocks";
type Provider = "blackrock" | "quefondos";

type FundSource = {
  symbol: string;
  name: string;
  shortName: string;
  category: string;
  provider: Provider;
  url: string;
};

type MarketQuote = {
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

const INDEX_FUNDS: FundSource[] = [
  {
    symbol: "IE000N4ZYX28",
    name: "iShares US Index Fund (IE) S Acc EUR",
    shortName: "iShares US",
    category: "Estados Unidos",
    provider: "blackrock",
    url: "https://www.blackrock.com/es/particulares/productos/345272/",
  },
  {
    symbol: "IE000N51F726",
    name: "iShares Developed World Screened Index Fund (IE) D Acc EUR",
    shortName: "iShares World ESG",
    category: "Mundo desarrollado",
    provider: "blackrock",
    url: "https://www.blackrock.com/es/particulares/productos/345270/",
  },
  {
    symbol: "IE000QAZP7L2",
    name: "iShares Emerging Markets Index Fund (IE) S Acc EUR",
    shortName: "iShares Emerging",
    category: "Emergentes",
    provider: "blackrock",
    url: "https://www.blackrock.com/no/individual/products/345276/ishares-emerging-markets-index-fund-ie",
  },
  {
    symbol: "IE00BYX5N771",
    name: "Fidelity MSCI Japan Index Fund P-Acc-EUR",
    shortName: "Fidelity Japan",
    category: "Japon",
    provider: "quefondos",
    url: "https://www1.quefondos.com/es/fondos/ficha/index.html?isin=IE00BYX5N771",
  },
  {
    symbol: "IE00B1G3DH73",
    name: "Vanguard U.S. 500 Stock Index Fund EUR Hedged Acc",
    shortName: "Vanguard US Hedged",
    category: "EE. UU. cubierto",
    provider: "quefondos",
    url: "https://www1.quefondos.com/es/fondos/ficha/index.html?isin=IE00B1G3DH73",
  },
  {
    symbol: "IE00BYX5MD61",
    name: "Fidelity MSCI Europe Index Fund P-Acc-EUR",
    shortName: "Fidelity Europe",
    category: "Europa",
    provider: "quefondos",
    url: "https://www1.quefondos.com/es/fondos/ficha/index.html?isin=IE00BYX5MD61",
  },
  {
    symbol: "IE00BDZVHT63",
    name: "Fidelity MSCI Pacific ex-Japan Index Fund P-Acc-USD",
    shortName: "Fidelity Pacific ex-Japan",
    category: "Pacifico ex-Japon",
    provider: "quefondos",
    url: "https://www1.quefondos.com/es/fondos/ficha/index.html?isin=IE00BDZVHT63",
  },
];

const requestHeaders = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function htmlText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&iacute;/g, "i")
    .replace(/&Iacute;/g, "I")
    .replace(/&oacute;/g, "o")
    .replace(/&Oacute;/g, "O")
    .replace(/&eacute;/g, "e")
    .replace(/&Eacute;/g, "E")
    .replace(/&aacute;/g, "a")
    .replace(/&Aacute;/g, "A")
    .replace(/&uuml;/g, "u")
    .replace(/&Uuml;/g, "U")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function numberFromText(value?: string | null) {
  if (!value) return null;
  const match = value.replace(/\s/g, "").match(/[-+]?\d[\d.,]*/);
  if (!match) return null;
  const raw = match[0];
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(/,/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchHtml(url: string) {
  const response = await fetch(url, { headers: requestHeaders });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

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
    /1 d(?:&iacute;|i|í|Ã­)a:\s*<\/span><span class="floatright"><span class="(?:mas|menos|igual)">([^<]+)/i,
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

async function yahooChart(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
  const response = await fetch(url, { headers: requestHeaders });
  if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}`);
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const error = payload?.chart?.error;
  if (!result || error) throw new Error(error?.description ?? "Sin datos Yahoo");
  return result;
}

async function eurRateFor(currency: string) {
  if (!currency || currency.toUpperCase() === "EUR") return 1;
  const symbol = `${currency.toUpperCase()}EUR=X`;
  const result = await yahooChart(symbol);
  const rate = Number(result?.meta?.regularMarketPrice);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Sin cambio ${currency}/EUR`);
  return rate;
}

async function quoteYahoo(kind: AssetKind, symbol: string): Promise<MarketQuote> {
  const normalized = symbol.trim().toUpperCase();
  const result = await yahooChart(normalized);
  const meta = result.meta ?? {};
  const price = Number(meta.regularMarketPrice ?? meta.previousClose);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Sin precio para ${normalized}`);

  const currency = String(meta.currency ?? (normalized.endsWith("-EUR") ? "EUR" : "USD")).toUpperCase();
  const rate = await eurRateFor(currency);
  const previous = Number(meta.previousClose);

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

async function quoteFor(kind: AssetKind, symbol: string): Promise<MarketQuote> {
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
