import { type AssetKind, resolveYahooSymbol, yahooChart } from "./lib/market";

type TrendWindow = "1h" | "1d";
type TrendRange = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y" | "10y" | "max";

type ParsedPosition = {
  kind: AssetKind;
  symbol: string;
  quantity: number;
};

type HistoryPoint = {
  bucketKey: string;
  capturedAt: string;
  value: number;
};

type AssetHistory = {
  key: string;
  kind: AssetKind;
  symbol: string;
  resolvedSymbol: string;
  quantity: number;
  currency: string;
  points: HistoryPoint[];
};

const WINDOW_CONFIG: Record<TrendWindow, { defaultRange: TrendRange; interval: string; ranges: TrendRange[] }> = {
  "1h": { defaultRange: "5d", interval: "60m", ranges: ["1d", "5d", "1mo", "3mo"] },
  "1d": { defaultRange: "6mo", interval: "1d", ranges: ["6mo", "1y", "2y", "5y", "10y", "max"] },
};

function safeNumber(value: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeWindow(value: string | null): TrendWindow {
  return value === "1h" ? "1h" : "1d";
}

function normalizeRange(window: TrendWindow, value: string | null): TrendRange {
  const config = WINDOW_CONFIG[window];
  if (!value) return config.defaultRange;
  return config.ranges.includes(value as TrendRange) ? (value as TrendRange) : config.defaultRange;
}

function parsePositions(url = "") {
  const parsed = new URL(url, "https://local.app");
  const raw = parsed.searchParams.get("positions") ?? "";
  return raw
    .split(",")
    .map((entry) => {
      const [kind, symbol, quantity] = entry.split(":");
      if (!symbol || !quantity) return null;
      if (!["indices", "crypto", "stocks"].includes(kind)) return null;
      const normalizedQuantity = safeNumber(quantity);
      if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) return null;
      return {
        kind: kind as AssetKind,
        symbol: decodeURIComponent(symbol).trim().toUpperCase(),
        quantity: normalizedQuantity,
      };
    })
    .filter(Boolean) as ParsedPosition[];
}

function bucketKeyFor(timestampMs: number, window: TrendWindow) {
  const date = new Date(timestampMs);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  if (window === "1d") return `${year}-${month}-${day}`;
  const hour = `${date.getUTCHours()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hour}`;
}

function isoFromTimestamp(timestampSec: number) {
  return new Date(timestampSec * 1000).toISOString();
}

function capturedAtFromBucketKey(bucketKey: string, window: TrendWindow) {
  return window === "1h" ? `${bucketKey}:00:00.000Z` : `${bucketKey}T00:00:00.000Z`;
}

