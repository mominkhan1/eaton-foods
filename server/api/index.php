<?php
/**
 * Front controller.
 *
 * Every /api/* request lands here via .htaccess. Routes are matched in order;
 * `{name}` captures one path segment and is passed to the handler.
 */

declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/http.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/catalog.php';
require __DIR__ . '/lib/orders.php';
require __DIR__ . '/lib/settings.php';

// ── Router ─────────────────────────────────────────────────────────────────

$routes = [];

function route(string $method, string $pattern, callable $handler): void
{
    $GLOBALS['routes'][] = [$method, $pattern, $handler];
}

function dispatch(string $method, string $path): void
{
    $allowedForPath = [];

    foreach ($GLOBALS['routes'] as [$routeMethod, $pattern, $handler]) {
        // {id} → one segment, not greedy across slashes.
        $regex = '#^' . preg_replace('#\{([a-z_]+)\}#', '(?P<$1>[^/]+)', $pattern) . '$#';

        if (!preg_match($regex, $path, $matches)) {
            continue;
        }

        if ($routeMethod !== $method) {
            $allowedForPath[] = $routeMethod;
            continue;
        }

        // Named captures only, decoded — ids may legitimately contain %20 etc.
        $params = [];
        foreach ($matches as $key => $value) {
            if (!is_int($key)) {
                $params[$key] = urldecode($value);
            }
        }

        $handler($params);
        return;
    }

    if ($allowedForPath !== []) {
        header('Allow: ' . implode(', ', array_unique($allowedForPath)));
        fail('method_not_allowed', 'That method is not supported here.', 405);
    }

    fail('not_found', 'No such endpoint.', 404);
}

// ── Public ─────────────────────────────────────────────────────────────────

route('GET', '/config', function (): void {
    json_response(public_config());
});

/*
 * Everything the storefront needs to render, in one request.
 *
 * The four collections below are also served individually, but the browser
 * wants all of them before it can paint anything. On shared hosting each
 * request is a separate PHP process and a fresh MySQL connection, so four
 * round trips is four times the connection cost and four times the latency
 * before a customer sees the menu.
 */
route('GET', '/bootstrap', function (): void {
    json_response([
        'catalog' => get_catalog(false),
        'hours'   => get_hours(),
        'banners' => get_banners(false),
        'promo'   => get_promo(),
    ]);
});

route('GET', '/catalog', function (): void {
    json_response(get_catalog(false));
});

route('GET', '/hours', function (): void {
    json_response(get_hours());
});

route('GET', '/banners', function (): void {
    json_response(get_banners(false));
});

route('GET', '/promo', function (): void {
    json_response(get_promo());
});

// Customers track by reference. Deliberately not enumerable: the reference is
// 6 random characters from a 30-character alphabet, and there is no endpoint
// that lists orders without authentication.
route('GET', '/orders/{reference}', function (array $params): void {
    $order = find_order_by_reference($params['reference']);
    if (!$order) {
        fail('not_found', 'We could not find an order with that reference.', 404);
    }
    json_response(present_order($order, false));
});

route('POST', '/orders', function (): void {
    json_response(create_order(), 201);
});

// ── Auth ───────────────────────────────────────────────────────────────────

route('POST', '/auth/login', function (): void {
    require __DIR__ . '/routes/auth_login.php';
});

route('POST', '/auth/logout', function (): void {
    logout_user();
    json_response(['ok' => true]);
});

route('GET', '/auth/me', function (): void {
    $user = current_user();
    json_response(['user' => $user]);
});

// ── Admin: orders ──────────────────────────────────────────────────────────

route('GET', '/admin/orders', function (): void {
    require_permission('orders.view');
    require __DIR__ . '/routes/admin_orders.php';
    admin_list_orders();
});

route('GET', '/admin/orders/{reference}', function (array $params): void {
    require_permission('orders.view');
    $order = find_order_by_reference($params['reference']);
    if (!$order) {
        fail('not_found', 'Order not found.', 404);
    }
    json_response(present_order($order, true));
});

route('PATCH', '/admin/orders/{reference}/status', function (array $params): void {
    require_permission('orders.update');
    require __DIR__ . '/routes/admin_orders.php';
    admin_set_status($params['reference']);
});

route('POST', '/admin/orders/{reference}/acknowledge', function (array $params): void {
    require_permission('orders.update');
    require __DIR__ . '/routes/admin_orders.php';
    admin_acknowledge($params['reference']);
});

// ── Admin: catalog ─────────────────────────────────────────────────────────

/*
 * The same bundle as /bootstrap, including the unpublished rows the panel has
 * to manage.
 *
 * Authentication only, deliberately — not `menu.manage`. A kitchen tablet
 * signed in as `staff` has no menu permission, but the orders screen still
 * needs the catalog to show each line's photo, including for an item that has
 * been hidden since the order was placed. Refusing here would leave the
 * kitchen looking at a screen full of fallback icons and a permanent error.
 * An unpublished item is the shop's own menu, not sensitive data, and every
 * endpoint that *changes* it still demands `menu.manage`.
 */
route('GET', '/admin/bootstrap', function (): void {
    require_auth();
    json_response([
        'catalog' => get_catalog(true),
        'hours'   => get_hours(),
        'banners' => get_banners(true),
        'promo'   => get_promo(),
    ]);
});

route('GET', '/admin/catalog', function (): void {
    require_permission('menu.manage');
    json_response(get_catalog(true));
});

route('PUT', '/admin/categories/{id}', function (array $params): void {
    require_permission('menu.manage');
    require __DIR__ . '/routes/admin_catalog.php';
    admin_save_category($params['id']);
});

