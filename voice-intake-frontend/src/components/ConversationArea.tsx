import React, { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble.js';
import type { ConversationTurn } from '../types/index.js';

interface ConversationAreaProps {
  turns: ConversationTurn[];
  isProcessing: boolean;
  activePlayingId: string | null;
  onPlayAudio?: (base64: string, mimeType?: string, id?: string) => void;
  onStopAudio?: () => void;
}

export const ConversationArea: React.FC<ConversationAreaProps> = ({
  turns,
  isProcessing,
  activePlayingId,
  onPlayAudio,
  onStopAudio,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, isProcessing]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
      <div className="max-w-3xl mx-auto">
        {turns.map((turn) => (
          <MessageBubble
            key={turn.id}
            turn={turn}
            isPlaying={activePlayingId === turn.id}
            onPlayAudio={onPlayAudio}
            onStopAudio={onStopAudio}
          />
        ))}

        {isProcessing && (
          <div className="flex items-center gap-2 text-slate-400 text-xs font-medium py-2 px-1 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-teal-500 animate-bounce"></span>
            <span className="w-2 h-2 rounded-full bg-teal-500 animate-bounce delay-100"></span>
            <span className="w-2 h-2 rounded-full bg-teal-500 animate-bounce delay-200"></span>
            <span>Intake Assistant is processing...</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
};
