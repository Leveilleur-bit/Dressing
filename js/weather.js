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


/** Résumé de la journée (offset 0 = aujourd'hui, 1 = demain) */
export async function fetchDay(lat, lon, offset) {
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon +
    "&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,weather_code" +
    "&timezone=auto&forecast_days=3";
  const r = await fetch(url);
  if (!r.ok) throw new Error("weather");
  const j = await r.json();
  const h = j.hourly;
  const base = h.time[0].slice(0, 10);
  const d = new Date(base + "T12:00:00");
  d.setDate(d.getDate() + offset);
  const day = d.toISOString().slice(0, 10);
  const idx = (hour) => h.time.indexOf(day + "T" + String(hour).padStart(2, "0") + ":00");
  const range = [];
  for (let hr = 8; hr <= 20; hr++) { const i = idx(hr); if (i >= 0) range.push(i); }
  if (!range.length) throw new Error("weather-range");
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
    day,
    morning, afternoon,
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
