import { ENV } from '../config/env.js';
import type { CaseSession } from '../types/index.js';

export interface ClinicalPipelinePayload {
  caseId: string;
  patientId: string;
  timestamp: string;
  intakeSource: 'VOICE_ASSISTANT';
  conversationMetrics: {
    language: string;
    totalTurns: number;
    audioTurnsCount: number;
  };
  patientCase: {
    chiefComplaint: string | null;
    symptoms: Array<{
      id: string;
      name: string;
      severity?: string;
      duration?: string;
      location?: string;
      character?: string;
      source: 'VOICE' | 'TEXT';
      evidence?: string;
    }>;
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
  };
  personalizedQuestions: {
    sarvam: {
      question: string;
      answer: string | null;
      category?: string;
    } | null;
    gemini: {
      question: string;
      answer: string | null;
      category?: string;
    } | null;
  };
  clinicalPipelineStatus: {
    status: 'DISPATCHED' | 'LOCAL_PERSISTED' | 'FORWARDED';
    destination: string;
    dispatchedAt: string;
  };
}

export async function exportToClinicalPipeline(session: CaseSession): Promise<ClinicalPipelinePayload> {
  const audioTurns = session.conversationHistory.filter((t) => t.source === 'VOICE').length;

  const payload: ClinicalPipelinePayload = {
    caseId: session.caseId,
    patientId: session.patientId,
    timestamp: new Date().toISOString(),
    intakeSource: 'VOICE_ASSISTANT',
    conversationMetrics: {
      language: session.selectedLanguage,
      totalTurns: session.conversationHistory.length,
      audioTurnsCount: audioTurns,
    },
    patientCase: {
      chiefComplaint: session.patientCase.chiefComplaint,
      symptoms: session.patientCase.symptoms,
      onset: session.patientCase.onset,
      duration: session.patientCase.duration,
      location: session.patientCase.location,
      severity: session.patientCase.severity,
      frequency: session.patientCase.frequency,
      progression: session.patientCase.progression,
      triggeringFactors: session.patientCase.triggeringFactors,
      relievingFactors: session.patientCase.relievingFactors,
      associatedSymptoms: session.patientCase.associatedSymptoms,
      medicalHistory: session.patientCase.medicalHistory,
      medications: session.patientCase.medications,
      allergies: session.patientCase.allergies,
      previousTreatment: session.patientCase.previousTreatment,
      familyHistory: session.patientCase.familyHistory,
      patientConcerns: session.patientCase.patientConcerns,
    },
    personalizedQuestions: {
      sarvam: session.personalizedQuestions.sarvam ? {
        question: session.personalizedQuestions.sarvam.question,
        answer: session.personalizedQuestions.sarvam.answer,
        category: session.personalizedQuestions.sarvam.category,
      } : null,
      gemini: session.personalizedQuestions.gemini ? {
        question: session.personalizedQuestions.gemini.question,
        answer: session.personalizedQuestions.gemini.answer,
        category: session.personalizedQuestions.gemini.category,
      } : null,
    },
    clinicalPipelineStatus: {
      status: 'LOCAL_PERSISTED',
      destination: ENV.CLINICAL_PIPELINE_URL,
      dispatchedAt: new Date().toISOString(),
    },
  };

  // Attempt forward to external clinical pipeline if URL reachable
  try {
    const response = await fetch(ENV.CLINICAL_PIPELINE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });

    if (response.ok) {
      payload.clinicalPipelineStatus.status = 'FORWARDED';
      console.log(`✅ [Clinical Pipeline] Case ${session.caseId} successfully forwarded to ${ENV.CLINICAL_PIPELINE_URL}`);
    } else {
      payload.clinicalPipelineStatus.status = 'DISPATCHED';
    }
  } catch (e: any) {
    console.log(`ℹ️ [Clinical Pipeline] External endpoint not reachable (${e.message}). Saved locally in unified format.`);
    payload.clinicalPipelineStatus.status = 'LOCAL_PERSISTED';
  }

  return payload;
}