function pointValue(result: any, index: number) {
  const adjClose = result?.indicators?.adjclose?.[0]?.adjclose?.[index];
  const close = result?.indicators?.quote?.[0]?.close?.[index];
  const value = Number(adjClose ?? close);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeFxPoints(result: any, window: TrendWindow) {
  const timestamps = Array.isArray(result?.timestamp) ? (result.timestamp as number[]) : [];
  const points = new Map<string, number>();
  timestamps.forEach((timestamp, index) => {
    const price = pointValue(result, index);
    if (!price) return;
    points.set(bucketKeyFor(timestamp * 1000, window), price);
  });
  return points;
}

function applyFx(points: HistoryPoint[], fxMap: Map<string, number>) {
  let lastRate = 1;
  return points
    .map((point) => {
      const direct = fxMap.get(point.bucketKey);
      if (direct) lastRate = direct;
      if (!lastRate || !Number.isFinite(lastRate)) return null;
      return { ...point, value: point.value * lastRate };
    })
    .filter(Boolean) as HistoryPoint[];
}

async function loadAssetHistory(position: ParsedPosition, window: TrendWindow, range: TrendRange): Promise<AssetHistory> {
  const resolvedSymbol = await resolveYahooSymbol(position.kind, position.symbol);
  const interval = WINDOW_CONFIG[window].interval;
  const result = await yahooChart(resolvedSymbol, range, interval);
  const timestamps = Array.isArray(result?.timestamp) ? (result.timestamp as number[]) : [];
  const currency = String(result?.meta?.currency ?? (resolvedSymbol.endsWith("-EUR") ? "EUR" : "USD")).toUpperCase();

  const points = timestamps
    .map((timestamp, index) => {
      const value = pointValue(result, index);
      if (!value) return null;
      return {
        bucketKey: bucketKeyFor(timestamp * 1000, window),
        capturedAt: isoFromTimestamp(timestamp),
        value,
      };
    })
    .filter(Boolean) as HistoryPoint[];

  if (currency !== "EUR") {
    const fxResult = await yahooChart(`${currency}EUR=X`, range, interval);
    const fxMap = normalizeFxPoints(fxResult, window);
    return {
      key: `${position.kind}:${position.symbol}`,
      kind: position.kind,
      symbol: position.symbol,
      resolvedSymbol,
      quantity: position.quantity,
      currency,
      points: applyFx(points, fxMap),
    };
  }

  return {
    key: `${position.kind}:${position.symbol}`,
    kind: position.kind,
    symbol: position.symbol,
    resolvedSymbol,
    quantity: position.quantity,
    currency,
    points,
  };
}

function aggregateSeries(assets: AssetHistory[], window: TrendWindow) {
  const orderedKeys = [
    ...new Set(
      assets.flatMap((asset) => asset.points.map((point) => point.bucketKey)),
    ),
  ].sort();
  const byAsset = assets.map((asset) => {
    const pointMap = new Map(asset.points.map((point) => [point.bucketKey, point]));
    return { asset, pointMap };
  });
  const lastValues = new Map<string, number>();

  return orderedKeys
    .map((bucketKey) => {
      let total = 0;
      let coverage = 0;
      let capturedAt = `${bucketKey}:00:00.000Z`;

      byAsset.forEach(({ asset, pointMap }) => {
        const point = pointMap.get(bucketKey);
        if (point) {
          lastValues.set(asset.key, point.value);
          capturedAt = point.capturedAt;
        }
        const activeValue = lastValues.get(asset.key);
        if (activeValue == null) return;
        coverage += 1;
        total += activeValue * asset.quantity;
      });

      if (coverage !== byAsset.length) return null;
      return { bucketKey, capturedAt: capturedAt || capturedAtFromBucketKey(bucketKey, window), value: total };
    })
    .filter(Boolean) as HistoryPoint[];
}

export default async function handler(request: { url?: string }, response: any) {
  try {
    const url = new URL(request.url ?? "", "https://local.app");
    const window = normalizeWindow(url.searchParams.get("window"));
    const range = normalizeRange(window, url.searchParams.get("range"));
    const positions = parsePositions(request.url);

    if (!positions.length) {
      response.status(200).json({
        refreshedAt: new Date().toISOString(),
        window,
        range,
        ranges: WINDOW_CONFIG[window].ranges,
        series: [],
        assets: [],
      });
      return;
    }

    const merged = [...new Map(
      positions.map((position) => [
        `${position.kind}:${position.symbol}`,
        position,
      ]),
    ).values()].map((position) => ({
      ...position,
      quantity: positions
        .filter((item) => item.kind === position.kind && item.symbol === position.symbol)
        .reduce((sum, item) => sum + item.quantity, 0),
    }));

    const assetResults = await Promise.allSettled(
      merged.map((position) => loadAssetHistory(position, window, range)),
    );

    const assets = assetResults
      .flatMap((result, index) => {
        if (result.status === "fulfilled") return [result.value];
        const failed = merged[index];
        return failed
          ? [{
              key: `${failed.kind}:${failed.symbol}`,
              kind: failed.kind,
              symbol: failed.symbol,
              resolvedSymbol: failed.symbol,
              quantity: failed.quantity,
              currency: "EUR",
              points: [],
            } satisfies AssetHistory]
          : [];
      });

    const series = aggregateSeries(assets.filter((asset) => asset.points.length), window);
    response.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
    response.status(200).json({
      refreshedAt: new Date().toISOString(),
      window,
      range,
      ranges: WINDOW_CONFIG[window].ranges,
      assets: assets.map((asset, index) => ({
        kind: asset.kind,
        symbol: asset.symbol,
        resolvedSymbol: asset.resolvedSymbol,
        quantity: asset.quantity,
        points: asset.points.length,
        status: asset.points.length ? "ok" : "error",
        error: asset.points.length
          ? null
          : assetResults[index]?.status === "rejected"
            ? assetResults[index].reason instanceof Error
              ? assetResults[index].reason.message
              : "Sin historico"
            : "Sin historico",
      })),
      series,
    });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Error desconocido",
      series: [],
      assets: [],
    });
  }
}
