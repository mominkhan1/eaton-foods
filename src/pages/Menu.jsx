import MenuBrowser from '../components/MenuBrowser';
import { useOrder } from '../context/OrderContext';
import { formatTime } from '../lib/hours';

export default function Menu() {
  const { storeOpen, opensAt, canPreOrder } = useOrder();

  return (
    <>
      {!storeOpen && (
        <div className="border-b border-brand-500/30 bg-brand-500/10">
          <p className="mx-auto max-w-6xl px-4 py-3 text-sm text-brand-600">
            We're closed right now
            {opensAt ? ` — we reopen at ${formatTime(opensAt)}.` : '.'}
            {canPreOrder && ' You can still build your order and schedule it for later.'}
          </p>
        </div>
      )}

      <MenuBrowser />
    </>
  );
}
