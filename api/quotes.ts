type Provider = "blackrock" | "quefondos";

type FundSource = {
  isin: string;
  name: string;
  shortName: string;
  category: string;
  provider: Provider;
  url: string;
};

type FundQuote = {
  isin: string;
  name: string;
  shortName: string;
  category: string;
  currency: "EUR";
  nav: number | null;
  navDate: string | null;
  changeAmount: number | null;
  changePercent: number | null;
  source: string;
  sourceUrl: string;
  status: "ok" | "error";
  error?: string;
};

const FUNDS: FundSource[] = [
  {
    isin: "IE000N4ZYX28",
    name: "iShares US Index Fund (IE) S Acc EUR",
    shortName: "iShares US",
    category: "Estados Unidos",
    provider: "blackrock",
    url: "https://www.blackrock.com/es/particulares/productos/345272/",
  },
  {
    isin: "IE000N51F726",
    name: "iShares Developed World Screened Index Fund (IE) D Acc EUR",
    shortName: "iShares World ESG",
    category: "Mundo desarrollado",
    provider: "blackrock",
    url: "https://www.blackrock.com/es/particulares/productos/345270/",
  },
  {
    isin: "IE000QAZP7L2",
    name: "iShares Emerging Markets Index Fund (IE) S Acc EUR",
    shortName: "iShares Emerging",
    category: "Emergentes",
    provider: "blackrock",
    url: "https://www.blackrock.com/no/individual/products/345276/ishares-emerging-markets-index-fund-ie",
  },
  {
    isin: "IE00BYX5N771",
    name: "Fidelity MSCI Japan Index Fund P-Acc-EUR",
    shortName: "Fidelity Japan",
    category: "Japon",
    provider: "quefondos",
    url: "https://www1.quefondos.com/es/fondos/ficha/index.html?isin=IE00BYX5N771",
  },
  {
    isin: "IE00B1G3DH73",
    name: "Vanguard U.S. 500 Stock Index Fund EUR Hedged Acc",
    shortName: "Vanguard US Hedged",
    category: "EE. UU. cubierto",
    provider: "quefondos",
    url: "https://www1.quefondos.com/es/fondos/ficha/index.html?isin=IE00B1G3DH73",
  },
  {
    isin: "IE00BYX5MD61",
    name: "Fidelity MSCI Europe Index Fund P-Acc-EUR",
    shortName: "Fidelity Europe",
    category: "Europa",
    provider: "quefondos",
    url: "https://www1.quefondos.com/es/fondos/ficha/index.html?isin=IE00BYX5MD61",
  },
  {
    isin: "IE00BDZVHT63",
    name: "Fidelity MSCI Pacific ex-Japan Index Fund P-Acc-USD",
    shortName: "Fidelity Pacific ex-Japan",
    category: "Pacifico ex-Japon",
    provider: "quefondos",
    url: "https://www1.quefondos.com/es/fondos/ficha/index.html?isin=IE00BDZVHT63",
  },
];

const headers = {
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
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function quoteFromBlackRock(fund: FundSource): Promise<FundQuote> {
  const html = await fetchHtml(fund.url);
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  const row = rows.find((entry) => entry.includes(fund.isin));

  if (row) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) =>
      htmlText(match[1]),
    );

    return {
      isin: fund.isin,
      name: fund.name,
      shortName: fund.shortName,
      category: fund.category,
      currency: "EUR",
      nav: numberFromText(cells[2]),
      changeAmount: numberFromText(cells[3]),
      changePercent: numberFromText(cells[4]),
      navDate: cells[5] || null,
      source: "BlackRock",
      sourceUrl: fund.url,
      status: "ok",
    };
  }

  const header = html.match(
    /(?:Valor liquidativo|NAV) as? of\s*([^<]+)<\/span>\s*<span class="header-nav-data">\s*EUR\s*([^<]+)/i,
  );
  if (!header) throw new Error("No se encontro NAV en BlackRock");

  return {
    isin: fund.isin,
    name: fund.name,
    shortName: fund.shortName,
    category: fund.category,
    currency: "EUR",
    nav: numberFromText(header[2]),
    navDate: htmlText(header[1]),
    changeAmount: null,
    changePercent: null,
    source: "BlackRock",
    sourceUrl: fund.url,
    status: "ok",
  };
}

async function quoteFromQueFondos(fund: FundSource): Promise<FundQuote> {
  const html = await fetchHtml(fund.url);
  const nav = html.match(
    /Valor liquidativo:\s*<\/span><span class="floatright">([^<]+)/i,
  );
  const date = html.match(/Fecha:\s*<\/span><span class="floatright">([^<]+)/i);
  const dayChange = html.match(
    /1 d(?:&iacute;|i|í)a:\s*<\/span><span class="floatright"><span class="(?:mas|menos|igual)">([^<]+)/i,
  );

  if (!nav) throw new Error("No se encontro valor liquidativo en Quefondos");

  return {
    isin: fund.isin,
    name: fund.name,
    shortName: fund.shortName,
    category: fund.category,
    currency: "EUR",
    nav: numberFromText(nav[1]),
    navDate: date ? htmlText(date[1]) : null,
    changeAmount: null,
    changePercent: numberFromText(dayChange?.[1]),
    source: "Quefondos / VDOS",
    sourceUrl: fund.url,
    status: "ok",
  };
}

async function quoteFor(fund: FundSource): Promise<FundQuote> {
  try {
    return fund.provider === "blackrock"
      ? await quoteFromBlackRock(fund)
      : await quoteFromQueFondos(fund);
  } catch (error) {
    return {
      isin: fund.isin,
      name: fund.name,
      shortName: fund.shortName,
      category: fund.category,
      currency: "EUR",
      nav: null,
      navDate: null,
      changeAmount: null,
      changePercent: null,
      source: fund.provider === "blackrock" ? "BlackRock" : "Quefondos / VDOS",
      sourceUrl: fund.url,
      status: "error",
      error: error instanceof Error ? error.message : "Error desconocido",
    };
  }
}

export default async function handler(_request: unknown, response: any) {
  const quotes = await Promise.all(FUNDS.map(quoteFor));

  response.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  response.status(200).json({
    refreshedAt: new Date().toISOString(),
    quotes,
  });
}
