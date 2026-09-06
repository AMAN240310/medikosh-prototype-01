import { Request, Response } from 'express';
import { db } from '../database/db.js';
import { transcribeAudio } from '../services/sarvamSTT.js';
import { synthesizeSpeech } from '../services/sarvamTTS.js';
import { conversationEngine } from '../services/conversationEngine.js';
import { exportToClinicalPipeline } from '../services/clinicalPipeline.js';
import type { CaseSession, ConversationTurn, SupportedLanguage } from '../types/index.js';

const GREETINGS: Record<SupportedLanguage, string> = {
  hi: 'नमस्ते। मैं आपका मेडीकेयर स्वास्थ्य सहायक हूँ। आज आप कैसा महसूस कर रहे हैं, या मैं आपके स्वास्थ्य में आपकी क्या मदद कर सकता हूँ?',
  en: 'Hello! I am your MediCare health assistant. How are you feeling today, or how can I help you with your symptoms?',
  bn: 'নমস্কার। আমি আপনার স্বাস্থ্য সহকারী। আজ আপনি কেমন অনুভব করছেন, বা আমি কীভাবে আপনাকে সাহায্য করতে পারি?',
  ta: 'வணக்கம்! நான் உங்கள் சுகாதார உதவியாளர். இன்று நீங்கள் எப்படி உணர்கிறீர்கள், நான் உங்களுக்கு எப்படி உதவ முடியும்?',
  te: 'నమస్కారం! నేను మీ ఆరోగ్య సహాయకుడిని. ఈ రోజు మీరు ఎలా ఉన్నారు, నేను మీకు ఎలా సహాయపడగలను?',
  kn: 'ನಮಸ್ಕಾರ! ನಾನು ನಿಮ್ಮ ಆರೋಗ್ಯ ಸಹಾಯಕ. ಇಂದು ನೀವು ಹೇಗಿದ್ದೀರಿ, ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?',
  ml: 'നമസ്കാരം! ഞാൻ നിങ്ങളുടെ ആരോഗ്യ സഹായിയാണ്. ഇന്ന് നിങ്ങൾക്ക് എങ്ങനെയുണ്ട്, എനിക്ക് എങ്ങനെ സഹായിക്കാനാകും?',
  mr: 'नमस्कार! मी तुमचा आरोग्य सहाय्यक आहे. आज तुम्हाला कसे वाटत आहे, किंवा मी तुम्हाला कशी मदत करू शकतो?',
  gu: 'નમસ્તે! હું તમારો આરોગ્ય સહાયક છું. આજે તમે કેવું અનુભવી રહ્યા છો, હું તમને કેવી રીતે મદદ કરી શકું?',
  pa: 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ! ਮੈਂ ਤੁਹਾਡਾ ਸਿਹਤ ਸਹਾਇਕ ਹਾਂ। ਅੱਜ ਤੁਸੀਂ ਕਿਵੇਂ ਮਹਿਸੂਸ ਕਰ ਰਹੇ ਹੋ, ਮੈਂ ਤੁਹਾਡੀ ਕੀ ਮਦਦ ਕਰ ਸਕਦਾ ਹਾਂ?',
  od: 'ନମସ୍କାର! ମୁଁ ଆପଣଙ୍କ ସ୍ୱାସ୍ଥ୍ୟ ସହାୟକ। ଆଜି ଆପଣ କିପରି ଅନୁଭବ କରୁଛନ୍ତି, ମୁଁ ଆପଣଙ୍କୁ କିପରି ସାହାଯ୍ୟ କରିପାରିବି?',
};

