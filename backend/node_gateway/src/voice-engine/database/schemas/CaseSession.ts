import mongoose, { Schema, Document } from 'mongoose';
import type { CaseSession as ICaseSession } from '../../types/index.js';

export interface CaseSessionDocument extends Omit<ICaseSession, 'id'>, Document {}

const SymptomDetailSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  severity: { type: String },
  onset: { type: String },
  duration: { type: String },
  location: { type: String },
  character: { type: String },
  source: { type: String, enum: ['VOICE', 'TEXT'], default: 'VOICE' },
  evidence: { type: String },
}, { _id: false });

const PatientCaseDataSchema = new Schema({
  chiefComplaint: { type: String, default: null },
  symptoms: { type: [SymptomDetailSchema], default: [] },
  onset: { type: String, default: null },
  duration: { type: String, default: null },
  location: { type: String, default: null },
  severity: { type: String, default: null },
  frequency: { type: String, default: null },
  progression: { type: String, default: null },
  triggeringFactors: { type: [String], default: [] },
  relievingFactors: { type: [String], default: [] },
  associatedSymptoms: { type: [String], default: [] },
  medicalHistory: { type: [String], default: [] },
  medications: { type: [String], default: [] },
  allergies: { type: [String], default: [] },
  previousTreatment: { type: [String], default: [] },
  familyHistory: { type: [String], default: [] },
  patientConcerns: { type: [String], default: [] },
}, { _id: false });

const ConversationTurnSchema = new Schema({
  id: { type: String, required: true },
  role: { type: String, enum: ['patient', 'assistant', 'system'], required: true },
  text: { type: String, required: true },
  audioBase64: { type: String },
  mimeType: { type: String },
  source: { type: String, enum: ['VOICE', 'TEXT', 'SYSTEM'], default: 'TEXT' },
  timestamp: { type: String, required: true },
  questionTopic: { type: String },
  language: { type: String },
}, { _id: false });

const PersonalizedQuestionSchema = new Schema({
  source: { type: String, enum: ['sarvam', 'gemini'], required: true },
  questionId: { type: String, required: true },
  question: { type: String, required: true },
  answer: { type: String, default: null },
  answeredAt: { type: String },
  category: { type: String },
}, { _id: false });

const CaseSessionSchema = new Schema<CaseSessionDocument>({
  sessionId: { type: String, required: true, unique: true, index: true },
  caseId: { type: String, required: true, index: true },
  patientId: { type: String, required: true, default: 'PAT-1001' },
  status: { 
    type: String, 
    enum: ['active', 'awaiting_personalized_questions', 'review', 'finalized', 'failed'], 
    default: 'active' 
  },
  selectedLanguage: { type: String, default: 'hi' },
  detectedLanguage: { type: String, default: null },
  conversationLanguage: { type: String, default: 'hi' },
  conversationHistory: { type: [ConversationTurnSchema], default: [] },
  patientCase: { type: PatientCaseDataSchema, default: () => ({}) },
  knownFacts: { type: Schema.Types.Mixed, default: {} },
  askedQuestions: { type: [Schema.Types.Mixed] as any, default: [] },
  answeredTopics: { type: [String], default: [] },
  missingInformation: { type: [String], default: [] },
  clarificationCountPerTopic: { type: Schema.Types.Mixed, default: {} },
  personalizedQuestions: {
    sarvam: { type: PersonalizedQuestionSchema, default: null },
    gemini: { type: PersonalizedQuestionSchema, default: null },
  },
  clinicalPipelinePayload: { type: Schema.Types.Mixed },
  createdAt: { type: String, default: () => new Date().toISOString() },
  updatedAt: { type: String, default: () => new Date().toISOString() },
});

export const CaseSessionModel = mongoose.model<CaseSessionDocument>('CaseSession', CaseSessionSchema);
