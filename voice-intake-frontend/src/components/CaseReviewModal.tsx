import React, { useState } from 'react';
import {
  ClipboardCheck,
  CheckCircle,
  Clock,
  MapPin,
  Activity,
  Pill,
  AlertTriangle,
  Send,
  Copy,
  Check,
  FileText,
  ChevronDown,
  ChevronUp,
  Edit3,
} from 'lucide-react';
import type { CaseSession } from '../types/index.js';
import { formatConversationTranscript } from '../utils/transcriptHelper.js';

interface CaseReviewModalProps {
  session: CaseSession;
  onFinalize: () => void;
  isSubmitting?: boolean;
}

export const CaseReviewModal: React.FC<CaseReviewModalProps> = ({
  session,
  onFinalize,
  isSubmitting = false,
}) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [showTranscript, setShowTranscript] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);

  // Editable local state
  const pc = session.patientCase;
  const [chiefComplaint, setChiefComplaint] = useState<string>(pc.chiefComplaint || '');
  const [duration, setDuration] = useState<string>(pc.duration || '');
  const [severity, setSeverity] = useState<string>(pc.severity || '7');
  const [location, setLocation] = useState<string>(pc.location || '');
  const [medications, setMedications] = useState<string>(pc.medications.join(', '));
  const [allergies, setAllergies] = useState<string>(pc.allergies.join(', '));

  const handleCopy = () => {
    const text = formatConversationTranscript(session);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleProceed = () => {
    // Commit edits back to session patientCase before finalizing
    session.patientCase.chiefComplaint = chiefComplaint || session.patientCase.chiefComplaint;
    session.patientCase.duration = duration || session.patientCase.duration;
    session.patientCase.severity = severity || session.patientCase.severity;
    session.patientCase.location = location || session.patientCase.location;
    session.patientCase.medications = medications
      ? medications.split(',').map((s) => s.trim()).filter(Boolean)
      : session.patientCase.medications;
    session.patientCase.allergies = allergies
      ? allergies.split(',').map((s) => s.trim()).filter(Boolean)
      : session.patientCase.allergies;

    onFinalize();
  };

  const FactRow = ({
    label,
    value,
    icon: Icon,
  }: {
    label: string;
    value: string | null | undefined | string[];
    icon?: any;
  }) => {
    const isProvided = Array.isArray(value) ? value.length > 0 : Boolean(value);

    return (
      <div className="py-2.5 border-b border-slate-100 last:border-b-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-sm">
        <div className="flex items-center gap-2 text-slate-600 font-medium">
          {Icon && <Icon className="w-4 h-4 text-teal-600 shrink-0" />}
          <span>{label}</span>
        </div>
        <div>
          {isProvided ? (
            <span className="text-slate-900 font-semibold bg-teal-50/80 text-teal-900 px-2.5 py-1 rounded-md border border-teal-200/60 inline-block text-xs sm:text-sm">
              {Array.isArray(value) ? value.join(', ') : value}
            </span>
          ) : (
            <span className="text-slate-400 italic text-xs bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
              Not provided / Unknown
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-8 shadow-xl max-w-2xl mx-auto my-4 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-teal-600 text-white flex items-center justify-center shadow-md shadow-teal-500/20">
            <ClipboardCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Review & Verify Your Intake</h2>
            <p className="text-xs text-slate-500">
              Review your extracted symptoms. You can update any details before proceeding to doctor allocation.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsEditing(!isEditing)}
            className="px-3 py-1.5 rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-800 text-xs font-semibold transition flex items-center gap-1.5"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>{isEditing ? 'Done Editing' : 'Edit Details'}</span>
          </button>
          <span className="text-xs font-mono font-bold bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md border border-slate-200">
            {session.caseId}
          </span>
        </div>
      </div>

      {isEditing ? (
        /* Editable Mode */
        <div className="space-y-4 bg-slate-50/70 border border-slate-200 p-5 rounded-2xl text-xs">
          <div className="p-3 bg-teal-50 border border-teal-200 text-teal-900 rounded-xl">
            <strong>Edit Your Clinical Information:</strong> Make any corrections below to ensure 100% accuracy for your doctor.
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Chief Complaint *</label>
            <input
              type="text"
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 font-semibold focus:outline-none focus:border-teal-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Duration / Onset</label>
              <input
                type="text"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="e.g. 3 days"
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Severity (1 to 10)</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-teal-500"
              >
                <option value="3">3 - Mild discomfort</option>
                <option value="5">5 - Moderate pain</option>
                <option value="7">7 - Severe pain</option>
                <option value="9">9 - Very severe / Acute</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Location / Affected Area</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Right knee"
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-teal-500"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Current Medications</label>
            <input
              type="text"
              value={medications}
              onChange={(e) => setMedications(e.target.value)}
              placeholder="e.g. Paracetamol 650mg"
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-teal-500"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Known Allergies</label>
            <input
              type="text"
              value={allergies}
              onChange={(e) => setAllergies(e.target.value)}
              placeholder="e.g. Penicillin allergy"
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-teal-500"
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="px-4 py-2 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-700 transition"
            >
              Save Details & Return to Review
            </button>
          </div>
        </div>
      ) : (
        /* Read-Only Review Display */
        <div className="space-y-4">
          {/* Core Presenting Complaint */}
          <div className="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              Presenting Complaint
            </h3>
            <FactRow label="Chief Complaint" value={chiefComplaint || pc.chiefComplaint} icon={Activity} />
            <FactRow label="Duration / Onset" value={duration || pc.duration} icon={Clock} />
            <FactRow label="Location" value={location || pc.location} icon={MapPin} />
            <FactRow label="Severity" value={severity || pc.severity} />
            <FactRow label="Triggers / Relieving Factors" value={[...pc.triggeringFactors, ...pc.relievingFactors]} />
          </div>

          {/* Symptoms Breakdown */}
          {pc.symptoms.length > 0 && (
            <div className="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-4">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Reported Symptoms ({pc.symptoms.length})
              </h3>
              <div className="flex flex-wrap gap-2 pt-1">
                {pc.symptoms.map((s, idx) => (
                  <span
                    key={idx}
                    className="bg-white border border-teal-200 text-teal-800 text-xs font-medium px-3 py-1 rounded-full shadow-2xs"
                  >
                    {s.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Medical Background & Safety */}
          <div className="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              Medical Background
            </h3>
            <FactRow label="Past Medical History" value={pc.medicalHistory} />
            <FactRow label="Current Medications" value={medications || pc.medications} icon={Pill} />
            <FactRow label="Known Allergies" value={allergies || pc.allergies} icon={AlertTriangle} />
          </div>

          {/* Transcript Section */}
          <div className="bg-slate-50/90 border border-teal-200/80 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-teal-600" />
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Conversation Transcript ({session.conversationHistory?.length || 0} turns)
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-medium transition-colors shadow-2xs"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-green-600" />
                      <span className="text-green-600 font-semibold">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                      <span>Copy</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setShowTranscript(!showTranscript)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded"
                >
                  {showTranscript ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {showTranscript && (
              <div className="mt-3 bg-white border border-slate-200 rounded-xl p-3 max-h-56 overflow-y-auto text-xs space-y-2.5 font-sans">
                {(session.conversationHistory || []).map((turn, index) => {
                  const isPatient = turn.role === 'patient';
                  return (
                    <div
                      key={turn.id || index}
                      className={`p-2.5 rounded-lg ${
                        isPatient
                          ? 'bg-teal-50 border border-teal-100 text-teal-950 ml-4'
                          : 'bg-slate-50 border border-slate-200 text-slate-900 mr-4'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold text-[10px] text-slate-400 uppercase mb-1">
                        <span>{isPatient ? 'You (Patient)' : 'Intake Assistant'}</span>
                        <span>{turn.source}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{turn.text}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer / Submit */}
      <div className="pt-6 mt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <CheckCircle className="w-4 h-4 text-teal-600" />
          <span>Intake data verified • Proceeding to documents & doctor slot</span>
        </div>
        <button
          onClick={handleProceed}
          disabled={isSubmitting}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-xl shadow-md shadow-teal-600/20 transition-all disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
          <span>Proceed to Documents & Appointment</span>
        </button>
      </div>
    </div>
  );
};
