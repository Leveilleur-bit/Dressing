// Appareil photo intégré : l'image ne passe jamais par l'album du téléphone.
const $ = (id) => document.getElementById(id);

let stream = null, facing = "environment", resolver = null;

async function start() {
  stop();
  const video = $("cam-video");
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } },
    audio: false
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
}
function stop() {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  $("cam-video").srcObject = null;
}
function close(result) {
  stop();
  $("camera").hidden = true;
  const r = resolver; resolver = null;
  if (r) r(result);
}

export function cameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
}

/** Ouvre la caméra ; résout un Blob JPEG carré, ou null si annulé. Rejette si la caméra est refusée. */
export async function takePhoto() {
  $("cam-msg").hidden = true;
  $("camera").hidden = false;
  try { await start(); }
  catch (e) { $("camera").hidden = true; throw e; }
  return new Promise((resolve) => { resolver = resolve; });
}

function capture() {
  const video = $("cam-video");
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  // même cadrage que le carré affiché : carré centré, légèrement au-dessus du milieu
  const side = Math.min(vw, vh) * 0.92;
  const sx = (vw - side) / 2, sy = Math.max(0, Math.min(vh - side, vh * 0.45 - side / 2));
  const out = Math.min(900, Math.round(side));
  const c = document.createElement("canvas");
  c.width = out; c.height = out;
  c.getContext("2d").drawImage(video, sx, sy, side, side, 0, 0, out, out);
  c.toBlob((b) => close(b), "image/jpeg", 0.82);
}

export function initCamera() {
  $("cam-shoot").addEventListener("click", capture);
  $("cam-cancel").addEventListener("click", () => close(null));
  $("cam-flip").addEventListener("click", async () => {
    facing = facing === "environment" ? "user" : "environment";
    try { await start(); } catch (e) { $("cam-msg").textContent = "Impossible de changer de caméra."; $("cam-msg").hidden = false; }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && !$("camera").hidden) close(null); });
}

/** Réduit une image choisie dans l'album. */
export function resizeFile(file, max = 900) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("load")); };
    img.src = url;
  });
}
