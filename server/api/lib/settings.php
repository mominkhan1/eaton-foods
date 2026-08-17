<?php
/**
 * Settings: store config, order setup, trading hours, banners, promo.
 *
 * The singleton blobs live in the `settings` table as JSON. Defaults mirror
 * src/data/store.js so a fresh database behaves identically to the demo.
 */

declare(strict_types=1);

require_once __DIR__ . '/paypal.php';

// ── Generic key/value ──────────────────────────────────────────────────────

function get_setting(string $key, array $default = []): array
{
    static $cache = [];
    if (array_key_exists($key, $cache)) {
        return $cache[$key];
    }

    $row = db_one('SELECT value_json FROM settings WHERE setting_key = ?', [$key]);
    if (!$row) {
        return $cache[$key] = $default;
    }

    $decoded = json_decode($row['value_json'], true);
    if (!is_array($decoded)) {
        return $cache[$key] = $default;
    }

    // Merge over the default so a setting gaining a field does not read as
    // null for shops whose stored copy predates it.
    return $cache[$key] = array_replace_recursive($default, $decoded);
}

function put_setting(string $key, array $value): void
{
    db_run(
        'INSERT INTO settings (setting_key, value_json) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)',
        [$key, json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]
    );
}

// ── Defaults (mirroring src/data/store.js) ─────────────────────────────────

function default_store_config(): array
{
    return [
        'name'         => 'Eat On',
        'legalName'    => 'The Food Table Ltd',
        'tagline'      => 'Good Food Good Mood',
        'isHalal'      => true,
        'address'      => 'The Howard Centre, Howardsgate, Welwyn Garden City',
        'postcode'     => 'AL8 6HA',
        'city'         => 'Welwyn Garden City',
        'country'      => 'United Kingdom',
        // PLACEHOLDER — replace with the shop's real number before launch.
        'phoneDisplay' => '01707 555142',
        'phone'        => '+441707555142',
        'email'        => 'orders@eaton.food',
        'timeZone'     => 'Europe/London',
        'currency'     => '£',
        'currencyCode' => 'GBP',
        // Geofence centre, approximate to the Howard Centre.
        'location'     => ['lat' => 51.8014, 'lng' => -0.2045],
    ];
}

function default_order_setup(): array
{
    return [
        'isDeliveryOn'                => true,
        'isPickupOn'                  => true,
        'isDineInOn'                  => false,
        'defaultOrderType'            => 'pickup',
        'deliveryTime'                => 35,
        'pickupTime'                  => 10,
        'isPreOrderingEnabled'        => true,
        'scheduleSlotMinutes'         => 15,
        'scheduleMaxDaysAhead'        => 2,
        // Districts alone decide the delivery area. Hatfield is served in
        // full and reaches past any circle centred on the shop, so a radius
        // test would refuse addresses the drivers go to. The radius value is
        // kept only as a fallback and is not enforced while this is false.
        'useRadiusBasedDeliveryArea'  => false,
        'deliveryRadiusKm'            => 5,
        'deliveryAreaLabel'           => 'Welwyn Garden City, Welwyn and Hatfield',
        // Roughly 5km around the Howard Centre: Welwyn Garden City (AL7/AL8),
        // Welwyn and Digswell (AL6), Hatfield (AL9/AL10).
        'servedPostcodeDistricts'     => ['AL6', 'AL7', 'AL8', 'AL9', 'AL10'],
        'deliveryFee'                 => 2.49,
        'isDeliveryFreeOver'          => true,
        'freeDeliveryThreshold'       => 25,
        'minimumDeliveryOrder'        => 12,
        'isCardPaymentAccepted'       => true,
        'isCashPaymentAccepted'       => false,
        'isCashPaymentAcceptedDelivery' => false,
        'isPlatformSurchargeLevied'   => true,
        'platformSurchargeAmt'        => 0.25,
        'platformSurchargePercentage' => 2,
    ];
}

function default_promo(): array
{
    return [
        'isOn'         => true,
        'code'         => 'EATON10',
        'title'        => '10% OFF your FIRST order',
        'message'      => 'Get 10% off your first order over £20',
        'buttonText'   => 'Order now',
        'percentage'   => 10,
        'minimumSpend' => 20,
    ];
}

function default_banner_settings(): array
{
    return [
        'autoplaySeconds' => 6,
        'emberIntensity'  => 0.4,
        'isAutoplayOn'    => true,
        'areEmbersOn'     => true,
    ];
}

function store_config(): array
{
    return get_setting('store_config', default_store_config());
}

function order_setup(): array
{
    return get_setting('order_setup', default_order_setup());
}

function get_promo(): array
{
    return get_setting('promo', default_promo());
}

/**
 * Everything the front end needs before it can render anything.
 *
 * The PayPal *client id* is included deliberately — the SDK needs it in the
 * page and it can only start a payment, never move money. The secret is never
 * exposed here.
 */
