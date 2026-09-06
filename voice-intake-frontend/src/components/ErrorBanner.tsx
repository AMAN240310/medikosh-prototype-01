import React from 'react';
import { AlertCircle, X } from 'lucide-react';

interface ErrorBannerProps {
  message: string | null;
  onDismiss: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onDismiss }) => {
  if (!message) return null;

  return (
    <div className="bg-amber-50 border-l-4 border-amber-500 p-3 rounded-r-lg shadow-sm flex items-start justify-between gap-3 text-sm text-amber-800 animate-fadeIn mb-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <p className="leading-relaxed">{message}</p>
      </div>
      <button
        onClick={onDismiss}
        className="text-amber-500 hover:text-amber-700 p-1 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
