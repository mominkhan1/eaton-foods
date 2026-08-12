-- Widen `banners` to hold a whole slide.
--
-- The original table stored a headline, a description and one button. The
-- admin editor has always offered more than that — an eyebrow pill, an orange
-- second line, an offer price, a second button and the live open/closed line —
-- so saving a slide through the API dropped roughly half of what the shop had
-- typed.
--
-- Run once against an existing database:
--   mysql -u USER -p DATABASE < server/migrations/001-banner-slide-fields.sql
--
-- A fresh install gets these from schema.sql and does not need this file.
-- Every column is nullable or defaulted, so existing rows stay valid.

ALTER TABLE banners
  ADD COLUMN eyebrow           VARCHAR(190) NULL AFTER id,
  ADD COLUMN price_note        VARCHAR(120) NULL AFTER body,
  ADD COLUMN price             VARCHAR(60)  NULL AFTER price_note,
  ADD COLUMN button2_text      VARCHAR(120) NULL AFTER button_href,
  ADD COLUMN button2_href      VARCHAR(255) NULL AFTER button2_text,
  ADD COLUMN show_store_status TINYINT(1)   NOT NULL DEFAULT 0 AFTER button2_href;
