"use client";

import { useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FormRecoveryBannerProps {
  /** Called when user clicks "Restore" */
  onRestore: () => void;
  /** Called when user dismisses the banner (clears saved data) */
  onDismiss: () => void;
}

/**
 * Banner displayed when a form has saved state from a previous session.
 * Allows the user to restore or dismiss the recovered data.
 */
export function FormRecoveryBanner({
  onRestore,
  onDismiss,
}: FormRecoveryBannerProps) {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  const handleRestore = () => {
    onRestore();
    setVisible(false);
  };

  const handleDismiss = () => {
    onDismiss();
    setVisible(false);
  };

  return (
    <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950 p-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <RotateCcw className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
        <p className="text-sm text-blue-800 dark:text-blue-200">
          Znaleziono niezapisane dane formularza. Przywrocic?
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900"
          onClick={handleRestore}
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          Przywroc
        </Button>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-300"
          aria-label="Odrzuc zapisane dane"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
