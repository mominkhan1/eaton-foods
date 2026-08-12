-- ---------------------------------------------------------------------------
-- Eat On — database schema (MySQL 5.7+ / MariaDB 10.3+, as shipped on cPanel)
--
-- Import this once via cPanel → phpMyAdmin → Import, or:
--   mysql -u USER -p DBNAME < schema.sql
--
-- Money is DECIMAL(10,2), never FLOAT — float arithmetic silently loses pennies
-- and a till that disagrees with the card statement is a real problem.
--
-- Times are stored UTC (DATETIME). The shop trades in Europe/London; converting
-- at the edges keeps BST/GMT transitions from corrupting stored history.
-- ---------------------------------------------------------------------------

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ── Staff accounts ─────────────────────────────────────────────────────────
--
-- role drives the permission checks in api/lib/auth.php:
--   owner   — everything, including staff management and revenue reports
--   manager — menu, hours, banners, promo, orders. No staff management.
--   staff   — orders only (the kitchen screen)

CREATE TABLE users (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email           VARCHAR(190) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  name            VARCHAR(120) NOT NULL,
  role            ENUM('owner','manager','staff') NOT NULL DEFAULT 'staff',
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at   DATETIME     NULL DEFAULT NULL,
  -- Throttling state for the login endpoint.
  failed_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until    DATETIME     NULL DEFAULT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Images ─────────────────────────────────────────────────────────────────
--
-- Replaces the browser IndexedDB store. The file itself lives in
-- public_html/uploads/; this table is the metadata + orphan-pruning index.

CREATE TABLE images (
  id          VARCHAR(64)  NOT NULL,          -- slug used by the app, e.g. img_ab12cd
  filename    VARCHAR(255) NOT NULL,          -- on-disk name inside uploads/
  mime        VARCHAR(80)  NOT NULL,
  width       INT UNSIGNED NULL,
  height      INT UNSIGNED NULL,
  size_bytes  INT UNSIGNED NOT NULL,
  uploaded_by INT UNSIGNED NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_images_created (created_at),
  CONSTRAINT fk_images_user FOREIGN KEY (uploaded_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Catalog ────────────────────────────────────────────────────────────────
--
-- IDs stay VARCHAR slugs ('beef-burgers', 'holy-smash') rather than ints, so
-- they match the seed data and the existing React code without a translation
-- layer, and so URLs stay readable.

CREATE TABLE categories (
  id            VARCHAR(64)  NOT NULL,
  name          VARCHAR(120) NOT NULL,
  description   TEXT         NULL,
  emoji         VARCHAR(16)  NULL,
  image_id      VARCHAR(64)  NULL,
  display_order INT          NOT NULL DEFAULT 0,
  is_published  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_categories_order (display_order),
  CONSTRAINT fk_categories_image FOREIGN KEY (image_id)
    REFERENCES images (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE items (
  id            VARCHAR(64)  NOT NULL,
  category_id   VARCHAR(64)  NOT NULL,
  name          VARCHAR(160) NOT NULL,
  description   TEXT         NULL,
  emoji         VARCHAR(16)  NULL,
  image_id      VARCHAR(64)  NULL,
  is_popular    TINYINT(1)   NOT NULL DEFAULT 0,
  is_published  TINYINT(1)   NOT NULL DEFAULT 1,
  display_order INT          NOT NULL DEFAULT 0,
  -- NULL = sellable on every order type. Otherwise a JSON array such as
  -- ["pickup"] — mirrors `orderTypes` in the seed data.
  order_types   VARCHAR(120) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_items_category (category_id, display_order),
  KEY idx_items_published (is_published),
  -- RESTRICT, not CASCADE: deleting a category that still holds items should
  -- fail loudly. The app already refuses this (deleteCategory → 'has-items');
  -- this is the backstop for anyone poking at phpMyAdmin directly.
  CONSTRAINT fk_items_category FOREIGN KEY (category_id)
    REFERENCES categories (id) ON DELETE RESTRICT,
  CONSTRAINT fk_items_image FOREIGN KEY (image_id)
    REFERENCES images (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The size carries the price ("On its own" £6.99 / "Make it a meal" £9.48).
CREATE TABLE item_sizes (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  item_id       VARCHAR(64)   NOT NULL,
  size_key      VARCHAR(64)   NOT NULL,       -- 'single' | 'meal' | 'std'
  name          VARCHAR(120)  NOT NULL,
  price         DECIMAL(10,2) NOT NULL,
  note          VARCHAR(255)  NULL,
  display_order INT           NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_size (item_id, size_key),
  CONSTRAINT fk_sizes_item FOREIGN KEY (item_id)
    REFERENCES items (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE modifier_groups (
  id            VARCHAR(64)  NOT NULL,        -- 'sauceChoice', 'extraDips'
  name          VARCHAR(160) NOT NULL,
  min_select    INT UNSIGNED NOT NULL DEFAULT 0,
  max_select    INT UNSIGNED NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE modifier_options (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  group_id      VARCHAR(64)   NOT NULL,
  option_key    VARCHAR(64)   NOT NULL,       -- 'ketchup', 'chilli'
  name          VARCHAR(160)  NOT NULL,
  price         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  is_available  TINYINT(1)    NOT NULL DEFAULT 1,
  display_order INT           NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_group_option (group_id, option_key),
  CONSTRAINT fk_options_group FOREIGN KEY (group_id)
    REFERENCES modifier_groups (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which option groups an item offers, and in what order.
CREATE TABLE item_modifier_groups (
  item_id       VARCHAR(64) NOT NULL,
  group_id      VARCHAR(64) NOT NULL,
  display_order INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, group_id),
  CONSTRAINT fk_img_item FOREIGN KEY (item_id)
    REFERENCES items (id) ON DELETE CASCADE,
  CONSTRAINT fk_img_group FOREIGN KEY (group_id)
    REFERENCES modifier_groups (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Trading hours ──────────────────────────────────────────────────────────
--
-- Same shape as seedShifts: ISO day (1=Mon … 7=Sun) plus seconds from midnight.
-- Late-night trading is two rows per day, avoiding wrap-around arithmetic.

CREATE TABLE shifts (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  day_of_week  TINYINT UNSIGNED NOT NULL,     -- 1..7
  start_second INT UNSIGNED NOT NULL,         -- 0..86400
  end_second   INT UNSIGNED NOT NULL,
  no_delivery  TINYINT(1) NOT NULL DEFAULT 0,
  no_pickup    TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_shifts_day (day_of_week)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE closed_dates (
  closed_date DATE         NOT NULL,
  reason      VARCHAR(190) NULL,
  PRIMARY KEY (closed_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Hero banners ───────────────────────────────────────────────────────────

CREATE TABLE banners (
  id                  VARCHAR(64)  NOT NULL,
  title               VARCHAR(190) NULL,
  subtitle            VARCHAR(255) NULL,
  body                TEXT         NULL,
  button_text         VARCHAR(120) NULL,
  button_href         VARCHAR(255) NULL,
  image_id            VARCHAR(64)  NULL,
  background_image_id VARCHAR(64)  NULL,
  display_order       INT          NOT NULL DEFAULT 0,
  is_published        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_banners_order (display_order),
  CONSTRAINT fk_banners_image FOREIGN KEY (image_id)
    REFERENCES images (id) ON DELETE SET NULL,
  CONSTRAINT fk_banners_bg FOREIGN KEY (background_image_id)
    REFERENCES images (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Settings ───────────────────────────────────────────────────────────────
--
-- Key/value JSON for things that are genuinely singletons: storeConfig,
-- orderSetup, promo, banner settings, manual open/closed override.
-- A table per setting would be a lot of one-row tables.

CREATE TABLE settings (
  setting_key VARCHAR(64) NOT NULL,
  value_json  LONGTEXT    NOT NULL,
  updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Orders ─────────────────────────────────────────────────────────────────
--
-- Totals are stored as columns rather than a JSON blob because the reports
-- screen sums them, and summing inside JSON on MySQL 5.7 is painful and slow.
--
-- Line items snapshot the item's name and price at the time of ordering. A
-- price rise next week must not retroactively change what a customer paid, and
-- a deleted menu item must not orphan its order history.

CREATE TABLE orders (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  reference         VARCHAR(16)   NOT NULL,   -- 'EF-A1B2C3'
  status            ENUM('received','preparing','ready','on-the-way','complete','cancelled')
                    NOT NULL DEFAULT 'received',
  order_type        ENUM('pickup','delivery') NOT NULL,

  placed_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ready_at          DATETIME      NULL,
  acknowledged_at   DATETIME      NULL,       -- drives the "new order" alert
  completed_at      DATETIME      NULL,

  -- Scheduling: 'asap' | 'scheduled' plus the chosen slot.
  timing_mode       ENUM('asap','scheduled') NOT NULL DEFAULT 'asap',
  scheduled_slot    DATETIME      NULL,

  customer_name     VARCHAR(160)  NOT NULL,
  customer_phone    VARCHAR(40)   NOT NULL,
  customer_email    VARCHAR(190)  NULL,
  customer_notes    TEXT          NULL,

  -- Delivery only; NULL for pickup.
  address_line1     VARCHAR(255)  NULL,
  address_line2     VARCHAR(255)  NULL,
  address_city      VARCHAR(120)  NULL,
  address_postcode  VARCHAR(16)   NULL,
  address_lat       DECIMAL(10,7) NULL,
  address_lng       DECIMAL(10,7) NULL,

  promo_code        VARCHAR(40)   NULL,

  subtotal          DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  discount          DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  delivery_fee      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  surcharge         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  total             DECIMAL(10,2) NOT NULL DEFAULT 0.00,

  -- Payment. 'unpaid' covers cash-on-collection if that is ever re-enabled.
  payment_status    ENUM('unpaid','pending','paid','failed','refunded')
                    NOT NULL DEFAULT 'pending',
  payment_method    VARCHAR(40)   NULL,       -- 'stripe' | 'cash'
  stripe_intent_id  VARCHAR(255)  NULL,
  paid_at           DATETIME      NULL,

  created_ip        VARBINARY(16) NULL,       -- INET6_ATON, for abuse triage
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_reference (reference),
  UNIQUE KEY uq_orders_intent (stripe_intent_id),
  KEY idx_orders_status (status, placed_at),
  KEY idx_orders_placed (placed_at),
  KEY idx_orders_ack (acknowledged_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_lines (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  order_id      INT UNSIGNED  NOT NULL,
  -- Kept for reporting joins, but nullable and ON DELETE SET NULL: the order
  -- must survive the item being removed from the menu.
  item_id       VARCHAR(64)   NULL,
  item_name     VARCHAR(160)  NOT NULL,       -- snapshot
  size_key      VARCHAR(64)   NULL,
  size_name     VARCHAR(120)  NULL,
  unit_price    DECIMAL(10,2) NOT NULL,       -- size price + modifiers, per unit
  quantity      INT UNSIGNED  NOT NULL DEFAULT 1,
  line_total    DECIMAL(10,2) NOT NULL,
  notes         VARCHAR(255)  NULL,
  PRIMARY KEY (id),
  KEY idx_lines_order (order_id),
  KEY idx_lines_item (item_id),
  CONSTRAINT fk_lines_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_lines_item FOREIGN KEY (item_id)
    REFERENCES items (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Chosen options, one row per selection, snapshotted like the lines above.
CREATE TABLE order_line_modifiers (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  line_id       INT UNSIGNED  NOT NULL,
  group_name    VARCHAR(160)  NOT NULL,
  option_name   VARCHAR(160)  NOT NULL,
  price         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (id),
  KEY idx_linemods_line (line_id),
  CONSTRAINT fk_linemods_line FOREIGN KEY (line_id)
    REFERENCES order_lines (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Who moved the order to which status, and when. The kitchen will eventually
-- argue about this, and an audit trail settles it.
CREATE TABLE order_events (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id   INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NULL,               -- NULL = system/webhook
  event_type VARCHAR(40)  NOT NULL,           -- 'status' | 'payment' | 'note'
  detail     VARCHAR(255) NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_events_order (order_id, created_at),
  CONSTRAINT fk_events_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_events_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Stripe webhook idempotency ─────────────────────────────────────────────
--
-- Stripe retries webhooks and can deliver the same event more than once.
-- Inserting the event id first, and treating a duplicate-key error as "already
-- handled", makes replays harmless.

CREATE TABLE stripe_events (
  event_id     VARCHAR(255) NOT NULL,
  event_type   VARCHAR(80)  NOT NULL,
  processed_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Login throttling ───────────────────────────────────────────────────────
--
-- Per-IP, so an attacker cannot lock a real user out by guessing at their
-- address; the per-user counter on `users` handles the other direction.

CREATE TABLE login_attempts (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  ip          VARBINARY(16) NOT NULL,
  email       VARCHAR(190)  NULL,
  succeeded   TINYINT(1)    NOT NULL DEFAULT 0,
  attempted_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_attempts_ip (ip, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
