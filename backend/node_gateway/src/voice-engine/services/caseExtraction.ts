import type { PatientCaseData, SymptomDetail } from '../types/index.js';

export function extractClinicalEntities(
  text: string,
  existingCase: PatientCaseData,
  source: 'VOICE' | 'TEXT'
): PatientCaseData {
  const updated: PatientCaseData = JSON.parse(JSON.stringify(existingCase));
  const lower = text.toLowerCase();

  // 1. Duration extraction
  const durationMatch = text.match(
    /(\d+|एक|दो|तीन|चार|पाँच|1|2|3|4|5|6|7|8|9|10)\s*(दिनों|दिन|dino|din|days?|hours?|ghante|घंटे|weeks?|hafte|हफ्ते|months?|mahine|महीने|sal|years?|साल)|(kal\s+raat\s+se|कल\s+रात\s+से|kal\s+se|कल\s+से|aaj\s+subah\s+se|आज\s+सुबह\s+से|subah\s+se|सुबह\s+से|since\s+yesterday|since\s+morning|yesterday|aaj\s+se|आज\s+से|today|parso|last\s+night)/i
  );
  if (durationMatch && (!updated.duration || updated.duration === 'unspecified')) {
    updated.duration = durationMatch[0].trim();
  }

  // 2. Severity extraction
  if (!updated.severity) {
    if (/(kuchh? bhi spasht|kuchh? nahi dikh|cannot see|blurry|blind|bahut tez|bohot tez|severe|unbearable|bahut jyada|बहुत तेज|असहनीय|स्पष्ट नहीं|extreme|very high)/i.test(lower)) {
      updated.severity = 'Severe (7-10/10)';
    } else if (/(moderate|theek thaak|medium|madhyam|मध्यम)/i.test(lower)) {
      updated.severity = 'Moderate (4-6/10)';
    } else if (/(mild|thoda|halka|halka fulka|हल्का|minor)/i.test(lower)) {
      updated.severity = 'Mild (1-3/10)';
    }
  }

  // 3. Location extraction
  if (!updated.location) {
    const locMatch = text.match(
      /(pet|stomach|abdomen|chest|seena|chhati|head|sar|sir|throat|gala|back|peeth|knee|ghutna|leg|pair|arm|hath|eyes?|aankh(on|en)?|पेट|सिर|सर|गला|छाती|पीठ|घुटना|पैर|हाथ|आंखों|आँखों|आंख|आँख)/i
    );
    if (locMatch) {
      updated.location = locMatch[0].trim();
    }
  }

  // 4. Symptoms / Chief Complaint detection
  const symptomKeywords: Array<{ key: string; name: string; aliases: RegExp }> = [
    {
      key: 'vision',
      name: 'Vision Problem / Blurred Vision (आँखों में धुंधलापन / समस्या)',
      aliases: /(dhundhla|dhundhlapan|blurred|blur|vision|aankh|aankhon|धुंधला|धुंधलापन|साफ नहीं|स्पष्ट नहीं|रोशनी|आई ड्रॉप|eye drop)/i,
    },
    {
      key: 'pain',
      name: 'Pain / Ache (दर्द)',
      aliases: /(dard|pain|ache|peeda|दर्द|दुखता)/i,
    },
    {
      key: 'fever',
      name: 'Fever (बुखार)',
      aliases: /(bukhar|fever|tapman|temperature|तापमान|बुखार)/i,
    },
    {
      key: 'vomiting',
      name: 'Vomiting / Nausea (उल्टी / जी मिचलाना)',
      aliases: /(ulti|vomit|nausea|ji michlana|उल्टी|मिचलाना)/i,
    },
    {
      key: 'cough',
      name: 'Cough (खांसी)',
      aliases: /(khansi|cough|khasi|खांसी)/i,
    },
    {
      key: 'breathlessness',
      name: 'Shortness of Breath (सांस फूलना)',
      aliases: /(saans phoolna|breathless|shortness of breath|difficulty breathing|सांस लेने में दिक्कत)/i,
    },
    {
      key: 'dizziness',
      name: 'Dizziness / Vertigo (चक्कर आना)',
      aliases: /(chakkar|dizziness|giddiness|vertigo|चक्कर)/i,
    },
    {
      key: 'diarrhea',
      name: 'Diarrhea / Loose Stools (दस्त)',
      aliases: /(dast|loose motion|diarrhea|pet kharab|दस्त)/i,
    },
    {
      key: 'fatigue',
      name: 'Fatigue / Weakness (कमजोरी / थकान)',
      aliases: /(kamzori|weakness|fatigue|thakan|कमजोरी|थकान)/i,
    },
  ];

  for (const sk of symptomKeywords) {
    if (sk.aliases.test(lower)) {
      const alreadyPresent = updated.symptoms.some((s) => s.name.includes(sk.name) || sk.name.includes(s.name));
      if (!alreadyPresent) {
        const newSym: SymptomDetail = {
          id: `sym-${updated.symptoms.length + 1}`,
          name: sk.name,
          source,
          severity: updated.severity || undefined,
          duration: updated.duration || undefined,
          location: updated.location || undefined,
          evidence: text,
        };
        updated.symptoms.push(newSym);

        if (!updated.chiefComplaint) {
          const locStr = updated.location ? ` in ${updated.location}` : '';
          const durStr = updated.duration ? ` for ${updated.duration}` : '';
          updated.chiefComplaint = `${sk.name}${locStr}${durStr}`;
        } else {
          if (!updated.associatedSymptoms.includes(sk.name)) {
            updated.associatedSymptoms.push(sk.name);
          }
        }
      }
    }
  }

  // 5. Triggers and Relieving Factors
  if (/(khane ke baad|after food|after eating|chalne par|walking|running|standing)/i.test(lower)) {
    const trigger = text.match(/(after food|after eating|khane ke baad|chalne par|walking|running)/i)?.[0];
    if (trigger && !updated.triggeringFactors.includes(trigger)) {
      updated.triggeringFactors.push(trigger);
    }
  }

  if (/(aaram karne par|resting|after rest|dawa khane par|lying down|so jaane par)/i.test(lower)) {
    const relieving = text.match(/(aaram karne par|resting|after rest|lying down|dawa lene par)/i)?.[0];
    if (relieving && !updated.relievingFactors.includes(relieving)) {
      updated.relievingFactors.push(relieving);
    }
  }

  // 6. Medical History / Comorbidities
  const historyKeywords = [
    { name: 'Diabetes (मधुमेह / शुगर)', regex: /(sugar|diabetes|madhumeh|मधुमेह|शुगर)/i },
    { name: 'Hypertension (हाई बीपी)', regex: /(bp|high bp|hypertension|blood pressure|रक्तचाप)/i },
    { name: 'Asthma (दमा)', regex: /(asthma|dama|दमा)/i },
    { name: 'Heart Disease (हृदय रोग)', regex: /(heart problem|dil ki bimari|cardiac|दिल की बीमारी)/i },
  ];

  for (const hk of historyKeywords) {
    if (hk.regex.test(lower) && !updated.medicalHistory.includes(hk.name)) {
      updated.medicalHistory.push(hk.name);
    }
  }

  // 7. Medications
  const medMatch = text.match(/(paracetamol|pan-?d|pantocid|metrogyl|amoxicillin|combiflam|aspirin|crocin|eye\s*drops?|आई\s*ड्रॉप|काइड\s*ड्रॉप|ड्रॉप|drops?|dawa|medicine|tablet)/i);
  if (medMatch) {
    const medName = medMatch[0];
    if (!updated.medications.includes(medName)) {
      updated.medications.push(medName);
    }
  }

  // 8. Allergies
  const allergyMatch = text.match(/(penicillin|sulfa|dust|dhool|peanuts|allergy|reaction)/i);
  if (allergyMatch && /(allergy|reaction|rashes)/i.test(lower)) {
    const allergyItem = allergyMatch[0];
    if (!updated.allergies.includes(allergyItem)) {
      updated.allergies.push(allergyItem);
    }
  }

  return updated;
}
