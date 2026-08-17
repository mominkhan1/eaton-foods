/**
 * API client.
 *
 * The single place that talks to the PHP backend. Everything else in the app
 * goes through `repository.js`, which goes through here — so a change of
 * transport (or a move to a different host) touches these two files only.
 *
 * Errors are normalised into `ApiError`, which carries the machine-readable
 * `code` the backend sends. Callers switch on the code; the `message` is
 * already written for a customer to read.
 */

/*
 * `import.meta.env` is Vite's, and is undefined under plain Node — which the
 * smoke test runs in. It only ever reaches the pure helpers there, never a
 * request, but the module still has to load.
 */
const BASE = import.meta.env?.VITE_API_BASE ?? '/api';

export class ApiError extends Error {
  constructor(code, message, status, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    Object.assign(this, extra);
  }

  /** Worth offering a retry button for; a 422 is not. */
  get isTransient() {
    return this.status === 0 || this.status >= 500 || this.code === 'network';
  }

  get isAuthError() {
    return this.status === 401 || this.status === 403;
  }
}

/**
 * One request.
 *
 * `credentials: 'same-origin'` is what carries the admin session cookie. It is
 * the default in modern browsers, but stated explicitly because the whole
 * admin panel silently stops working if it is ever wrong.
 */
async function request(path, { method = 'GET', body, signal, isForm = false } = {}) {
  const options = {
    method,
    credentials: 'same-origin',
    signal,
    headers: {},
  };

  if (body !== undefined) {
    if (isForm) {
      // Let the browser set Content-Type, so it can add the multipart boundary.
      options.body = body;
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
  }

  let response;
  try {
    response = await fetch(`${BASE}${path}`, options);
  } catch (cause) {
    // An aborted request is the caller's own doing — let it through untouched
    // so effects can distinguish "cancelled" from "the shop's wifi dropped".
    if (cause?.name === 'AbortError') throw cause;

    throw new ApiError(
      'network',
      'Could not reach the server. Check your connection and try again.',
      0,
    );
  }

  // 204, or an empty body on a 200.
  if (response.status === 204) return null;

  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      // A PHP fatal error or an HTML error page from Apache lands here. The
      // raw text is useless to a customer and may leak paths, so it is logged
      // rather than shown.
      console.error('Non-JSON response from API:', text.slice(0, 500));
      throw new ApiError(
        'bad_response',
        'The server sent something unexpected. Please try again.',
        response.status,
      );
    }
  }

  if (!response.ok) {
    const { error, message, ...extra } = payload ?? {};
    throw new ApiError(
      error ?? 'http_error',
      message ?? 'Something went wrong.',
      response.status,
      extra,
    );
  }

  return payload;
}

const get = (path, options) => request(path, { ...options, method: 'GET' });
const post = (path, body, options) => request(path, { ...options, method: 'POST', body });
const put = (path, body, options) => request(path, { ...options, method: 'PUT', body });
const patch = (path, body, options) => request(path, { ...options, method: 'PATCH', body });
const del = (path, options) => request(path, { ...options, method: 'DELETE' });

// ── Public ─────────────────────────────────────────────────────────────────

