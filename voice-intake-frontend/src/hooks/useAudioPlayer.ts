import { useState, useRef, useCallback, useEffect } from 'react';

interface UseAudioPlayerProps {
  onPlaybackEnded?: () => void;
}

export function useAudioPlayer({ onPlaybackEnded }: UseAudioPlayerProps = {}) {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onEndedCallbackRef = useRef<(() => void) | undefined>(onPlaybackEnded);

  useEffect(() => {
    onEndedCallbackRef.current = onPlaybackEnded;
  }, [onPlaybackEnded]);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setIsPlaying(false);
    setCurrentlyPlayingId(null);
  }, []);

  const playBase64 = useCallback(
    (base64: string, mimeType: string = 'audio/wav', id?: string, perPlayCallback?: () => void) => {
      stopAudio();

      try {
        const audioSrc = `data:${mimeType};base64,${base64}`;
        const audio = new Audio(audioSrc);
        audioRef.current = audio;

        audio.onplay = () => {
          setIsPlaying(true);
          if (id) setCurrentlyPlayingId(id);
        };

        const handleFinish = () => {
          setIsPlaying(false);
          setCurrentlyPlayingId(null);
          audioRef.current = null;
          if (perPlayCallback) perPlayCallback();
          if (onEndedCallbackRef.current) onEndedCallbackRef.current();
        };

        audio.onended = handleFinish;

        audio.onerror = (e) => {
          console.warn('Audio playback error:', e);
          handleFinish();
        };

        audio.play().catch((err) => {
          console.warn('Audio autoplay blocked or failed:', err);
          handleFinish();
        });
      } catch (err) {
        console.error('Failed to construct Audio object:', err);
        setIsPlaying(false);
        setCurrentlyPlayingId(null);
        if (perPlayCallback) perPlayCallback();
        if (onEndedCallbackRef.current) onEndedCallbackRef.current();
      }
    },
    [stopAudio]
  );

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [stopAudio]);

  return {
    isPlaying,
    currentlyPlayingId,
    playBase64,
    stopAudio,
  };
}
