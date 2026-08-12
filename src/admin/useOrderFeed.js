import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

/** How often the kitchen screen re-reads the order list. */
export const POLL_MS = 10000;

/**
 * Live order list from the API.
 *
 * Orders arrive from other people's phones, so there is no local event to
 * react to — the screen has to ask. Polling is the right shape for that here:
 * a takeaway's kitchen tablet checking a small endpoint every ten seconds
 * costs almost nothing, and it survives the tab being backgrounded and the
 * wifi dropping in a way a long-lived connection does not.
 *
 * `scope` and `status` are passed through to the API, which does the filtering
 * in SQL. Pulling every order ever placed onto a tablet and filtering in the
 * browser gets slower every week the shop trades.
 *
 * A failed poll leaves the previous list on screen and reports the error
 * separately: a blank kitchen screen during a service is worse than a slightly
 * stale one, and the next tick usually recovers on its own.
 */
export function useOrderFeed({
  scope = 'active',
  status,
  intervalMs = POLL_MS,
  enabled = true,
} = {}) {
  const [state, setState] = useState({
    orders: [],
    unacknowledgedCount: 0,
    loading: true,
    error: null,
  });

  const load = useCallback(
    async (signal) => {
      try {
        const payload = await api.admin.listOrders({ scope, status, limit: 200 }, { signal });
        if (signal?.aborted) return;

        setState({
          orders: payload.orders,
          unacknowledgedCount: payload.unacknowledgedCount ?? 0,
          loading: false,
          error: null,
        });
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) return;
        setState((current) => ({ ...current, loading: false, error }));
      }
    },
    [scope, status],
  );

  useEffect(() => {
    // Polling before the session probe has finished, or for a user whose role
    // has no access to orders, would only collect 401s and 403s.
    if (!enabled) return undefined;

    const controller = new AbortController();

    load(controller.signal);
    const id = setInterval(() => load(controller.signal), intervalMs);

    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [load, intervalMs, enabled]);

  return { ...state, refresh: () => load() };
}
