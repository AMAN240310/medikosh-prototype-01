import React from 'react';
import { Mic, X, Loader2, Volume2, Sparkles } from 'lucide-react';
import type { RecorderState } from '../hooks/useVoiceRecorder.js';

interface VoiceControlsProps {
  state: RecorderState;
  audioLevel: number;
  recordingSeconds: number;
  disabled?: boolean;
  isSpeaking?: boolean;
  isHandsFree?: boolean;
  onToggleHandsFree?: () => void;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
}

export const VoiceControls: React.FC<VoiceControlsProps> = ({
  state,
  audioLevel,
  recordingSeconds,
  disabled = false,
  isSpeaking = false,
  isHandsFree = true,
  onToggleHandsFree,
  onStart,
  onStop,
  onCancel,
}) => {
  const isListening = state === 'LISTENING';
  const isProcessing = state === 'PROCESSING';

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="flex flex-col items-center justify-center pt-2 pb-4">
      {/* Timer Indicator Badge */}
      <div className="neo-pill-btn px-3.5 py-1 rounded-full border border-white/80 flex items-center space-x-1.5 text-xs font-semibold text-rose-500 mb-3">
        <span className={`w-2 h-2 rounded-full bg-rose-500 ${isListening ? 'animate-ping' : ''}`}></span>
        <span>{formatTime(recordingSeconds)}</span>
        {isListening && (
          <button
            onClick={onCancel}
            title="Cancel recording"
            className="ml-1 p-0.5 text-slate-400 hover:text-rose-600 rounded-full cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Mic Waveform & Central Stop/Record Button Row */}
      <div className="w-full flex items-center justify-center space-x-3 sm:space-x-5 my-2">
        {/* Left Sound Wave Visualizer Bars */}
        <div className="flex items-center space-x-1 sm:space-x-1.5 opacity-80" data-purpose="audio-wave-left">
          <span className="w-1 rounded-full bg-blue-300 transition-all duration-75" style={{ height: isListening ? `${Math.max(4, Math.round(6 * (audioLevel + 5) / 50))}px` : '6px' }}></span>
          <span className="w-1.5 rounded-full bg-blue-400 transition-all duration-75" style={{ height: isListening ? `${Math.max(8, Math.round(16 * (audioLevel + 10) / 50))}px` : '16px' }}></span>
          <span className="w-1.5 rounded-full bg-blue-400/80 transition-all duration-75" style={{ height: isListening ? `${Math.max(12, Math.round(32 * (audioLevel + 15) / 50))}px` : '32px' }}></span>
          <span className="w-1.5 rounded-full bg-blue-500 transition-all duration-75" style={{ height: isListening ? `${Math.max(16, Math.round(48 * (audioLevel + 20) / 50))}px` : '48px' }}></span>
          <span className="w-1.5 rounded-full bg-blue-400 transition-all duration-75" style={{ height: isListening ? `${Math.max(10, Math.round(28 * (audioLevel + 10) / 50))}px` : '28px' }}></span>
          <span className="w-1 rounded-full bg-blue-300 transition-all duration-75" style={{ height: isListening ? `${Math.max(5, Math.round(10 * (audioLevel + 5) / 50))}px` : '10px' }}></span>
        </div>

        {/* Neomorphic Central Recording Button with Stop Icon */}
        <div className="relative flex items-center justify-center p-3 rounded-full record-button-outer border border-white/80">
          {/* Glow Aura when listening */}
          <div className={`absolute inset-0 rounded-full record-glow pointer-events-none transition-opacity duration-300 ${isListening ? 'opacity-90' : 'opacity-20'}`}></div>

          {/* Red/Coral Gradient Button */}
          <button
            onClick={isListening ? onStop : onStart}
            disabled={disabled || isProcessing}
            aria-label={isListening ? 'Stop recording' : 'Start speaking'}
            className={`relative w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center shadow-inner hover:scale-105 active:scale-95 transition transform duration-150 focus:outline-none cursor-pointer ${
              isListening
                ? 'bg-gradient-to-tr from-rose-600 via-rose-500 to-red-400'
                : isProcessing
                ? 'bg-slate-200 cursor-not-allowed'
                : isSpeaking
                ? 'bg-gradient-to-tr from-teal-500 to-teal-400 animate-pulse'
                : 'bg-gradient-to-tr from-teal-600 via-teal-500 to-emerald-400'
            }`}
            type="button"
          >
            {isProcessing ? (
              <Loader2 className="w-6 h-6 sm:w-7 sm:h-7 text-teal-700 animate-spin" />
            ) : isListening ? (
              <span className="w-5 h-5 sm:w-6 sm:h-6 bg-white rounded-md shadow-sm"></span>
            ) : isSpeaking ? (
              <Volume2 className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
            ) : (
              <Mic className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
            )}
          </button>
        </div>

        {/* Right Sound Wave Visualizer Bars */}
        <div className="flex items-center space-x-1 sm:space-x-1.5 opacity-80" data-purpose="audio-wave-right">
          <span className="w-1 rounded-full bg-blue-300 transition-all duration-75" style={{ height: isListening ? `${Math.max(5, Math.round(10 * (audioLevel + 5) / 50))}px` : '10px' }}></span>
          <span className="w-1.5 rounded-full bg-blue-400 transition-all duration-75" style={{ height: isListening ? `${Math.max(10, Math.round(28 * (audioLevel + 10) / 50))}px` : '28px' }}></span>
          <span className="w-1.5 rounded-full bg-blue-500 transition-all duration-75" style={{ height: isListening ? `${Math.max(16, Math.round(48 * (audioLevel + 20) / 50))}px` : '48px' }}></span>
          <span className="w-1.5 rounded-full bg-blue-400/80 transition-all duration-75" style={{ height: isListening ? `${Math.max(12, Math.round(32 * (audioLevel + 15) / 50))}px` : '32px' }}></span>
          <span className="w-1.5 rounded-full bg-blue-400 transition-all duration-75" style={{ height: isListening ? `${Math.max(8, Math.round(16 * (audioLevel + 10) / 50))}px` : '16px' }}></span>
          <span className="w-1 rounded-full bg-blue-300 transition-all duration-75" style={{ height: isListening ? `${Math.max(4, Math.round(6 * (audioLevel + 5) / 50))}px` : '6px' }}></span>
        </div>
      </div>

      {/* Instruction Texts */}
      <div className="text-center mt-3 space-y-0.5">
        <h2 className="text-slate-700 font-semibold text-sm sm:text-base tracking-tight">
          {isListening
            ? 'Listening to you... Speak naturally'
            : isProcessing
            ? 'Transcribing & analyzing symptoms...'
            : isSpeaking
            ? 'Assistant is speaking...'
            : 'Tap the microphone or speak naturally'}
        </h2>
        <p className="text-xs text-slate-400">
          {isListening ? '(will auto-send when silent)' : '(Hands-free voice consultation ready)'}
        </p>
      </div>

      {/* Hands-Free Toggle Status Pill */}
      {onToggleHandsFree && (
        <div className="mt-4">
          <button
            type="button"
            onClick={onToggleHandsFree}
            className={`neo-pill-btn px-4 py-1.5 rounded-full border border-teal-200/50 flex items-center space-x-2 text-xs font-semibold cursor-pointer transition ${
              isHandsFree
                ? 'bg-teal-50/40 text-teal-700'
                : 'bg-slate-100 text-slate-500'
            }`}
          >
            <Sparkles className="w-4 h-4 text-teal-600" />
            <span>Hands-Free Auto-Listen: {isHandsFree ? 'ON' : 'OFF'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
