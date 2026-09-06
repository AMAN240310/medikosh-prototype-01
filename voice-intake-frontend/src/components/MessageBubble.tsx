import React from 'react';
import { VolumeX, Mic, Keyboard } from 'lucide-react';
import type { ConversationTurn } from '../types/index.js';

interface MessageBubbleProps {
  turn: ConversationTurn;
  isPlaying: boolean;
  onPlayAudio?: (base64: string, mimeType?: string, id?: string) => void;
  onStopAudio?: () => void;
}

const cleanText = (text: string) => {
  if (!text) return '';
  return text
    .replace(/<tool_call[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_call[\s\S]*$/gi, '')
    .replace(/<\/?(?:tool_call|arg_key|arg_value|function_call|action|thought|tool_code|json)[^>]*>/gi, '')
    .trim();
};

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  turn,
  isPlaying,
  onPlayAudio,
  onStopAudio,
}) => {
  const isAssistant = turn.role === 'assistant';
  const displayText = cleanText(turn.text);

  return (
    <div
      className={`flex flex-col ${
        isAssistant ? 'items-start' : 'items-end'
      } mb-4 transition-all animate-fadeIn w-full`}
    >
      <div className="flex items-center gap-2 mb-1 px-1 text-xs text-slate-500 font-semibold">
        <span>{isAssistant ? 'Intake Assistant' : 'You (Patient)'}</span>
        {isAssistant && (
          <span className="inline-flex items-center space-x-1 bg-teal-50 border border-teal-200/70 text-teal-600 text-[10px] font-medium px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse"></span>
            <span>Voice</span>
          </span>
        )}
        {!isAssistant && turn.source === 'VOICE' && (
          <span className="inline-flex items-center gap-0.5 text-blue-600 bg-blue-100/70 border border-blue-200/60 px-2 py-0.5 rounded-full text-[10px] font-medium">
            <Mic className="w-2.5 h-2.5" /> Voice
          </span>
        )}
        {!isAssistant && turn.source === 'TEXT' && (
          <span className="inline-flex items-center gap-0.5 text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full text-[10px] font-medium">
            <Keyboard className="w-2.5 h-2.5" /> Text
          </span>
        )}
      </div>

      <div
        className={`w-full max-w-[95%] sm:max-w-[85%] rounded-2xl p-4 sm:p-5 relative text-sm sm:text-base leading-relaxed ${
          isAssistant
            ? 'neo-subtle-box border border-white/80 text-slate-700 font-medium'
            : 'neo-pill-btn bg-gradient-to-tr from-teal-50 to-white text-slate-800 font-medium border border-teal-200/60 rounded-tr-xs'
        }`}
      >
        <p className="whitespace-pre-wrap">{displayText}</p>

        {/* Audio control for assistant turn */}
        {isAssistant && (
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-200/50 pt-3">
            <button
              onClick={() => {
                if (isPlaying) {
                  onStopAudio?.();
                } else if (turn.audioBase64) {
                  onPlayAudio?.(turn.audioBase64, turn.mimeType, turn.id);
                }
              }}
              type="button"
              className="neo-pill-btn flex items-center space-x-2 px-4 py-1.5 rounded-full text-xs font-semibold text-teal-700 hover:text-teal-800 border border-white/80 cursor-pointer transition"
            >
              {isPlaying ? (
                <>
                  <VolumeX className="w-3.5 h-3.5 text-teal-600 animate-pulse" />
                  <span>Stop Audio</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5 text-teal-600 fill-teal-600" viewBox="0 0 24 24">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                  <span>Play Response</span>
                </>
              )}
            </button>

            {isPlaying && (
              <span className="flex gap-1 items-center">
                <span className="w-1.5 h-3 bg-teal-500 rounded-full animate-pulse"></span>
                <span className="w-1.5 h-4 bg-teal-600 rounded-full animate-pulse delay-75"></span>
                <span className="w-1.5 h-2.5 bg-teal-400 rounded-full animate-pulse delay-150"></span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