route('DELETE', '/admin/categories/{id}', function (array $params): void {
    require_permission('menu.manage');
    require __DIR__ . '/routes/admin_catalog.php';
    admin_delete_category($params['id']);
});

route('POST', '/admin/categories/reorder', function (): void {
    require_permission('menu.manage');
    require __DIR__ . '/routes/admin_catalog.php';
    admin_reorder_categories();
});

route('PUT', '/admin/items/{id}', function (array $params): void {
    require_permission('menu.manage');
    require __DIR__ . '/routes/admin_catalog.php';
    admin_save_item($params['id']);
});

route('DELETE', '/admin/items/{id}', function (array $params): void {
    require_permission('menu.manage');
    require __DIR__ . '/routes/admin_catalog.php';
    admin_delete_item($params['id']);
});

route('PUT', '/admin/modifier-groups/{id}', function (array $params): void {
    require_permission('menu.manage');
    require __DIR__ . '/routes/admin_catalog.php';
    admin_save_modifier_group($params['id']);
});

route('DELETE', '/admin/modifier-groups/{id}', function (array $params): void {
    require_permission('menu.manage');
    require __DIR__ . '/routes/admin_catalog.php';
    admin_delete_modifier_group($params['id']);
});

// ── Admin: hours, banners, promo ───────────────────────────────────────────

route('PUT', '/admin/hours', function (): void {
    require_permission('hours.manage');
    require __DIR__ . '/routes/admin_settings.php';
    admin_save_hours();
});

route('GET', '/admin/banners', function (): void {
    require_permission('banners.manage');
    json_response(get_banners(true));
});

route('PUT', '/admin/banners/{id}', function (array $params): void {
    require_permission('banners.manage');
    require __DIR__ . '/routes/admin_settings.php';
    admin_save_banner($params['id']);
});

route('DELETE', '/admin/banners/{id}', function (array $params): void {
    require_permission('banners.manage');
    require __DIR__ . '/routes/admin_settings.php';
    admin_delete_banner($params['id']);
});

// '/admin/banners/{id}' also matches this path, but only for PUT and DELETE —
// the dispatcher keeps looking on a method mismatch, so this POST is reached.
route('POST', '/admin/banners/reorder', function (): void {
    require_permission('banners.manage');
    require __DIR__ . '/routes/admin_settings.php';
    admin_reorder_banners();
});

route('PUT', '/admin/banner-settings', function (): void {
    require_permission('banners.manage');
    require __DIR__ . '/routes/admin_settings.php';
    admin_save_banner_settings();
});

route('POST', '/admin/test-email', function (): void {
    require_permission('settings.manage');
    require __DIR__ . '/routes/admin_settings.php';
    admin_test_email();
});

route('PUT', '/admin/promo', function (): void {
    require_permission('promo.manage');
    require __DIR__ . '/routes/admin_settings.php';
    admin_save_promo();
});

// ── Admin: images, reports, staff ──────────────────────────────────────────

route('POST', '/admin/images', function (): void {
    require_permission('images.manage');
    require __DIR__ . '/routes/admin_images.php';
    admin_upload_image();
});

route('DELETE', '/admin/images/{id}', function (array $params): void {
    require_permission('images.manage');
    require __DIR__ . '/routes/admin_images.php';
    admin_delete_image($params['id']);
});

route('GET', '/admin/reports', function (): void {
    require_permission('reports.view');
    require __DIR__ . '/routes/admin_reports.php';
    admin_reports();
});

route('GET', '/admin/staff', function (): void {
    require_permission('staff.manage');
    require __DIR__ . '/routes/admin_staff.php';
    admin_list_staff();
});

route('POST', '/admin/staff', function (): void {
    require_permission('staff.manage');
    require __DIR__ . '/routes/admin_staff.php';
    admin_create_staff();
});

route('PUT', '/admin/staff/{id}', function (array $params): void {
    require_permission('staff.manage');
    require __DIR__ . '/routes/admin_staff.php';
    admin_update_staff((int) $params['id']);
});

route('DELETE', '/admin/staff/{id}', function (array $params): void {
    require_permission('staff.manage');
    require __DIR__ . '/routes/admin_staff.php';
    admin_delete_staff((int) $params['id']);
});

// Any signed-in user may change their own password.
route('POST', '/auth/change-password', function (): void {
    require_auth();
    require __DIR__ . '/routes/admin_staff.php';
    change_own_password();
});

// ── PayPal ─────────────────────────────────────────────────────────────────

// Must come before the same-origin guard runs — PayPal posts from its own
// servers, and is authenticated by asking PayPal to verify the signature.
route('POST', '/paypal/webhook', function (): void {
    require __DIR__ . '/routes/paypal_webhook.php';
    handle_paypal_webhook();
});

route('POST', '/orders/{reference}/paypal-order', function (array $params): void {
    require __DIR__ . '/routes/paypal_order.php';
    create_paypal_order($params['reference']);
});

route('POST', '/orders/{reference}/paypal-capture', function (array $params): void {
    require __DIR__ . '/routes/paypal_order.php';
    capture_paypal_order($params['reference']);
});

// ── Run ────────────────────────────────────────────────────────────────────

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Strip the script prefix and any query string to get the API-relative path.
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';
$path = '/' . trim(preg_replace('#^.*?/api#', '', $path) ?? '', '/');

// The webhook authenticates by signature, so the origin check would only
// reject it. Everything else that changes state must be same-origin.
if ($path !== '/paypal/webhook') {
    assert_same_origin();
}

prune_login_attempts();
dispatch($method, $path);
