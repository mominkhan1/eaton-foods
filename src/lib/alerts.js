/**
 * New-order alerting for the kitchen screen.
 *
 * Three channels, because a busy kitchen misses any single one:
 *   1. an audible chime (Web Audio — no asset to load or fail)
 *   2. the browser tab title, which flashes a count even when unfocused
 *   3. a desktop notification, if the shop has granted permission
 *
 * Browsers block audio until the page has been interacted with, so the chime
 * is armed by the first click anywhere in the admin panel.
 */

let audioContext = null;
let armed = false;

export function armAudio() {
  if (armed) return;
  try {
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return;
    audioContext = new Ctor();
    // A resumed context is what actually satisfies the autoplay policy.
    audioContext.resume?.();
    armed = true;
  } catch {
    // No audio available — the title and notification channels still work.
  }
}

export function isAudioArmed() {
  return armed;
}

/** Two-tone chime, repeated `times`. */
export function playChime(times = 2) {
  if (!audioContext) return;

  const now = audioContext.currentTime;

  for (let index = 0; index < times; index += 1) {
    const start = now + index * 0.42;

    for (const [offset, frequency] of [
      [0, 880],
      [0.16, 1174.66],
    ]) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      // Quick attack, exponential tail — a beep, not a drone.
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.28, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.3);

      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.32);
    }
  }
}

// ── Tab title ──────────────────────────────────────────────────────────────

let titleTimer = null;
let baseTitle = null;

export function flashTitle(count) {
  if (typeof document === 'undefined') return;
  if (baseTitle === null) baseTitle = document.title;

  clearInterval(titleTimer);

  if (count <= 0) {
    document.title = baseTitle;
    titleTimer = null;
    return;
  }

  let showing = false;
  const alert = `(${count}) New order${count === 1 ? '' : 's'}`;

  document.title = alert;
  titleTimer = setInterval(() => {
    showing = !showing;
    document.title = showing ? baseTitle : alert;
  }, 1200);
}

export function restoreTitle() {
  clearInterval(titleTimer);
  titleTimer = null;
  if (baseTitle !== null && typeof document !== 'undefined') document.title = baseTitle;
}

// ── Desktop notifications ──────────────────────────────────────────────────

export function notificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function requestNotifications() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export function notifyNewOrder(order) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  try {
    const notification = new Notification(`New ${order.orderType} order — ${order.reference}`, {
      body: `${order.customer?.name ?? 'Customer'} · ${order.totals.itemCount} items`,
      tag: order.reference,
      requireInteraction: false,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Some browsers throw when constructing notifications outside a service
    // worker; the other two channels cover it.
  }
}
