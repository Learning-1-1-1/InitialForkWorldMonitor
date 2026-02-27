const ALPHA_VANTAGE_API_KEY_PLACEHOLDER = 'ALPHA_VANTAGE_API_KEY_PLACEHOLDER';

export const ALPHA_VANTAGE_API_KEY =
  import.meta.env.VITE_ALPHA_VANTAGE_API_KEY ?? ALPHA_VANTAGE_API_KEY_PLACEHOLDER;

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

const COMMODITY_META: Record<CommodityId, { displayName: string; alphaSymbol: string }> = {
  WTI: { displayName: 'WTI Crude', alphaSymbol: 'WTI' },
  BRENT: { displayName: 'Brent Crude', alphaSymbol: 'BRENT' },
  NATGAS: { displayName: 'Natural Gas', alphaSymbol: 'NATURAL_GAS' },
  GOLD: { displayName: 'Gold', alphaSymbol: 'GOLD' },
  SILVER: { displayName: 'Silver', alphaSymbol: 'SILVER' },
  COPPER: { displayName: 'Copper', alphaSymbol: 'COPPER' },
  WHEAT: { displayName: 'Wheat', alphaSymbol: 'WHEAT' },
};

function computeChangePct(now: number, past: number | null): number | null {
  if (past == null || past === 0) return null;
  return ((now - past) / past) * 100;
}

export async function fetchCommodityTimeSeries(_id: CommodityId): Promise<TimeSeriesPoint[]> {
  if (!ALPHA_VANTAGE_API_KEY || ALPHA_VANTAGE_API_KEY === ALPHA_VANTAGE_API_KEY_PLACEHOLDER) {
    const base = 100 + Math.random() * 20;
    const now = Date.now();
    return [
      { timestamp: new Date(now - 24 * 3600 * 1000), price: base * 0.95 },
      { timestamp: new Date(now - 4 * 3600 * 1000), price: base * 0.98 },
      { timestamp: new Date(now - 1 * 3600 * 1000), price: base * 1.01 },
      { timestamp: new Date(now), price: base * 1.02 },
    ];
  }

  // Squelette pour intégration réelle Alpha Vantage (volontairement inactif tant
  // que la clé n'est pas renseignée correctement dans VITE_ALPHA_VANTAGE_API_KEY).
  return [];
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

  const p1h = findClosest(1 * 3600 * 1000);
  const p4h = findClosest(4 * 3600 * 1000);
  const p24h = findClosest(24 * 3600 * 1000);

  return {
    id,
    displayName: meta.displayName,
    currentPrice: nowPoint.price,
    change1hPct: computeChangePct(nowPoint.price, p1h?.price ?? null),
    change4hPct: computeChangePct(nowPoint.price, p4h?.price ?? null),
    change24hPct: computeChangePct(nowPoint.price, p24h?.price ?? null),
  };
}

export async function getAllCommodityQuotesMock(): Promise<CommodityQuote[]> {
  const ids: CommodityId[] = ['WTI', 'BRENT', 'NATGAS', 'GOLD', 'SILVER', 'COPPER', 'WHEAT'];

  const seriesById = await Promise.all(
    ids.map(async (id) => {
      const s = await fetchCommodityTimeSeries(id);
      return { id, series: s };
    }),
  );

  return seriesById.map(({ id, series }) => buildCommodityQuoteFromSeries(id, series));
}
