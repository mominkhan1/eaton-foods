/**
 * Image storage.
 *
 * Photos go in IndexedDB, not `localStorage` — the latter holds ~5MB of
 * *strings*, so base64-encoding a couple of phone photos would blow the whole
 * quota and take the menu and orders down with it. IndexedDB stores Blobs
 * natively and has orders of magnitude more room.
 *
 * Every upload is downscaled and re-encoded in the browser before it is
 * stored. A modern phone camera produces 4–8MB files; a menu card renders at
 * roughly 200px. Storing the original would be ~40× more bytes than anyone can
 * see, so uploads are capped at MAX_EDGE and re-encoded to WebP.
 *
 * When this moves to a server, `putImage` becomes an upload returning a URL,
 * and `getImageUrl` returns that URL directly. The downscaling is worth keeping
 * either way — it happens before the bytes leave the device.
 */

const DB_NAME = 'eaton-images';
const STORE = 'images';
const DB_VERSION = 1;

/** Longest edge kept, in CSS pixels — 2× a large card for retina screens. */
export const MAX_EDGE = 900;
export const QUALITY = 0.82;

/** Refuse absurd source files before spending memory decoding them. */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

// ── Pure helpers (unit-testable, no browser needed) ─────────────────────────

/**
 * Scale `width`×`height` to fit inside a `maxEdge` box, preserving aspect.
 * Images already inside the box are left alone rather than upscaled.
 */
export function fitWithin(width, height, maxEdge = MAX_EDGE) {
  if (width <= 0 || height <= 0) return { width: 0, height: 0, scaled: false };
  if (width <= maxEdge && height <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height), scaled: false };
  }

  const ratio = Math.min(maxEdge / width, maxEdge / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  };
}

export function validateSourceFile(file) {
  if (!file) return { ok: false, reason: 'no-file' };
  if (!String(file.type).startsWith('image/')) return { ok: false, reason: 'not-an-image' };
  if (file.size > MAX_SOURCE_BYTES) return { ok: false, reason: 'too-large' };
  return { ok: true };
}

export const IMAGE_ERRORS = {
  'no-file': 'No file selected.',
  'not-an-image': 'That file is not an image.',
  'too-large': `Images must be under ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)}MB.`,
  decode: 'That image could not be read — try a JPEG or PNG.',
  store: 'The image could not be saved. Your browser storage may be full.',
};

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function generateImageId() {
  const random = Math.random().toString(36).slice(2, 10);
  return `img_${Date.now().toString(36)}_${random}`;
}

// ── IndexedDB ──────────────────────────────────────────────────────────────

/** Node and locked-down browsers get a memory store so nothing throws. */
const memoryStore = new Map();

function hasIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

let dbPromise = null;

function openDb() {
  if (!hasIndexedDb()) return Promise.reject(new Error('no-indexeddb'));

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      // Let a later call retry rather than caching the failure forever.
      dbPromise = null;
      throw error;
    });
  }

  return dbPromise;
}

async function withStore(mode, work) {
  if (!hasIndexedDb()) return work(null);

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let result;

    try {
      result = work(store);
    } catch (error) {
      reject(error);
      return;
    }

    transaction.oncomplete = () => resolve(result?.result ?? result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function putImageBlob(id, blob) {
  if (!hasIndexedDb()) {
    memoryStore.set(id, blob);
    return id;
  }
  await withStore('readwrite', (store) => store.put(blob, id));
  return id;
}

export async function getImageBlob(id) {
  if (!id) return null;
  if (!hasIndexedDb()) return memoryStore.get(id) ?? null;

  try {
    return (await withStore('readonly', (store) => store.get(id))) ?? null;
  } catch {
    return null;
  }
}

export async function deleteImage(id) {
  if (!id) return;
  revokeImageUrl(id);

  if (!hasIndexedDb()) {
    memoryStore.delete(id);
    return;
  }

  try {
    await withStore('readwrite', (store) => store.delete(id));
  } catch {
    // A failed cleanup only wastes space; never block the catalog edit on it.
  }
}

export async function listImageIds() {
  if (!hasIndexedDb()) return [...memoryStore.keys()];

  try {
    return (await withStore('readonly', (store) => store.getAllKeys())) ?? [];
  } catch {
    return [];
  }
}

/** Drop stored images no longer referenced by the catalog. */
export async function pruneImages(keepIds) {
  const keep = new Set(keepIds.filter(Boolean));
  const stored = await listImageIds();

  const orphans = stored.filter((id) => !keep.has(id));
  await Promise.all(orphans.map((id) => deleteImage(id)));

  return orphans.length;
}

// ── Object URLs ────────────────────────────────────────────────────────────

/**
 * Session-scoped cache.
 *
 * A menu has tens of images, not thousands, so holding one object URL each for
 * the session is cheaper than refcounting every mount/unmount — and far harder
 * to get wrong. URLs are revoked explicitly when an image is replaced or
 * deleted.
 */
const urlCache = new Map();
const pending = new Map();

export function peekImageUrl(id) {
  return id ? (urlCache.get(id) ?? null) : null;
}

export async function getImageUrl(id) {
  if (!id) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  if (pending.has(id)) return pending.get(id);

  const load = (async () => {
    const blob = await getImageBlob(id);
    if (!blob) {
      pending.delete(id);
      return null;
    }

    const url = URL.createObjectURL(blob);
    urlCache.set(id, url);
    pending.delete(id);
    return url;
  })();

  pending.set(id, load);
  return load;
}

export function revokeImageUrl(id) {
  const url = urlCache.get(id);
  if (url) URL.revokeObjectURL(url);
  urlCache.delete(id);
  pending.delete(id);
}

// ── Upload pipeline ────────────────────────────────────────────────────────

function loadBitmap(file) {
  // createImageBitmap handles EXIF orientation; the <img> path is the fallback.
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() =>
      loadViaImageElement(file),
    );
  }
  return loadViaImageElement(file);
}

function loadViaImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode'));
    };
    image.src = url;
  });
}

function encode(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('decode'))),
      type,
      quality,
    );
  });
}

/**
 * Validate → decode → downscale → re-encode → store.
 *
 * Resolves `{ ok, id, width, height, bytes }`, or `{ ok: false, reason }`.
 */
export async function processAndStoreImage(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  const validation = validateSourceFile(file);
  if (!validation.ok) return validation;

  let bitmap;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    return { ok: false, reason: 'decode' };
  }

  const sourceWidth = bitmap.width ?? bitmap.naturalWidth;
  const sourceHeight = bitmap.height ?? bitmap.naturalHeight;
  const target = fitWithin(sourceWidth, sourceHeight, maxEdge);

  if (target.width === 0) return { ok: false, reason: 'decode' };

  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;

  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, target.width, target.height);
  bitmap.close?.();

  let blob;
  try {
    blob = await encode(canvas, 'image/webp', quality);
    // Safari < 14 ignores the type and hands back a PNG, which is far larger
    // than the JPEG we would rather have.
    if (!blob || blob.type !== 'image/webp') {
      blob = await encode(canvas, 'image/jpeg', quality);
    }
  } catch {
    return { ok: false, reason: 'decode' };
  }

  const id = generateImageId();
  try {
    await putImageBlob(id, blob);
  } catch {
    return { ok: false, reason: 'store' };
  }

  return {
    ok: true,
    id,
    width: target.width,
    height: target.height,
    bytes: blob.size,
    sourceBytes: file.size,
    type: blob.type,
  };
}
