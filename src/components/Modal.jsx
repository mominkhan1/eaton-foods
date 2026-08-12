import { useEffect, useRef } from 'react';

/**
 * Bottom-sheet on mobile, centred dialog on desktop.
 *
 * `dismissible: false` is used by the order-type gate, which must be answered
 * before the menu is usable.
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  dismissible = true,
  size = 'md',
}) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(event) {
      if (event.key === 'Escape' && dismissible) onClose?.();
    }

    document.addEventListener('keydown', onKeyDown);
    // Stop the page behind the sheet from scrolling with it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose, dismissible]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const widths = {
    sm: 'sm:max-w-md',
    md: 'sm:max-w-lg',
    lg: 'sm:max-w-2xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm"
        onClick={dismissible ? onClose : undefined}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative flex max-h-[92vh] w-full flex-col rounded-t-3xl border
                    border-surface-200 bg-surface-50 shadow-2xl outline-none
                    sm:rounded-3xl ${widths[size]}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-surface-200 px-5 py-4">
          <h2 className="text-2xl text-ink-950">{title}</h2>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 rounded-full p-1 text-ink-500 hover:bg-surface-100 hover:text-ink-800"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer className="border-t border-surface-200 px-5 py-4">{footer}</footer>
        )}
      </div>
    </div>
  );
}
