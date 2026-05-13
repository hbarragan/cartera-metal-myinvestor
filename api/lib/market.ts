export type AssetKind = "indices" | "crypto" | "stocks";
export type Provider = "blackrock" | "quefondos";

export type FundSource = {
  symbol: string;
  yahooSymbol: string;
  name: string;
  shortName: string;
  category: string;
  provider: Provider;
  url: string;
};

type YahooSearchQuote = {
  symbol?: string;
  longname?: string;
  shortname?: string;
  exchDisp?: string;
  quoteType?: string;
};

export const INDEX_FUNDS: FundSource[] = [
  {
    symbol: "IE000N4ZYX28",
    yahooSymbol: "0P0001XF42.F",
    name: "iShares US Index Fund (IE) S Acc EUR",
    shortName: "iShares US",
    category: "Estados Unidos",
    provider: "blackrock",
    url: "https://www.blackrock.com/es/particulares/productos/345272/",
  },
  {
    symbol: "IE000N51F726",
    yahooSymbol: "0P0001XF41.F",
    name: "iShares Developed World Screened Index Fund (IE) D Acc EUR",
    shortName: "iShares World ESG",
    category: "Mundo desarrollado",
    provider: "blackrock",
    url: "https://www.blackrock.com/es/particulares/productos/345270/",
  },
  {
    symbol: "IE000QAZP7L2",
    yahooSymbol: "0P0001XF3Z.F",
    name: "iShares Emerging Markets Index Fund (IE) S Acc EUR",
    shortName: "iShares Emerging",
    category: "Emergentes",
    provider: "blackrock",
    url: "https://www.blackrock.com/no/individual/products/345276/ishares-emerging-markets-index-fund-ie",
  },
  {
    symbol: "IE00BYX5N771",
    yahooSymbol: "0P0001CLDI.F",
    name: "Fidelity MSCI Japan Index Fund P-Acc-EUR",
    shortName: "Fidelity Japan",
    category: "Japon",
    provider: "quefondos",
    url: "https://www1.quefondos.com/es/fondos/ficha/index.html?isin=IE00BYX5N771",
  },
  {
    symbol: "IE00B1G3DH73",
    yahooSymbol: "0P00006TV8.F",
    name: "Vanguard U.S. 500 Stock Index Fund EUR Hedged Acc",
    shortName: "Vanguard US Hedged",
    category: "EE. UU. cubierto",
    provider: "quefondos",
    url: "https://www1.quefondos.com/es/fondos/ficha/index.html?isin=IE00B1G3DH73",
  },
  {
    symbol: "IE00BYX5MD61",
    yahooSymbol: "0P0001CJGN.F",
    name: "Fidelity MSCI Europe Index Fund P-Acc-EUR",
    shortName: "Fidelity Europe",
    category: "Europa",
    provider: "quefondos",
    url: "https://www1.quefondos.com/es/fondos/ficha/index.html?isin=IE00BYX5MD61",
  },
  {
    symbol: "IE00BDZVHT63",
    yahooSymbol: "0P0001COSJ",
    name: "Fidelity MSCI Pacific ex-Japan Index Fund P-Acc-USD",
    shortName: "Fidelity Pacific ex-Japan",
    category: "Pacifico ex-Japon",
    provider: "quefondos",
    url: "https://www1.quefondos.com/es/fondos/ficha/index.html?isin=IE00BDZVHT63",
  },
];

export const requestHeaders = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,text/plain,*/*;q=0.8",
};

export function normalizeAssetKind(value: string | null): AssetKind {
  return value === "indices" || value === "crypto" || value === "stocks" ? value : "stocks";
}

export function htmlText(value: string) {
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

export function numberFromText(value?: string | null) {
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

export async function fetchHtml(url: string) {
  const response = await fetch(url, { headers: requestHeaders });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export async function yahooChart(symbol: string, range = "1d", interval = "1m") {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includePrePost=false&events=div,splits`;
  const response = await fetch(url, { headers: requestHeaders });
  if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}`);
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const error = payload?.chart?.error;
  if (!result || error) throw new Error(error?.description ?? "Sin datos Yahoo");
  return result;
}

async function yahooSearch(query: string) {
  const url =
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}` +
    "&quotesCount=12&newsCount=0";
  const response = await fetch(url, { headers: requestHeaders });
  if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.quotes) ? (payload.quotes as YahooSearchQuote[]) : [];
}

export async function resolveYahooSymbol(kind: AssetKind, symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (kind !== "indices") return normalized;

  const fund = INDEX_FUNDS.find((item) => item.symbol === normalized);
  if (fund?.yahooSymbol) return fund.yahooSymbol;

  const quotes = await yahooSearch(normalized);
  const preferred = quotes.find(
    (quote) =>
      quote?.symbol &&
      ["MUTUALFUND", "ETF", "INDEX"].includes(String(quote.quoteType ?? "").toUpperCase()),
  );
  if (!preferred?.symbol) {
    throw new Error(`Sin historico Yahoo para ${normalized}`);
  }
  return String(preferred.symbol).toUpperCase();
}

export async function eurRateFor(currency: string) {
  if (!currency || currency.toUpperCase() === "EUR") return 1;
  const symbol = `${currency.toUpperCase()}EUR=X`;
  const result = await yahooChart(symbol);
  const rate = Number(result?.meta?.regularMarketPrice);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Sin cambio ${currency}/EUR`);
  return rate;
}
