// Vercel Edge Function: proxy to Alpha Vantage to avoid CORS. Uses VITE_ALPHAVANTAGEAPI server-side.
import { getCorsHeaders } from './_cors.js';

export const config = { runtime: 'edge' };

const ALPHA_BASE = 'https://www.alphavantage.co/query';

const COMMODITY_IDS = ['WTI', 'BRENT', 'NATGAS', 'GOLD', 'SILVER', 'COPPER', 'WHEAT'];

const META = {
  WTI: { displayName: 'WTI Crude', alphaFunction: 'WTI' },
  BRENT: { displayName: 'Brent Crude', alphaFunction: 'BRENT' },
  NATGAS: { displayName: 'Natural Gas', alphaFunction: 'NATURAL_GAS' },
  GOLD: { displayName: 'Gold', alphaFunction: 'GOLD' },
  SILVER: { displayName: 'Silver', alphaFunction: 'SILVER' },
  COPPER: { displayName: 'Copper', alphaFunction: 'COPPER' },
  WHEAT: { displayName: 'Wheat', alphaFunction: 'WHEAT' },
};

function computeChangePct(now, past) {
  if (past == null || past === 0) return null;
  return ((now - past) / past) * 100;
}

function isValidNumericValue(val) {
  if (val === '.' || val === '' || val == null) return false;
  const n = typeof val === 'number' ? val : parseFloat(val);
  return !Number.isNaN(n);
}

function parseAlphaVantageResponse(raw) {
  const points = [];
  if (raw && typeof raw === 'object') {
    const obj = raw;
    if (Array.isArray(obj.data)) {
      const validData = obj.data
        .filter((d) => d && typeof d === 'object' && typeof d.date === 'string' && isValidNumericValue(d.value ?? d.close))
        .map((d) => ({ date: d.date, value: parseFloat(d.value ?? d.close) }));
      for (const { date, value } of validData) {
        points.push({ timestamp: new Date(date), price: value });
      }
    }
    const key = Object.keys(obj).find(
      (k) => (k.startsWith('Time Series') || k === 'data') && k !== 'Meta Data' && k !== 'metadata',
    );
    const daily = key ? obj[key] : null;
    if (daily && typeof daily === 'object' && !Array.isArray(daily)) {
      for (const [dateStr, values] of Object.entries(daily)) {
        if (!values || typeof values !== 'object') continue;
        const close = values['4. close'] ?? values['5. close'] ?? values.close;
        if (!isValidNumericValue(close)) continue;
        const num = typeof close === 'string' ? parseFloat(close) : Number(close);
        points.push({ timestamp: new Date(dateStr), price: num });
      }
    }
  }
  return points.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function buildQuote(id, series) {
  const meta = META[id];
  if (!series.length) {
    return { id, displayName: meta.displayName, currentPrice: null, change1hPct: null, change4hPct: null, change24hPct: null };
  }
  const sorted = [...series].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const nowPoint = sorted[sorted.length - 1];
  if (!nowPoint) {
    return { id, displayName: meta.displayName, currentPrice: null, change1hPct: null, change4hPct: null, change24hPct: null };
  }
  const oneDayMs = 24 * 3600 * 1000;
  const findClosest = (deltaMs) => {
    const target = nowPoint.timestamp.getTime() - deltaMs;
    let best = null;
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
  const p1d = findClosest(1 * oneDayMs);
  const p4d = findClosest(4 * oneDayMs);
  return {
    id,
    displayName: meta.displayName,
    currentPrice: nowPoint.price,
    change1hPct: null,
    change4hPct: p4d ? computeChangePct(nowPoint.price, p4d.price) : null,
    change24hPct: p1d ? computeChangePct(nowPoint.price, p1d.price) : null,
  };
}

async function fetchOneCommodity(apiKey, id, opts = {}) {
  const { debug = false } = opts;
  const meta = META[id];
  const url = new URL(ALPHA_BASE);
  url.searchParams.set('function', meta.alphaFunction);
  url.searchParams.set('interval', 'daily');
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('datatype', 'json');
  try {
    const res = await fetch(url.toString());
    const json = await res.json();
    if (debug) {
      console.log(`[commodities] Alpha Vantage raw response for ${id}:`, JSON.stringify(json).slice(0, 500));
      console.log(`[commodities] Alpha Vantage response keys:`, json && typeof json === 'object' ? Object.keys(json) : 'not object');
    }
    if (!res.ok) {
      if (debug) console.error(`[commodities] Alpha Vantage HTTP ${res.status} for ${id}`);
      return { points: [], raw: debug ? json : undefined };
    }
    if (json && typeof json === 'object' && 'Note' in json) {
      if (debug) console.log(`[commodities] Alpha Vantage rate limit/note for ${id}:`, json.Note);
      return { points: [], raw: debug ? json : undefined };
    }
    const dataKey = Object.keys(json).find(
      (k) => (k !== 'Meta Data' && k !== 'metadata' && (k.startsWith('Time Series') || k === 'data')),
    );
    const raw = dataKey ? json[dataKey] : json;
    const points = parseAlphaVantageResponse(raw ?? json);
    if (debug) console.log(`[commodities] Parsed ${points.length} points for ${id}, dataKey=${dataKey}`);
    return { points, raw: debug ? json : undefined };
  } catch (err) {
    console.error(`[commodities] fetch error for ${id}:`, err.message);
    return { points: [], raw: undefined };
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    });
  }

  const apiKey = process.env.VITE_ALPHAVANTAGEAPI || process.env.ALPHAVANTAGEAPI || '';
  const isDebug = new URL(req.url || '', 'http://x').searchParams.get('debug') === '1';

  if (isDebug) {
    console.log('[commodities] debug=1, apiKey present:', Boolean(apiKey), 'key length:', apiKey ? apiKey.length : 0);
  }

  if (!apiKey) {
    const body = { error: 'Missing API key', quotes: [] };
    if (isDebug) body.debug = { message: 'Set VITE_ALPHAVANTAGEAPI or ALPHAVANTAGEAPI in Vercel env' };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    });
  }

  // In debug mode fetch only WTI and return raw Alpha Vantage response for inspection
  if (isDebug) {
    const result = await fetchOneCommodity(apiKey, 'WTI', { debug: true });
    const quote = buildQuote('WTI', result.points);
    const cors = getCorsHeaders(req);
    return new Response(
      JSON.stringify({
        debug: true,
        alphaVantageRawResponse: result.raw,
        parsedPointsCount: result.points.length,
        builtQuote: quote,
      }, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  const results = await Promise.all(COMMODITY_IDS.map((id) => fetchOneCommodity(apiKey, id)));
  const quotes = COMMODITY_IDS.map((id, i) => buildQuote(id, (results[i] && results[i].points) || []));
  const withData = quotes.filter((q) => q.currentPrice != null).length;
  console.log('[commodities] fetched', quotes.length, 'commodities,', withData, 'with price data');

  const cors = getCorsHeaders(req);
  return new Response(JSON.stringify(quotes), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      ...cors,
    },
  });
}
