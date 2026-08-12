/**
 * Image storage.
 *
 * Photos live on the server. The browser downscales and re-encodes before
 * uploading — a modern phone camera produces 4–8MB files and a menu card
 * renders at roughly 200px, so sending the original would be ~40× more bytes
 * than anyone can see, over a shop's uplink. That work happens before the bytes
 * leave the device, which is the whole reason to keep it.
 *
 * An uploaded photo is addressed by its server-issued id. The API returns the
 * public URL alongside every id it hands out — in the catalog, in the banners,
 * and in the upload response — so this module never has to guess a filename or
 * make a second request to resolve one. `registerImageUrls` collects those
 * pairs; `getImageUrl` reads them back.
 *
 * Nothing is cached in the browser's own storage. An earlier version kept
 * blobs in IndexedDB, which meant a photo uploaded by the shop existed only in
 * the manager's browser: the customer's device had no way to see it, and the
 * database never learned about it at all.
 */

import { api } from './api.js';

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
  upload: 'The image could not be uploaded. Please try again.',
};

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── The id → URL registry ──────────────────────────────────────────────────

/*
 * A shop's whole photo library is a few dozen entries, so one flat map for the
 * session is cheaper than tracking which screen needs which photo. It is fed
 * from API responses rather than built here: the server owns the filename, and
 * an id alone does not imply a URL (the extension depends on what the browser
 * managed to encode).
 */
const urls = new Map();

/**
 * Record the id → URL pairs carried by an API payload.
 *
 * Accepts any object or array and walks it, picking up every `imageId` /
 * `imageUrl` pair — including the `backgroundImageId` / `backgroundImageUrl`
 * pair a banner slide carries. Walking the payload rather than naming each
 * collection means a new endpoint that returns photos works without a change
 * here.
 */
export function registerImageUrls(payload) {
  if (!payload || typeof payload !== 'object') return;

  if (Array.isArray(payload)) {
    for (const entry of payload) registerImageUrls(entry);
    return;
  }

  for (const [key, value] of Object.entries(payload)) {
    // `imageUrl` → `imageId`, `backgroundImageUrl` → `backgroundImageId`.
    if (key.endsWith('ImageUrl') || key === 'imageUrl') {
      const idKey = `${key.slice(0, -3)}Id`;
      const id = payload[idKey];
      if (id && typeof value === 'string' && value) urls.set(id, value);
      continue;
    }

    if (value && typeof value === 'object') registerImageUrls(value);
  }
}

/** Public URL for a stored image id, or null when it is not known. */
export function getImageUrl(id) {
  if (!id) return null;
  return urls.get(id) ?? null;
}

export function forgetImageUrl(id) {
  if (id) urls.delete(id);
}

/** Test hook — the registry is module state and outlives a single case. */
export function clearImageUrls() {
  urls.clear();
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
 * Validate → decode → downscale → re-encode → upload.
 *
 * Resolves `{ ok, id, url, width, height, bytes }`, or `{ ok: false, reason }`.
 * The server validates independently — it inspects the bytes rather than
 * trusting the filename or the declared type — because the client doing the
 * right thing is not a guarantee.
 */
export async function processAndUploadImage(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
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

  const extension = blob.type === 'image/webp' ? 'webp' : 'jpg';

  let uploaded;
  try {
    uploaded = await api.admin.uploadImage(
      new File([blob], `upload.${extension}`, { type: blob.type }),
    );
  } catch (error) {
    // The API writes its messages for a person to read, so prefer it over the
    // generic one whenever there is one.
    return { ok: false, reason: 'upload', message: error?.message };
  }

  urls.set(uploaded.id, uploaded.url);

  return {
    ok: true,
    id: uploaded.id,
    url: uploaded.url,
    width: uploaded.width,
    height: uploaded.height,
    bytes: blob.size,
    sourceBytes: file.size,
    type: blob.type,
  };
}

/**
 * Delete an image from the server.
 *
 * The API refuses while anything still points at the photo, which is what
 * stops a delete from silently blanking a menu card. A refusal is reported
 * back rather than thrown: the caller is usually cleaning up after an edit
 * that has already succeeded, and must not be derailed by it.
 */
export async function deleteImage(id, { force = false } = {}) {
  if (!id) return { ok: true };

  try {
    await api.admin.deleteImage(id, { force });
    forgetImageUrl(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.code ?? 'failed', message: error?.message };
  }
}
