import { useRef, useState } from 'react';
import Thumb from '../components/Thumb';
import {
  processAndStoreImage,
  deleteImage,
  formatBytes,
  IMAGE_ERRORS,
  MAX_EDGE,
} from '../lib/images';

/**
 * Upload / replace / remove the picture for a category or item.
 *
 * `value` is the stored image id (or null). `onChange` receives the new id.
 * The previous image is deleted only once a replacement has stored
 * successfully, so a failed upload never destroys the existing picture.
 */
export default function ImageField({ value, onChange, emoji, label = 'Photo' }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [dragging, setDragging] = useState(false);

  async function accept(file) {
    if (!file) return;

    setBusy(true);
    setError(null);
    setInfo(null);

    const result = await processAndStoreImage(file);

    if (!result.ok) {
      setError(IMAGE_ERRORS[result.reason] ?? 'That image could not be used.');
      setBusy(false);
      return;
    }

    const previous = value;
    onChange(result.id);

    // Only now is it safe to drop the old one.
    if (previous) await deleteImage(previous);

    setInfo(
      `${result.width}×${result.height} · ${formatBytes(result.bytes)}` +
        (result.sourceBytes > result.bytes
          ? ` (from ${formatBytes(result.sourceBytes)})`
          : ''),
    );
    setBusy(false);
  }

  function onDrop(event) {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files?.[0]);
  }

  async function remove() {
    const previous = value;
    onChange(null);
    setInfo(null);
    setError(null);
    if (previous) await deleteImage(previous);
  }

  return (
    <div>
      <span className="mb-1 block text-sm text-ink-500">{label}</span>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex items-center gap-4 rounded-xl border border-dashed p-3 transition-colors ${
          dragging ? 'border-brand-500 bg-brand-500/8' : 'border-surface-300'
        }`}
      >
        <Thumb
          imageId={value}
          emoji={emoji}
          className="h-20 w-20 shrink-0"
          emojiClass="text-3xl"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="btn-secondary px-4 py-2 text-xs"
            >
              {busy ? 'Processing…' : value ? 'Replace' : 'Upload photo'}
            </button>

            {value && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="btn-ghost px-3 py-2 text-xs hover:text-chilli-500"
              >
                Remove
              </button>
            )}
          </div>

          <p className="mt-1.5 text-xs text-ink-500/80">
            {error ? (
              <span className="text-chilli-500">{error}</span>
            ) : info ? (
              <span className="text-leaf-500">Saved · {info}</span>
            ) : (
              `Drop an image or browse. Resized to ${MAX_EDGE}px and re-encoded before saving.`
            )}
          </p>

          {!value && !error && (
            <p className="mt-1 text-xs text-ink-500/70">
              No photo — the card falls back to the icon.
            </p>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          accept(event.target.files?.[0]);
          // Allow re-picking the same file after a failure.
          event.target.value = '';
        }}
      />
    </div>
  );
}
