import React, { useState } from 'react';

interface TextInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const TextInput: React.FC<TextInputProps> = ({
  onSend,
  disabled = false,
  placeholder = 'अपनी समस्या यहाँ टाइप करें या ऊपर माइक दबाकर बोलें...',
}) => {
  const [text, setText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="neo-inset rounded-full p-1.5 pl-5 pr-2 flex items-center justify-between border border-slate-300/30 transition-all">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="bg-transparent border-0 focus:ring-0 focus:outline-none w-full text-xs sm:text-sm text-slate-700 placeholder:text-slate-400 font-normal pr-2 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={!text.trim() || disabled}
          aria-label="Send message"
          className="w-10 h-10 rounded-full bg-teal-400/80 hover:bg-teal-500 text-teal-950 flex items-center justify-center transition shadow-sm flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <svg className="w-4 h-4 transform rotate-45 -ml-0.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24">
            <line x1="22" x2="11" y1="2" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    </form>
  );
};
