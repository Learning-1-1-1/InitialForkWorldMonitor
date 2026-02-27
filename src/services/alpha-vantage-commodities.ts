const ALPHA_VANTAGE_API_KEY_PLACEHOLDER = 'ALPHA_VANTAGE_API_KEY_PLACEHOLDER';

// In Vercel: set VITE_ALPHAVANTAGEAPI (same value as ALPHAVANTAGEAPI) so the key is available in the client bundle.
export const ALPHA_VANTAGE_API_KEY: string =
  import.meta.env.VITE_ALPHAVANTAGEAPI ??
  import.meta.env.VITE_ALPHA_VANTAGE_API_KEY ??
  ALPHA_VANTAGE_API_KEY_PLACEHOLDER;

const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query';

export type CommodityId =
  | 'WTI'
  | 'BRENT'
  | 'NATGAS'
  | 'GOLD'
  | 'SILVER'
  | 'COPPER'
  | 'WHEAT';

export interface CommodityQuote {
  id: CommodityId;
  displayName: string;
  currentPrice: number | null;
  change1hPct: number | null;
  change4hPct: number | null;
  change24hPct: number | null;
}

export interface TimeSeriesPoint {
  timestamp: Date;
  price: number;
}

const COMMODITY_META: Record<CommodityId, { displayName: string; alphaFunction: string }> = {
  WTI: { displayName: 'WTI Crude', alphaFunction: 'WTI' },
  BRENT: { displayName: 'Brent Crude', alphaFunction: 'BRENT' },
  NATGAS: { displayName: 'Natural Gas', alphaFunction: 'NATURAL_GAS' },
  GOLD: { displayName: 'Gold', alphaFunction: 'GOLD' },
  SILVER: { displayName: 'Silver', alphaFunction: 'SILVER' },
  COPPER: { displayName: 'Copper', alphaFunction: 'COPPER' },
  WHEAT: { displayName: 'Wheat', alphaFunction: 'WHEAT' },
};

function computeChangePct(now: number, past: number | null): number | null {
  if (past == null || past === 0) return null;
  return ((now - past) / past) * 100;
}

function parseAlphaVantageResponse(raw: unknown): TimeSeriesPoint[] {
  const points: TimeSeriesPoint[] = [];
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    // Format 1: { data: [ { date: "YYYY-MM-DD", value: "72.50" }, ... ] }
    if (Array.isArray(obj.data)) {
      for (const row of obj.data) {
        if (row && typeof row === 'object') {
          const r = row as Record<string, unknown>;
          const dateStr = typeof r.date === 'string' ? r.date : null;
          const val = r.value ?? r.close;
          const num = typeof val === 'number' ? val : typeof val === 'string' ? parseFloat(val) : NaN;
          if (dateStr && !Number.isNaN(num)) {
            points.push({ timestamp: new Date(dateStr), price: num });
          }
        }
      }
    }
    // Format 2: { "Time Series (Daily)": { "2024-01-15": { "4. close": "72.50" }, ... } }
    const key = Object.keys(obj).find((k) => k.startsWith('Time Series') || k === 'data');
    const daily = key ? obj[key] : null;
    if (daily && typeof daily === 'object' && !Array.isArray(daily)) {
      const series = daily as Record<string, Record<string, string>>;
      for (const [dateStr, values] of Object.entries(series)) {
        if (!values || typeof values !== 'object') continue;
        const close = values['4. close'] ?? values['5. close'] ?? (values as Record<string, unknown>).close;
        const num = typeof close === 'string' ? parseFloat(close) : Number(close);
        if (!Number.isNaN(num)) {
          points.push({ timestamp: new Date(dateStr), price: num });
        }
      }
    }
  }
  return points.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

