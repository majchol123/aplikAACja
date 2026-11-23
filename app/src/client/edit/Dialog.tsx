import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Modal on the native <dialog> (focus trap, Escape, inert background for free). Mounted =
 * open; `onClose` must unmount it. `actions` stay at the top next to the title while a long
 * dialog scrolls (a submit button there names its form with `form`).
 */
export function Dialog({
  title,
  onClose,
  children,
  wide = false,
  actions,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  actions?: ReactNode;
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
      {actions ? (
        // Sticks to the dialog's edge (the scrollport's padding would otherwise show the
        // content scrolling past above it).
        <div className="sticky -top-5 z-10 -mx-5 -mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-5 pb-3 pt-5 sm:-top-6 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6">
          <h2 id={id} className="mr-auto text-xl font-bold text-brand-900">
            {title}
          </h2>
          <div className="ml-auto flex shrink-0 gap-2">{actions}</div>
        </div>
      ) : (
        <h2 id={id} className="text-xl font-bold text-brand-900">
          {title}
        </h2>
      )}
      {children}
    </dialog>
  );
}
