<?php
/**
 * Outgoing email.
 *
 * Uses PHP's mail(), which on cPanel hands off to the server's local Exim.
 * That is the one path guaranteed to exist on Namecheap shared hosting — no
 * Composer, no SMTP credentials, nothing to install.
 *
 * DELIVERABILITY: the From address MUST be on your own domain. Sending as
 * gmail.com from a Namecheap server fails DMARC and lands in spam or is
 * rejected outright. `from_email` defaults to orders@<your domain> for exactly
 * this reason. Set an SPF record too — see DEPLOYMENT.md.
 *
 * Email must never break an order. Every send is wrapped so that a mail
 * failure is logged and swallowed: a customer who has paid must get their
 * order through even if the shop's mailbox is full.
 */

declare(strict_types=1);

/**
 * Send one email.
 *
 * @param string|string[] $to
 * @return bool True if the MTA accepted it. Not a delivery guarantee.
 */
function send_mail($to, string $subject, string $html, string $text = ''): bool
{
    $recipients = array_values(array_filter(
        array_map('trim', is_array($to) ? $to : [$to]),
        static fn (string $address): bool => filter_var($address, FILTER_VALIDATE_EMAIL) !== false
    ));

    if ($recipients === []) {
        error_log('[eaton][mail] no valid recipients for: ' . $subject);
        return false;
    }

    $fromEmail = mail_from_address();
    $fromName  = (string) (store_config()['name'] ?? 'Eat On');

    // A bare newline or a header injected through the subject would let an
    // attacker add their own Bcc. Strip anything that could start a new header.
    $subject = trim(preg_replace('/[\r\n]+/', ' ', $subject) ?? '');

    if ($text === '') {
        $text = html_to_text($html);
    }

    $boundary = 'eaton_' . bin2hex(random_bytes(12));

    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
        sprintf('From: %s <%s>', mail_encode_header($fromName), $fromEmail),
        'Reply-To: ' . $fromEmail,
        'X-Mailer: EatOn',
        // Stops most auto-responders and out-of-office replies bouncing back.
        'Auto-Submitted: auto-generated',
    ];

    $body = implode("\r\n", [
        '--' . $boundary,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        $text,
        '',
        '--' . $boundary,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        $html,
        '',
        '--' . $boundary . '--',
        '',
    ]);

    $ok = true;

    foreach ($recipients as $recipient) {
        try {
            // -f sets the envelope sender, which is what SPF is checked
            // against. Without it Exim uses the web user and SPF fails.
            $sent = @mail(
                $recipient,
                mail_encode_header($subject),
                $body,
                implode("\r\n", $headers),
                '-f' . $fromEmail
            );

            if (!$sent) {
                error_log("[eaton][mail] mail() refused for {$recipient}: {$subject}");
                $ok = false;
            }
        } catch (Throwable $e) {
            error_log('[eaton][mail] ' . $e->getMessage());
            $ok = false;
        }
    }

    return $ok;
}

/**
 * The From address.
 *
 * Falls back to orders@<site domain> rather than the shop's contact email,
 * which is often a free mailbox that would fail DMARC.
 */
function mail_from_address(): string
{
    $configured = (string) config('mail.from_email', '');
    if ($configured !== '' && filter_var($configured, FILTER_VALIDATE_EMAIL)) {
        return $configured;
    }

    $host = parse_url((string) config('site_url', ''), PHP_URL_HOST) ?: 'localhost';
    return 'orders@' . preg_replace('/^www\./', '', $host);
}

/** Where new-order alerts go. */
function mail_notification_recipients(): array
{
    $configured = config('mail.order_notifications', null);

    if (is_array($configured) && $configured !== []) {
        return $configured;
    }
    if (is_string($configured) && trim($configured) !== '') {
        return array_map('trim', explode(',', $configured));
    }

    // Fall back to the shop's own contact address, then any owner accounts —
    // so a shop that never configures this still gets its orders.
    $storeEmail = (string) (store_config()['email'] ?? '');
    if ($storeEmail !== '' && filter_var($storeEmail, FILTER_VALIDATE_EMAIL)) {
        return [$storeEmail];
    }

    return array_column(
        db_all("SELECT email FROM users WHERE role = 'owner' AND is_active = 1"),
        'email'
    );
}

