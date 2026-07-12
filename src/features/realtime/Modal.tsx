import { useEffect, type ReactNode } from 'react';

/** Full-screen dimmed modal shell used by the realtime tools. Escape / backdrop close. */
export function Modal({
  title,
  subtitle,
  onClose,
  children
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="rt-modal-backdrop" onClick={onClose}>
      <div className="rt-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="rt-modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="label">{subtitle}</div>}
          </div>
          <button className="rt-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="rt-modal-body">{children}</div>
      </div>
    </div>
  );
}
