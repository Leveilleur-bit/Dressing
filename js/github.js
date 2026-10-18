// Lecture / écriture dans un dépôt GitHub privé via l'API « contents ».
const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function b64FromUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function utf8FromB64(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** "owner/repo", "https://github.com/owner/repo(.git)" → {owner, repo} */
export function parseRepo(input) {
  const s = String(input || "").trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const m = s.match(/(?:github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export class Repo {
  constructor({ owner, repo, token }) { this.owner = owner; this.repo = repo; this.token = token; }

  async req(path, { method = "GET", body, accept = "application/vnd.github+json", raw = false } = {}) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: {
          Accept: accept,
          Authorization: "Bearer " + this.token,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store"
      });
    } catch (e) {
      throw new GitHubError(0, "Pas de connexion");
    }
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch (e) {}
      throw new GitHubError(res.status, msg);
    }
    if (raw) return res.blob();
    if (res.status === 204) return null;
    return res.json();
  }

  contentsPath(p) { return `/repos/${this.owner}/${this.repo}/contents/${p.split("/").map(encodeURIComponent).join("/")}`; }

  /** Vérifie le jeton : renvoie {private, canWrite} */
  async check() {
    const r = await this.req(`/repos/${this.owner}/${this.repo}`);
    return { private: !!r.private, canWrite: !!(r.permissions && (r.permissions.push || r.permissions.admin)) };
  }

  /** {data, sha} ou {data:null, sha:null} si le fichier n'existe pas */
  async getJson(path) {
    let meta;
    try { meta = await this.req(this.contentsPath(path)); }
    catch (e) { if (e.status === 404) return { data: null, sha: null }; throw e; }
    let text;
    if (meta.content && meta.encoding === "base64") text = utf8FromB64(meta.content);
    else {
      // fichier > 1 Mo : passer par le blob
      const blob = await this.req(`/repos/${this.owner}/${this.repo}/git/blobs/${meta.sha}`);
      text = utf8FromB64(blob.content);
    }
    return { data: JSON.parse(text), sha: meta.sha };
  }

  /** Écrit le JSON. Lève GitHubError 409/422 si le sha ne correspond plus. */
  async putJson(path, data, sha, message) {
    const r = await this.req(this.contentsPath(path), {
      method: "PUT",
      body: { message, content: b64FromUtf8(JSON.stringify(data, null, 1)), ...(sha ? { sha } : {}) }
    });
    return r.content.sha;
  }

  async putBlob(path, blob, message) {
    const content = await blobToB64(blob);
    let sha;
    try { sha = (await this.req(this.contentsPath(path))).sha; } catch (e) { if (e.status !== 404) throw e; }
    await this.req(this.contentsPath(path), { method: "PUT", body: { message, content, ...(sha ? { sha } : {}) } });
  }

  getBlob(path) {
    return this.req(this.contentsPath(path), { accept: "application/vnd.github.raw", raw: true });
  }

  async deleteFile(path, message) {
    let sha;
    try { sha = (await this.req(this.contentsPath(path))).sha; } catch (e) { if (e.status === 404) return; throw e; }
    await this.req(this.contentsPath(path), { method: "DELETE", body: { message, sha } });
  }
}
