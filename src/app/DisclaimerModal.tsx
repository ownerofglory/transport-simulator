import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export const DISCLAIMER_STORAGE_KEY = 'transit-simulator:disclaimer-acknowledged:v1';

function wasDisclaimerAcknowledged() {
  try {
    return window.localStorage.getItem(DISCLAIMER_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** One-time notice that makes the simulator's unofficial purpose explicit. */
export function DisclaimerModal() {
  const [open, setOpen] = useState(() => !wasDisclaimerAcknowledged());

  const close = useCallback(() => {
    try {
      window.localStorage.setItem(DISCLAIMER_STORAGE_KEY, 'true');
    } catch {
      // Still allow the current session to continue when storage is unavailable.
    }
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, open]);

  if (!open) return null;

  return createPortal(
    <div className="disclaimer-backdrop" onClick={close}>
      <section
        className="disclaimer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="disclaimer-title"
        aria-describedby="disclaimer-description"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="disclaimer-close" aria-label="Close disclaimer" onClick={close}>
          ×
        </button>
        <div className="disclaimer-kicker">Before you continue</div>
        <h2 id="disclaimer-title">Unofficial transit simulator</h2>
        <div id="disclaimer-description" className="disclaimer-copy">
          <p>
            This is an independent application and is not an official service of VVS, any other
            transport association (Verkehrsverbund), or any transport operator.
          </p>
          <p>
            Do not use it to plan journeys, search for transit connections, or make travel
            decisions. Routes, stops, schedules, and other information may be incomplete,
            fictional, or out of date.
          </p>
          <p>This non-commercial project is intended solely for exploratory purposes.</p>
        </div>
        <button className="disclaimer-acknowledge" onClick={close} autoFocus>
          I understand
        </button>
      </section>
    </div>,
    document.body
  );
}
