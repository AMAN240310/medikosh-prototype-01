import dotenv from 'dotenv';
dotenv.config();

export const ENV = {
  PORT: parseInt(process.env.PORT || '5050', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/voice_case_taking',

  // Sarvam AI credentials & models
  SARVAM_API_KEY: process.env.SARVAM_API_KEY || '',
  SARVAM_STT_MODEL: process.env.SARVAM_STT_MODEL || 'saaras:v3',
  SARVAM_CHAT_MODEL: process.env.SARVAM_CHAT_MODEL || 'sarvam-105b-conversations',
  SARVAM_TTS_MODEL: process.env.SARVAM_TTS_MODEL || 'bulbul:v3',
  SARVAM_TTS_SPEAKER: process.env.SARVAM_TTS_SPEAKER || 'shubh',

  // Gemini AI credentials & model (Question 2 only)
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',

  // Clinical Pipeline URL
  CLINICAL_PIPELINE_URL: process.env.CLINICAL_PIPELINE_URL || 'http://localhost:8000/pipeline/run',
};
