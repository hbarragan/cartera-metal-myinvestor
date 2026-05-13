import {
  Activity,
  BarChart3,
  Bitcoin,
  BriefcaseBusiness,
  Check,
  CircleDollarSign,
  Download,
  Eye,
  EyeOff,
  LayoutDashboard,
  LineChart,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
  Upload,
  WalletCards,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PortfolioKind = "indices" | "crypto" | "stocks";

type Position = {
  id: string;
  symbol: string;
  quantity: number;
};

type Portfolio = {
  id: string;
  kind: PortfolioKind;
  name: string;
  investedEUR: number;
  positions: Position[];
};

type MarketQuote = {
  id: string;
  kind: PortfolioKind;
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

type AssetSearchResult = {
  kind: PortfolioKind;
  symbol: string;
  name: string;
  exchange?: string;
  type?: string;
  source: string;
};

type AppCache = {
  portfolios: Portfolio[];
  savedAt: string;
  history?: HistoryCache;
};

type HistorySnapshot = {
  bucketKey: string;
  capturedAt: string;
  value: number;
  invested: number;
};

type HistoryCache = {
  hourly: HistorySnapshot[];
  daily: HistorySnapshot[];
};

type TrendWindow = "1h" | "1d";
type TrendRange = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y" | "10y" | "max";

type TrendPoint = {
  label: string;
  capturedAt: string;
  value: number;
  invested: number;
};

type TrendDialog = {
  bucket: TrendWindow;
  range: TrendRange;
  ranges: TrendRange[];
  points: TrendPoint[];
  loading: boolean;
  statusText: string;
  summary: {
    amount: number;
    ratio: number;
  } | null;
};

type HistoryApiPoint = {
  bucketKey: string;
  capturedAt: string;
  value: number;
};

type HistoryApiResponse = {
  window: TrendWindow;
  range: TrendRange;
  ranges: TrendRange[];
  series: HistoryApiPoint[];
  assets: Array<{
    kind: PortfolioKind;
    symbol: string;
    resolvedSymbol: string;
    quantity: number;
    points: number;
    status: "ok" | "error";
    error: string | null;
  }>;
  error?: string;
};

type PrivacyCache = {
  hidden: boolean;
  pattern: string | null;
  updatedAt: string;
};

type PatternDialog = {
  mode: "setup" | "unlock";
  reason: "hide" | "show" | "export";
};

type LegacyHolding = {
  isin: string;
  shares?: number;
  lastVal?: number | null;
  lastNav?: number | null;
};

const APP_CACHE_KEY = "stock-hbarrag:v1";
const HISTORY_CACHE_KEY = "stock-hbarrag:history:v1";
const PRIVACY_CACHE_KEY = "stock-hbarrag:privacy:v1";
const AUTO_HIDE_MS = 60_000;
const LEGACY_KEYS = [
  "cartera-metal-myinvestor:v4",
  "cartera-metal-myinvestor:v3",
  "cartera-metal-myinvestor:v2",
  "cartera-metal-myinvestor:v1",
];

const INDEX_OPTIONS = [
  { symbol: "IE000N4ZYX28", label: "iShares US" },
  { symbol: "IE000N51F726", label: "iShares World ESG" },
  { symbol: "IE000QAZP7L2", label: "iShares Emerging" },
  { symbol: "IE00BYX5N771", label: "Fidelity Japan" },
  { symbol: "IE00B1G3DH73", label: "Vanguard US Hedged" },
  { symbol: "IE00BYX5MD61", label: "Fidelity Europe" },
  { symbol: "IE00BDZVHT63", label: "Fidelity Pacific ex-Japan" },
];

const KIND_META: Record<PortfolioKind, { label: string; single: string; icon: typeof BarChart3 }> = {
  indices: { label: "Indices", single: "indice", icon: BarChart3 },
  crypto: { label: "Crypto", single: "crypto", icon: Bitcoin },
  stocks: { label: "Acciones", single: "accion", icon: BriefcaseBusiness },
};

const TREND_RANGES: Record<TrendWindow, TrendRange[]> = {
  "1h": ["1d", "5d", "1mo", "3mo"],
  "1d": ["6mo", "1y", "2y", "5y", "10y", "max"],
};

const DEFAULT_TREND_RANGE: Record<TrendWindow, TrendRange> = {
  "1h": "5d",
  "1d": "6mo",
};

const euro = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const percent = new Intl.NumberFormat("es-ES", {
  style: "percent",
  maximumFractionDigits: 2,
});

const priceFormat = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 6,
});

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeNumber(value: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
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

function compactNumber(value: number, maxDecimals = 12) {
  return Number.isFinite(value) ? value.toFixed(maxDecimals).replace(/\.?0+$/, "") : "0";
}

function isDecimalInput(value: string) {
  return /^\d*([,.]\d*)?$/.test(value);
}

function formatDateTime(value?: string | null) {
  if (!value) return "Sin refrescar";
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatTrendLabel(bucket: TrendWindow, value: string) {
  return new Intl.DateTimeFormat(
    "es-ES",
    bucket === "1h"
      ? { day: "2-digit", month: "2-digit", hour: "2-digit" }
      : { day: "2-digit", month: "2-digit", year: "2-digit" },
  ).format(new Date(value));
}

function formatTrendRange(range: TrendRange) {
  switch (range) {
    case "1d":
      return "1d";
    case "5d":
      return "5d";
    case "1mo":
      return "1m";
    case "3mo":
      return "3m";
    case "6mo":
      return "6m";
    case "1y":
      return "1a";
    case "2y":
      return "2a";
    case "5y":
      return "5a";
    case "10y":
      return "10a";
    default:
      return "MAX";
  }
}

function emptyHistory(): HistoryCache {
  return { hourly: [], daily: [] };
}

function normalizeHistorySnapshots(value: unknown): HistorySnapshot[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const snapshot = item as Partial<HistorySnapshot>;
      if (!snapshot.bucketKey || !snapshot.capturedAt) return null;
      return {
        bucketKey: String(snapshot.bucketKey),
        capturedAt: String(snapshot.capturedAt),
        value: safeNumber(snapshot.value ?? 0),
        invested: safeNumber(snapshot.invested ?? 0),
      };
    })
    .filter(Boolean) as HistorySnapshot[];
}

