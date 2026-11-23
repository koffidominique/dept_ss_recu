import { useEffect, useRef, type RefObject } from 'react';

interface UsePosShortcutsOptions {
  searchInputRef: RefObject<HTMLInputElement | null>;
  canValidate: boolean;
  onValidate: () => void;
  canSettleExact?: boolean;
  onSettleExact?: () => void;
  onHoldOrOpenHeld?: () => void;
  hasModalOpen: boolean;
  onEscape: () => void;
}

export function usePosShortcuts({
  searchInputRef,
  canValidate,
  onValidate,
  canSettleExact = false,
  onSettleExact,
  onHoldOrOpenHeld,
  hasModalOpen,
  onEscape,
}: UsePosShortcutsOptions) {
  const validateRef = useRef<() => void>(() => {});
  const settleRef = useRef<() => void>(() => {});
  const holdRef = useRef<() => void>(() => {});

  useEffect(() => {
    validateRef.current = () => {
      if (canValidate) {
        onValidate();
      }
    };
  }, [canValidate, onValidate]);

  useEffect(() => {
    settleRef.current = () => {
      if (canSettleExact && onSettleExact) {
        onSettleExact();
      }
    };
  }, [canSettleExact, onSettleExact]);

  useEffect(() => {
    holdRef.current = () => {
      if (onHoldOrOpenHeld) {
        onHoldOrOpenHeld();
      }
    };
  }, [onHoldOrOpenHeld]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        if (!hasModalOpen) {
          e.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }
      } else if (e.key === 'F4') {
        if (!hasModalOpen) {
          e.preventDefault();
          holdRef.current();
        }
      } else if (e.key === 'F8') {
        if (!hasModalOpen) {
          e.preventDefault();
          settleRef.current();
        }
      } else if (e.key === 'F9') {
        if (!hasModalOpen) {
          e.preventDefault();
          validateRef.current();
        }
      } else if (e.key === 'Escape') {
        onEscape();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchInputRef, hasModalOpen, onEscape]);
}
