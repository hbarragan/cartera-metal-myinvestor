import {
  Activity,
  BarChart3,
  Bitcoin,
  BriefcaseBusiness,
  Check,
  CircleDollarSign,
  Download,
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

type LegacyHolding = {
  isin: string;
  shares?: number;
  lastVal?: number | null;
  lastNav?: number | null;
};

const APP_CACHE_KEY = "stock-hbarrag:v1";
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
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
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
          <button className="icon-button" onClick={refreshQuotes} title="Refrescar precios">
            <RefreshCcw size={18} className={isLoading ? "spin" : ""} />
          </button>
          <button className="secondary-button" onClick={exportPortfolios}>
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
          <strong>{euro.format(totals.value)}</strong>
          <small className={totals.amount >= 0 ? "positive" : "negative"}>
            {totals.amount >= 0 ? "+" : ""}
            {euro.format(totals.amount)} vs aportado
          </small>
        </article>
        <article className="metric">
          <CircleDollarSign size={20} />
          <span>Aportado total</span>
          <strong>{euro.format(totals.invested)}</strong>
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

      {activeView === "dashboard" && <DashboardBreakdown rows={totals.byKind} />}

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
                />
              ))
            )}
          </div>
        </div>
      </section>

      <footer className="footer-line">Ultimo guardado: {formatDateTime(lastSavedAt)}</footer>
    </main>
  );
}

function DashboardBreakdown({ rows }: { rows: Array<{ kind: PortfolioKind; value: number; invested: number; amount: number; ratio: number; count: number }> }) {
  return (
    <section className="breakdown-grid">
      {rows.map((row) => {
        const Icon = KIND_META[row.kind].icon;
        return (
          <article className="breakdown-card" key={row.kind}>
            <Icon size={19} />
            <span>{KIND_META[row.kind].label}</span>
            <strong>{euro.format(row.value)}</strong>
            <small className={row.amount >= 0 ? "positive" : "negative"}>
              {row.amount >= 0 ? "+" : ""}
              {percent.format(row.ratio)} · {euro.format(row.amount)}
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
}: {
  portfolio: Portfolio;
  quotes: Map<string, MarketQuote>;
  onChange: (portfolio: Portfolio) => void;
  onRemove: () => void;
  onAddPosition: (symbol: string) => void;
  onRemovePosition: (positionId: string) => void;
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
        <DecimalInput
          className="money-input invested-input"
          prefix="EUR"
          value={portfolio.investedEUR}
          maxDecimals={2}
          onValueChange={(investedEUR) => onChange({ ...portfolio, investedEUR })}
        />
        <div>
          <span>Valor</span>
          <strong>{euro.format(value)}</strong>
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
                  <td>{quote?.priceEUR ? priceFormat.format(quote.priceEUR) : "Sin dato"}</td>
                  <td>{euro.format(rowValue)}</td>
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