function normalizeHistoryCache(value: unknown): HistoryCache {
  if (!value || typeof value !== "object") return emptyHistory();
  const candidate = value as Partial<HistoryCache>;
  return {
    hourly: normalizeHistorySnapshots(candidate.hourly),
    daily: normalizeHistorySnapshots(candidate.daily),
  };
}

function readHistoryCache(): HistoryCache {
  try {
    const cached = localStorage.getItem(HISTORY_CACHE_KEY);
    return cached ? normalizeHistoryCache(JSON.parse(cached)) : emptyHistory();
  } catch {
    localStorage.removeItem(HISTORY_CACHE_KEY);
    return emptyHistory();
  }
}

function bucketKeyFor(date: Date, bucket: "hourly" | "daily") {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  if (bucket === "daily") return `${year}-${month}-${day}`;
  const hour = `${date.getHours()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hour}`;
}

function shiftDate(date: Date, bucket: "hourly" | "daily") {
  const next = new Date(date);
  if (bucket === "hourly") next.setHours(next.getHours() - 1);
  else next.setDate(next.getDate() - 1);
  return next;
}

function upsertSnapshot(list: HistorySnapshot[], next: HistorySnapshot) {
  const index = list.findIndex((snapshot) => snapshot.bucketKey === next.bucketKey);
  if (index === -1) return [...list, next];
  const copy = [...list];
  copy[index] = next;
  return copy;
}

function applyHistorySnapshot(history: HistoryCache, capturedAt: string, value: number, invested: number) {
  const stamp = new Date(capturedAt);
  const hourly = upsertSnapshot(history.hourly, {
    bucketKey: bucketKeyFor(stamp, "hourly"),
    capturedAt,
    value,
    invested,
  });
  const daily = upsertSnapshot(history.daily, {
    bucketKey: bucketKeyFor(stamp, "daily"),
    capturedAt,
    value,
    invested,
  });

  const sameHourly =
    hourly.length === history.hourly.length &&
    hourly.every((snapshot, index) => snapshot === history.hourly[index]);
  const sameDaily =
    daily.length === history.daily.length &&
    daily.every((snapshot, index) => snapshot === history.daily[index]);

  return sameHourly && sameDaily ? history : { hourly, daily };
}

function resolveTrend(history: HistorySnapshot[], bucket: "hourly" | "daily", currentValue: number, referenceAt?: string | null) {
  const baseDate = referenceAt ? new Date(referenceAt) : new Date();
  const previousKey = bucketKeyFor(shiftDate(baseDate, bucket), bucket);
  const snapshot = history.find((item) => item.bucketKey === previousKey);
  if (!snapshot) return null;
  const amount = currentValue - snapshot.value;
  const ratio = snapshot.value > 0 ? currentValue / snapshot.value - 1 : 0;
  return { label: bucket === "hourly" ? "1h" : "1d", amount, ratio, capturedAt: snapshot.capturedAt };
}

function buildTrendDialogFromSeries(
  history: HistoryApiPoint[],
  bucket: TrendWindow,
  range: TrendRange,
  currentInvested: number,
  statusText: string,
) {
  const points = [...history]
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt))
    .map((snapshot) => ({
      label: formatTrendLabel(bucket, snapshot.capturedAt),
      capturedAt: snapshot.capturedAt,
      value: snapshot.value,
      invested: currentInvested,
    }));

  if (points.length < 2) {
    return {
      bucket,
      range,
      ranges: TREND_RANGES[bucket],
      points,
      loading: false,
      statusText,
      summary: null,
    } satisfies TrendDialog;
  }

  const first = points[0];
  const last = points.at(-1) ?? first;
  const amount = last.value - first.value;
  const ratio = first.value > 0 ? last.value / first.value - 1 : 0;
  return {
    bucket,
    range,
    ranges: TREND_RANGES[bucket],
    points,
    loading: false,
    statusText,
    summary: { amount, ratio },
  } satisfies TrendDialog;
}

function readPrivacyCache(): PrivacyCache {
  try {
    const cached = localStorage.getItem(PRIVACY_CACHE_KEY);
    if (!cached) return { hidden: false, pattern: null, updatedAt: new Date().toISOString() };
    const parsed = JSON.parse(cached) as Partial<PrivacyCache>;
    return {
      hidden: Boolean(parsed.hidden),
      pattern: typeof parsed.pattern === "string" && parsed.pattern ? parsed.pattern : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    localStorage.removeItem(PRIVACY_CACHE_KEY);
    return { hidden: false, pattern: null, updatedAt: new Date().toISOString() };
  }
}

function quoteKey(kind: PortfolioKind, symbol: string) {
  return `${kind}:${symbol.toUpperCase()}`;
}

function positionValue(position: Position, portfolio: Portfolio, quotes: Map<string, MarketQuote>) {
  const quote = quotes.get(quoteKey(portfolio.kind, position.symbol));
  return position.quantity * (quote?.priceEUR ?? 0);
}

function portfolioValue(portfolio: Portfolio, quotes: Map<string, MarketQuote>) {
  return portfolio.positions.reduce((sum, position) => sum + positionValue(position, portfolio, quotes), 0);
}

function gainFor(value: number, investedEUR: number) {
  const amount = value - investedEUR;
  const ratio = investedEUR > 0 ? value / investedEUR - 1 : 0;
  return { amount, ratio };
}

function createPortfolio(kind: PortfolioKind, name?: string): Portfolio {
  return {
    id: id(),
    kind,
    name: name ?? `Cartera ${KIND_META[kind].label}`,
    investedEUR: 0,
    positions: [],
  };
}

function normalizeImportedPortfolio(value: unknown): Portfolio | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Portfolio>;
  if (!candidate.id || !candidate.name || !candidate.kind || !["indices", "crypto", "stocks"].includes(candidate.kind)) {
    return null;
  }

  return {
    id: String(candidate.id),
    kind: candidate.kind,
    name: String(candidate.name),
    investedEUR: safeNumber(candidate.investedEUR ?? 0),
    positions: Array.isArray(candidate.positions)
      ? candidate.positions
          .map((position) => {
            if (!position || typeof position !== "object") return null;
            const item = position as Partial<Position>;
            if (!item.id || !item.symbol) return null;
            return {
              id: String(item.id),
              symbol: String(item.symbol).trim().toUpperCase(),
              quantity: safeNumber(item.quantity ?? 0),
            };
          })
          .filter(Boolean) as Position[]
      : [],
  };
}

