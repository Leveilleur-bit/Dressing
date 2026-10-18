// Météo via Open-Meteo (gratuit, sans clé).
const CODES = {
  0: "Ciel dégagé", 1: "Plutôt dégagé", 2: "Partiellement nuageux", 3: "Couvert",
  45: "Brouillard", 48: "Brouillard givrant",
  51: "Bruine légère", 53: "Bruine", 55: "Bruine dense", 56: "Bruine verglaçante", 57: "Bruine verglaçante",
  61: "Pluie faible", 63: "Pluie", 65: "Forte pluie", 66: "Pluie verglaçante", 67: "Pluie verglaçante",
  71: "Neige faible", 73: "Neige", 75: "Forte neige", 77: "Grains de neige",
  80: "Averses", 81: "Averses", 82: "Fortes averses", 85: "Averses de neige", 86: "Averses de neige",
  95: "Orage", 96: "Orage et grêle", 99: "Orage et grêle"
};

export async function searchCity(name) {
  const url = "https://geocoding-api.open-meteo.com/v1/search?count=5&language=fr&format=json&name=" + encodeURIComponent(name);
  const r = await fetch(url);
  if (!r.ok) throw new Error("geo");
  const j = await r.json();
  return (j.results || []).map((x) => ({
    name: x.name, region: [x.admin1, x.country].filter(Boolean).join(", "), lat: x.latitude, lon: x.longitude
  }));
}

export function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("unsupported"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3) }),
      (e) => reject(e),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 3 * 3600e3 }
    );
  });
}


async function fetchHourly(lat, lon, days) {
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon +
    "&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,weather_code" +
    "&timezone=auto&forecast_days=" + days;
  const r = await fetch(url);
  if (!r.ok) throw new Error("weather");
  return (await r.json()).hourly;
}

function summarize(h, day) {
  const idx = (hour) => h.time.indexOf(day + "T" + String(hour).padStart(2, "0") + ":00");
  const range = [];
  for (let hr = 8; hr <= 20; hr++) { const i = idx(hr); if (i >= 0) range.push(i); }
  if (!range.length) return null;
  const at = (arr, hour) => { const i = idx(hour); return i >= 0 ? arr[i] : null; };
  const max = (arr) => Math.max(...range.map((i) => arr[i] ?? 0));
  const sum = (arr) => range.reduce((a, i) => a + (arr[i] || 0), 0);
  const codes = range.map((i) => h.weather_code[i]);
  const worst = codes.reduce((a, c) => (c > a ? c : a), 0);
  const morning = { temp: at(h.temperature_2m, 8), feels: at(h.apparent_temperature, 8) };
  const afternoon = { temp: at(h.temperature_2m, 15), feels: at(h.apparent_temperature, 15) };
  const rainProb = max(h.precipitation_probability);
  const rainMm = sum(h.precipitation);
  return {
    day, morning, afternoon,
    minFeels: Math.min(...range.map((i) => h.apparent_temperature[i])),
    maxFeels: Math.max(...range.map((i) => h.apparent_temperature[i])),
    rainProb, rainMm: Math.round(rainMm * 10) / 10,
    rain: rainProb >= 50 || rainMm >= 1,
    wind: Math.round(max(h.wind_speed_10m)),
    gusts: Math.round(max(h.wind_gusts_10m)),
    snow: codes.some((c) => [71, 73, 75, 77, 85, 86].includes(c)),
    sky: CODES[worst] || "",
    fetchedAt: Date.now()
  };
}

const days = (h) => [...new Set(h.time.map((t) => t.slice(0, 10)))];

/** Aujourd'hui et demain, en une seule requête : [d0, d1] */
export async function fetchTwoDays(lat, lon) {
  const h = await fetchHourly(lat, lon, 3);
  const [a, b] = days(h);
  const d0 = summarize(h, a), d1 = summarize(h, b);
  if (!d0 || !d1) throw new Error("weather-range");
  return [d0, d1];
}

/** Prévisions sur 16 jours : { "2026-11-03": résumé, … } */
export async function fetchRange(lat, lon) {
  const h = await fetchHourly(lat, lon, 16);
  const out = {};
  for (const d of days(h)) { const s = summarize(h, d); if (s) out[d] = s; }
  return out;
}
