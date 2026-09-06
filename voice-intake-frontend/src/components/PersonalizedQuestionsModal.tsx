import React, { useState } from 'react';
import { HelpCircle, CheckCircle2 } from 'lucide-react';
import type { PersonalizedQuestion } from '../types/index.js';

interface PersonalizedQuestionsModalProps {
  sarvamQ: PersonalizedQuestion | null;
  geminiQ: PersonalizedQuestion | null;
  onSubmit: (ans1: string, ans2: string) => void;
  isSubmitting?: boolean;
}

export const PersonalizedQuestionsModal: React.FC<PersonalizedQuestionsModalProps> = ({
  sarvamQ,
  geminiQ,
  onSubmit,
  isSubmitting = false,
}) => {
  const [ans1, setAns1] = useState(sarvamQ?.answer || '');
  const [ans2, setAns2] = useState(geminiQ?.answer || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ans1.trim() && !ans2.trim()) return;
    onSubmit(ans1.trim(), ans2.trim());
  };

  return (
    <div className="bg-white border border-teal-100 rounded-3xl p-6 sm:p-8 shadow-xl max-w-2xl mx-auto my-6 animate-fadeIn">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
        <div className="w-10 h-10 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center">
          <HelpCircle className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">A Few Final Questions</h2>
          <p className="text-xs sm:text-sm text-slate-500">
            To ensure complete clinical intake before the doctor reviews your case, please answer these two tailored questions:
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Question 1 */}
        {sarvamQ && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded-full bg-teal-600 text-white text-xs font-bold flex items-center justify-center">
                1
              </span>
              <h3 className="font-semibold text-slate-800 text-sm sm:text-base">
                {sarvamQ.question}
              </h3>
            </div>
            <textarea
              rows={2}
              value={ans1}
              onChange={(e) => setAns1(e.target.value)}
              placeholder="Type your answer here..."
              className="w-full mt-2 bg-white border border-slate-200 rounded-xl p-3 text-sm text-slate-800 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
        )}

        {/* Question 2 */}
        {geminiQ && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded-full bg-teal-600 text-white text-xs font-bold flex items-center justify-center">
                2
              </span>
              <h3 className="font-semibold text-slate-800 text-sm sm:text-base">
                {geminiQ.question}
              </h3>
            </div>
            <textarea
              rows={2}
              value={ans2}
              onChange={(e) => setAns2(e.target.value)}
              placeholder="Type your answer here..."
              className="w-full mt-2 bg-white border border-slate-200 rounded-xl p-3 text-sm text-slate-800 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
        )}

        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onSubmit(ans1.trim() || 'No additional input provided', ans2.trim() || 'No additional input provided')}
            disabled={isSubmitting}
            className="text-xs sm:text-sm font-semibold text-slate-500 hover:text-teal-700 underline transition-colors"
          >
            Skip & Proceed to Review →
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-xl shadow-md shadow-teal-600/20 transition-all disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Proceed to Case Review</span>
          </button>
        </div>
      </form>
    </div>
  );
};
