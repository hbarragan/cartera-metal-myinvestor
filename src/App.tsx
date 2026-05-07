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
  amountEUR: number;
  lastNav: number | null;
  lastNavDate: string | null;
  updatedAt: string | null;
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

const CACHE_KEY = "cartera-metal-myinvestor:v1";
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

const percent = new Intl.NumberFormat("es-ES", {
  style: "percent",
  maximumFractionDigits: 2,
});

function defaultHoldings(): Holding[] {
  const perFund = DEFAULT_TOTAL / DEFAULT_ISINS.length;
  return DEFAULT_ISINS.map((isin) => ({
    isin,
    amountEUR: perFund,
    lastNav: null,
    lastNavDate: null,
    updatedAt: null,
  }));
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

function quoteDelta(current: Holding, quote?: Quote) {
  if (!quote?.nav || !current.lastNav) return { amount: 0, ratio: 0 };
  const nextAmount = current.amountEUR * (quote.nav / current.lastNav);
  return {
    amount: nextAmount - current.amountEUR,
    ratio: nextAmount / current.amountEUR - 1,
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
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) {
      const initial = defaultHoldings();
      setHoldings(initial);
      setDrafts(
        Object.fromEntries(initial.map((holding) => [holding.isin, holding.amountEUR.toFixed(2)])),
      );
      return;
    }

    try {
      const parsed = JSON.parse(cached) as CacheState;
      const cachedByIsin = new Map(parsed.holdings.map((holding) => [holding.isin, holding]));
      const merged = defaultHoldings().map((holding) => cachedByIsin.get(holding.isin) ?? holding);
      setHoldings(merged);
      setDrafts(
        Object.fromEntries(merged.map((holding) => [holding.isin, holding.amountEUR.toFixed(2)])),
      );
      setHistory(parsed.history ?? []);
      setLastSavedAt(parsed.savedAt);
    } catch {
      const initial = defaultHoldings();
      setHoldings(initial);
      setDrafts(
        Object.fromEntries(initial.map((holding) => [holding.isin, holding.amountEUR.toFixed(2)])),
      );
    }
  }, []);

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

  const total = useMemo(
    () => holdings.reduce((sum, holding) => sum + holding.amountEUR, 0),
    [holdings],
  );

  const quoteByIsin = useMemo(
    () => new Map(quotes.map((quote) => [quote.isin, quote])),
    [quotes],
  );

  const refreshQuotes = useCallback(
    async (applyPerformance = true) => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/quotes?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as { refreshedAt: string; quotes: Quote[] };
        setQuotes(payload.quotes);
        setLastApiRefresh(payload.refreshedAt);

        if (applyPerformance) {
          setHoldings((current) => {
            const byIsin = new Map(payload.quotes.map((quote) => [quote.isin, quote]));
            let changed = false;
            const next = current.map((holding) => {
              const quote = byIsin.get(holding.isin);
              if (!quote?.nav) return holding;

              const amountEUR = holding.lastNav
                ? holding.amountEUR * (quote.nav / holding.lastNav)
                : holding.amountEUR;

              if (
                amountEUR !== holding.amountEUR ||
                quote.nav !== holding.lastNav ||
                quote.navDate !== holding.lastNavDate
              ) {
                changed = true;
              }

              return {
                ...holding,
                amountEUR,
                lastNav: quote.nav,
                lastNavDate: quote.navDate,
                updatedAt: payload.refreshedAt,
              };
            });

            if (!changed) return current;

            const nextTotal = next.reduce((sum, holding) => sum + holding.amountEUR, 0);
            const nextHistory = [...history, { at: payload.refreshedAt, total: nextTotal }].slice(-48);
            setHistory(nextHistory);
            setDrafts(
              Object.fromEntries(next.map((holding) => [holding.isin, holding.amountEUR.toFixed(2)])),
            );
            persist(next, nextHistory);
            return next;
          });
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "No se pudo refrescar");
      } finally {
        setIsLoading(false);
      }
    },
    [history, persist],
  );

  useEffect(() => {
    refreshQuotes();
    const timer = window.setInterval(() => refreshQuotes(), 60_000);
    return () => window.clearInterval(timer);
  }, [refreshQuotes]);

  const projected = useMemo(() => {
    return holdings.map((holding) => {
      const quote = quoteByIsin.get(holding.isin);
      const delta = quoteDelta(holding, quote);
      return {
        holding,
        quote,
        delta,
        nextAmount: holding.amountEUR + delta.amount,
      };
    });
  }, [holdings, quoteByIsin]);

  const projectedTotal = projected.reduce((sum, item) => sum + item.nextAmount, 0);
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
        amountEUR: safeNumber(drafts[holding.isin] ?? String(holding.amountEUR)),
        lastNav: quote?.nav ?? holding.lastNav,
        lastNavDate: quote?.navDate ?? holding.lastNavDate,
        updatedAt: savedAt,
      };
    });
    const nextTotal = next.reduce((sum, holding) => sum + holding.amountEUR, 0);
    const nextHistory = [...history, { at: savedAt, total: nextTotal }].slice(-48);
    setHoldings(next);
    setHistory(nextHistory);
    persist(next, nextHistory);
    window.setTimeout(() => setIsSaving(false), 650);
  }

  function resetPortfolio() {
    const initial = defaultHoldings();
    const savedAt = nowIso();
    const next = initial.map((holding) => {
      const quote = quoteByIsin.get(holding.isin);
      return {
        ...holding,
        lastNav: quote?.nav ?? null,
        lastNavDate: quote?.navDate ?? null,
        updatedAt: savedAt,
      };
    });
    const nextHistory = [{ at: savedAt, total: DEFAULT_TOTAL }];
    setHoldings(next);
    setDrafts(Object.fromEntries(next.map((holding) => [holding.isin, holding.amountEUR.toFixed(2)])));
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
          <button className="icon-button" onClick={() => refreshQuotes()} title="Refrescar NAV">
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
          <span>Proxima valoracion</span>
          <strong>{euro.format(projectedTotal)}</strong>
          <small>Aplicando el ultimo NAV disponible</small>
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
              <p className="eyebrow">Distribucion en euros</p>
              <h2>Fondos de la cartera</h2>
            </div>
            <p>{euro.format(total)} guardados en este navegador</p>
          </div>

          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Fondo</th>
                  <th>ISIN</th>
                  <th>NAV</th>
                  <th>Fecha NAV</th>
                  <th>Aporte</th>
                  <th>Peso</th>
                  <th>Desde cache</th>
                </tr>
              </thead>
              <tbody>
                {projected.map(({ holding, quote, delta }) => {
                  const weight = total > 0 ? holding.amountEUR / total : 0;
                  return (
                    <tr key={holding.isin}>
                      <td>
                        <strong>{quote?.shortName ?? holding.isin}</strong>
                        <span>{quote?.category ?? "Pendiente"}</span>
                      </td>
                      <td className="mono">{holding.isin}</td>
                      <td>{quote?.nav ? euro.format(quote.nav) : "Sin dato"}</td>
                      <td>{quote?.navDate ?? holding.lastNavDate ?? "Pendiente"}</td>
                      <td>
                        <label className="money-input">
                          <span>EUR</span>
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