function public_config(): array
{
    return [
        'store'      => store_config(),
        'orderSetup' => order_setup(),
        'promo'      => get_promo(),
        // The client id is public by design — the SDK needs it in the page,
        // and it can only start a payment, never move money. The secret stays
        // on the server.
        'paypal'     => [
            'clientId'   => paypal_is_configured() ? config('paypal.client_id') : null,
            'currency'   => paypal_currency(),
            'mode'       => paypal_is_live() ? 'live' : 'sandbox',
            'configured' => paypal_is_configured(),
            // Which wallets to offer alongside the PayPal button. The browser
            // asks the device whether it can actually pay with one before it
            // shows anything, so these only say the shop has set it up — not
            // that this customer will see it.
            'googlePay'  => paypal_wallet_enabled('googlepay'),
            'applePay'   => paypal_wallet_enabled('applepay'),
        ],
        'uploadsUrl' => config('uploads_url', '/uploads'),
    ];
}

// ── Trading hours ──────────────────────────────────────────────────────────

const MANUAL_STATUS_AUTO   = 'auto';
const MANUAL_STATUS_OPEN   = 'open';
const MANUAL_STATUS_CLOSED = 'closed';

function get_hours(): array
{
    $shifts = array_map(static function (array $row): array {
        return [
            'id'          => (int) $row['id'],
            'day'         => (int) $row['day_of_week'],
            'start'       => (int) $row['start_second'],
            'end'         => (int) $row['end_second'],
            'noDelivery'  => (bool) $row['no_delivery'],
            'noPickup'    => (bool) $row['no_pickup'],
        ];
    }, db_all('SELECT * FROM shifts ORDER BY day_of_week, start_second'));

    $closedDates = array_map(static function (array $row): array {
        return ['date' => $row['closed_date'], 'reason' => $row['reason']];
    }, db_all('SELECT closed_date, reason FROM closed_dates ORDER BY closed_date'));

    $manual = get_setting('manual_status', ['value' => MANUAL_STATUS_AUTO])['value'];

    return [
        'shifts'       => $shifts,
        'closedDates'  => $closedDates,
        'manualStatus' => $manual,
        // Computed server-side so every device agrees, regardless of the
        // customer's own clock or time zone.
        'isOpenNow'    => is_open_now($shifts, $closedDates, $manual),
        'serverTime'   => gmdate('c'),
    ];
}

/**
 * Is the shop open right now?
 *
 * Evaluated in the shop's own time zone. A customer in another time zone must
 * still see the shop's own opening hours, so this never uses the client clock.
 */
function is_open_now(array $shifts, array $closedDates, string $manualStatus): bool
{
    if ($manualStatus === MANUAL_STATUS_OPEN) {
        return true;
    }
    if ($manualStatus === MANUAL_STATUS_CLOSED) {
        return false;
    }

    $zone = new DateTimeZone(store_config()['timeZone'] ?? 'Europe/London');
    $now  = new DateTimeImmutable('now', $zone);

    $today = $now->format('Y-m-d');
    foreach ($closedDates as $closed) {
        if ($closed['date'] === $today) {
            return false;
        }
    }

    $day = (int) $now->format('N');                       // 1 = Mon … 7 = Sun
    $secondsIn = ((int) $now->format('G')) * 3600
        + ((int) $now->format('i')) * 60
        + (int) $now->format('s');

    foreach ($shifts as $shift) {
        if ($shift['day'] === $day && $secondsIn >= $shift['start'] && $secondsIn < $shift['end']) {
            return true;
        }
    }

    return false;
}

/** Prep time in minutes for the ASAP quote. */
function prep_minutes(string $orderType): int
{
    $setup = order_setup();
    return $orderType === 'delivery'
        ? (int) ($setup['deliveryTime'] ?? 35)
        : (int) ($setup['pickupTime'] ?? 10);
}

// ── Banners ────────────────────────────────────────────────────────────────

function get_banners(bool $includeUnpublished = false): array
{
    $where = $includeUnpublished ? '' : 'WHERE is_published = 1';

    // Keys match src/data/banners.js exactly, so a slide read back from the API
    // drops straight into the editor and the hero without a translation step.
    $slides = array_map(static function (array $row): array {
        return [
            'id'                 => $row['id'],
            'eyebrow'            => (string) ($row['eyebrow'] ?? ''),
            'heading'            => (string) ($row['title'] ?? ''),
            'headingAccent'      => (string) ($row['subtitle'] ?? ''),
            'description'        => (string) ($row['body'] ?? ''),
            'priceNote'          => (string) ($row['price_note'] ?? ''),
            'price'              => (string) ($row['price'] ?? ''),
            'primaryLabel'       => (string) ($row['button_text'] ?? ''),
            'primaryHref'        => (string) ($row['button_href'] ?? ''),
            'secondaryLabel'     => (string) ($row['button2_text'] ?? ''),
            'secondaryHref'      => (string) ($row['button2_href'] ?? ''),
            'showStoreStatus'    => (bool) ($row['show_store_status'] ?? false),
            'imageId'            => $row['image_id'],
            'imageUrl'           => image_url($row['image_id']),
            'backgroundImageId'  => $row['background_image_id'],
            'backgroundImageUrl' => image_url($row['background_image_id']),
            'displayOrder'       => (int) $row['display_order'],
            'isPublished'        => (bool) $row['is_published'],
        ];
    }, db_all("SELECT * FROM banners {$where} ORDER BY display_order, id"));

    return [
        'slides'   => $slides,
        'settings' => get_setting('banner_settings', default_banner_settings()),
    ];
}
