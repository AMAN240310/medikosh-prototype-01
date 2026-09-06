import { useState, useEffect, useCallback } from 'react';
import { caseTakingApi } from '../services/api.js';
import type { CaseSession, SupportedLanguage, ConversationTurn } from '../types/index.js';

export function useCaseSession() {
  const [session, setSession] = useState<CaseSession | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isProcessingTurn, setIsProcessingTurn] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>('hi');
  const [latestAudio, setLatestAudio] = useState<{ base64: string; mimeType: string } | null>(null);
  const [finalizedPayload, setFinalizedPayload] = useState<any | null>(null);

  const initSession = useCallback(async (lang: SupportedLanguage = 'hi') => {
    try {
      setIsLoading(true);
      setError(null);
      setFinalizedPayload(null);
      const data = await caseTakingApi.startSession(lang);
      setSession(data.session);
      setSelectedLanguage(data.session.selectedLanguage);
      if (data.audioBase64) {
        setLatestAudio({
          base64: data.audioBase64,
          mimeType: data.mimeType || 'audio/wav',
        });
      }
    } catch (err: any) {
      console.error('Failed to init session:', err);
      setError(err.message || 'Could not start case-taking session.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    initSession('hi');
  }, [initSession]);

  const changeLanguage = useCallback(async (newLang: SupportedLanguage) => {
    setSelectedLanguage(newLang);
    if (session) {
      try {
        await caseTakingApi.updateLanguage(session.sessionId, newLang);
        setSession((prev) => prev ? { ...prev, selectedLanguage: newLang } : null);
      } catch (err: any) {
        console.warn('Failed to update language on backend:', err);
      }
    }
  }, [session]);

  const submitTextTurn = useCallback(async (text: string) => {
    if (!session || !text.trim()) return;

    try {
      setIsProcessingTurn(true);
      setError(null);

      // Optimistically show user message
      const optimisticTurn: ConversationTurn = {
        id: `turn-opt-${Date.now()}`,
        role: 'patient',
        text: text.trim(),
        source: 'TEXT',
        timestamp: new Date().toISOString(),
        language: selectedLanguage,
      };

      setSession((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          conversationHistory: [...prev.conversationHistory, optimisticTurn],
        };
      });

      const res = await caseTakingApi.sendTextTurn(session.sessionId, text.trim());
      
      // Fetch refreshed full session
      const refreshed = await caseTakingApi.getSession(session.sessionId);
      setSession(refreshed);

      if (res.audioBase64) {
        setLatestAudio({
          base64: res.audioBase64,
          mimeType: res.mimeType || 'audio/wav',
        });
      }
    } catch (err: any) {
      console.error('Submit text turn error:', err);
      setError(err.message || 'Failed to send your message. Please try again.');
    } finally {
      setIsProcessingTurn(false);
    }
  }, [session, selectedLanguage]);

  const submitVoiceTurn = useCallback(async (audioBlob: Blob) => {
    if (!session) return;

    try {
      setIsProcessingTurn(true);
      setError(null);

      const res = await caseTakingApi.sendAudioTurn(session.sessionId, audioBlob);
      
      const refreshed = await caseTakingApi.getSession(session.sessionId);
      setSession(refreshed);

      if (res.audioBase64) {
        setLatestAudio({
          base64: res.audioBase64,
          mimeType: res.mimeType || 'audio/wav',
        });
      }
    } catch (err: any) {
      console.error('Submit voice turn error:', err);
      setError(err.message || 'Could not process your voice recording. You can also type your symptoms.');
    } finally {
      setIsProcessingTurn(false);
    }
  }, [session]);

  const submitPersonalizedAnswers = useCallback(async (sarvamAnswer: string, geminiAnswer: string) => {
    if (!session) return;

    try {
      setIsProcessingTurn(true);
      setError(null);

      const res = await caseTakingApi.submitPersonalizedAnswers(session.sessionId, {
        sarvamAnswer,
        geminiAnswer,
      });

      setSession(res.session);
    } catch (err: any) {
      console.error('Submit personalized answers error:', err);
      setError(err.message || 'Failed to record your answers.');
    } finally {
      setIsProcessingTurn(false);
    }
  }, [session]);

  const finalizeCase = useCallback(async () => {
    if (!session) return;

    try {
      setIsLoading(true);
      setError(null);

      const res = await caseTakingApi.finalizeCase(session.sessionId);
      setFinalizedPayload(res.clinicalPipelinePayload);
      
      setSession((prev) => prev ? { ...prev, status: 'finalized' } : null);
    } catch (err: any) {
      console.error('Finalize case error:', err);
      setError(err.message || 'Failed to finalize case.');
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  return {
    session,
    isLoading,
    isProcessingTurn,
    error,
    setError,
    selectedLanguage,
    latestAudio,
    finalizedPayload,
    changeLanguage,
    submitTextTurn,
    submitVoiceTurn,
    submitPersonalizedAnswers,
    finalizeCase,
    startNewSession: () => initSession(selectedLanguage),
  };
}
