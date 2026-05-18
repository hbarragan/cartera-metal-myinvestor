import { type AssetKind } from "./lib/market.js";
import { type MarketQuote, quoteFor } from "./quotes.js";

type PortfolioKind = AssetKind;

type Position = {
  id?: string;
  symbol: string;
  quantity: number | string;
};

type Portfolio = {
  id?: string;
  kind: PortfolioKind;
  name: string;
  investedEUR: number | string;
  positions: Position[];
};

type NormalizedPosition = {
  id: string;
  symbol: string;
  quantity: number;
};

type NormalizedPortfolio = {
  id: string;
  kind: PortfolioKind;
  name: string;
  investedEUR: number;
  positions: NormalizedPosition[];
};

const KIND_LABELS: Record<PortfolioKind, string> = {
  indices: "Indices",
  crypto: "Crypto",
  stocks: "Acciones",
};

function safeNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const clean = value.trim().replace(/\s/g, "").replace(/[€%]/g, "");
  let normalized = clean;
  if (clean.includes(",") && clean.includes(".")) {
    normalized = clean.replace(/\./g, "").replace(",", ".");
  } else if (clean.includes(",")) {
    normalized = clean.replace(",", ".");
  } else if ((clean.match(/\./g) ?? []).length > 1) {
    const parts = clean.split(".");
    normalized = `${parts.slice(0, -1).join("")}.${parts.at(-1)}`;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function gainFor(value: number, investedEUR: number) {
  const amount = value - investedEUR;
  const ratio = investedEUR > 0 ? value / investedEUR - 1 : 0;
  return { amount, ratio };
}

function quoteKey(kind: PortfolioKind, symbol: string) {
  return `${kind}:${symbol.trim().toUpperCase()}`;
}

function normalizeKind(value: unknown): PortfolioKind | null {
  return value === "indices" || value === "crypto" || value === "stocks" ? value : null;
}

function normalizePortfolios(value: unknown): NormalizedPortfolio[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Partial<Portfolio>;
      const kind = normalizeKind(candidate.kind);
      if (!kind) return null;

      const positions = Array.isArray(candidate.positions)
        ? candidate.positions
            .map((position, positionIndex) => {
              if (!position || typeof position !== "object") return null;
              const symbol = String((position as Partial<Position>).symbol ?? "").trim().toUpperCase();
              const quantity = safeNumber((position as Partial<Position>).quantity);
              if (!symbol || quantity <= 0) return null;
              return {
                id: String((position as Partial<Position>).id ?? `${index}-${positionIndex}`),
                symbol,
                quantity,
              };
            })
            .filter(Boolean) as NormalizedPosition[]
        : [];

      return {
        id: String(candidate.id ?? `portfolio-${index}`),
        kind,
        name: String(candidate.name ?? KIND_LABELS[kind]),
        investedEUR: safeNumber(candidate.investedEUR),
        positions,
      };
    })
    .filter(Boolean) as NormalizedPortfolio[];
}

function parseAssetsParam(value: string | null): NormalizedPortfolio[] {
  if (!value) return [];
  const positionsByKind = new Map<PortfolioKind, NormalizedPosition[]>();
  value.split(",").forEach((entry, index) => {
    const [rawKind, rawSymbol, rawQuantity] = entry.split(":");
    const kind = normalizeKind(rawKind);
    const symbol = decodeURIComponent(rawSymbol ?? "").trim().toUpperCase();
    if (!kind || !symbol) return;
    const quantity = safeNumber(rawQuantity ?? 1) || 1;
    positionsByKind.set(kind, [
      ...(positionsByKind.get(kind) ?? []),
      { id: `asset-${index}`, symbol, quantity },
    ]);
  });

  return [...positionsByKind.entries()].map(([kind, positions]) => ({
    id: `assets-${kind}`,
    kind,
    name: `Activos ${KIND_LABELS[kind]}`,
    investedEUR: 0,
    positions,
  }));
}

