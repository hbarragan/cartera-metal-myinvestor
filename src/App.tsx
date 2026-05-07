import {
  Activity,
  AlertCircle,
  Banknote,
  Check,
  RefreshCcw,
  RotateCcw,
  Save,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Quote = {
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

type Holding = {
  isin: string;
  shares: number;
  seedAmountEUR?: number;
  lastVal: number | null;
  lastValDate: string | null;
  previousVal: number | null;
  updatedAt: string | null;
};

type LegacyHolding = {
  isin: string;
  amountEUR?: number;
  shares?: number;
  lastNav?: number | null;
  lastNavDate?: string | null;
  lastVal?: number | null;
  lastValDate?: string | null;
  previousVal?: number | null;
  updatedAt?: string | null;
};

type Snapshot = {
  at: string;
  total: number;
};

type CacheState = {
  holdings: Holding[];
  history: Snapshot[];
  savedAt: string;
};

const CACHE_KEY = "cartera-metal-myinvestor:v2";
const LEGACY_CACHE_KEY = "cartera-metal-myinvestor:v1";
const DEFAULT_ISINS = [
  "IE000N4ZYX28",
  "IE000N51F726",
  "IE000QAZP7L2",
  "IE00BYX5N771",
  "IE00B1G3DH73",
  "IE00BYX5MD61",
  "IE00BDZVHT63",
];
const DEFAULT_TOTAL = 10000;

const euro = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const valFormat = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 6,
});

const percent = new Intl.NumberFormat("es-ES", {
  style: "percent",
  maximumFractionDigits: 2,
});

function defaultHoldings(): Holding[] {
  return DEFAULT_ISINS.map((isin) => ({
    isin,
    shares: 0,
    lastVal: null,
    lastValDate: null,
    previousVal: null,
    updatedAt: null,
  }));
}

function normalizeHolding(holding: LegacyHolding): Holding {
  return {
    isin: holding.isin,
    shares: holding.shares ?? 0,
    seedAmountEUR: holding.amountEUR,
    lastVal: holding.lastVal ?? holding.lastNav ?? null,
    lastValDate: holding.lastValDate ?? holding.lastNavDate ?? null,
    previousVal: holding.previousVal ?? null,
    updatedAt: holding.updatedAt ?? null,
  };
}

