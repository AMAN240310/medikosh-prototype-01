import type { CaseSession, SupportedLanguage } from '../types/index.js';

const GATEWAY_HOST =
  typeof window !== 'undefined'
    ? (window.location.port === '3000'
        ? `${window.location.protocol}//${window.location.hostname}:5000`
        : window.location.origin)
    : 'http://localhost:5000';

const API_BASE = `${GATEWAY_HOST}/api/case-taking`;
const INTAKE_API_BASE = `${GATEWAY_HOST}/api/intake`;

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
  };
}

export const caseTakingApi = {
  async startSession(selectedLanguage: SupportedLanguage = 'hi'): Promise<{
    session: CaseSession;
    initialGreeting: string;
    audioBase64?: string;
    mimeType?: string;
  }> {
    const res = await fetch(`${API_BASE}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedLanguage }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message || 'Failed to start session');
    return json.data;
  },

  async getSession(sessionId: string): Promise<CaseSession> {
    const res = await fetch(`${API_BASE}/session/${sessionId}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message || 'Failed to fetch session');
    return json.data;
  },

  async sendAudioTurn(
    sessionId: string,
    audioBlob: Blob
  ): Promise<{
    sessionId: string;
    transcript: string;
    detectedLanguage?: string;
    assistantMessage: string;
    audioBase64?: string;
    mimeType?: string;
    questionTopic?: string;
    status: any;
    isComplete: boolean;
    knownFacts: Record<string, any>;
    missingInformation: string[];
    progress: any;
  }> {
    const formData = new FormData();
    const ext = audioBlob.type.includes('wav') ? 'wav' : 'webm';
    formData.append('audio', audioBlob, `speech.${ext}`);

    const res = await fetch(`${API_BASE}/session/${sessionId}/audio`, {
      method: 'POST',
      body: formData,
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message || 'Failed to process voice turn');
    return json.data;
  },

  async sendTextTurn(
    sessionId: string,
    text: string
  ): Promise<{
    sessionId: string;
    assistantMessage: string;
    audioBase64?: string;
    mimeType?: string;
    questionTopic?: string;
    status: any;
    isComplete: boolean;
    knownFacts: Record<string, any>;
    missingInformation: string[];
    progress: any;
  }> {
    const res = await fetch(`${API_BASE}/session/${sessionId}/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message || 'Failed to process text turn');
    return json.data;
  },

  async updateLanguage(sessionId: string, language: SupportedLanguage): Promise<void> {
    const res = await fetch(`${API_BASE}/session/${sessionId}/language`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message || 'Failed to update language');
  },

  async submitPersonalizedAnswers(
    sessionId: string,
    answers: { sarvamAnswer?: string; geminiAnswer?: string }
  ): Promise<{ session: CaseSession; status: any }> {
    const res = await fetch(`${API_BASE}/session/${sessionId}/personalized-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(answers),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message || 'Failed to submit answers');
    return json.data;
  },

  async finalizeCase(sessionId: string): Promise<{
    sessionId: string;
    caseId: string;
    status: any;
    clinicalPipelinePayload: any;
    message: string;
  }> {
    const res = await fetch(`${API_BASE}/session/${sessionId}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message || 'Failed to finalize case');
    return json.data;
  },

  async synthesizeAudio(text: string, language: string): Promise<{ audioBase64: string; mimeType: string }> {
    const res = await fetch(`${API_BASE}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message || 'Failed to synthesize speech');
    return json.data;
  },

  async processFullIntake(formData: FormData): Promise<any> {
    const res = await fetch(`${INTAKE_API_BASE}/process`, {
      method: 'POST',
      body: formData,
    });
    const json = await res.json();
    return json;
  },

  async structureIntake(formData: FormData): Promise<any> {
    const res = await fetch(`${INTAKE_API_BASE}/structure`, {
      method: 'POST',
      body: formData,
    });
    const json = await res.json();
    return json;
  },

  async allocateDoctor(payload: {
    clinicalSummary: string;
    chiefComplaint?: string;
    patientId?: string;
    patientName?: string;
    patientPhone?: string;
    patientAge?: number;
    patientGender?: string;
    patientBloodType?: string;
    structuredExtraction?: any;
    rxnormResults?: any[];
    documentText?: string;
    followupAnswers?: Array<{ question: string; answer: string }>;
    [key: string]: any;
  }): Promise<any> {
    const res = await fetch(`${INTAKE_API_BASE}/allocate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    return json;
  },
};
