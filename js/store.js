// Profils, cache local et synchronisation avec le dépôt GitHub de chaque personne.
import { Repo, GitHubError } from "./github.js";

const FILE = "dressing.json";
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
export { LS };

export const emptyDoc = () => ({ app: "dressing-du-matin", version: 1, items: [], history: [], feedback: {}, agenda: {}, prefs: { styles: [], note: "", t: 0 }, trips: {} });

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- profils ----------
export function getProfiles() { return LS.get("dressing:profiles", []); }
export function saveProfiles(list) { LS.set("dressing:profiles", list); }
export function getActiveId() { return LS.get("dressing:active", null); }
export function setActiveId(id) { LS.set("dressing:active", id); }

// ---------- fusion ----------
function mergeMap(a = {}, b = {}) {
  const out = { ...a };
  for (const k of Object.keys(b)) if (!out[k] || (b[k].t || 0) > (out[k].t || 0)) out[k] = b[k];
  return out;
}
export function merge(local, remote) {
  if (!remote) return local;
  if (!local) return { ...emptyDoc(), ...remote };
  const items = new Map();
  for (const it of remote.items || []) items.set(it.id, it);
  for (const it of local.items || []) {
    const r = items.get(it.id);
    if (!r || (it.updatedAt || 0) > (r.updatedAt || 0)) items.set(it.id, it);
  }
  const hist = new Map();
  for (const h of [...(remote.history || []), ...(local.history || [])]) {
    const r = hist.get(h.id);
    if (!r || (h.t || 0) > (r.t || 0)) hist.set(h.id, h);
  }
  return {
    ...emptyDoc(), ...remote,
    items: [...items.values()],
    history: [...hist.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : (b.t || 0) - (a.t || 0))).slice(0, 400),
    feedback: mergeMap(remote.feedback, local.feedback),
    agenda: mergeMap(remote.agenda, local.agenda),
    trips: mergeMap(remote.trips, local.trips),
    prefs: ((local.prefs && local.prefs.t) || 0) > ((remote.prefs && remote.prefs.t) || 0) ? local.prefs : remote.prefs || emptyDoc().prefs
  };
}

// ---------- synchronisation ----------
export class Sync {
  constructor(profile, { onData, onStatus }) {
    this.profile = profile;
    this.repo = new Repo(profile);
    this.onData = onData; this.onStatus = onStatus;
    this.key = "dressing:data:" + profile.id;
    const cached = LS.get(this.key, null);
    this.doc = cached ? cached.doc : emptyDoc();
    this.sha = cached ? cached.sha : null;
    this.pending = cached ? !!cached.pending : false;
    this.loaded = !!cached;
    this.timer = null; this.busy = false; this.again = false; this.rev = 0;
    this.photoUrls = new Map();
    this.onOnline = () => this.sync();
    window.addEventListener("online", this.onOnline);
  }
  destroy() { window.removeEventListener("online", this.onOnline); clearTimeout(this.timer); for (const u of this.photoUrls.values()) URL.revokeObjectURL(u); }

  persist() {
    if (!LS.set(this.key, { doc: this.doc, sha: this.sha, pending: this.pending })) {
      // stockage plein : on garde au moins l'essentiel
      LS.set(this.key, { doc: { ...this.doc, history: this.doc.history.slice(0, 60) }, sha: this.sha, pending: this.pending });
    }
  }

  status(state, msg) { this.onStatus && this.onStatus(state, msg); }

  /** Applique une modification locale puis enregistre sur GitHub. */
  change(mutator) {
    mutator(this.doc);
    this.rev++;
    this.pending = true;
    this.persist();
    this.onData(this.doc);
    clearTimeout(this.timer);
    this.status("saving");
    this.timer = setTimeout(() => this.sync(), 900);
  }

  async sync() {
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const remote = await this.repo.getJson(FILE);
        const merged = merge(this.pending ? this.doc : null, remote.data) || this.doc;
        const remoteStr = JSON.stringify(remote.data);
        this.loaded = true;
        if (!this.pending && remote.data) {
          this.doc = merge(null, remote.data); this.sha = remote.sha;
          this.persist(); this.onData(this.doc); this.status("ok");
          break;
        }
        if (remote.data && JSON.stringify(merged) === remoteStr) {
          this.doc = merged; this.sha = remote.sha; this.pending = false;
          this.persist(); this.onData(this.doc); this.status("ok");
          break;
        }
        try {
          const rev = this.rev;
          this.sha = await this.repo.putJson(FILE, merged, remote.sha, "Mise à jour du dressing");
          if (this.rev === rev) { this.doc = merged; this.pending = false; this.status("ok"); }
          else { this.doc = merge(this.doc, merged); this.again = true; } // modifié pendant l'envoi : on renverra
          this.persist(); this.onData(this.doc);
          break;
        } catch (e) {
          if ((e.status === 409 || e.status === 422) && attempt < 3) continue; // modifié ailleurs entre-temps : on refusionne
          throw e;
        }
      }
    } catch (e) {
      if (e instanceof GitHubError && e.status === 0) this.status("offline");
      else if (e instanceof GitHubError && (e.status === 401 || e.status === 403)) this.status("auth", e.message);
      else if (e instanceof GitHubError && e.status === 404) this.status("notfound");
      else this.status("error", e.message);
    } finally {
      this.busy = false;
      if (this.again) { this.again = false; this.sync(); }
    }
  }

  // ---------- photos ----------
  cacheKey(path) { return "https://dressing.photos/" + this.profile.id + "/" + path; }

  async uploadPhoto(blob, itemId) {
    const path = "photos/" + itemId + "-" + Date.now().toString(36) + ".jpg";
    await this.repo.putBlob(path, blob, "Photo : " + itemId);
    await this.cachePut(path, blob);
    this.photoUrls.set(path, URL.createObjectURL(blob));
    return path;
  }

  async cachePut(path, blob) {
    try { const c = await caches.open("dressing-photos"); await c.put(this.cacheKey(path), new Response(blob, { headers: { "Content-Type": "image/jpeg" } })); } catch (e) {}
  }

  async photoUrl(path) {
    if (this.photoUrls.has(path)) return this.photoUrls.get(path);
    let blob = null;
    try { const c = await caches.open("dressing-photos"); const r = await c.match(this.cacheKey(path)); if (r) blob = await r.blob(); } catch (e) {}
    if (!blob) { blob = await this.repo.getBlob(path); await this.cachePut(path, blob); }
    const url = URL.createObjectURL(blob);
    this.photoUrls.set(path, url);
    return url;
  }

  async deletePhoto(path) {
    try { await this.repo.deleteFile(path, "Suppression d'une photo"); } catch (e) {}
    try { const c = await caches.open("dressing-photos"); await c.delete(this.cacheKey(path)); } catch (e) {}
  }
}
