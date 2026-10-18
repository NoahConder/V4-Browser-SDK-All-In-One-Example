import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Dialog behavior for the sheets, modals and header panels: moves focus inside
// on open (the first field -- skipping ones marked `data-no-autofocus`, such as
// the resources panel's search box, so phones don't get the keyboard the moment
// the panel opens -- else the first control), keeps Tab cycling within,
// closes on Escape, and returns focus to whatever opened it on close. Attach
// the returned ref to the dialog's root element and give it role="dialog" and
// a label, plus aria-modal="true" unless `trapFocus` is off.
//
// (Naming note: Tailwind scans source text -- comments included -- for class
// candidates, and the usual word for "the wrapping element" is also one of
// its layout utilities, which breaks the build with the raw `short` screen.
// Hence `dialogEl`.)
export interface DialogOptions {
  // Keep Tab cycling inside the element (an aria-modal dialog). A non-modal
  // panel -- the call-stats sheet, read alongside the call controls -- passes
  // false: focus still moves in on open and back to the opener on close, and
  // Escape still closes, but Tab leaves normally and nothing is dimmed.
  trapFocus?: boolean;
}

export function useDialog(isOpen: boolean, onClose: () => void, { trapFocus = true }: DialogOptions = {}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const dialogEl = dialogRef.current;
    if (!dialogEl) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE));

    (
      dialogEl.querySelector<HTMLElement>(
        'input:not([data-no-autofocus]), select:not([data-no-autofocus]), textarea:not([data-no-autofocus])',
      ) ?? focusables()[0]
    )?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Handled here so the screen-level Escape handlers don't also fire.
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !trapFocus) return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    dialogEl.addEventListener('keydown', onKeyDown);
    return () => {
      dialogEl.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, [isOpen, trapFocus]);

  return dialogRef;
}
