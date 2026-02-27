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

function parseDataToPoints(json) {
  return (json.data || [])
    .filter((d) => d && d.value && d.value !== '.' && !Number.isNaN(parseFloat(d.value)))
    .map((d) => ({ date: d.date, value: parseFloat(d.value) }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function buildQuoteFromPoints(id, points) {
  const meta = META[id];
  const price = points[0]?.value ?? null;
  const prev1d = points[1]?.value ?? null;
  const prev4d = points[4]?.value ?? null;
  return {
    id,
    displayName: meta.displayName,
    currentPrice: price,
    change1hPct: null,
    change4hPct: price != null && prev4d != null ? computeChangePct(price, prev4d) : null,
    change24hPct: price != null && prev1d != null ? computeChangePct(price, prev1d) : null,
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
      return { quote: buildQuoteFromPoints(id, []), raw: debug ? json : undefined, pointsCount: 0 };
    }
    if (json && typeof json === 'object' && 'Note' in json) {
      if (debug) console.log(`[commodities] Alpha Vantage rate limit/note for ${id}:`, json.Note);
      return { quote: buildQuoteFromPoints(id, []), raw: debug ? json : undefined, pointsCount: 0 };
    }
    const points = parseDataToPoints(json);
    if (debug) console.log(`[commodities] Parsed ${points.length} points for ${id}`);
    const quote = buildQuoteFromPoints(id, points);
    return { quote, raw: debug ? json : undefined, pointsCount: points.length };
  } catch (err) {
    console.error(`[commodities] fetch error for ${id}:`, err.message);
    return { quote: buildQuoteFromPoints(id, []), raw: undefined, pointsCount: 0 };
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
    const cors = getCorsHeaders(req);
    return new Response(
      JSON.stringify({
        debug: true,
        alphaVantageRawResponse: result.raw,
        parsedPointsCount: result.pointsCount,
        builtQuote: result.quote,
      }, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  const results = await Promise.all(COMMODITY_IDS.map((id) => fetchOneCommodity(apiKey, id)));
  const quotes = results.map((r) => r.quote);
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