async function readBody(request: any) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  if (typeof request.on !== "function") return {};

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", resolve);
    request.on("error", reject);
  });
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function portfoliosFromRequest(request: any) {
  const url = new URL(request.url ?? "", "https://local.app");
  if (request.method === "POST" || request.method === "PUT") {
    const body = await readBody(request);
    return normalizePortfolios(body?.portfolios);
  }

  const portfoliosParam = url.searchParams.get("portfolios");
  if (portfoliosParam) {
    return normalizePortfolios(JSON.parse(portfoliosParam));
  }

  return parseAssetsParam(url.searchParams.get("assets"));
}

function positionValue(position: NormalizedPosition, portfolio: NormalizedPortfolio, quotes: Map<string, MarketQuote>) {
  const quote = quotes.get(quoteKey(portfolio.kind, position.symbol));
  return position.quantity * (quote?.priceEUR ?? 0);
}

export default async function handler(request: any, response: any) {
  try {
    if (!["GET", "POST", "PUT"].includes(request.method ?? "GET")) {
      response.setHeader("Allow", "GET, POST, PUT");
      response.status(405).json({ error: "Metodo no permitido" });
      return;
    }

    const portfolios = await portfoliosFromRequest(request);
    const assets = [
      ...new Map(
        portfolios.flatMap((portfolio) =>
          portfolio.positions.map((position) => [
            quoteKey(portfolio.kind, position.symbol),
            { kind: portfolio.kind, symbol: position.symbol },
          ]),
        ),
      ).values(),
    ];

    const quotes = await Promise.all(assets.map((asset) => quoteFor(asset.kind, asset.symbol)));
    const quoteMap = new Map(quotes.map((quote) => [quoteKey(quote.kind, quote.symbol), quote]));

    const portfolioReports = portfolios.map((portfolio) => {
      const positions = portfolio.positions.map((position) => {
        const quote = quoteMap.get(quoteKey(portfolio.kind, position.symbol)) ?? null;
        const valueEUR = positionValue(position, portfolio, quoteMap);
        return {
          id: position.id,
          symbol: position.symbol,
          name: quote?.shortName ?? position.symbol,
          quantity: position.quantity,
          priceEUR: quote?.priceEUR ?? null,
          valueEUR,
          dayChangePercent: quote?.changePercent ?? null,
          quoteStatus: quote?.status ?? "error",
          quoteError: quote?.error ?? null,
          source: quote?.source ?? null,
          priceDate: quote?.priceDate ?? null,
        };
      });
      const valueEUR = positions.reduce((sum, position) => sum + position.valueEUR, 0);
      return {
        id: portfolio.id,
        name: portfolio.name,
        kind: portfolio.kind,
        kindLabel: KIND_LABELS[portfolio.kind],
        investedEUR: portfolio.investedEUR,
        valueEUR,
        ...gainFor(valueEUR, portfolio.investedEUR),
        positions,
      };
    });

    const byKind = (Object.keys(KIND_LABELS) as PortfolioKind[]).map((kind) => {
      const rows = portfolioReports.filter((portfolio) => portfolio.kind === kind);
      const valueEUR = rows.reduce((sum, portfolio) => sum + portfolio.valueEUR, 0);
      const investedEUR = rows.reduce((sum, portfolio) => sum + portfolio.investedEUR, 0);
      return {
        kind,
        label: KIND_LABELS[kind],
        count: rows.length,
        valueEUR,
        investedEUR,
        ...gainFor(valueEUR, investedEUR),
      };
    });

    const valueEUR = portfolioReports.reduce((sum, portfolio) => sum + portfolio.valueEUR, 0);
    const investedEUR = portfolioReports.reduce((sum, portfolio) => sum + portfolio.investedEUR, 0);

    response.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    response.status(200).json({
      refreshedAt: new Date().toISOString(),
      input: {
        portfolios: portfolios.length,
        positions: portfolios.reduce((sum, portfolio) => sum + portfolio.positions.length, 0),
      },
      summary: {
        valueEUR,
        investedEUR,
        ...gainFor(valueEUR, investedEUR),
      },
      byKind,
      portfolios: portfolioReports,
      quotes,
      warnings: portfolios.length
        ? []
        : ["No se recibieron carteras. Envia POST { portfolios } o usa ?assets=indices:IE000N4ZYX28:1"],
    });
  } catch (error) {
    response.status(500).json({
      refreshedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
}
