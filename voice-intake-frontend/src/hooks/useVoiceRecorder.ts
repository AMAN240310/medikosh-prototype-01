import { useState, useRef, useCallback, useEffect } from 'react';
import { encodeWAV } from '../utils/wavEncoder.js';

export type RecorderState = 'READY' | 'LISTENING' | 'PROCESSING' | 'ERROR';

interface UseVoiceRecorderProps {
  onRecordingComplete?: (audioBlob: Blob) => void;
  silenceThresholdMs?: number;
}

export function useVoiceRecorder({
  onRecordingComplete,
  silenceThresholdMs = 2000,
}: UseVoiceRecorderProps = {}) {
  const [state, setState] = useState<RecorderState>('READY');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const isRecordingRef = useRef<boolean>(false);
  const timerRef = useRef<any>(null);
  const animFrameRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<any>(null);
  const speechDetectedRef = useRef<boolean>(false);
  const sampleRateRef = useRef<number>(16000);

  const cleanupStream = useCallback(() => {
    isRecordingRef.current = false;
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {}
      processorRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {}
      sourceNodeRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {}
      analyserRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  const monitorAudioLevel = useCallback(() => {
    if (!analyserRef.current) return;
    const buffer = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(buffer);

    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i];
    }
    const avg = sum / buffer.length;
    const normalized = Math.min(100, Math.round((avg / 128) * 100));
    setAudioLevel(normalized);

    // VAD: Sound above threshold
    if (normalized > 15) {
      speechDetectedRef.current = true;
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    } else if (speechDetectedRef.current && !silenceTimerRef.current) {
      silenceTimerRef.current = setTimeout(() => {
        if (isRecordingRef.current) {
          stopRecording();
        }
      }, silenceThresholdMs);
    }

    animFrameRef.current = requestAnimationFrame(monitorAudioLevel);
  }, [silenceThresholdMs]);

  const startRecording = useCallback(async () => {
    try {
      if (isRecordingRef.current) return;

      cleanupStream();
      setErrorMessage(null);
      pcmChunksRef.current = [];
      speechDetectedRef.current = false;
      setRecordingSeconds(0);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      sampleRateRef.current = audioCtx.sampleRate;

      const sourceNode = audioCtx.createMediaStreamSource(stream);
      sourceNodeRef.current = sourceNode;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      // Script processor for linear PCM extraction
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!isRecordingRef.current) return;
        const channel = e.inputBuffer.getChannelData(0);
        // Copy chunk
        pcmChunksRef.current.push(new Float32Array(channel));
      };

      sourceNode.connect(analyser);
      sourceNode.connect(processor);
      processor.connect(audioCtx.destination);

      isRecordingRef.current = true;
      setState('LISTENING');

      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev >= 60) {
            stopRecording();
            return 60;
          }
          return prev + 1;
        });
      }, 1000);

      monitorAudioLevel();
    } catch (err: any) {
      console.error('Microphone error:', err);
      cleanupStream();
      setState('ERROR');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('Microphone access was denied. You can continue speaking by enabling permission or type using the text box.');
      } else {
        setErrorMessage(`Audio recording error: ${err.message}`);
      }
    }
  }, [cleanupStream, monitorAudioLevel]);

  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;

    // Collect all samples
    const chunks = pcmChunksRef.current;
    let totalLength = 0;
    for (const c of chunks) {
      totalLength += c.length;
    }

    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    const currentSampleRate = sampleRateRef.current || 16000;
    const durationSeconds = totalLength / currentSampleRate;

    cleanupStream();

    if (durationSeconds < 0.5) {
      // Too short to contain speech
      setState('READY');
      setErrorMessage('Speech recording was too short. Please speak your symptoms clearly.');
      return;
    }

    setState('PROCESSING');

    // Encode into pristine 16kHz mono linear PCM WAV
    try {
      const wavBlob = encodeWAV(merged, currentSampleRate, 16000);
      if (onRecordingComplete && wavBlob.size > 0) {
        onRecordingComplete(wavBlob);
      }
    } catch (e: any) {
      console.error('WAV encoding failed:', e);
      setState('READY');
      setErrorMessage('Failed to prepare audio format. Please try speaking again.');
    }
  }, [cleanupStream, onRecordingComplete]);

  const cancelRecording = useCallback(() => {
    pcmChunksRef.current = [];
    cleanupStream();
    setState('READY');
    setRecordingSeconds(0);
  }, [cleanupStream]);

  const resetToReady = useCallback(() => {
    cleanupStream();
    setState('READY');
    setRecordingSeconds(0);
  }, [cleanupStream]);

  useEffect(() => {
    return () => {
      cleanupStream();
    };
  }, [cleanupStream]);

  return {
    state,
    setState,
    errorMessage,
    audioLevel,
    recordingSeconds,
    startRecording,
    stopRecording,
    cancelRecording,
    resetToReady,
  };
}
