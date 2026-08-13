import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { storeConfig } from '../data/store';
import mark from '../assets/eat-on-mark.webp';

/**
 * Admin authentication.
 *
 * Identity lives in a server session, not in this component. Nothing here
 * decides whether you are allowed in — it asks the API who you are, and the
 * API re-checks on every request. Hiding a button below is presentation; the
 * actual enforcement is in the PHP, so a tampered client gains nothing.
 *
 * `permissions` comes from the server too, so the nav reflects the role the
 * backend will actually honour rather than a guess made here.
 */

const AdminAuthContext = createContext(null);

/** Backoff between session probes, in ms. Four attempts over ~4.6 seconds. */
const PROBE_DELAYS = [400, 1200, 3000];

/**
 * Ask the server who we are, retrying transient failures.
 *
 * Pure: it returns the outcome rather than touching state, so the caller owns
 * when that lands. Without the retry a one-second blip — patchy wifi on a
 * kitchen tablet, or a dev server mid-restart — wedges the whole panel on an
 * error screen until someone thinks to reload. During a rush that is orders
 * going unseen.
 *
 * Returns `{ user, status }`, or null if the probe was aborted.
 */
async function resolveSession(signal) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const data = await api.me({ signal });
      return { user: data?.user ?? null, status: 'ready' };
    } catch (error) {
      if (error?.name === 'AbortError') return null;

      // A 401 is a clean "not signed in", not a failure — show the form.
      const transient = error instanceof ApiError && error.isTransient;
      if (!transient || attempt >= PROBE_DELAYS.length) {
        return { user: null, status: transient ? 'offline' : 'ready' };
      }

      await new Promise((resolve) => setTimeout(resolve, PROBE_DELAYS[attempt]));
      if (signal?.aborted) return null;
    }
  }
}

export function AdminAuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // 'checking' until the session probe finishes. Rendering the login form
  // before we know would flash it at an already-signed-in shop on every
  // refresh, which reads as being logged out.
  const [status, setStatus] = useState('checking');

  const [probeId, setProbeId] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      const outcome = await resolveSession(controller.signal);
      if (cancelled || outcome === null) return;

      setUser(outcome.user);
      setStatus(outcome.status);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // probeId is the retry trigger: bumping it re-runs the probe.
  }, [probeId]);

  const retry = useCallback(() => {
    setStatus('checking');
    setProbeId((n) => n + 1);
  }, []);

  // Coming back online, or returning to the tab, is the natural moment to
  // re-check rather than making someone hunt for a button.
  useEffect(() => {
    if (status !== 'offline') return undefined;

    const onVisible = () => {
      if (document.visibilityState === 'visible') retry();
    };

    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [status, retry]);

  const signIn = useCallback(async (email, password) => {
    const data = await api.login(email, password);
    setUser(data.user);
    setStatus('ready');
    return data.user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      // Clear locally even if the request failed — the alternative is a UI
      // that claims you are still signed in when you asked not to be.
      setUser(null);
    }
  }, []);

  const can = useCallback(
    (permission) => Boolean(user?.permissions?.includes(permission)),
    [user],
  );

  const value = useMemo(
    () => ({ user, status, isAuthed: Boolean(user), signIn, signOut, can, retry }),
    [user, status, signIn, signOut, can, retry],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (!context) throw new Error('useAdminAuth must be used inside an AdminAuthProvider');
  return context;
}

export function AdminLogin() {
  const { signIn, status, retry } = useAdminAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      await signIn(email.trim(), password);
    } catch (caught) {
      // The server already writes these for a human to read, and deliberately
      // does not say whether it was the email or the password that was wrong.
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not sign in. Please try again.',
      );
      setPassword('');
      setBusy(false);
    }
  }

  if (status === 'offline') {
    return (
      <div className="grid min-h-screen place-items-center bg-surface-100 px-4">
        <div className="card w-full max-w-sm p-6 text-center">
          <h1 className="text-2xl text-ink-950">Cannot reach the server</h1>
          <p className="mt-2 text-sm text-ink-500">
            The admin panel could not contact the site after several tries. It will keep trying
            on its own when the connection comes back.
          </p>
          <button type="button" className="btn-primary mt-5 w-full" onClick={retry}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center bg-surface-100 px-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm p-6" noValidate>
        <img src={mark} alt="" aria-hidden="true" width={70} height={44} className="h-11 w-auto" />

        <h1 className="mt-4 text-3xl text-ink-950">{storeConfig.name} admin</h1>
        <p className="mt-1 text-sm text-ink-500">Sign in to manage the shop.</p>

        <label className="mt-5 block text-sm font-medium text-ink-700" htmlFor="admin-email">
          Email
        </label>
        <input
          id="admin-email"
          type="email"
          className="field mt-1"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setError(null);
          }}
          autoComplete="username"
          autoFocus
          required
          disabled={busy}
        />

        <label className="mt-4 block text-sm font-medium text-ink-700" htmlFor="admin-password">
          Password
        </label>
        <input
          id="admin-password"
          type="password"
          className="field mt-1"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setError(null);
          }}
          autoComplete="current-password"
          required
          disabled={busy}
        />

        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-chilli-500/10 px-3 py-2 text-sm text-chilli-500">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary mt-5 w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="mt-5 text-xs text-ink-400">
          Accounts are created by the shop owner. If you are locked out, ask them to reset your
          password.
        </p>
      </form>
    </div>
  );
}