function metalPortfolioFromLegacy(): Portfolio | null {
  for (const key of LEGACY_KEYS) {
    const cached = localStorage.getItem(key);
    if (!cached) continue;
    try {
      const parsed = JSON.parse(cached) as { holdings?: LegacyHolding[]; investedEUR?: number };
      const positions = (parsed.holdings ?? [])
        .map((holding) => ({
          id: id(),
          symbol: holding.isin,
          quantity: safeNumber(holding.shares ?? 0),
        }))
        .filter((position) => position.symbol && position.quantity >= 0);

      if (positions.length) {
        return {
          id: id(),
          kind: "indices",
          name: "Cartera Metal",
          investedEUR: safeNumber(parsed.investedEUR ?? 10000),
          positions,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function metalTemplate(): Portfolio {
  return {
    id: id(),
    kind: "indices",
    name: "Cartera Metal",
    investedEUR: 0,
    positions: INDEX_OPTIONS.map((asset) => ({
      id: id(),
      symbol: asset.symbol,
      quantity: 0,
    })),
  };
}

export default function App() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [quotes, setQuotes] = useState<MarketQuote[]>([]);
  const [activeView, setActiveView] = useState<"dashboard" | PortfolioKind>("dashboard");
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyCache, setHistoryCache] = useState<HistoryCache>(emptyHistory());
  const [loadingTrend, setLoadingTrend] = useState<TrendWindow | null>(null);
  const [trendDialog, setTrendDialog] = useState<TrendDialog | null>(null);
  const [pricesHidden, setPricesHidden] = useState(false);
  const [pattern, setPattern] = useState<string | null>(null);
  const [patternDialog, setPatternDialog] = useState<PatternDialog | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const idleTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const privacy = readPrivacyCache();
    setPricesHidden(privacy.hidden);
    setPattern(privacy.pattern);
    const localHistory = readHistoryCache();
    let restoredHistory = localHistory;

    const cached = localStorage.getItem(APP_CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as AppCache;
        setPortfolios(parsed.portfolios ?? []);
        setLastSavedAt(parsed.savedAt ?? null);
        if (!localHistory.hourly.length && !localHistory.daily.length && parsed.history) {
          restoredHistory = normalizeHistoryCache(parsed.history);
        }
        setHistoryCache(restoredHistory);
        return;
      } catch {
        localStorage.removeItem(APP_CACHE_KEY);
      }
    }

    const migratedMetal = metalPortfolioFromLegacy();
    setHistoryCache(restoredHistory);
    setPortfolios(migratedMetal ? [migratedMetal] : []);
  }, []);

  const persistPrivacy = useCallback((hidden: boolean, nextPattern = pattern) => {
    const payload: PrivacyCache = {
      hidden,
      pattern: nextPattern,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(PRIVACY_CACHE_KEY, JSON.stringify(payload));
    setPricesHidden(hidden);
    setPattern(nextPattern);
  }, [pattern]);

  const persistHistory = useCallback((next: HistoryCache) => {
    localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(next));
  }, []);

  const quoteMap = useMemo(
    () => new Map(quotes.map((quote) => [quoteKey(quote.kind, quote.symbol), quote])),
    [quotes],
  );

  const assetQuery = useMemo(() => {
    const assets = portfolios.flatMap((portfolio) =>
      portfolio.positions.map((position) => quoteKey(portfolio.kind, position.symbol)),
    );
    return [...new Set(assets)].join(",");
  }, [portfolios]);

  const historyPositionQuery = useMemo(() => {
    const grouped = new Map<string, { kind: PortfolioKind; symbol: string; quantity: number }>();
    portfolios.forEach((portfolio) => {
      portfolio.positions.forEach((position) => {
        const normalizedSymbol = position.symbol.trim().toUpperCase();
        if (!normalizedSymbol || position.quantity <= 0) return;
        const key = quoteKey(portfolio.kind, normalizedSymbol);
        const current = grouped.get(key);
        if (current) {
          current.quantity += position.quantity;
          return;
        }
        grouped.set(key, {
          kind: portfolio.kind,
          symbol: normalizedSymbol,
          quantity: position.quantity,
        });
      });
    });
    return [...grouped.values()]
      .map((item) => `${item.kind}:${item.symbol}:${item.quantity}`)
      .join(",");
  }, [portfolios]);

  const refreshQuotes = useCallback(async () => {
    if (!assetQuery) {
      setQuotes([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/quotes?assets=${encodeURIComponent(assetQuery)}&t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { refreshedAt: string; quotes: MarketQuote[] };
      setQuotes(payload.quotes);
      setLastRefresh(payload.refreshedAt);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo refrescar");
    } finally {
      setIsLoading(false);
    }
  }, [assetQuery]);

  useEffect(() => {
    refreshQuotes();
    const timer = window.setInterval(() => refreshQuotes(), 60_000);
    return () => window.clearInterval(timer);
  }, [refreshQuotes]);

  const totals = useMemo(() => {
    const byKind = (["indices", "crypto", "stocks"] as PortfolioKind[]).map((kind) => {
      const kindPortfolios = portfolios.filter((portfolio) => portfolio.kind === kind);
      const value = kindPortfolios.reduce((sum, portfolio) => sum + portfolioValue(portfolio, quoteMap), 0);
      const invested = kindPortfolios.reduce((sum, portfolio) => sum + portfolio.investedEUR, 0);
      return { kind, value, invested, ...gainFor(value, invested), count: kindPortfolios.length };
    });
    const value = byKind.reduce((sum, item) => sum + item.value, 0);
    const invested = byKind.reduce((sum, item) => sum + item.invested, 0);
    return { byKind, value, invested, ...gainFor(value, invested) };
  }, [portfolios, quoteMap]);

  useEffect(() => {
    if (!portfolios.length || totals.value <= 0 || !lastRefresh) return;
    setHistoryCache((current) => {
      const next = applyHistorySnapshot(current, lastRefresh, totals.value, totals.invested);
      if (next !== current) persistHistory(next);
      return next;
    });
  }, [lastRefresh, persistHistory, portfolios.length, totals.invested, totals.value]);

  const trendMetrics = useMemo(
    () => ({
      "1h": resolveTrend(historyCache.hourly, "hourly", totals.value, lastRefresh),
      "1d": resolveTrend(historyCache.daily, "daily", totals.value, lastRefresh),
    }),
    [historyCache.daily, historyCache.hourly, lastRefresh, totals.value],
  );

  const fetchGlobalHistory = useCallback(
    async (bucket: TrendWindow, range = DEFAULT_TREND_RANGE[bucket], keepOpen = false) => {
      if (!historyPositionQuery) return;

      if (keepOpen) {
        setTrendDialog((current) =>
          current
            ? {
                ...current,
                bucket,
                range,
                ranges: TREND_RANGES[bucket],
                loading: true,
                statusText: "Cargando historico global...",
              }
            : current,
        );
      } else {
        setLoadingTrend(bucket);
      }

      try {
        const response = await fetch(
          `/api/history?window=${bucket}&range=${range}&positions=${encodeURIComponent(historyPositionQuery)}&t=${Date.now()}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as HistoryApiResponse;
        const okAssets = payload.assets.filter((asset) => asset.status === "ok").length;
        const statusText =
          okAssets === payload.assets.length
            ? `${payload.assets.length} activo(s) calculados con historico ${formatTrendRange(payload.range)}`
            : `${okAssets}/${payload.assets.length} activo(s) con historico ${formatTrendRange(payload.range)}`;
        setTrendDialog(buildTrendDialogFromSeries(payload.series, bucket, payload.range, totals.invested, statusText));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "No se pudo cargar el historico global");
        setTrendDialog((current) =>
          keepOpen && current
            ? {
                ...current,
                loading: false,
                statusText: "No se pudo actualizar el historico global.",
              }
            : current,
        );
      } finally {
        setLoadingTrend(null);
      }
    },
    [historyPositionQuery, totals.invested],
  );

  function persist(next = portfolios, nextHistory = historyCache) {
    const savedAt = new Date().toISOString();
    localStorage.setItem(APP_CACHE_KEY, JSON.stringify({ portfolios: next, savedAt, history: nextHistory } satisfies AppCache));
    setLastSavedAt(savedAt);
  }

  function save() {
    setIsSaving(true);
    persist();
    window.setTimeout(() => setIsSaving(false), 650);
  }

  function exportPortfolios() {
    const savedAt = new Date().toISOString();
    const payload: AppCache = { portfolios, savedAt, history: historyCache };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `hbarragan-stock-carteras-${savedAt.slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function requestExportPortfolios() {
    if (pattern) {
      setPatternDialog({ mode: "unlock", reason: "export" });
      return;
    }
    exportPortfolios();
  }

  async function importPortfolios(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text()) as Partial<AppCache> | Portfolio[];
      const rawPortfolios = Array.isArray(parsed) ? parsed : parsed.portfolios;
      const importedHistory = Array.isArray(parsed) ? emptyHistory() : normalizeHistoryCache(parsed.history);
      const imported = (rawPortfolios ?? [])
        .map((portfolio) => normalizeImportedPortfolio(portfolio))
        .filter(Boolean) as Portfolio[];

      if (!imported.length) throw new Error("El archivo no contiene carteras validas");

      setPortfolios(imported);
      setHistoryCache(importedHistory);
      setActiveView("dashboard");
      persistHistory(importedHistory);
      persist(imported, importedHistory);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo importar el archivo");
    } finally {
      event.target.value = "";
    }
  }

  function updatePortfolio(portfolioId: string, updater: (portfolio: Portfolio) => Portfolio) {
    setPortfolios((current) => current.map((portfolio) => (portfolio.id === portfolioId ? updater(portfolio) : portfolio)));
  }

  function addPortfolio(kind: PortfolioKind) {
    setPortfolios((current) => [...current, createPortfolio(kind)]);
    setActiveView(kind);
  }

  function addMetalPortfolio() {
    setPortfolios((current) => [...current, metalTemplate()]);
    setActiveView("indices");
  }

  function removePortfolio(portfolioId: string) {
    setPortfolios((current) => current.filter((portfolio) => portfolio.id !== portfolioId));
  }

  function addPosition(portfolioId: string, symbol: string) {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) return;
    updatePortfolio(portfolioId, (portfolio) => ({
      ...portfolio,
      positions: portfolio.positions.some((position) => position.symbol.toUpperCase() === normalized)
        ? portfolio.positions
        : [...portfolio.positions, { id: id(), symbol: normalized, quantity: 0 }],
    }));
  }

  function removePosition(portfolioId: string, positionId: string) {
    updatePortfolio(portfolioId, (portfolio) => ({
      ...portfolio,
      positions: portfolio.positions.filter((position) => position.id !== positionId),
    }));
  }

  const hidePrices = useCallback(() => {
    if (!pattern) return;
    persistPrivacy(true, pattern);
  }, [pattern, persistPrivacy]);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    if (!pattern || pricesHidden) return;
    idleTimerRef.current = window.setTimeout(hidePrices, AUTO_HIDE_MS);
  }, [hidePrices, pattern, pricesHidden]);

  useEffect(() => {
    resetIdleTimer();
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "pointerdown"];
    events.forEach((eventName) => window.addEventListener(eventName, resetIdleTimer, { passive: true }));
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      events.forEach((eventName) => window.removeEventListener(eventName, resetIdleTimer));
    };
  }, [resetIdleTimer]);

  function togglePricePrivacy() {
    if (pricesHidden) {
      setPatternDialog({ mode: pattern ? "unlock" : "setup", reason: "show" });
      return;
    }

    if (!pattern) {
      setPatternDialog({ mode: "setup", reason: "hide" });
      return;
    }

    persistPrivacy(true, pattern);
  }

  function createPattern(nextPattern: string) {
    persistPrivacy(true, nextPattern);
    setPatternDialog(null);
  }

  function unlockWithPattern() {
    if (!patternDialog) return;
    if (patternDialog.reason === "export") {
      setPatternDialog(null);
      exportPortfolios();
      return;
    }
    persistPrivacy(false, pattern);
    setPatternDialog(null);
  }

  function openTrendChart(bucket: TrendWindow) {
    if (loadingTrend) return;
    void fetchGlobalHistory(bucket, DEFAULT_TREND_RANGE[bucket]);
  }

  function updateTrendRange(range: TrendRange) {
    if (!trendDialog || trendDialog.loading) return;
    void fetchGlobalHistory(trendDialog.bucket, range, true);
  }

  const visiblePortfolios =
    activeView === "dashboard" ? portfolios : portfolios.filter((portfolio) => portfolio.kind === activeView);

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">hbarragan stock</p>
          <h1>Dashboard de carteras</h1>
        </div>
        <div className="actions">
          <button className="icon-button" onClick={togglePricePrivacy} title={pricesHidden ? "Mostrar importes" : "Ocultar importes"}>
            {pricesHidden ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
          <button className="icon-button" onClick={refreshQuotes} title="Refrescar precios">
            <RefreshCcw size={18} className={isLoading ? "spin" : ""} />
          </button>
          <button className="secondary-button" onClick={requestExportPortfolios}>
            <Download size={17} />
            Exportar
          </button>
          <button className="secondary-button" onClick={() => importInputRef.current?.click()}>
            <Upload size={17} />
            Importar
          </button>
          <input
            ref={importInputRef}
            className="hidden-file"
            type="file"
            accept="application/json,.json"
            onChange={importPortfolios}
          />
          <button className="primary-button" onClick={save}>
            {isSaving ? <Check size={17} /> : <Save size={17} />}
            Guardar
          </button>
        </div>
      </section>

      <nav className="tabs">
        <button className={activeView === "dashboard" ? "active" : ""} onClick={() => setActiveView("dashboard")}>
          <LayoutDashboard size={17} />
          Dashboard
        </button>
        {(["indices", "crypto", "stocks"] as PortfolioKind[]).map((kind) => {
          const Icon = KIND_META[kind].icon;
          return (
            <button className={activeView === kind ? "active" : ""} onClick={() => setActiveView(kind)} key={kind}>
              <Icon size={17} />
              {KIND_META[kind].label}
            </button>
          );
        })}
      </nav>

      <section className="metrics-grid">
        <article className="metric primary-metric">
          <div className="metric-header">
            <WalletCards size={20} />
            <div className="trend-toggle" role="tablist" aria-label="Ventana historica">
              <TrendButton loading={loadingTrend === "1h"} label="1h" onClick={() => openTrendChart("1h")} />
              <TrendButton loading={loadingTrend === "1d"} label="1d" onClick={() => openTrendChart("1d")} />
            </div>
          </div>
          <span>Valor global</span>
          <strong>
            <SecretValue hidden={pricesHidden}>{euro.format(totals.value)}</SecretValue>
          </strong>
          <small className={totals.amount >= 0 ? "positive" : "negative"}>
            {totals.amount >= 0 ? "+" : ""}
            <SecretValue hidden={pricesHidden}>{euro.format(totals.amount)}</SecretValue> vs aportado
          </small>
          <small className="trend-caption">
            1h {trendMetrics["1h"] ? `${trendMetrics["1h"].amount >= 0 ? "+" : ""}${percent.format(trendMetrics["1h"].ratio)}` : "pendiente"} · 1d{" "}
            {trendMetrics["1d"] ? `${trendMetrics["1d"].amount >= 0 ? "+" : ""}${percent.format(trendMetrics["1d"].ratio)}` : "pendiente"}
          </small>
          <small className="trend-caption">
            1h abre rango corto. 1d carga 6 meses globales y puedes ampliar mas.
          </small>
        </article>
        <article className="metric">
          <CircleDollarSign size={20} />
          <span>Aportado total</span>
          <strong>
            <SecretValue hidden={pricesHidden}>{euro.format(totals.invested)}</SecretValue>
          </strong>
          <small>Editable en cada cartera</small>
        </article>
        <article className="metric">
          <LineChart size={20} />
          <span>Ganancia global</span>
          <strong className={totals.ratio >= 0 ? "positive" : "negative"}>
            {totals.ratio >= 0 ? "+" : ""}
            {percent.format(totals.ratio)}
          </strong>
          <small>{formatDateTime(lastRefresh)}</small>
        </article>
        <article className="metric">
          <Activity size={20} />
          <span>Precios</span>
          <strong>
            {quotes.filter((quote) => quote.status === "ok").length}/{new Set(assetQuery.split(",").filter(Boolean)).size}
          </strong>
          <small>Refresco cada minuto</small>
        </article>
      </section>

      {error && <section className="status-line error-line">{error}</section>}

      {activeView === "dashboard" && <DashboardBreakdown rows={totals.byKind} pricesHidden={pricesHidden} />}

      <section className="workspace-grid wide">
        <div className="portfolio-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{activeView === "dashboard" ? "Todas las carteras" : KIND_META[activeView].label}</p>
              <h2>{activeView === "dashboard" ? "Carteras" : `Carteras de ${KIND_META[activeView].label}`}</h2>
            </div>
            <div className="section-actions">
              {activeView === "indices" && (
                <button className="secondary-button" onClick={addMetalPortfolio}>
                  <Plus size={16} />
                  Anadir Metal
                </button>
              )}
              {activeView !== "dashboard" && (
                <button className="primary-button" onClick={() => addPortfolio(activeView)}>
                  <Plus size={16} />
                  Nueva cartera
                </button>
              )}
            </div>
          </div>

          <div className="portfolio-list">
            {visiblePortfolios.length === 0 ? (
              <div className="empty-state">
                <strong>No hay carteras todavia.</strong>
                <span>Entra en Indices, Crypto o Acciones y crea la primera.</span>
              </div>
            ) : (
              visiblePortfolios.map((portfolio) => (
                <PortfolioCard
                  key={portfolio.id}
                  portfolio={portfolio}
                  quotes={quoteMap}
                  onChange={(next) => updatePortfolio(portfolio.id, () => next)}
                  onRemove={() => removePortfolio(portfolio.id)}
                  onAddPosition={(symbol) => addPosition(portfolio.id, symbol)}
                  onRemovePosition={(positionId) => removePosition(portfolio.id, positionId)}
                  pricesHidden={pricesHidden}
                />
              ))
            )}
          </div>
        </div>
      </section>

      <footer className="footer-line">Ultimo guardado: {formatDateTime(lastSavedAt)}</footer>

      {trendDialog && (
        <TrendChartModal
          dialog={trendDialog}
          pricesHidden={pricesHidden}
          onRangeChange={updateTrendRange}
          onClose={() => setTrendDialog(null)}
        />
      )}

      {patternDialog && (
        <PatternModal
          dialog={patternDialog}
          expectedPattern={pattern}
          onCreate={createPattern}
          onUnlock={unlockWithPattern}
          onClose={() => setPatternDialog(null)}
        />
      )}
    </main>
  );
}

