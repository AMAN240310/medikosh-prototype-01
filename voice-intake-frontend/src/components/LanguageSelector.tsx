import React from 'react';
import { Globe } from 'lucide-react';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../types/index.js';

interface LanguageSelectorProps {
  selected: SupportedLanguage;
  onChange: (lang: SupportedLanguage) => void;
  detected?: string | null;
  disabled?: boolean;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  selected,
  onChange,
  detected,
  disabled = false,
}) => {
  return (
    <div className="flex items-center gap-2 bg-white/80 backdrop-blur border border-slate-200 rounded-full px-3 py-1.5 shadow-sm text-sm">
      <Globe className="w-4 h-4 text-teal-600 shrink-0" />
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value as SupportedLanguage)}
        disabled={disabled}
        className="bg-transparent border-none text-slate-800 font-medium focus:ring-0 cursor-pointer outline-none pr-1"
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.nativeName} ({lang.name})
          </option>
        ))}
      </select>
      {detected && detected !== selected && (
        <span className="hidden sm:inline-block text-xs bg-teal-50 text-teal-700 font-medium px-2 py-0.5 rounded-full border border-teal-200">
          Detected: {detected}
        </span>
      )}
    </div>
  );
};
