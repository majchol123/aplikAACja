import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Modal on the native <dialog> (focus trap, Escape, inert background for free). Mounted =
 * open; `onClose` must unmount it.
 */
export function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={`m-auto max-h-[94dvh] w-[calc(100%-1rem)] overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl backdrop:bg-slate-900/50 sm:p-6 ${
        wide ? 'max-w-4xl' : 'max-w-lg'
      }`}
    >
      <h2 id={id} className="text-xl font-bold text-brand-900">
        {title}
      </h2>
      {children}
    </dialog>
  );
}