function DashboardBreakdown({
  rows,
  pricesHidden,
}: {
  rows: Array<{ kind: PortfolioKind; value: number; invested: number; amount: number; ratio: number; count: number }>;
  pricesHidden: boolean;
}) {
  return (
    <section className="breakdown-grid">
      {rows.map((row) => {
        const Icon = KIND_META[row.kind].icon;
        return (
          <article className="breakdown-card" key={row.kind}>
            <Icon size={19} />
            <span>{KIND_META[row.kind].label}</span>
            <strong>
              <SecretValue hidden={pricesHidden}>{euro.format(row.value)}</SecretValue>
            </strong>
            <small className={row.amount >= 0 ? "positive" : "negative"}>
              {row.amount >= 0 ? "+" : ""}
              {percent.format(row.ratio)} · <SecretValue hidden={pricesHidden}>{euro.format(row.amount)}</SecretValue>
            </small>
            <em>{row.count} cartera(s)</em>
          </article>
        );
      })}
    </section>
  );
}

function PortfolioCard({
  portfolio,
  quotes,
  onChange,
  onRemove,
  onAddPosition,
  onRemovePosition,
  pricesHidden,
}: {
  portfolio: Portfolio;
  quotes: Map<string, MarketQuote>;
  onChange: (portfolio: Portfolio) => void;
  onRemove: () => void;
  onAddPosition: (symbol: string) => void;
  onRemovePosition: (positionId: string) => void;
  pricesHidden: boolean;
}) {
  const value = portfolioValue(portfolio, quotes);
  const gain = gainFor(value, portfolio.investedEUR);

  return (
    <article className="portfolio-card">
      <div className="portfolio-card-header">
        <div>
          <input
            className="portfolio-name"
            value={portfolio.name}
            onChange={(event) => onChange({ ...portfolio, name: event.target.value })}
          />
          <span>{KIND_META[portfolio.kind].label}</span>
        </div>
        <button className="danger-button" onClick={onRemove} title="Eliminar cartera">
          <Trash2 size={16} />
        </button>
      </div>

      <div className="portfolio-summary">
        {pricesHidden ? (
          <div className="masked-input">
            <span>EUR</span>
            <strong>******</strong>
          </div>
        ) : (
          <DecimalInput
            className="money-input invested-input"
            prefix="EUR"
            value={portfolio.investedEUR}
            maxDecimals={2}
            onValueChange={(investedEUR) => onChange({ ...portfolio, investedEUR })}
          />
        )}
        <div>
          <span>Valor</span>
          <strong>
            <SecretValue hidden={pricesHidden}>{euro.format(value)}</SecretValue>
          </strong>
        </div>
        <div>
          <span>Ganancia</span>
          <strong className={gain.amount >= 0 ? "positive" : "negative"}>
            {gain.amount >= 0 ? "+" : ""}
            {percent.format(gain.ratio)}
          </strong>
        </div>
      </div>

      <AssetSearch kind={portfolio.kind} onPick={onAddPosition} />

      <div className="table-shell compact-table">
        <table>
          <thead>
            <tr>
              <th>Activo</th>
              <th>Cantidad</th>
              <th>Precio EUR</th>
              <th>Valor</th>
              <th>Dia</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {portfolio.positions.map((position) => {
              const quote = quotes.get(quoteKey(portfolio.kind, position.symbol));
              const rowValue = positionValue(position, portfolio, quotes);
              return (
                <tr key={position.id}>
                  <td>
                    <strong>{quote?.shortName ?? position.symbol}</strong>
                    <span className="mono">{position.symbol}</span>
                  </td>
                  <td>
                    <DecimalInput
                      className="money-input unit-input"
                      prefix={portfolio.kind === "indices" ? "PART." : "UD."}
                      value={position.quantity}
                      maxDecimals={12}
                      onValueChange={(quantity) =>
                        onChange({
                          ...portfolio,
                          positions: portfolio.positions.map((item) =>
                            item.id === position.id ? { ...item, quantity } : item,
                          ),
                        })
                      }
                    />
                  </td>
                  <td>
                    <SecretValue hidden={pricesHidden}>{quote?.priceEUR ? priceFormat.format(quote.priceEUR) : "Sin dato"}</SecretValue>
                  </td>
                  <td>
                    <SecretValue hidden={pricesHidden}>{euro.format(rowValue)}</SecretValue>
                  </td>
                  <td className={(quote?.changePercent ?? 0) >= 0 ? "positive" : "negative"}>
                    {quote?.changePercent == null ? "Pendiente" : `${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)} %`}
                  </td>
                  <td>
                    <button className="icon-button small" onClick={() => onRemovePosition(position.id)}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function SecretValue({ hidden, children }: { hidden: boolean; children: React.ReactNode }) {
  return <span className={hidden ? "masked-value" : undefined}>{hidden ? "******" : children}</span>;
}

function TrendButton({ loading, label, onClick }: { loading: boolean; label: TrendWindow; onClick: () => void }) {
  return (
    <button
      className={loading ? "trend-button loading" : "trend-button"}
      onClick={onClick}
      type="button"
      title={`Historico ${label}`}
      disabled={loading}
    >
      {loading ? <RefreshCcw size={14} className="spin" /> : <LineChart size={14} />}
      {loading ? "Cargando" : label}
    </button>
  );
}

function TrendChartModal({
  dialog,
  pricesHidden,
  onRangeChange,
  onClose,
}: {
  dialog: TrendDialog;
  pricesHidden: boolean;
  onRangeChange: (range: TrendRange) => void;
  onClose: () => void;
}) {
  const width = 720;
  const height = 260;
  const padding = 30;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const ticks = 4;
  const allValues = dialog.points.length
    ? dialog.points.flatMap((point) => [point.value, point.invested])
    : [0, dialog.summary?.amount ?? 0];
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const range = maxValue - minValue || Math.max(maxValue, 1);
  const lastPoint = dialog.points.at(-1) ?? null;
  const sampleIndexes = Array.from(
    new Set([0, Math.floor((dialog.points.length - 1) / 3), Math.floor(((dialog.points.length - 1) * 2) / 3), dialog.points.length - 1]),
  ).filter((index) => index >= 0);

  function positionX(index: number) {
    if (dialog.points.length <= 1) return padding;
    return padding + (index / (dialog.points.length - 1)) * chartWidth;
  }

  function positionY(value: number) {
    return padding + (1 - (value - minValue) / range) * chartHeight;
  }

  function buildPath(values: number[]) {
    return values
      .map((value, index) => `${index === 0 ? "M" : "L"} ${positionX(index).toFixed(2)} ${positionY(value).toFixed(2)}`)
      .join(" ");
  }

  const valuePath = buildPath(dialog.points.map((point) => point.value));
  const investedPath = buildPath(dialog.points.map((point) => point.invested));

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="trend-chart-title">
      <div className="chart-modal">
        <div className="pattern-modal-header">
          <div>
            <p className="eyebrow">Historico global</p>
            <h2 id="trend-chart-title">
              Grafico {dialog.bucket} · {formatTrendRange(dialog.range)}
            </h2>
          </div>
          <button className="icon-button small" onClick={onClose} title="Cerrar">
            <X size={16} />
          </button>
        </div>

        <div className="trend-range-list" role="tablist" aria-label="Rango historico">
          {dialog.ranges.map((rangeOption) => (
            <button
              key={`${dialog.bucket}-${rangeOption}`}
              type="button"
              className={dialog.range === rangeOption ? "trend-range active" : "trend-range"}
              onClick={() => onRangeChange(rangeOption)}
              disabled={dialog.loading}
            >
              {formatTrendRange(rangeOption)}
            </button>
          ))}
        </div>

        <div className="chart-summary">
          <div className="chart-summary-item">
            <span>Actual</span>
            <strong>
              <SecretValue hidden={pricesHidden}>{lastPoint ? euro.format(lastPoint.value) : "Sin dato"}</SecretValue>
            </strong>
          </div>
          <div className="chart-summary-item">
            <span>Periodo</span>
            <strong className={dialog.summary ? (dialog.summary.amount >= 0 ? "positive" : "negative") : undefined}>
              {dialog.summary ? `${dialog.summary.amount >= 0 ? "+" : ""}${percent.format(dialog.summary.ratio)}` : "Sin base"}
            </strong>
          </div>
          <div className="chart-summary-item">
            <span>Muestras</span>
            <strong>{dialog.points.length}</strong>
          </div>
        </div>

        <p className="chart-status">{dialog.loading ? "Cargando historico global..." : dialog.statusText}</p>

        {dialog.loading ? (
          <div className="chart-empty">
            <strong>Cargando...</strong>
            <span>Estamos recalculando la serie global de la cartera.</span>
          </div>
        ) : dialog.points.length < 2 ? (
          <div className="chart-empty">
            <strong>No hay suficientes datos todavia.</strong>
            <span>Prueba con otro rango o refresca para seguir guardando historial local.</span>
          </div>
        ) : (
          <div className="chart-shell">
            <div className="chart-legend">
              <span><i className="legend-line value-line" /> Valor global</span>
              <span><i className="legend-line invested-line" /> Aportado global</span>
            </div>
            <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} aria-label={`Grafico ${dialog.bucket}`}>
              {Array.from({ length: ticks + 1 }, (_, index) => {
                const y = padding + (chartHeight / ticks) * index;
                return <line key={index} x1={padding} x2={width - padding} y1={y} y2={y} className="chart-grid" />;
              })}
              <path d={investedPath} className="chart-path invested-path" />
              <path d={valuePath} className="chart-path value-path" />
              {dialog.points.map((point, index) => (
                <circle key={point.capturedAt} cx={positionX(index)} cy={positionY(point.value)} r={index === dialog.points.length - 1 ? 4.5 : 3} className="chart-dot" />
              ))}
            </svg>
            <div className="chart-axis">
              {sampleIndexes.map((index) => (
                <span key={`${dialog.bucket}-${dialog.points[index]?.capturedAt}`}>{dialog.points[index]?.label}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PatternModal({
  dialog,
  expectedPattern,
  onCreate,
  onUnlock,
  onClose,
}: {
  dialog: PatternDialog;
  expectedPattern: string | null;
  onCreate: (pattern: string) => void;
  onUnlock: () => void;
  onClose: () => void;
}) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<number[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const title =
    dialog.mode === "setup"
      ? "Crear patron"
      : dialog.reason === "export"
        ? "Patron para exportar"
        : "Patron para mostrar";
  const helper =
    dialog.mode === "setup"
      ? "Dibuja al menos 4 puntos. Se guardara solo en este navegador."
      : "Dibuja tu patron para continuar.";

  function updateSelected(next: number[]) {
    selectedRef.current = next;
    setSelected(next);
  }

  function dotFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const dot = element?.closest<HTMLButtonElement>("[data-pattern-dot]");
    if (!dot || !boardRef.current?.contains(dot)) return null;
    const value = Number(dot.dataset.patternDot);
    return Number.isFinite(value) ? value : null;
  }

  function addDot(dot: number) {
    const current = selectedRef.current;
    if (current.includes(dot)) return;
    updateSelected([...current, dot]);
  }

  function startPattern(event: React.PointerEvent<HTMLDivElement>) {
    const dot = dotFromPointer(event);
    if (!dot) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setMessage(null);
    setIsDrawing(true);
    updateSelected([dot]);
  }

  function movePattern(event: React.PointerEvent<HTMLDivElement>) {
    if (!isDrawing) return;
    const dot = dotFromPointer(event);
    if (dot) addDot(dot);
  }

  function finishPattern(event: React.PointerEvent<HTMLDivElement>) {
    if (!isDrawing) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDrawing(false);

    const dots = selectedRef.current;
    const nextPattern = dots.join("-");
    if (dialog.mode === "setup") {
      if (dots.length < 4) {
        setMessage("El patron debe tener al menos 4 puntos.");
        updateSelected([]);
        return;
      }
      onCreate(nextPattern);
      return;
    }

    if (expectedPattern && nextPattern === expectedPattern) {
      onUnlock();
      return;
    }

    setMessage("Patron incorrecto.");
    updateSelected([]);
  }

  function clearPattern() {
    setMessage(null);
    updateSelected([]);
  }

  const polyline = selected
    .map((dot) => {
      const index = dot - 1;
      const column = index % 3;
      const row = Math.floor(index / 3);
      return `${column * 100 + 50},${row * 100 + 50}`;
    })
    .join(" ");

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pattern-title">
      <div className="pattern-modal">
        <div className="pattern-modal-header">
          <div>
            <p className="eyebrow">Privacidad</p>
            <h2 id="pattern-title">{title}</h2>
          </div>
          <button className="icon-button small" onClick={onClose} title="Cerrar">
            ×
          </button>
        </div>
        <p className="pattern-helper">{helper}</p>
        <div
          ref={boardRef}
          className="pattern-board"
          onPointerDown={startPattern}
          onPointerMove={movePattern}
          onPointerUp={finishPattern}
          onPointerCancel={finishPattern}
        >
          <svg className="pattern-lines" viewBox="0 0 300 300" aria-hidden="true">
            {selected.length > 1 && <polyline points={polyline} />}
          </svg>
          {Array.from({ length: 9 }, (_, index) => {
            const dot = index + 1;
            const order = selected.indexOf(dot);
            return (
              <button
                key={dot}
                type="button"
                data-pattern-dot={dot}
                className={order >= 0 ? "pattern-dot active" : "pattern-dot"}
                aria-label={`Punto ${dot}`}
              >
                {order >= 0 ? order + 1 : ""}
              </button>
            );
          })}
        </div>
        {message && <p className="pattern-error">{message}</p>}
        <div className="pattern-actions">
          <button className="secondary-button" onClick={clearPattern}>Borrar</button>
          <button className="secondary-button" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function AssetSearch({ kind, onPick }: { kind: PortfolioKind; onPick: (symbol: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AssetSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 && kind !== "indices") {
      setResults([]);
      setSearchError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const response = await fetch(`/api/search?kind=${kind}&q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as { results: AssetSearchResult[]; error?: string };
        setResults(payload.results ?? []);
        if (payload.error) setSearchError(payload.error);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSearchError(error instanceof Error ? error.message : "No se pudo buscar");
        setResults([]);
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [kind, query]);

  function pick(symbol: string) {
    onPick(symbol);
    setQuery(symbol);
  }

  return (
    <div className="asset-search">
      <div className="asset-search-row">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            kind === "indices"
              ? "Buscar indice, ETF, fondo o ISIN..."
              : kind === "crypto"
                ? "Buscar crypto: bitcoin, BTC-EUR..."
                : "Buscar accion: Apple, AAPL, IBE.MC..."
          }
        />
        <button className="secondary-button" onClick={() => pick(query.trim().toUpperCase())}>
          <Plus size={16} />
          Anadir ticker
        </button>
      </div>
      <div className="search-results">
        {isSearching && <span className="search-hint">Buscando...</span>}
        {searchError && <span className="search-error">{searchError}</span>}
        {!isSearching &&
          results.map((result) => (
            <button key={`${result.kind}:${result.symbol}`} onClick={() => pick(result.symbol)}>
              <strong>{result.symbol}</strong>
              <span>{result.name}</span>
              <em>
                {[result.type, result.exchange || result.source].filter(Boolean).join(" · ")}
              </em>
            </button>
          ))}
      </div>
    </div>
  );
}

function DecimalInput({
  value,
  onValueChange,
  prefix,
  className,
  maxDecimals = 12,
}: {
  value: number;
  onValueChange: (value: number) => void;
  prefix: string;
  className: string;
  maxDecimals?: number;
}) {
  const [text, setText] = useState(compactNumber(value, maxDecimals));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) setText(compactNumber(value, maxDecimals));
  }, [isFocused, maxDecimals, value]);

  return (
    <label className={className}>
      <span>{prefix}</span>
      <input
        value={text}
        inputMode="decimal"
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          setText(compactNumber(safeNumber(text), maxDecimals));
        }}
        onChange={(event) => {
          const next = event.target.value;
          if (!isDecimalInput(next)) return;
          setText(next);
          onValueChange(safeNumber(next));
        }}
      />
    </label>
  );
}
