import { useState } from 'react';
import Modal from './Modal';
import { useOrder } from '../context/OrderContext';
import { DELIVERY_AREA_MESSAGES } from '../lib/geo';
import { ORDER_TYPE, orderSetup } from '../data/store';

/** Mounted only while open, so the form re-seeds from the saved address. */
export default function AddressModal({ open, onClose }) {
  if (!open) return null;
  return <AddressForm onClose={onClose} />;
}

function AddressForm({ onClose }) {
  const { deliveryAddress, submitDeliveryAddress, setOrderType } = useOrder();

  const [line1, setLine1] = useState(deliveryAddress?.line1 ?? '');
  const [postcode, setPostcode] = useState(deliveryAddress?.postcode ?? '');
  const [notes, setNotes] = useState(deliveryAddress?.notes ?? '');
  const [error, setError] = useState(null);

  function onSubmit(event) {
    event.preventDefault();

    if (!line1.trim()) {
      setError('Please enter your street address.');
      return;
    }

    const result = submitDeliveryAddress({ line1, postcode, notes });

    if (!result.ok) {
      setError(DELIVERY_AREA_MESSAGES[result.reason] ?? 'We could not check that address.');
      return;
    }

    setOrderType(ORDER_TYPE.DELIVERY);
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Delivery address" size="sm">
      <form onSubmit={onSubmit} className="grid gap-3">
        <p className="text-sm text-ink-500">
          We deliver within {orderSetup.deliveryRadiusKm}km of the shop. Minimum order £
          {orderSetup.minimumDeliveryOrder.toFixed(2)}, free over £
          {orderSetup.freeDeliveryThreshold.toFixed(2)}.
        </p>

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

        <label className="block">
          <span className="mb-1 block text-sm text-ink-500">
            Delivery notes <span className="text-ink-500/70">(optional)</span>
          </span>
          <input
            className="field"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Flat 3, buzzer doesn't work"
          />
        </label>

        {error && (
          <p className="rounded-xl bg-chilli-500/10 px-4 py-3 text-sm text-chilli-500">{error}</p>
        )}

        <div className="mt-1 flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1">
            Save address
          </button>
        </div>
      </form>
    </Modal>
  );
}
