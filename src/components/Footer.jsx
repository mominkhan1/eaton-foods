import { storeConfig, orderSetup } from '../data/store';
import { openingHoursSummary } from '../lib/hours';
import logo from '../assets/eat-on-logo.png';

export default function Footer() {
  const hours = openingHoursSummary();

  return (
    <footer className="mt-16 border-t border-surface-200 bg-surface-100">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          <img
            src={logo}
            alt={`${storeConfig.name} logo`}
            width={132}
            height={132}
            className="mb-3 h-28 w-auto"
          />
          <p className="mt-2 text-sm text-ink-500">
            {storeConfig.address}
            <br />
            {storeConfig.postcode}
          </p>
          <p className="mt-3 text-sm">
            <a href={`tel:${storeConfig.phone}`} className="text-brand-600 hover:underline">
              {storeConfig.phoneDisplay}
            </a>
          </p>
        </div>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-800">
            Opening hours
          </h3>
          <dl className="mt-3 grid gap-1 text-sm">
            {hours.map((row) => (
              <div key={row.isoDay} className="flex justify-between gap-4">
                <dt className="text-ink-500">{row.day}</dt>
                <dd className="tabular-nums text-ink-800">{row.hours}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-800">
            Delivery
          </h3>
          <ul className="mt-3 grid gap-1.5 text-sm text-ink-500">
            <li>{orderSetup.deliveryAreaLabel}</li>
            <li>Minimum order £{orderSetup.minimumDeliveryOrder.toFixed(2)}</li>
            <li>Free over £{orderSetup.freeDeliveryThreshold.toFixed(2)}</li>
            <li>Card payment only</li>
          </ul>
          <p className="mt-4 text-xs text-ink-500/80">
            Districts served: {orderSetup.servedPostcodeDistricts.join(', ')}
          </p>
        </div>
      </div>

      <div className="border-t border-surface-100 px-4 py-4">
        <p className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 text-xs text-ink-500/80">
          {storeConfig.isHalal && (
            <span className="chip bg-leaf-500/15 text-leaf-500">Halal</span>
          )}
          © {new Date().getFullYear()} {storeConfig.name}
          {storeConfig.legalName ? ` by ${storeConfig.legalName}` : ''}, {storeConfig.city}.
          Allergen information available in store.
        </p>
      </div>
    </footer>
  );
}
