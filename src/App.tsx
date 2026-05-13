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
  const [pricesHidden, setPricesHidden] = useState(false);
  const [pattern, setPattern] = useState<string | null>(null);
  const [patternDialog, setPatternDialog] = useState<PatternDialog | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const idleTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const privacy = readPrivacyCache();
    setPricesHidden(privacy.hidden);
    setPattern(privacy.pattern);

    const cached = localStorage.getItem(APP_CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as AppCache;
        setPortfolios(parsed.portfolios ?? []);
        setLastSavedAt(parsed.savedAt ?? null);
        return;
      } catch {
        localStorage.removeItem(APP_CACHE_KEY);
      }
    }

    const migratedMetal = metalPortfolioFromLegacy();
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

  function persist(next = portfolios) {
    const savedAt = new Date().toISOString();
    localStorage.setItem(APP_CACHE_KEY, JSON.stringify({ portfolios: next, savedAt } satisfies AppCache));
    setLastSavedAt(savedAt);
  }

  function save() {
    setIsSaving(true);
    persist();
    window.setTimeout(() => setIsSaving(false), 650);
  }

  function exportPortfolios() {
    const savedAt = new Date().toISOString();
    const payload: AppCache = { portfolios, savedAt };
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
      const imported = (rawPortfolios ?? [])
        .map((portfolio) => normalizeImportedPortfolio(portfolio))
        .filter(Boolean) as Portfolio[];

      if (!imported.length) throw new Error("El archivo no contiene carteras validas");

      setPortfolios(imported);
      setActiveView("dashboard");
      persist(imported);
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
          <WalletCards size={20} />
          <span>Valor global</span>
          <strong>
            <SecretValue hidden={pricesHidden}>{euro.format(totals.value)}</SecretValue>
          </strong>
          <small className={totals.amount >= 0 ? "positive" : "negative"}>
            {totals.amount >= 0 ? "+" : ""}
            <SecretValue hidden={pricesHidden}>{euro.format(totals.amount)}</SecretValue> vs aportado
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
            <strong>••••••</strong>
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
  return <span className={hidden ? "masked-value" : undefined}>{hidden ? "••••••" : children}</span>;
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
