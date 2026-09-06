import { useEffect, useState } from 'react';
import { Header } from './components/Header.js';
import { ConversationArea } from './components/ConversationArea.js';
import { VoiceControls } from './components/VoiceControls.js';
import { TextInput } from './components/TextInput.js';
import { PersonalizedQuestionsModal } from './components/PersonalizedQuestionsModal.js';
import { CaseReviewModal } from './components/CaseReviewModal.js';
import { ClinicalSubmissionView } from './components/ClinicalSubmissionView.js';
import { ErrorBanner } from './components/ErrorBanner.js';
import { useCaseSession } from './hooks/useCaseSession.js';
import { useVoiceRecorder } from './hooks/useVoiceRecorder.js';
import { useAudioPlayer } from './hooks/useAudioPlayer.js';

export default function App() {
  const [isHandsFree, setIsHandsFree] = useState<boolean>(true);

  const {
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
    startNewSession,
  } = useCaseSession();

  const {
    state: recorderState,
    errorMessage: recorderError,
    audioLevel,
    recordingSeconds,
    startRecording,
    stopRecording,
    cancelRecording,
    resetToReady,
  } = useVoiceRecorder({
    onRecordingComplete: async (blob) => {
      try {
        await submitVoiceTurn(blob);
      } finally {
        resetToReady();
      }
    },
  });

  const { isPlaying, currentlyPlayingId, playBase64, stopAudio } = useAudioPlayer({
    onPlaybackEnded: () => {
      // When AI finishes speaking the question, if hands-free is enabled, auto-start listening!
      if (isHandsFree && session?.status === 'active') {
        setTimeout(() => {
          startRecording();
        }, 400);
      }
    },
  });

  // Auto-play assistant responses when new TTS audio arrives
  useEffect(() => {
    if (latestAudio?.base64) {
      playBase64(latestAudio.base64, latestAudio.mimeType);
    }
  }, [latestAudio, playBase64]);

  const handleTextSubmit = async (text: string) => {
    stopAudio();
    await submitTextTurn(text);
    resetToReady();
  };

  const activeError = error || recorderError;

  return (
    <div className="min-h-screen bg-[#ebf1f8] flex flex-col justify-between p-4 md:p-6 antialiased">
      {/* Header with Case ID, Progress Stepper, and Language Selector (Template 3) */}
      <Header
        session={session}
        selectedLanguage={selectedLanguage}
        onLanguageChange={changeLanguage}
        onReset={startNewSession}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center w-full px-2 py-4">
        {activeError && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4">
            <ErrorBanner message={activeError} onDismiss={() => setError(null)} />
          </div>
        )}

        {isLoading && !session ? (
          <div className="neo-card-outer rounded-[2.5rem] p-10 flex flex-col items-center justify-center text-slate-500 gap-4">
            <div className="w-10 h-10 border-3 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm font-semibold">Starting voice intake session...</p>
          </div>
        ) : session?.status === 'finalized' && finalizedPayload ? (
          <ClinicalSubmissionView
            caseId={session.caseId}
            payload={finalizedPayload}
            session={session}
            onStartNew={startNewSession}
          />
        ) : session?.status === 'review' ? (
          <CaseReviewModal
            session={session}
            onFinalize={finalizeCase}
            isSubmitting={isLoading}
          />
        ) : session?.status === 'awaiting_personalized_questions' ? (
          <PersonalizedQuestionsModal
            sarvamQ={session.personalizedQuestions.sarvam}
            geminiQ={session.personalizedQuestions.gemini}
            onSubmit={submitPersonalizedAnswers}
            isSubmitting={isProcessingTurn}
          />
        ) : (
          /* Active Conversational Case Taking Stage (Template 3) */
          <section className="neo-card-outer w-full max-w-4xl rounded-[2.5rem] p-4 sm:p-6 md:p-8 border border-white/80 transition-all">
            <div className="neo-card-inner rounded-[2rem] p-5 sm:p-7 md:p-8 border border-white/50 flex flex-col justify-between space-y-6">
              
              {/* Header Row inside Card */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-bold text-slate-700">Intake Assistant</span>
                  <span className="inline-flex items-center space-x-1 bg-teal-50 border border-teal-200/70 text-teal-700 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                    <svg className="w-3.5 h-3.5 text-teal-600 animate-pulse" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M12 3v18m6-14v10M6 8v6" strokeLinecap="round" strokeLinejoin="round"></path>
                    </svg>
                    <span>Voice</span>
                  </span>
                </div>
                <span className="text-xs text-slate-400 font-medium">Auto-Transcribed Intake</span>
              </div>

              {/* Scrollable Conversation Area */}
              <div className="max-h-[340px] overflow-y-auto custom-scrollbar pr-1">
                <ConversationArea
                  turns={session?.conversationHistory || []}
                  isProcessing={isProcessingTurn || recorderState === 'PROCESSING'}
                  activePlayingId={currentlyPlayingId}
                  onPlayAudio={(base64, mime, id) => playBase64(base64, mime, id)}
                  onStopAudio={stopAudio}
                />
              </div>

              {/* Divider */}
              <div className="w-full h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent"></div>

              {/* Voice Interaction & Recording Center */}
              <VoiceControls
                state={recorderState}
                audioLevel={audioLevel}
                recordingSeconds={recordingSeconds}
                disabled={isProcessingTurn || isLoading}
                isSpeaking={isPlaying}
                isHandsFree={isHandsFree}
                onToggleHandsFree={() => setIsHandsFree((prev) => !prev)}
                onStart={startRecording}
                onStop={stopRecording}
                onCancel={cancelRecording}
              />

              {/* Bottom Inset Text Input Bar */}
              <div className="w-full max-w-xl mx-auto">
                <TextInput
                  onSend={handleTextSubmit}
                  disabled={recorderState === 'LISTENING' || isProcessingTurn || isLoading}
                  placeholder={
                    selectedLanguage === 'hi'
                      ? 'अपनी समस्या यहाँ टाइप करें या ऊपर माइक दबाकर बोलें...'
                      : 'Type symptoms or tap mic above to speak...'
                  }
                />
              </div>

            </div>
          </section>
        )}
      </main>

      {/* Accessible Footer Notice */}
      <footer className="w-full text-center py-2">
        <p className="text-[11px] text-slate-400 font-medium">
          Case Taking Intake Portal • Voice-Assisted Consultation Experience • HIPAA & NABH Compliant
        </p>
      </footer>
    </div>
  );
}
