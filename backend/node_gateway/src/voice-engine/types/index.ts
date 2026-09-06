export type SupportedLanguage = 
  | 'en' // English
  | 'hi' // Hindi (हिन्दी)
  | 'bn' // Bengali (বাংলা)
  | 'ta' // Tamil (தமிழ்)
  | 'te' // Telugu (తెలుగు)
  | 'kn' // Kannada (ಕನ್ನಡ)
  | 'ml' // Malayalam (മലയാളം)
  | 'mr' // Marathi (मराठी)
  | 'gu' // Gujarati (ગુજરાતી)
  | 'pa' // Punjabi (ਪੰਜਾਬੀ)
  | 'od'; // Odia (ଓଡ଼ିଆ)

export interface LanguageInfo {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
  sarvamCode: string;
}

export const SUPPORTED_LANGUAGES: LanguageInfo[] = [
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', sarvamCode: 'hi-IN' },
  { code: 'en', name: 'English', nativeName: 'English', sarvamCode: 'en-IN' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', sarvamCode: 'bn-IN' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', sarvamCode: 'ta-IN' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', sarvamCode: 'te-IN' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', sarvamCode: 'kn-IN' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', sarvamCode: 'ml-IN' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', sarvamCode: 'mr-IN' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', sarvamCode: 'gu-IN' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', sarvamCode: 'pa-IN' },
  { code: 'od', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', sarvamCode: 'od-IN' },
];

export interface SymptomDetail {
  id: string;
  name: string;
  severity?: string;
  onset?: string;
  duration?: string;
  location?: string;
  character?: string;
  source: 'VOICE' | 'TEXT';
  evidence?: string;
}

export interface PatientCaseData {
  chiefComplaint: string | null;
  symptoms: SymptomDetail[];
  onset: string | null;
  duration: string | null;
  location: string | null;
  severity: string | null;
  frequency: string | null;
  progression: string | null;
  triggeringFactors: string[];
  relievingFactors: string[];
  associatedSymptoms: string[];
  medicalHistory: string[];
  medications: string[];
  allergies: string[];
  previousTreatment: string[];
  familyHistory: string[];
  patientConcerns: string[];
}

export interface ConversationTurn {
  id: string;
  role: 'patient' | 'assistant' | 'system';
  text: string;
  audioBase64?: string;
  mimeType?: string;
  source: 'VOICE' | 'TEXT' | 'SYSTEM';
  timestamp: string;
  questionTopic?: string;
  language?: string;
}

export type SessionStatus = 
  | 'active'
  | 'awaiting_personalized_questions'
  | 'review'
  | 'finalized'
  | 'failed';

export interface PersonalizedQuestion {
  source: 'sarvam' | 'gemini';
  questionId: string;
  question: string;
  answer: string | null;
  answeredAt?: string;
  category?: string;
}

export interface CaseSession {
  sessionId: string;
  caseId: string;
  patientId: string;
  status: SessionStatus;
  selectedLanguage: SupportedLanguage;
  detectedLanguage: string | null;
  conversationLanguage: string;
  conversationHistory: ConversationTurn[];
  patientCase: PatientCaseData;
  knownFacts: Record<string, any>;
  askedQuestions: Array<{ id: string; topic: string; question: string; turnIndex: number }>;
  answeredTopics: string[];
  missingInformation: string[];
  clarificationCountPerTopic: Record<string, number>;
  personalizedQuestions: {
    sarvam: PersonalizedQuestion | null;
    gemini: PersonalizedQuestion | null;
  };
  clinicalPipelinePayload?: any;
  createdAt: string;
  updatedAt: string;
}

export interface TurnResult {
  sessionId: string;
  transcript?: string;
  detectedLanguage?: string;
  assistantMessage: string;
  audioBase64?: string;
  mimeType?: string;
  questionTopic?: string;
  status: SessionStatus;
  isComplete: boolean;
  knownFacts: Record<string, any>;
  missingInformation: string[];
  progress: {
    stage: string;
    step: number;
    totalSteps: number;
  };
}
