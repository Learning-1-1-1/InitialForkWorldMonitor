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

function parseAlphaVantageResponse(raw) {
  const points = [];
  if (raw && typeof raw === 'object') {
    const obj = raw;
    if (Array.isArray(obj.data)) {
      for (const row of obj.data) {
        if (row && typeof row === 'object') {
          const dateStr = typeof row.date === 'string' ? row.date : null;
          const val = row.value ?? row.close;
          const num = typeof val === 'number' ? val : typeof val === 'string' ? parseFloat(val) : NaN;
          if (dateStr && !Number.isNaN(num)) {
            points.push({ timestamp: new Date(dateStr), price: num });
          }
        }
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
        const num = typeof close === 'string' ? parseFloat(close) : Number(close);
        if (!Number.isNaN(num)) {
          points.push({ timestamp: new Date(dateStr), price: num });
        }
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

async function fetchOneCommodity(apiKey, id) {
  const meta = META[id];
  const url = new URL(ALPHA_BASE);
  url.searchParams.set('function', meta.alphaFunction);
  url.searchParams.set('interval', 'daily');
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('datatype', 'json');
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const json = await res.json();
    if (json && typeof json === 'object' && 'Note' in json) return [];
    const dataKey = Object.keys(json).find(
      (k) => (k !== 'Meta Data' && k !== 'metadata' && (k.startsWith('Time Series') || k === 'data')),
    );
    const raw = dataKey ? json[dataKey] : json;
    return parseAlphaVantageResponse(raw ?? json);
  } catch {
    return [];
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
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Missing API key', quotes: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) } },
    );
  }

  const results = await Promise.all(COMMODITY_IDS.map((id) => fetchOneCommodity(apiKey, id)));
  const quotes = COMMODITY_IDS.map((id, i) => buildQuote(id, results[i] || []));

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