/** RFC 2047 encoding, so accented names and £ survive the header. */
function mail_encode_header(string $value): string
{
    if (preg_match('/^[\x20-\x7E]*$/', $value)) {
        return $value;
    }
    return '=?UTF-8?B?' . base64_encode($value) . '?=';
}

function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function money_gbp(int $pence): string
{
    return '£' . number_format($pence / 100, 2);
}

/** Crude but adequate plain-text alternative for clients that refuse HTML. */
function html_to_text(string $html): string
{
    $text = preg_replace('#<br\s*/?>#i', "\n", $html) ?? $html;
    $text = preg_replace('#</(p|tr|h[1-6]|div)>#i', "\n", $text) ?? $text;
    $text = strip_tags($text);
    $text = html_entity_decode($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $text = preg_replace("/[ \t]+/", ' ', $text) ?? $text;
    $text = preg_replace("/\n{3,}/", "\n\n", $text) ?? $text;

    return trim($text);
}

// ── Shared layout ──────────────────────────────────────────────────────────

/**
 * Wrap content in an email shell.
 *
 * Table-based with inline styles on purpose: Outlook ignores <style> blocks
 * and most flexbox, so anything cleverer breaks in the client the shop's
 * accountant uses.
 */
function mail_layout(string $heading, string $content, string $accent = '#d64541'): string
{
    $store = store_config();
    $name  = e($store['name'] ?? 'Eat On');

    return <<<HTML
<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:{$accent};padding:20px 24px;">
            <div style="color:#ffffff;font-size:20px;font-weight:700;">{$name}</div>
            <div style="color:rgba(255,255,255,.9);font-size:14px;margin-top:2px;">{$heading}</div>
          </td>
        </tr>
        <tr><td style="padding:24px;color:#18181b;font-size:15px;line-height:1.55;">
          {$content}
        </td></tr>
        <tr>
          <td style="padding:16px 24px;background:#fafafa;color:#71717a;font-size:12px;line-height:1.5;">
            {$name} · This email was sent automatically, please do not reply to it.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
HTML;
}

/** The itemised lines table, shared by both emails. */
function mail_order_lines_html(array $order): string
{
    $rows = '';

    foreach ($order['lines'] as $line) {
        $modifiers = '';
        if (!empty($line['modifiers'])) {
            $parts = array_map(
                static fn (array $m): string => e($m['optionName'])
                    . ($m['pricePence'] > 0 ? ' (+' . money_gbp($m['pricePence']) . ')' : ''),
                $line['modifiers']
            );
            $modifiers = '<div style="color:#71717a;font-size:13px;margin-top:2px;">'
                . implode(', ', $parts) . '</div>';
        }

        $note = '';
        if (!empty($line['notes'])) {
            // Customer notes are the one place free text reaches the kitchen —
            // highlighted, because allergy requests arrive here.
            $note = '<div style="color:#b45309;font-size:13px;margin-top:4px;">Note: '
                . e($line['notes']) . '</div>';
        }

        $size = $line['sizeName'] ? '<div style="color:#71717a;font-size:13px;">' . e($line['sizeName']) . '</div>' : '';

        $rows .= '<tr>'
            . '<td style="padding:10px 0;border-bottom:1px solid #f4f4f5;vertical-align:top;">'
            . '<strong>' . (int) $line['quantity'] . ' × ' . e($line['name']) . '</strong>'
            . $size . $modifiers . $note
            . '</td>'
            . '<td style="padding:10px 0;border-bottom:1px solid #f4f4f5;text-align:right;white-space:nowrap;vertical-align:top;">'
            . money_gbp($line['totalPence'])
            . '</td></tr>';
    }

    $totals = $order['totals'];
    $summary = '<tr><td style="padding:8px 0;">Subtotal</td>'
        . '<td style="padding:8px 0;text-align:right;">' . money_gbp($totals['subtotal']) . '</td></tr>';

    if ($totals['discount'] > 0) {
        $summary .= '<tr><td style="padding:2px 0;color:#15803d;">Discount'
            . ($order['promoCode'] ? ' (' . e($order['promoCode']) . ')' : '')
            . '</td><td style="padding:2px 0;text-align:right;color:#15803d;">−'
            . money_gbp($totals['discount']) . '</td></tr>';
    }
    if ($totals['delivery'] > 0) {
        $summary .= '<tr><td style="padding:2px 0;">Delivery</td><td style="padding:2px 0;text-align:right;">'
            . money_gbp($totals['delivery']) . '</td></tr>';
    }
    if ($totals['surcharge'] > 0) {
        $summary .= '<tr><td style="padding:2px 0;">Service charge</td><td style="padding:2px 0;text-align:right;">'
            . money_gbp($totals['surcharge']) . '</td></tr>';
    }

    $summary .= '<tr><td style="padding:10px 0 0;border-top:2px solid #18181b;font-size:17px;font-weight:700;">Total</td>'
        . '<td style="padding:10px 0 0;border-top:2px solid #18181b;text-align:right;font-size:17px;font-weight:700;">'
        . money_gbp($totals['total']) . '</td></tr>';

    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;">'
        . $rows . $summary . '</table>';
}

// ── The emails ─────────────────────────────────────────────────────────────

/**
 * Tell the shop a new order has arrived.
 *
 * This is the one that must not fail — it is how the kitchen finds out an
 * order exists at all.
 */
function send_new_order_notification(array $order, string $subjectPrefix = ''): bool
{
    $store = store_config();
    $when  = order_local_time($order['readyAt'] ?? null);

    $type = $order['orderType'] === 'delivery' ? 'DELIVERY' : 'COLLECTION';

    $address = '';
    if ($order['orderType'] === 'delivery' && !empty($order['address'])) {
        $a = $order['address'];
        $address = '<p style="margin:0 0 4px;"><strong>Deliver to</strong><br>'
            . e($a['line1'])
            . ($a['line2'] ? '<br>' . e($a['line2']) : '')
            . ($a['city'] ? '<br>' . e($a['city']) : '')
            . '<br>' . e($a['postcode']) . '</p>';
    }

    $paid = ($order['payment']['status'] ?? '') === 'paid';
    $paidBadge = $paid
        ? '<span style="background:#dcfce7;color:#15803d;padding:3px 8px;border-radius:99px;font-size:13px;">PAID</span>'
        : '<span style="background:#fef3c7;color:#b45309;padding:3px 8px;border-radius:99px;font-size:13px;">NOT PAID YET</span>';

    $customerNote = '';
    if (!empty($order['customer']['notes'])) {
        $customerNote = '<p style="margin:12px 0;padding:10px;background:#fffbeb;border-left:3px solid #f59e0b;">'
            . '<strong>Customer note:</strong><br>' . e($order['customer']['notes']) . '</p>';
    }

    $content = '<p style="margin:0 0 12px;font-size:22px;font-weight:700;">'
        . e($order['reference']) . ' &nbsp; ' . $paidBadge . '</p>'
        . '<p style="margin:0 0 4px;"><strong>' . $type . '</strong> — '
        . ($order['timing']['mode'] === 'scheduled' ? 'scheduled for ' : 'ASAP, ready around ')
        . e($when) . '</p>'
        . '<p style="margin:12px 0 4px;"><strong>' . e($order['customer']['name']) . '</strong><br>'
        . '<a href="tel:' . e($order['customer']['phone']) . '" style="color:#d64541;">'
        . e($order['customer']['phone']) . '</a></p>'
        . $address
        . $customerNote
        . '<hr style="border:none;border-top:1px solid #e4e4e7;margin:16px 0;">'
        . mail_order_lines_html($order);

    $subject = sprintf(
        '%sNew %s order %s — %s',
        $subjectPrefix === '' ? '' : '[' . $subjectPrefix . '] ',
        strtolower($type),
        $order['reference'],
        money_gbp($order['totals']['total'])
    );

    return send_mail(
        mail_notification_recipients(),
        $subject,
        mail_layout($subjectPrefix === '' ? 'New order' : 'Payment received', $content)
    );
}

/** Confirm the order to the customer. */
function send_order_confirmation(array $order): bool
{
    $email = $order['customer']['email'] ?? null;
    if (!$email) {
        return false;   // email is optional at checkout
    }

    $store = store_config();
    $when  = order_local_time($order['readyAt'] ?? null);

    $heading = $order['orderType'] === 'delivery'
        ? 'We are getting your order ready and will deliver it to you.'
        : 'We are getting your order ready for collection.';

    $trackUrl = rtrim((string) config('site_url', ''), '/')
        . '/track?ref=' . urlencode($order['reference']);

    $content = '<p style="margin:0 0 12px;">Thanks, ' . e($order['customer']['name']) . '.</p>'
        . '<p style="margin:0 0 16px;">' . $heading . '</p>'
        . '<table role="presentation" width="100%" style="background:#fafafa;border-radius:8px;margin-bottom:16px;">'
        . '<tr><td style="padding:14px 16px;">'
        . '<div style="color:#71717a;font-size:13px;">Your reference</div>'
        . '<div style="font-size:22px;font-weight:700;letter-spacing:1px;">' . e($order['reference']) . '</div>'
        . '<div style="color:#71717a;font-size:13px;margin-top:8px;">'
        . ($order['orderType'] === 'delivery' ? 'Estimated delivery' : 'Ready for collection') . '</div>'
        . '<div style="font-size:16px;font-weight:600;">' . e($when) . '</div>'
        . '</td></tr></table>'
        . '<p style="margin:0 0 16px;"><a href="' . e($trackUrl)
        . '" style="background:#d64541;color:#fff;padding:11px 20px;border-radius:8px;'
        . 'text-decoration:none;display:inline-block;font-weight:600;">Track your order</a></p>'
        . mail_order_lines_html($order);

    if ($order['orderType'] === 'pickup') {
        $content .= '<p style="margin:16px 0 0;color:#71717a;font-size:14px;">Collect from<br>'
            . '<strong style="color:#18181b;">' . e($store['address'] ?? '') . '</strong></p>';
    }

    $content .= '<p style="margin:16px 0 0;color:#71717a;font-size:14px;">'
        . 'Something wrong? Call us on ' . e($store['phoneDisplay'] ?? '') . '.</p>';

    return send_mail(
        $email,
        'Your ' . ($store['name'] ?? 'Eat On') . ' order ' . $order['reference'],
        mail_layout('Order confirmed', $content)
    );
}

/** Tell the customer their order status moved on. */
function send_status_update(array $order, string $status): bool
{
    $email = $order['customer']['email'] ?? null;
    if (!$email) {
        return false;
    }

    // Only the states a customer benefits from hearing about. Emailing every
    // transition trains people to ignore the emails.
    $messages = [
        'ready' => $order['orderType'] === 'delivery'
            ? ['Your order is ready', 'Your food is cooked and packed, and is about to leave with the driver.']
            : ['Your order is ready to collect', 'Your food is cooked and packed, and is waiting for you.'],
        'on-the-way' => ['Your order is on the way', 'Your driver is heading over to you now.'],
        'cancelled'  => ['Your order was cancelled', 'Your order has been cancelled. If you have been charged, the refund will follow automatically. Please call us if you were not expecting this.'],
    ];

    if (!isset($messages[$status])) {
        return false;
    }

    [$title, $body] = $messages[$status];
    $accent = $status === 'cancelled' ? '#71717a' : '#d64541';

    $content = '<p style="margin:0 0 12px;">Hi ' . e($order['customer']['name']) . ',</p>'
        . '<p style="margin:0 0 16px;">' . e($body) . '</p>'
        . '<p style="margin:0;color:#71717a;font-size:14px;">Reference <strong style="color:#18181b;">'
        . e($order['reference']) . '</strong></p>';

    return send_mail($email, $title . ' — ' . $order['reference'], mail_layout($title, $content, $accent));
}

/** Format a UTC timestamp in the shop's own time zone. */
function order_local_time(?string $iso): string
{
    if (!$iso) {
        return 'shortly';
    }

    try {
        $zone = new DateTimeZone(store_config()['timeZone'] ?? 'Europe/London');
        $when = (new DateTimeImmutable($iso))->setTimezone($zone);
        $today = (new DateTimeImmutable('now', $zone))->format('Y-m-d');

        return $when->format('Y-m-d') === $today
            ? $when->format('g:ia')
            : $when->format('D j M, g:ia');
    } catch (Throwable) {
        return 'shortly';
    }
}
