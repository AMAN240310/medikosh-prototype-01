import { Router } from 'express';
import { caseTakingController } from '../controllers/caseTakingController.js';
import { audioUpload } from '../middleware/audioUpload.js';

const router = Router();

// 1. Session Lifecycle
router.post('/session', (req, res) => caseTakingController.startSession(req, res));
router.get('/session/:sessionId', (req, res) => caseTakingController.getSession(req, res));

// 2. Multimodal Inputs (Voice / Text)
router.post(
  '/session/:sessionId/audio',
  audioUpload.single('audio'),
  (req, res) => caseTakingController.handleAudioTurn(req, res)
);
router.post('/session/:sessionId/text', (req, res) => caseTakingController.handleTextTurn(req, res));

// 3. Language Selection & Overrides
router.post('/session/:sessionId/language', (req, res) => caseTakingController.updateLanguage(req, res));

// 4. Personalized Follow-up Questions (Sarvam Q1 + Gemini Q2)
router.post(
  '/session/:sessionId/personalized-questions',
  (req, res) => caseTakingController.answerPersonalizedQuestions(req, res)
);

// 5. Direct Audio TTS
router.post('/tts', (req, res) => caseTakingController.synthesizeAudio(req, res));

// 6. Case Finalization & Clinical Pipeline Dispatch
router.post('/session/:sessionId/finalize', (req, res) => caseTakingController.finalizeCase(req, res));

export default router;
