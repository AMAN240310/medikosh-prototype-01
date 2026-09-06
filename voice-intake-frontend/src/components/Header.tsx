import React from 'react';
import { RotateCcw, Home } from 'lucide-react';
import { LanguageSelector } from './LanguageSelector.js';
import type { SupportedLanguage, CaseSession } from '../types/index.js';

interface HeaderProps {
  session: CaseSession | null;
  selectedLanguage: SupportedLanguage;
  onLanguageChange: (lang: SupportedLanguage) => void;
  onReset: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  session,
  selectedLanguage,
  onLanguageChange,
  onReset,
}) => {
  const getProgress = () => {
    if (!session) return { step: 1, label: 'Voice Intake', total: 5 };
    switch (session.status) {
      case 'active': {
        const turns = session.conversationHistory.filter((t) => t.role === 'patient').length;
        if (turns <= 0) return { step: 1, label: 'Understanding Symptoms', total: 5 };
        if (turns === 1) return { step: 1, label: 'Duration & Location', total: 5 };
        if (turns === 2) return { step: 1, label: 'Severity & Pain Scale', total: 5 };
        if (turns === 3) return { step: 1, label: 'Associated Symptoms', total: 5 };
        return { step: 1, label: 'Finalizing Intake', total: 5 };
      }
      case 'awaiting_personalized_questions':
        return { step: 1, label: 'Specific Follow-up', total: 5 };
      case 'review':
        return { step: 1, label: 'Voice Intake Done', total: 5 };
      case 'finalized':
        return { step: 5, label: 'Doctor Allotment', total: 5 };
      default:
        return { step: 1, label: 'Voice Intake', total: 5 };
    }
  };

  const progress = getProgress();
  const caseId = session?.caseId || 'CASE-547072';

  return (
    <header className="w-full max-w-7xl mx-auto mb-4 md:mb-6 pt-2">
      <div className="neo-raised rounded-3xl md:rounded-full px-5 py-3 md:py-3.5 flex flex-wrap items-center justify-between gap-4 border border-white/60">
        {/* Left Branding: Emblem + Titles */}
        <div className="flex items-center space-x-3.5">
          {/* Teal Medical Stethoscope Emblem */}
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-teal-600 to-teal-400 flex items-center justify-center text-white shadow-md shadow-teal-500/30 flex-shrink-0">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M4.5 3v5a6 6 0 0 0 12 0V3"></path>
              <path d="M10.5 14v4a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-1.5"></path>
              <circle cx="18.5" cy="10.5" r="2.5"></circle>
            </svg>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center space-x-2">
              <h1 className="text-base md:text-lg font-bold text-slate-800 tracking-tight leading-none">
                Case Taking Intake
              </h1>
              <span className="text-[11px] font-semibold text-blue-600 bg-blue-100/70 border border-blue-200/60 px-2 py-0.5 rounded-full">
                {caseId}
              </span>
            </div>
            <span className="text-xs text-slate-400 font-medium mt-1">
              Voice-First Patient Intake Assistant
            </span>
          </div>
        </div>

        {/* Right Navigation & Status Controls */}
        <div className="flex items-center flex-wrap gap-2.5 sm:gap-3">
          {/* Step Progress Capsule */}
          <div className="px-4 py-1.5 rounded-full bg-teal-50/80 border border-teal-200/60 flex items-center space-x-1 text-xs">
            <span className="font-semibold text-teal-700">{progress.label}</span>
            <span className="text-teal-300 mx-1">|</span>
            <span className="text-slate-500 font-medium">Step {progress.step} of {progress.total}</span>
          </div>

          {/* Language Selector Dropdown */}
          <div className="neo-pill-btn flex items-center space-x-2 px-3.5 py-1.5 rounded-full cursor-pointer text-xs font-semibold text-slate-700 border border-white/60">
            <LanguageSelector
              selected={selectedLanguage}
              onChange={onLanguageChange}
              detected={session?.detectedLanguage}
            />
          </div>

          {/* Refresh / Reset Button */}
          <button
            onClick={onReset}
            aria-label="Restart Session"
            className="neo-pill-btn p-2 rounded-full text-slate-500 hover:text-teal-600 border border-white/60 cursor-pointer"
            type="button"
            title="Restart Session"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Exit to Portal Button */}
          <a
            href="http://localhost:3000/"
            className="neo-pill-btn flex items-center space-x-1.5 px-4 py-1.5 rounded-full text-xs font-semibold text-slate-600 hover:text-slate-800 border border-white/70 cursor-pointer"
          >
            <Home className="w-4 h-4 text-slate-500" />
            <span>Exit to Portal</span>
          </a>
        </div>
      </div>
    </header>
  );
};
