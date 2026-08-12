import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ORDER_TYPE, orderSetup } from '../data/store';
import { isStoreOpen, nextOpenAt, asapQuote } from '../lib/hours';
import { checkDeliveryArea, geocodePostcodeStub } from '../lib/geo';

const STORAGE_KEY = 'eaton.order.v1';

const OrderContext = createContext(null);

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function OrderProvider({ children }) {
  const persisted = loadPersisted();

  const [orderType, setOrderTypeState] = useState(
    persisted?.orderType ?? orderSetup.defaultOrderType,
  );
  // The order-type gate is shown until the customer has actively chosen.
  const [hasChosenOrderType, setHasChosenOrderType] = useState(
    persisted?.hasChosenOrderType ?? false,
  );
  const [deliveryAddress, setDeliveryAddress] = useState(persisted?.deliveryAddress ?? null);
  const [timing, setTiming] = useState(persisted?.timing ?? { mode: 'asap', slot: null });

  // Re-evaluated on a timer so the shop can open or close under the customer.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const snapshot = { orderType, hasChosenOrderType, deliveryAddress, timing };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Private browsing — the order simply won't survive a refresh.
    }
  }, [orderType, hasChosenOrderType, deliveryAddress, timing]);

  const storeOpen = useMemo(() => isStoreOpen(now, orderType), [now, orderType]);
  const opensAt = useMemo(() => nextOpenAt(now, orderType), [now, orderType]);
  const quote = useMemo(() => asapQuote(orderType, now), [orderType, now]);

  function setOrderType(next) {
    setOrderTypeState(next);
    setHasChosenOrderType(true);
    // A scheduled slot belongs to the order type it was picked under — prep
    // times and delivery cut-offs differ, so drop it on a switch.
    setTiming({ mode: 'asap', slot: null });
  }

  /**
   * Validate and store a delivery address.
   * Returns the result of the area check so the caller can show the reason.
   */
  function submitDeliveryAddress({ line1, postcode, notes }) {
    const coords = geocodePostcodeStub(postcode);
    const result = checkDeliveryArea(postcode, coords);

    if (result.ok) {
      setDeliveryAddress({
        line1: line1.trim(),
        postcode: postcode.trim().toUpperCase(),
        notes: (notes ?? '').trim(),
        coords,
        distanceKm: result.distanceKm,
      });
    }

    return result;
  }

  function clearDeliveryAddress() {
    setDeliveryAddress(null);
  }

  const value = {
    orderType,
    setOrderType,
    hasChosenOrderType,
    isDelivery: orderType === ORDER_TYPE.DELIVERY,
    isPickup: orderType === ORDER_TYPE.PICKUP,

    deliveryAddress,
    submitDeliveryAddress,
    clearDeliveryAddress,
    // Delivery orders can't reach checkout without a validated address.
    needsAddress: orderType === ORDER_TYPE.DELIVERY && !deliveryAddress,

    timing,
    setTiming,

    now,
    storeOpen,
    opensAt,
    quote,
    canPreOrder: orderSetup.isPreOrderingEnabled,
  };

  return <OrderContext.Provider value={value}>{children}</OrderContext.Provider>;
}

export function useOrder() {
  const context = useContext(OrderContext);
  if (!context) throw new Error('useOrder must be used inside an OrderProvider');
  return context;
}
