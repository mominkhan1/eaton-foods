-- Move the payment columns off Stripe and onto something gateway-neutral.
--
-- `stripe_intent_id` named one provider in the schema, which is why swapping
-- gateways touches the database at all. `payment_ref` holds whatever the
-- gateway calls its transaction — a PayPal capture id today — so the next
-- change is config rather than DDL.
--
-- Run once against an existing database:
--   mysql -u USER -p DATABASE < server/migrations/002-paypal-payments.sql
--
-- A fresh install gets this shape from schema.sql and does not need the file.
-- Existing rows keep their id: nothing is lost, and a historic Stripe payment
-- can still be traced.

ALTER TABLE orders
  ADD COLUMN payment_ref VARCHAR(255) NULL AFTER payment_method;

UPDATE orders SET payment_ref = stripe_intent_id WHERE stripe_intent_id IS NOT NULL;

-- The unique index has to go before the column it covers.
ALTER TABLE orders DROP INDEX uq_orders_intent;
ALTER TABLE orders DROP COLUMN stripe_intent_id;

-- Still unique: a capture must never be credited to two orders.
ALTER TABLE orders ADD UNIQUE KEY uq_orders_payment_ref (payment_ref);

-- 'awaiting' is the state between "customer pressed pay" and "PayPal said yes".
-- It is distinct from 'pending' so the kitchen list can exclude orders nobody
-- has actually paid for, without hiding a cash order.
ALTER TABLE orders
  MODIFY COLUMN payment_status
  ENUM('unpaid','pending','awaiting','paid','failed','refunded')
  NOT NULL DEFAULT 'pending';

-- Webhook replay protection is gateway-neutral too. RENAME keeps whatever is
-- already in there, so a redelivered historic event still cannot double-run.
RENAME TABLE stripe_events TO payment_events;

-- Orders placed before there was a gateway.
--
-- They sit at 'pending', which from now on means "nobody has paid yet" and is
-- excluded from the kitchen's working list. These were taken when the shop
-- settled up in person, so they are 'unpaid' in the cash sense and must stay
-- visible — without this, every order already in the system disappears from
-- the Orders screen the moment this deploys.
UPDATE orders
   SET payment_status = 'unpaid'
 WHERE payment_status = 'pending'
   AND paid_at IS NULL;