export const api = {
  /**
   * Catalog, hours, banners and promo in one request.
   *
   * The storefront needs all four before it can paint, and on shared hosting
   * each request is its own PHP process and MySQL connection.
   */
  getBootstrap: (options) => get('/bootstrap', options),

  /** Store config, order setup, promo and the PayPal client id. */
  getConfig: (options) => get('/config', options),
  getCatalog: (options) => get('/catalog', options),
  getHours: (options) => get('/hours', options),
  getBanners: (options) => get('/banners', options),
  getPromo: (options) => get('/promo', options),

  placeOrder: (order, options) => post('/orders', order, options),
  trackOrder: (reference, options) => get(`/orders/${encodeURIComponent(reference)}`, options),

  /**
   * Start a PayPal payment for an order, returning the PayPal order id for
   * the SDK to open. The amount comes from the stored order, never from here.
   *
   * `source` is which sheet is about to open — 'paypal', 'googlepay' or
   * 'applepay'. It decides whether the order is pinned to the PayPal wallet or
   * left open for a wallet to attach its own token, and the server refuses any
   * value the shop has not switched on.
   */
  createPaypalOrder: (reference, source = 'paypal', options) =>
    post(`/orders/${encodeURIComponent(reference)}/paypal-order`, { source }, options),

  /**
   * Take the money. The server checks the captured amount and currency
   * against the order before anything is marked paid.
   */
  capturePaypalOrder: (reference, paypalOrderId, options) =>
    post(`/orders/${encodeURIComponent(reference)}/paypal-capture`, { paypalOrderId }, options),

  // ── Auth ─────────────────────────────────────────────────────────────────

  login: (email, password) => post('/auth/login', { email, password }),
  logout: () => post('/auth/logout'),
  /** Null when signed out — used to restore a session on page load. */
  me: (options) => get('/auth/me', options),
  changePassword: (currentPassword, newPassword) =>
    post('/auth/change-password', { currentPassword, newPassword }),

  // ── Admin ────────────────────────────────────────────────────────────────

  admin: {
    listOrders: (params = {}, options) => {
      const search = new URLSearchParams(
        Object.entries(params).filter(([, value]) => value != null && value !== ''),
      );
      const query = search.toString();
      return get(`/admin/orders${query ? `?${query}` : ''}`, options);
    },
    getOrder: (reference, options) =>
      get(`/admin/orders/${encodeURIComponent(reference)}`, options),
    setOrderStatus: (reference, status) =>
      patch(`/admin/orders/${encodeURIComponent(reference)}/status`, { status }),
    acknowledgeOrder: (reference) =>
      post(`/admin/orders/${encodeURIComponent(reference)}/acknowledge`),

    /** As `getBootstrap`, plus the unpublished rows the panel manages. */
    getBootstrap: (options) => get('/admin/bootstrap', options),

    /** Includes unpublished items, unlike the public catalog. */
    getCatalog: (options) => get('/admin/catalog', options),
    saveCategory: (category) => put(`/admin/categories/${encodeURIComponent(category.id)}`, category),
    deleteCategory: (id) => del(`/admin/categories/${encodeURIComponent(id)}`),
    reorderCategories: (orderedIds) => post('/admin/categories/reorder', { orderedIds }),

    saveItem: (item) => put(`/admin/items/${encodeURIComponent(item.id)}`, item),
    deleteItem: (id) => del(`/admin/items/${encodeURIComponent(id)}`),

    saveModifierGroup: (group) =>
      put(`/admin/modifier-groups/${encodeURIComponent(group.id)}`, group),
    deleteModifierGroup: (id, { force = false } = {}) =>
      del(`/admin/modifier-groups/${encodeURIComponent(id)}${force ? '?force=1' : ''}`),

    saveHours: (hours) => put('/admin/hours', hours),

    getBanners: (options) => get('/admin/banners', options),
    saveBanner: (banner) => put(`/admin/banners/${encodeURIComponent(banner.id)}`, banner),
    deleteBanner: (id) => del(`/admin/banners/${encodeURIComponent(id)}`),
    reorderBanners: (orderedIds) => post('/admin/banners/reorder', { orderedIds }),
    saveBannerSettings: (settings) => put('/admin/banner-settings', settings),

    savePromo: (promo) => put('/admin/promo', promo),

    /** @param {File} file Already downscaled by the browser. */
    uploadImage: (file) => {
      const form = new FormData();
      form.append('file', file);
      return request('/admin/images', { method: 'POST', body: form, isForm: true });
    },
    deleteImage: (id, { force = false } = {}) =>
      del(`/admin/images/${encodeURIComponent(id)}${force ? '?force=1' : ''}`),

    getReports: ({ from, to } = {}, options) => {
      const search = new URLSearchParams();
      if (from) search.set('from', from);
      if (to) search.set('to', to);
      const query = search.toString();
      return get(`/admin/reports${query ? `?${query}` : ''}`, options);
    },

    listStaff: (options) => get('/admin/staff', options),
    createStaff: (staff) => post('/admin/staff', staff),
    updateStaff: (id, patchBody) => put(`/admin/staff/${id}`, patchBody),
    deleteStaff: (id) => del(`/admin/staff/${id}`),
  },
};

export default api;
