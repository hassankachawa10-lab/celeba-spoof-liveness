// src/config.ts
// Central API config — reads VITE_API_URL from build-time env, falls back to same-origin.
// In production (Vercel): set VITE_API_URL=https://your-railway-backend.railway.app
// In development: VITE_API_URL is not set, falls back to relative (FastAPI serves both)

const rawApiUrl = import.meta.env.VITE_API_URL as string | undefined;

// Normalise: strip trailing slash
export const API_BASE: string = rawApiUrl
  ? rawApiUrl.replace(/\/$/, '')
  : '';

// Build WebSocket URL from the API base
// https://... → wss://...   |   http://... → ws://...   |   '' → ws(s)://same-origin
export function buildWsUrl(path: string): string {
  if (API_BASE) {
    const wsBase = API_BASE.replace(/^https/, 'wss').replace(/^http/, 'ws');
    return `${wsBase}${path}`;
  }
  // Same-origin: derive protocol from window.location
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}${path}`;
}

// HTTP fetch helper — prepends API_BASE if set, otherwise uses relative URL
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