function safeNumber(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nowIso() {
  return new Date().toISOString();
}

function formatDateTime(value?: string | null) {
  if (!value) return "Sin refrescar";
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatShares(value: number) {
  return Number.isFinite(value) ? value.toFixed(6).replace(/\.?0+$/, "") : "0";
}

function valFor(holding: Holding, quote?: Quote) {
  return quote?.nav ?? holding.lastVal ?? 0;
}

function holdingValue(holding: Holding, quote?: Quote) {
  return holding.shares * valFor(holding, quote);
}

function holdingDelta(holding: Holding, quote?: Quote) {
  const currentVal = valFor(holding, quote);
  if (!holding.previousVal || !currentVal) return { amount: 0, ratio: 0 };
  const amount = holding.shares * (currentVal - holding.previousVal);
  return {
    amount,
    ratio: currentVal / holding.previousVal - 1,
  };
}

export default function App() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>(defaultHoldings);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [lastApiRefresh, setLastApiRefresh] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = localStorage.getItem(CACHE_KEY) ?? localStorage.getItem(LEGACY_CACHE_KEY);
    if (!cached) {
      const initial = defaultHoldings();
      setHoldings(initial);
      setDrafts(Object.fromEntries(initial.map((holding) => [holding.isin, "0"])));
      return;
    }

    try {
      const parsed = JSON.parse(cached) as { holdings?: LegacyHolding[]; history?: Snapshot[]; savedAt?: string };
      const cachedByIsin = new Map(
        (parsed.holdings ?? []).map((holding) => [holding.isin, normalizeHolding(holding)]),
      );
      const merged = defaultHoldings().map((holding) => cachedByIsin.get(holding.isin) ?? holding);
      setHoldings(merged);
      setDrafts(Object.fromEntries(merged.map((holding) => [holding.isin, formatShares(holding.shares)])));
      setHistory(parsed.history ?? []);
      setLastSavedAt(parsed.savedAt ?? null);
    } catch {
      const initial = defaultHoldings();
      setHoldings(initial);
      setDrafts(Object.fromEntries(initial.map((holding) => [holding.isin, "0"])));
    }
  }, []);

  const quoteByIsin = useMemo(
    () => new Map(quotes.map((quote) => [quote.isin, quote])),
    [quotes],
  );

  const total = useMemo(
    () => holdings.reduce((sum, holding) => sum + holdingValue(holding, quoteByIsin.get(holding.isin)), 0),
    [holdings, quoteByIsin],
  );

  const persist = useCallback((nextHoldings: Holding[], nextHistory: Snapshot[]) => {
    const savedAt = nowIso();
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        holdings: nextHoldings,
        history: nextHistory.slice(-48),
        savedAt,
      } satisfies CacheState),
    );
    setLastSavedAt(savedAt);
  }, []);

  const refreshQuotes = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/quotes?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { refreshedAt: string; quotes: Quote[] };
      setQuotes(payload.quotes);
      setLastApiRefresh(payload.refreshedAt);

      setHoldings((current) => {
        const byIsin = new Map(payload.quotes.map((quote) => [quote.isin, quote]));
        const hasNoShares = current.every((holding) => holding.shares <= 0);
        let changed = false;
        const next = current.map((holding) => {
          const quote = byIsin.get(holding.isin);
          if (!quote?.nav) return holding;

          const shares = hasNoShares
            ? (holding.seedAmountEUR ?? DEFAULT_TOTAL / DEFAULT_ISINS.length) / quote.nav
            : holding.shares;
          const previousVal = holding.lastVal ?? quote.nav;

          if (
            shares !== holding.shares ||
            quote.nav !== holding.lastVal ||
            quote.navDate !== holding.lastValDate
          ) {
            changed = true;
          }

          return {
            ...holding,
            shares,
            seedAmountEUR: undefined,
            previousVal,
            lastVal: quote.nav,
            lastValDate: quote.navDate,
            updatedAt: payload.refreshedAt,
          };
        });

        if (!changed) return current;

        const nextTotal = next.reduce((sum, holding) => sum + holdingValue(holding, byIsin.get(holding.isin)), 0);
        const nextHistory = [...history, { at: payload.refreshedAt, total: nextTotal }].slice(-48);
        setHistory(nextHistory);
        setDrafts(Object.fromEntries(next.map((holding) => [holding.isin, formatShares(holding.shares)])));
        persist(next, nextHistory);
        return next;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo refrescar");
    } finally {
      setIsLoading(false);
    }
  }, [history, persist]);

  useEffect(() => {
    refreshQuotes();
    const timer = window.setInterval(() => refreshQuotes(), 60_000);
    return () => window.clearInterval(timer);
  }, [refreshQuotes]);

  const rows = useMemo(() => {
    return holdings.map((holding) => {
      const quote = quoteByIsin.get(holding.isin);
      const value = holdingValue(holding, quote);
      const delta = holdingDelta(holding, quote);
      return { holding, quote, value, delta };
    });
  }, [holdings, quoteByIsin]);

  const absoluteReturn = total - DEFAULT_TOTAL;
  const returnRatio = total / DEFAULT_TOTAL - 1;
  const okQuotes = quotes.filter((quote) => quote.status === "ok").length;

  function saveDrafts() {
    setIsSaving(true);
    const savedAt = nowIso();
    const next = holdings.map((holding) => {
      const quote = quoteByIsin.get(holding.isin);
      return {
        ...holding,
        shares: safeNumber(drafts[holding.isin] ?? String(holding.shares)),
        previousVal: holding.lastVal,
        lastVal: quote?.nav ?? holding.lastVal,
        lastValDate: quote?.navDate ?? holding.lastValDate,
        updatedAt: savedAt,
      };
    });
    const nextTotal = next.reduce((sum, holding) => sum + holdingValue(holding, quoteByIsin.get(holding.isin)), 0);
    const nextHistory = [...history, { at: savedAt, total: nextTotal }].slice(-48);
    setHoldings(next);
    setHistory(nextHistory);
    persist(next, nextHistory);
    window.setTimeout(() => setIsSaving(false), 650);
  }

  function resetPortfolio() {
    const savedAt = nowIso();
    const next = defaultHoldings().map((holding) => {
      const quote = quoteByIsin.get(holding.isin);
      const shares = quote?.nav ? DEFAULT_TOTAL / DEFAULT_ISINS.length / quote.nav : 0;
      return {
        ...holding,
        shares,
        previousVal: quote?.nav ?? null,
        lastVal: quote?.nav ?? null,
        lastValDate: quote?.navDate ?? null,
        updatedAt: savedAt,
      };
    });
    const nextTotal = next.reduce((sum, holding) => sum + holdingValue(holding, quoteByIsin.get(holding.isin)), 0);
    const nextHistory = [{ at: savedAt, total: nextTotal || DEFAULT_TOTAL }];
    setHoldings(next);
    setDrafts(Object.fromEntries(next.map((holding) => [holding.isin, formatShares(holding.shares)])));
    setHistory(nextHistory);
    persist(next, nextHistory);
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">MyInvestor</p>
          <h1>Cartera Metal</h1>
        </div>
        <div className="actions">
          <button className="icon-button" onClick={() => refreshQuotes()} title="Refrescar VAL">
            <RefreshCcw size={18} className={isLoading ? "spin" : ""} />
          </button>
          <button className="secondary-button" onClick={resetPortfolio}>
            <RotateCcw size={17} />
            Reiniciar
          </button>
          <button className="primary-button" onClick={saveDrafts}>
            {isSaving ? <Check size={17} /> : <Save size={17} />}
            Guardar
          </button>
        </div>
      </section>

      <section className="metrics-grid">
        <article className="metric primary-metric">
          <WalletCards size={20} />
          <span>Valor actual</span>
          <strong>{euro.format(total)}</strong>
          <small className={absoluteReturn >= 0 ? "positive" : "negative"}>
            {absoluteReturn >= 0 ? "+" : ""}
            {euro.format(absoluteReturn)} desde {euro.format(DEFAULT_TOTAL)}
          </small>
        </article>
        <article className="metric">
          {returnRatio >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
          <span>Rentabilidad cacheada</span>
          <strong className={returnRatio >= 0 ? "positive" : "negative"}>
            {returnRatio >= 0 ? "+" : ""}
            {percent.format(returnRatio)}
          </strong>
          <small>Ultima cartera: {formatDateTime(lastSavedAt)}</small>
        </article>
        <article className="metric">
          <Activity size={20} />
          <span>Refresco proveedor</span>
          <strong>
            {okQuotes}/{DEFAULT_ISINS.length}
          </strong>
          <small>{formatDateTime(lastApiRefresh)}</small>
        </article>
        <article className="metric">
          <Banknote size={20} />
          <span>Formula</span>
          <strong>Part. x VAL</strong>
          <small>El aporte se calcula en euros</small>
        </article>
      </section>

      {error && (
        <section className="status-line error-line">
          <AlertCircle size={18} />
          <span>{error}</span>
        </section>
      )}

      <section className="workspace-grid">
        <div className="portfolio-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Distribucion por participaciones</p>
              <h2>Fondos de la cartera</h2>
            </div>
            <p>{euro.format(total)} calculados en este navegador</p>
          </div>

          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Fondo</th>
                  <th>ISIN</th>
                  <th>VAL</th>
                  <th>Fecha VAL</th>
                  <th>Participaciones</th>
                  <th>Aporte</th>
                  <th>Peso</th>
                  <th>Desde cache</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ holding, quote, value, delta }) => {
                  const weight = total > 0 ? value / total : 0;
                  return (
                    <tr key={holding.isin}>
                      <td>
                        <strong>{quote?.shortName ?? holding.isin}</strong>
                        <span>{quote?.category ?? "Pendiente"}</span>
                      </td>
                      <td className="mono">{holding.isin}</td>
                      <td>{valFor(holding, quote) ? valFormat.format(valFor(holding, quote)) : "Sin dato"}</td>
                      <td>{quote?.navDate ?? holding.lastValDate ?? "Pendiente"}</td>
                      <td>
                        <label className="money-input unit-input">
                          <span>PART.</span>
                          <input
                            value={drafts[holding.isin] ?? ""}
                            inputMode="decimal"
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [holding.isin]: event.target.value,
                              }))
                            }
                          />
                        </label>
                      </td>
                      <td>{euro.format(value)}</td>
                      <td>{percent.format(weight)}</td>
                      <td className={delta.amount >= 0 ? "positive" : "negative"}>
                        {delta.amount >= 0 ? "+" : ""}
                        {euro.format(delta.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="side-panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Historial local</p>
              <h2>Ultimos refrescos</h2>
            </div>
          </div>
          <div className="history-list">
            {history.length === 0 ? (
              <p className="muted">Aun no hay muestras guardadas.</p>
            ) : (
              history
                .slice(-8)
                .reverse()
                .map((item) => (
                  <div className="history-item" key={`${item.at}-${item.total}`}>
                    <span>{formatDateTime(item.at)}</span>
                    <strong>{euro.format(item.total)}</strong>
                  </div>
                ))
            )}
          </div>

          <div className="source-list">
            <p className="eyebrow">Fuentes</p>
            {quotes.map((quote) => (
              <a key={quote.isin} href={quote.sourceUrl} target="_blank" rel="noreferrer">
                <span>{quote.shortName}</span>
                <strong className={quote.status === "ok" ? "positive" : "negative"}>
                  {quote.source}
                </strong>
              </a>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
