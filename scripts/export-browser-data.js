/**
 * Export everything the app has stored in this browser.
 *
 * The demo keeps its data in the browser, which means it is invisible to git
 * and lost the moment the profile is cleared. This pulls it all out into one
 * JSON file so menu edits, banners and uploaded photos can be committed and
 * later imported into MySQL.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *
 *   1. Open the origin that HAS your data — http://localhost:5173
 *      (127.0.0.1 is a different origin with different storage)
 *   2. Press F12 → Console tab
 *   3. Paste this whole file, press Enter
 *   4. A file called eaton-export.json downloads
 *   5. Move it into the project root and run:  npm run import:browser
 *
 * Photos are Blobs, so they are base64-encoded to survive the JSON trip and
 * decoded back to real image files on the way in.
 */

(async () => {
  const KEYS = [
    'eaton.catalog.v3',
    'eaton.hours.v2',
    'eaton.orders.v2',
    'eaton.banners.v1',
    'eaton.promo.v1',
  ];

  const out = {
    exportedAt: new Date().toISOString(),
    origin: window.location.origin,
    localStorage: {},
    images: [],
  };

  // ── localStorage ─────────────────────────────────────────────────────────
  for (const key of KEYS) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    try {
      out.localStorage[key] = JSON.parse(raw);
    } catch {
      console.warn(`[export] ${key} is not valid JSON, skipping`);
    }
  }

  // ── IndexedDB photos ─────────────────────────────────────────────────────
  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

  const images = await new Promise((resolve) => {
    const request = indexedDB.open('eaton-images', 1);

    request.onerror = () => {
      console.warn('[export] could not open the image store');
      resolve([]);
    };

    // Fires when no database exists yet — nothing was ever uploaded here.
    request.onupgradeneeded = (event) => {
      if (!event.target.result.objectStoreNames.contains('images')) {
        event.target.transaction.abort();
        resolve([]);
      }
    };

    request.onsuccess = async () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('images')) {
        resolve([]);
        return;
      }

      const store = db.transaction('images', 'readonly').objectStore('images');
      const keysReq = store.getAllKeys();
      const valsReq = store.getAll();

      let keys = null;
      let values = null;
      const done = async () => {
        if (keys === null || values === null) return;

        const encoded = [];
        for (let i = 0; i < keys.length; i += 1) {
          const blob = values[i];
          if (!(blob instanceof Blob)) continue;
          encoded.push({
            id: String(keys[i]),
            type: blob.type || 'image/webp',
            bytes: blob.size,
            dataUrl: await blobToDataUrl(blob),
          });
        }
        resolve(encoded);
      };

      keysReq.onsuccess = () => { keys = keysReq.result; done(); };
      valsReq.onsuccess = () => { values = valsReq.result; done(); };
    };
  });

  out.images = images;

  // ── Download ─────────────────────────────────────────────────────────────
  const json = JSON.stringify(out, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'eaton-export.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  const catalog = out.localStorage['eaton.catalog.v3'];
  const banners = out.localStorage['eaton.banners.v1'];

  console.log('%c Eat On export complete ', 'background:#c0392b;color:#fff;font-weight:bold');
  console.log('  origin      :', out.origin);
  console.log('  categories  :', catalog?.categories?.length ?? 0);
  console.log('  items       :', catalog?.items?.length ?? 0);
  console.log('  banners     :', banners?.slides?.length ?? 0);
  console.log('  photos      :', out.images.length);
  console.log('  orders      :', Object.keys(out.localStorage['eaton.orders.v2'] ?? {}).length);
  console.log('  size        :', (json.length / 1024).toFixed(0), 'KB');
  console.log('\n  Saved as eaton-export.json — move it to the project root,');
  console.log('  then run:  npm run import:browser');
})();