export async function fetchCommodityTimeSeries(id: CommodityId): Promise<TimeSeriesPoint[]> {
  const apiKey = ALPHA_VANTAGE_API_KEY;
  const useRealApi = apiKey && apiKey !== ALPHA_VANTAGE_API_KEY_PLACEHOLDER;

  if (!useRealApi) {
    const base = 100 + Math.random() * 20;
    const now = Date.now();
    return [
      { timestamp: new Date(now - 24 * 3600 * 1000), price: base * 0.95 },
      { timestamp: new Date(now - 4 * 3600 * 1000), price: base * 0.98 },
      { timestamp: new Date(now - 1 * 3600 * 1000), price: base * 1.01 },
      { timestamp: new Date(now), price: base * 1.02 },
    ];
  }

  const meta = COMMODITY_META[id];
  const url = new URL(ALPHA_VANTAGE_BASE);
  url.searchParams.set('function', meta.alphaFunction);
  url.searchParams.set('interval', 'daily');
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('datatype', 'json');

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    if (json && typeof json === 'object' && 'Note' in json) {
      // Rate limit message
      return [];
    }
    // Response may be nested under the function name key
    const dataKey = Object.keys(json as Record<string, unknown>).find(
      (k) => (k !== 'Meta Data' && k !== 'metadata' && k.startsWith('Time Series')) || k === 'data',
    );
    const raw = dataKey ? (json as Record<string, unknown>)[dataKey] : json;
    return parseAlphaVantageResponse(raw ?? json);
  } catch {
    return [];
  }
}

export function buildCommodityQuoteFromSeries(id: CommodityId, series: TimeSeriesPoint[]): CommodityQuote {
  const meta = COMMODITY_META[id];
  if (series.length === 0) {
    return {
      id,
      displayName: meta.displayName,
      currentPrice: null,
      change1hPct: null,
      change4hPct: null,
      change24hPct: null,
    };
  }

  const sorted = [...series].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const nowPoint = sorted[sorted.length - 1];
  if (!nowPoint) {
    return {
      id,
      displayName: meta.displayName,
      currentPrice: null,
      change1hPct: null,
      change4hPct: null,
      change24hPct: null,
    };
  }

  const nowTs = nowPoint.timestamp.getTime();
  const oneDayMs = 24 * 3600 * 1000;

  const findClosest = (deltaMs: number): TimeSeriesPoint | null => {
    const target = nowTs - deltaMs;
    let best: TimeSeriesPoint | null = null;
    let bestDiff = Infinity;
    for (const p of sorted) {
      const diff = Math.abs(p.timestamp.getTime() - target);
      if (diff < bestDiff) {
        best = p;
        bestDiff = diff;
      }
    }
    return best;
  };

  // Alpha Vantage returns daily data; use 1d and 4d ago for Δ 24h and Δ 4h
  const p1d = findClosest(1 * oneDayMs);
  const p4d = findClosest(4 * oneDayMs);

  return {
    id,
    displayName: meta.displayName,
    currentPrice: nowPoint.price,
    change1hPct: null, // API is daily; we could approximate or leave null
    change4hPct: p4d ? computeChangePct(nowPoint.price, p4d.price) : null,
    change24hPct: p1d ? computeChangePct(nowPoint.price, p1d.price) : null,
  };
}

export async function getAllCommodityQuotesMock(): Promise<CommodityQuote[]> {
  try {
    const res = await fetch('/api/commodities');
    if (res.ok) {
      const quotes = (await res.json()) as CommodityQuote[];
      if (Array.isArray(quotes) && quotes.length > 0) return quotes;
    }
  } catch {
    // Fall through to mock when API unavailable (e.g. local dev without proxy)
  }

  const ids: CommodityId[] = ['WTI', 'BRENT', 'NATGAS', 'GOLD', 'SILVER', 'COPPER', 'WHEAT'];
  const seriesById = await Promise.all(
    ids.map(async (id) => {
      const s = await fetchCommodityTimeSeries(id);
      return { id, series: s };
    }),
  );
  return seriesById.map(({ id, series }) => buildCommodityQuoteFromSeries(id, series));
}
