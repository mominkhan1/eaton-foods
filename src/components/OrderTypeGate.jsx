import { useState } from 'react';
import Modal from './Modal';
import { ORDER_TYPE, orderSetup, storeConfig } from '../data/store';
import { useOrder } from '../context/OrderContext';
import { DELIVERY_AREA_MESSAGES } from '../lib/geo';
import { formatTime } from '../lib/hours';
import { StorefrontIcon, ScooterIcon } from './Icons';

/**
 * First-run gate: collection or delivery, and for delivery a postcode that
 * passes the area check. Nothing else in the app assumes an order type until
 * this has been answered.
 */
export default function OrderTypeGate() {
  const {
    hasChosenOrderType,
    setOrderType,
    submitDeliveryAddress,
    storeOpen,
    opensAt,
  } = useOrder();

  const [step, setStep] = useState('choose');
  const [line1, setLine1] = useState('');
  const [postcode, setPostcode] = useState('');
  const [error, setError] = useState(null);

  if (hasChosenOrderType) return null;

  function chooseCollection() {
    setOrderType(ORDER_TYPE.PICKUP);
  }

  function chooseDelivery() {
    setError(null);
    setStep('address');
  }

  function confirmAddress(event) {
    event.preventDefault();

    if (!line1.trim()) {
      setError('Please enter your street address.');
      return;
    }

    const result = submitDeliveryAddress({ line1, postcode });

    if (!result.ok) {
      setError(DELIVERY_AREA_MESSAGES[result.reason] ?? 'We could not check that address.');
      return;
    }

    setOrderType(ORDER_TYPE.DELIVERY);
  }

  return (
    <Modal open title={step === 'choose' ? 'How do you want your food?' : 'Where are we delivering?'} dismissible={false} size="sm">
      {!storeOpen && (
        <p className="mb-4 rounded-xl bg-surface-0 px-4 py-3 text-sm text-ink-500">
          We're closed right now.{' '}
          {opensAt ? (
            <>
              We reopen at{' '}
              <span className="font-semibold text-brand-600">{formatTime(opensAt)}</span> — you can
              still place an order for later.
            </>
          ) : (
            'Please check back soon.'
          )}
        </p>
      )}

      {step === 'choose' ? (
        <div className="grid gap-3">
          <button
            type="button"
            onClick={chooseCollection}
            className="card group flex items-center gap-4 p-4 text-left hover:border-brand-500"
          >
            <StorefrontIcon className="h-8 w-8 shrink-0 text-brand-600" />
            <span className="flex-1">
              <span className="block font-semibold text-ink-950">Collection</span>
              <span className="block text-sm text-ink-500">
                Ready in ~{orderSetup.pickupTime} mins · {storeConfig.address}
              </span>
            </span>
            <Chevron />
          </button>

          {orderSetup.isDeliveryOn && (
            <button
              type="button"
              onClick={chooseDelivery}
              className="card group flex items-center gap-4 p-4 text-left hover:border-brand-500"
            >
              <ScooterIcon className="h-8 w-8 shrink-0 text-brand-600" />
              <span className="flex-1">
                <span className="block font-semibold text-ink-950">Delivery</span>
                <span className="block text-sm text-ink-500">
                  ~{orderSetup.deliveryTime} mins · {orderSetup.deliveryAreaLabel}
                </span>
              </span>
              <Chevron />
            </button>
          )}
        </div>
      ) : (
        <form onSubmit={confirmAddress} className="grid gap-3">
          <label className="block">
            <span className="mb-1 block text-sm text-ink-500">Street address</span>
            <input
              className="field"
              value={line1}
              onChange={(event) => setLine1(event.target.value)}
              placeholder="12 Platt Lane"
              autoComplete="address-line1"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-ink-500">Postcode</span>
            <input
              className="field uppercase"
              value={postcode}
              onChange={(event) => setPostcode(event.target.value)}
              placeholder="AL8 6HA"
              autoComplete="postal-code"
            />
          </label>

          {error && (
            <p className="rounded-xl bg-chilli-500/10 px-4 py-3 text-sm text-chilli-500">{error}</p>
          )}

          <div className="mt-1 flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setStep('choose')}>
              Back
            </button>
            <button type="submit" className="btn-primary flex-1">
              Check postcode
            </button>
          </div>

          <button
            type="button"
            onClick={chooseCollection}
            className="btn-ghost mt-1 text-xs"
          >
            Outside the zone? Switch to collection
          </button>
        </form>
      )}
    </Modal>
  );
}

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="text-ink-500 group-hover:text-brand-600">
      <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
