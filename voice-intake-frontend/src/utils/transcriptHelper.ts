import type { CaseSession } from '../types/index.js';

export function formatConversationTranscript(session: CaseSession): string {
  const dateStr = new Date(session.createdAt || Date.now()).toLocaleString();
  const turns = session.conversationHistory || [];

  const lines: string[] = [
    '======================================================================',
    '                   CLINICAL INTAKE CONVERSATION TRANSCRIPT            ',
    '======================================================================',
    `Case ID        : ${session.caseId}`,
    `Patient ID     : ${session.patientId}`,
    `Language       : ${session.selectedLanguage}`,
    `Date & Time    : ${dateStr}`,
    `Total Messages : ${turns.length}`,
    '======================================================================',
    '',
    '--- FULL DIALOGUE ---',
    '',
  ];

  turns.forEach((t, i) => {
    const speaker = t.role === 'patient' ? 'You (Patient)' : 'Intake Assistant';
    const mode = t.source || 'VOICE';
    lines.push(`[${i + 1}] ${speaker} (${mode}):`);
    lines.push(`"${t.text}"`);
    lines.push('');
  });

  // Include personalized follow-up Q&A if present
  const sarvamPQ = session.personalizedQuestions?.sarvam;
  const geminiPQ = session.personalizedQuestions?.gemini;

  if (sarvamPQ || geminiPQ) {
    lines.push('--- PERSONALIZED FOLLOW-UP QUESTIONS ---');
    lines.push('');
    if (sarvamPQ) {
      lines.push(`Follow-up Question 1: ${sarvamPQ.question}`);
      lines.push(`Patient Answer      : ${sarvamPQ.answer || 'Not answered'}`);
      lines.push('');
    }
    if (geminiPQ) {
      lines.push(`Follow-up Question 2: ${geminiPQ.question}`);
      lines.push(`Patient Answer      : ${geminiPQ.answer || 'Not answered'}`);
      lines.push('');
    }
  }

  // Summary of facts
  const pc = session.patientCase;
  lines.push('======================================================================');
  lines.push('                     SUMMARY OF CLINICAL FACTS                        ');
  lines.push('======================================================================');
  lines.push(`Chief Complaint  : ${pc.chiefComplaint || 'Not specified'}`);
  lines.push(`Duration / Onset : ${pc.duration || 'Not specified'}`);
  lines.push(`Location         : ${pc.location || 'Not specified'}`);
  lines.push(`Severity         : ${pc.severity || 'Not specified'}`);
  lines.push(`Medications      : ${pc.medications.length ? pc.medications.join(', ') : 'None reported'}`);
  lines.push(`Allergies        : ${pc.allergies.length ? pc.allergies.join(', ') : 'None reported'}`);
  lines.push(`Medical History  : ${pc.medicalHistory.length ? pc.medicalHistory.join(', ') : 'None reported'}`);
  lines.push('======================================================================');

  return lines.join('\n');
}

export function downloadTranscriptFile(session: CaseSession) {
  const text = formatConversationTranscript(session);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `intake-transcript-${session.caseId}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
