import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { calculateTotals } from '../lib/pricing';
import { isItemAvailableFor } from '../data/menu';
import { useOrder } from './OrderContext';

const STORAGE_KEY = 'eaton.cart.v1';

const CartContext = createContext(null);

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { lines: [], promoCode: null };
    const parsed = JSON.parse(raw);
    return { lines: parsed.lines ?? [], promoCode: parsed.promoCode ?? null };
  } catch {
    return { lines: [], promoCode: null };
  }
}

export function CartProvider({ children }) {
  const { orderType } = useOrder();
  const persisted = loadPersisted();

  const [lines, setLines] = useState(persisted.lines);
  const [promoCode, setPromoCode] = useState(persisted.promoCode);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ lines, promoCode }));
    } catch {
      // Non-fatal; the basket just won't survive a refresh.
    }
  }, [lines, promoCode]);

  /** Identical configurations stack rather than creating a second line. */
  const addLine = useCallback((line) => {
    setLines((current) => {
      const existing = current.findIndex((candidate) => candidate.lineId === line.lineId);
      if (existing === -1) return [...current, line];

      const next = [...current];
      next[existing] = {
        ...next[existing],
        quantity: next[existing].quantity + line.quantity,
      };
      return next;
    });
  }, []);

  const setQuantity = useCallback((lineId, quantity) => {
    setLines((current) =>
      quantity <= 0
        ? current.filter((line) => line.lineId !== lineId)
        : current.map((line) => (line.lineId === lineId ? { ...line, quantity } : line)),
    );
  }, []);

  const removeLine = useCallback((lineId) => {
    setLines((current) => current.filter((line) => line.lineId !== lineId));
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setPromoCode(null);
  }, []);

  /**
   * Lines that can't be sold on the current order type.
   *
   * This is the collection-only trap: add an in-store slush, switch to
   * delivery, and the basket is now unfulfillable. The UI surfaces these and
   * blocks checkout until they're removed.
   */
  const blockedLines = useMemo(
    () =>
      lines.filter(
        (line) => !isItemAvailableFor({ orderTypes: line.orderTypes }, orderType),
      ),
    [lines, orderType],
  );

  const removeBlockedLines = useCallback(() => {
    setLines((current) =>
      current.filter((line) => isItemAvailableFor({ orderTypes: line.orderTypes }, orderType)),
    );
  }, [orderType]);

  const totals = useMemo(
    () => calculateTotals(lines, orderType, promoCode),
    [lines, orderType, promoCode],
  );

  const value = {
    lines,
    addLine,
    setQuantity,
    removeLine,
    clear,
    promoCode,
    setPromoCode,
    totals,
    blockedLines,
    removeBlockedLines,
    isEmpty: lines.length === 0,
    canCheckout: lines.length > 0 && totals.meetsMinimum && blockedLines.length === 0,
    isOpen,
    openCart: () => setIsOpen(true),
    closeCart: () => setIsOpen(false),
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside a CartProvider');
  return context;
}