export class CaseTakingController {
  async startSession(req: Request, res: Response) {
    try {
      const selectedLanguage: SupportedLanguage = req.body.selectedLanguage || 'hi';
      const patientId = req.body.patientId || `PAT-${Math.floor(1000 + Math.random() * 9000)}`;
      const sessionId = `sess-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const caseId = `CASE-${Date.now().toString().slice(-6)}`;

      const initialGreeting = GREETINGS[selectedLanguage] || GREETINGS.hi;
      const ttsResult = await synthesizeSpeech(initialGreeting, selectedLanguage);

      const initialTurn: ConversationTurn = {
        id: `turn-init-${Date.now()}`,
        role: 'assistant',
        text: initialGreeting,
        audioBase64: ttsResult?.audioBase64,
        mimeType: ttsResult?.mimeType,
        source: 'VOICE',
        timestamp: new Date().toISOString(),
        questionTopic: 'greeting',
        language: selectedLanguage,
      };

      const session: CaseSession = {
        sessionId,
        caseId,
        patientId,
        status: 'active',
        selectedLanguage,
        detectedLanguage: null,
        conversationLanguage: selectedLanguage,
        conversationHistory: [initialTurn],
        patientCase: {
          chiefComplaint: null,
          symptoms: [],
          onset: null,
          duration: null,
          location: null,
          severity: null,
          frequency: null,
          progression: null,
          triggeringFactors: [],
          relievingFactors: [],
          associatedSymptoms: [],
          medicalHistory: [],
          medications: [],
          allergies: [],
          previousTreatment: [],
          familyHistory: [],
          patientConcerns: [],
        },
        knownFacts: {},
        askedQuestions: [{ id: 'q-init', topic: 'chief_complaint', question: initialGreeting, turnIndex: 0 }],
        answeredTopics: [],
        missingInformation: ['chief_complaint', 'duration', 'location', 'severity'],
        clarificationCountPerTopic: {},
        personalizedQuestions: {
          sarvam: null,
          gemini: null,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await db.saveSession(session);

      return res.status(201).json({
        success: true,
        data: {
          session,
          initialGreeting,
          audioBase64: ttsResult?.audioBase64,
          mimeType: ttsResult?.mimeType,
        },
      });
    } catch (err: any) {
      console.error('[StartSession Error]:', err);
      return res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  async getSession(req: Request, res: Response) {
    try {
      const sessionId = req.params.sessionId as string;
      const session = await db.getSession(sessionId);

      if (!session) {
        return res.status(404).json({
          success: false,
          error: { message: `Session ${sessionId} not found` },
        });
      }

      return res.json({ success: true, data: session });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  async handleAudioTurn(req: Request, res: Response) {
    try {
      const sessionId = req.params.sessionId as string;
      const session = await db.getSession(sessionId);

      if (!session) {
        return res.status(404).json({ success: false, error: { message: 'Session not found' } });
      }

      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          success: false,
          error: { message: 'No audio file provided or invalid audio format.' },
        });
      }

      // Transcribe via Sarvam STT
      const sttResult = await transcribeAudio(
        req.file.buffer,
        req.file.mimetype,
        session.selectedLanguage
      );

      if (!sttResult.transcript || sttResult.transcript.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'Could not hear any speech. Please try speaking again or type your symptoms.' },
        });
      }

      // If Sarvam detected a language, preserve it
      if (sttResult.languageCode) {
        session.detectedLanguage = sttResult.languageCode;
      }

      // Process Turn in conversation engine
      const turnResult = await conversationEngine.processTurn(
        session,
        sttResult.transcript,
        'VOICE'
      );

      return res.json({
        success: true,
        data: {
          ...turnResult,
          transcript: sttResult.transcript,
          detectedLanguage: sttResult.languageCode,
        },
      });
    } catch (err: any) {
      console.error('[AudioTurn Error]:', err.message);
      const friendlyMessage = err.message?.includes('audio format')
        ? 'Speech recording was unclear or too short. Please speak clearly for a moment or type your symptoms.'
        : err.message || 'Failed to process voice input.';
      return res.status(400).json({ success: false, error: { message: friendlyMessage } });
    }
  }

  async handleTextTurn(req: Request, res: Response) {
    try {
      const sessionId = req.params.sessionId as string;
      const { text } = req.body;

      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'Text input cannot be empty.' },
        });
      }

      const session = await db.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: { message: 'Session not found' } });
      }

      const turnResult = await conversationEngine.processTurn(
        session,
        text.trim(),
        'TEXT'
      );

      return res.json({ success: true, data: turnResult });
    } catch (err: any) {
      console.error('[TextTurn Error]:', err);
      return res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  async updateLanguage(req: Request, res: Response) {
    try {
      const sessionId = req.params.sessionId as string;
      const { language } = req.body;

      const session = await db.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: { message: 'Session not found' } });
      }

      session.selectedLanguage = language;
      session.conversationLanguage = language;
      await db.saveSession(session);

      return res.json({ success: true, data: { selectedLanguage: language } });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  async answerPersonalizedQuestions(req: Request, res: Response) {
    try {
      const sessionId = req.params.sessionId as string;
      const { sarvamAnswer, geminiAnswer } = req.body;

      const session = await db.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: { message: 'Session not found' } });
      }

      if (session.personalizedQuestions.sarvam && sarvamAnswer) {
        session.personalizedQuestions.sarvam.answer = sarvamAnswer;
        session.personalizedQuestions.sarvam.answeredAt = new Date().toISOString();
        
        session.conversationHistory.push({
          id: `pq-turn-1-${Date.now()}`,
          role: 'patient',
          text: `[Follow-up 1 Response]: ${sarvamAnswer}`,
          source: 'TEXT',
          timestamp: new Date().toISOString(),
        });
      }

      if (session.personalizedQuestions.gemini && geminiAnswer) {
        session.personalizedQuestions.gemini.answer = geminiAnswer;
        session.personalizedQuestions.gemini.answeredAt = new Date().toISOString();

        session.conversationHistory.push({
          id: `pq-turn-2-${Date.now()}`,
          role: 'patient',
          text: `[Follow-up 2 Response]: ${geminiAnswer}`,
          source: 'TEXT',
          timestamp: new Date().toISOString(),
        });
      }

      session.status = 'review';
      await db.saveSession(session);

      return res.json({
        success: true,
        data: {
          session,
          status: session.status,
          message: 'Personalized answers recorded. Ready for case review.',
        },
      });
    } catch (err: any) {
      console.error('[PersonalizedAnswer Error]:', err);
      return res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  async synthesizeAudio(req: Request, res: Response) {
    try {
      const { text, language = 'hi' } = req.body;
      if (!text) {
        return res.status(400).json({ success: false, error: { message: 'Text required' } });
      }

      const result = await synthesizeSpeech(text, language);
      return res.json({ success: true, data: result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: { message: err.message } });
    }
  }

  async finalizeCase(req: Request, res: Response) {
    try {
      const sessionId = req.params.sessionId as string;
      const session = await db.getSession(sessionId);

      if (!session) {
        return res.status(404).json({ success: false, error: { message: 'Session not found' } });
      }

      // Export structured case to Clinical Pipeline
      const pipelinePayload = await exportToClinicalPipeline(session);
      session.clinicalPipelinePayload = pipelinePayload;
      session.status = 'finalized';

      await db.saveSession(session);

      return res.json({
        success: true,
        data: {
          sessionId: session.sessionId,
          caseId: session.caseId,
          status: session.status,
          clinicalPipelinePayload: pipelinePayload,
          message: 'Case intake finalized and structured clinical record dispatched to clinical pipeline.',
        },
      });
    } catch (err: any) {
      console.error('[FinalizeCase Error]:', err);
      return res.status(500).json({ success: false, error: { message: err.message } });
    }
  }
}

export const caseTakingController = new CaseTakingController();
