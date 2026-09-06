import { randomUUID } from 'crypto';
import type { 
  CaseSession, 
  ConversationTurn, 
  SupportedLanguage, 
  TurnResult 
} from '../types/index.js';
import { extractClinicalEntities } from './caseExtraction.js';
import { 
  generateSarvamTurn, 
  generateSarvamPersonalizedQuestion, 
  cleanAssistantMessage 
} from './sarvamChat.js';
import { generateGeminiPersonalizedQuestion } from './geminiQuestion.js';
import { synthesizeSpeech } from './sarvamTTS.js';
import { db } from '../database/db.js';

export class ConversationEngine {
  /**
   * Process an incoming patient utterance (either text or transcribed voice).
   */
  async processTurn(
    session: CaseSession,
    patientInput: string,
    source: 'VOICE' | 'TEXT'
  ): Promise<TurnResult> {
    const timestamp = new Date().toISOString();
    const cleanText = patientInput.trim();

    // 1. Add patient message to conversation history
    const patientTurn: ConversationTurn = {
      id: `turn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      role: 'patient',
      text: cleanText,
      source,
      timestamp,
      language: session.selectedLanguage,
    };
    session.conversationHistory.push(patientTurn);

    // 2. Extract clinical facts from patient statement
    session.patientCase = extractClinicalEntities(cleanText, session.patientCase, source);

    // 3. Update knownFacts map
    session.knownFacts = {
      chiefComplaint: session.patientCase.chiefComplaint,
      duration: session.patientCase.duration,
      location: session.patientCase.location,
      severity: session.patientCase.severity,
      frequency: session.patientCase.frequency,
      symptoms: session.patientCase.symptoms.map((s) => s.name),
      triggers: session.patientCase.triggeringFactors,
      relieving: session.patientCase.relievingFactors,
      medicalHistory: session.patientCase.medicalHistory,
      medications: session.patientCase.medications,
      allergies: session.patientCase.allergies,
    };

    // 4. Calculate missing information
    session.missingInformation = this.computeMissingInformation(session);

    // 5. Check loop protection & topic attempts
    const lastAskedTopic = session.askedQuestions[session.askedQuestions.length - 1]?.topic;
    if (lastAskedTopic) {
      session.clarificationCountPerTopic[lastAskedTopic] = 
        (session.clarificationCountPerTopic[lastAskedTopic] || 0) + 1;
    }

const CLINICAL_QUESTIONS: Record<string, Record<string, string>> = {
  hi: {
    duration: 'यह समस्या आपको कितने दिनों या समय से हो रही है, और क्या यह अचानक शुरू हुई थी या धीरे-धीरे?',
    location: 'क्या आप बता सकते हैं कि यह दर्द या परेशानी शरीर के किस हिस्से में सबसे ज्यादा महसूस हो रही है, और क्या यह कहीं और भी फैलता है?',
    severity: 'इस दर्द या परेशानी की तीव्रता 1 से 10 के पैमाने पर कितनी होगी — हल्की, मध्यम या बहुत तेज?',
    triggers: 'क्या यह परेशानी किसी खास काम, खाने या तनाव से बढ़ती है, या किसी चीज से आराम मिलता है?',
    associated_symptoms: 'क्या इसके साथ आपको बुखार, उल्टी, चक्कर, खांसी या अत्यधिक कमजोरी जैसे कोई अन्य लक्षण हैं?',
    medical_history: 'क्या आपको पहले से कोई पुरानी बीमारी जैसे डायबिटीज, बीपी, थायरॉइड या सांस की समस्या है?',
    medications: 'क्या आप वर्तमान में किसी बीमारी की कोई नियमित दवा ले रहे हैं?',
    allergies: 'क्या आपको किसी दवा, इंजेक्शन या खाद्य पदार्थ से कोई एलर्जी है?',
  },
  en: {
    duration: 'How long have you been experiencing this problem, and did it start suddenly or gradually?',
    location: 'Could you clarify the exact location of the discomfort or pain, and does it spread anywhere?',
    severity: 'On a scale of 1 to 10 (or mild, moderate, severe), how intense would you describe this discomfort?',
    triggers: 'Does anything specific seem to trigger, worsen, or relieve these symptoms?',
    associated_symptoms: 'Are you experiencing any other accompanying symptoms such as fever, nausea, dizziness, or fatigue?',
    medical_history: 'Do you have any pre-existing medical conditions like diabetes, hypertension, or asthma?',
    medications: 'Are you currently taking any regular prescription or over-the-counter medications?',
    allergies: 'Do you have any known allergies to medicines, foods, or other substances?',
  },
  bn: {
    duration: 'এই সমস্যাটি আপনার কতদিন বা কতক্ষণ ধরে হচ্ছে, এবং এটি কি হঠাৎ শুরু হয়েছিল?',
    location: 'এই অস্বস্তি বা ব্যথা শরীরের কোন অংশে সবচেয়ে বেশি অনুভূত হচ্ছে?',
    severity: 'এই অস্বস্তির তীব্রতা কেমন — মৃদু, মাঝারি নাকি খুব তীব্র?',
    triggers: 'কোনো নির্দিষ্ট কাজ বা খাবারের পরে কি এই সমস্যা বাড়ে বা কমে?',
    associated_symptoms: 'এর সাথে কি আপনার জ্বর, বমি, মাথা ঘোরা বা অন্য কোনো লক্ষণ আছে?',
    medical_history: 'আপনার কি ডায়াবেটিস বা উচ্চ রক্তচাপের মতো কোনো পূর্ববর্তী স্বাস্থ্য সমস্যা আছে?',
    medications: 'আপনি কি বর্তমানে কোনো নিয়মিত ওষুধ খাচ্ছেন?',
    allergies: 'আপনার কি কোনো ওষুধ বা খাবারে অ্যালার্জি আছে?',
  },
  ta: {
    duration: 'இந்த பிரச்சனை உங்களுக்கு எவ்வளவு காலமாக உள்ளது, இது திடீரென தொடங்கியதா?',
    location: 'இந்த அசௌகரியம் உடலின் எந்தப் பகுதியில் அதிகமாக உள்ளது என்பதை விளக்க முடியுமா?',
    severity: 'இந்த வலியின் தீவிரம் எப்படி உள்ளது — லேசானதா, மிதமானதா அல்லது கடுமையானதா?',
    triggers: 'குறிப்பிட்ட செயல் அல்லது உணவுக்குப் பிறகு இது அதிகரிக்கிறதா அல்லது குறைகிறதா?',
    associated_symptoms: 'இதனுடன் காய்ச்சல், வாந்தி அல்லது தலைச்சுற்றல் போன்ற வேறு அறிகுறிகள் உள்ளதா?',
    medical_history: 'உங்களுக்கு சர்க்கரை நோய் அல்லது ரத்த அழுத்தம் போன்ற முந்தைய நோய்கள் உள்ளதா?',
    medications: 'நீங்கள் தற்போது ஏதேனும் வழக்கமான மருந்துகளை எடுத்துக்கொள்கிறீர்களா?',
    allergies: 'உங்களுக்கு ஏதேனும் மருந்து அல்லது உணவு ஒவ்வாமை உள்ளதா?',
  },
  te: {
    duration: 'ఈ సమస్య మీకు ఎంత కాలంగా ఉంది, ఇది అకస్మాత్తుగా ప్రారంభమైందా?',
    location: 'ఈ నొప్పి లేదా అసౌకర్యం శరీరంలో ఎక్కడ ఎక్కువగా ఉంది?',
    severity: 'ఈ నొప్పి తీవ్రత ఎలా ఉంది — తేలికపాటి, మధ్యస్థ లేదా చాలా తీవ్రమైనదా?',
    triggers: 'ఏదైనా నిర్దిష్ట పని లేదా ఆహారం వల్ల ఇది పెరుగుతుందా లేదా తగ్గుతుందా?',
    associated_symptoms: 'దీనితో పాటు జ్వరం, వాంతులు లేదా తలతిరగడం వంటి ఇతర లక్షణాలు ఏమైనా ఉన్నాయా?',
    medical_history: 'మీకు గతంలో బీపీ, షుగర్ వంటి ఇతర అనారోగ్య సమస్యలు ఉన్నాయా?',
    medications: 'మీరు ప్రస్తుతం ఏవైనా రెగ్యులర్ మందులు వాడుతున్నారా?',
    allergies: 'మీకు ఏదైనా మందు లేదా ఆహారం పట్ల అలెర్జీ ఉందా?',
  },
  kn: {
    duration: 'ಈ ಸಮಸ್ಯೆ ನಿಮಗೆ ಎಷ್ಟು ದಿನಗಳಿಂದ ಇದೆ, ಮತ್ತು ಇದು ಹಠಾತ್ತಾಗಿ ಪ್ರಾರಂಭವಾಯಿತೇ?',
    location: 'ಈ ನೋವು ಅಥವಾ ಅಸ್ವಸ್ಥತೆ ದೇಹದ ಯಾವ ಭಾಗದಲ್ಲಿ ಹೆಚ್ಚಾಗಿ ಕಂಡುಬರುತ್ತಿದೆ?',
    severity: 'ಈ ನೋವಿನ ತೀವ್ರತೆ ಹೇಗಿದೆ — ಸೌಮ್ಯ, ಮಧ್ಯಮ ಅಥವಾ ತೀವ್ರವೇ?',
    triggers: 'ಯಾವುದಾದರೂ ನಿರ್ದಿಷ್ಟ ಚಟುವಟಿಕೆ ಅಥವಾ ಆಹಾರದಿಂದ ಇದು ಹೆಚ್ಚಾಗುತ್ತದೆಯೇ ಅಥವಾ ಕಡಿಮೆಯಾಗುತ್ತದೆಯೇ?',
    associated_symptoms: 'ಇದರೊಂದಿಗೆ ಜ್ವರ, ವಾಂತಿ ಅಥವಾ ತಲೆತಿರುಗುವಿಕೆಯಂತಹ ಇತರ ಲಕ್ಷಣಗಳಿವೆಯೇ?',
    medical_history: 'ನಿಮಗೆ ಬಿಪಿ, ಸಕ್ಕರೆ ಕಾಯಿಲೆಯಂತಹ ಯಾವುದೇ ಹಿಂದಿನ ಆರೋಗ್ಯ ಸಮಸ್ಯೆಗಳಿವೆಯೇ?',
    medications: 'ನೀವು ಪ್ರಸ್ತುತ ಯಾವುದೇ ನಿಯಮಿತ ಔಷಧಿಗಳನ್ನು ತೆಗೆದುಕೊಳ್ಳುತ್ತಿದ್ದೀರಾ?',
    allergies: 'ನಿಮಗೆ ಯಾವುದೇ ಔಷಧ ಅಥವಾ ಆಹಾರದ ಅಲರ್ಜಿ ಇದೆಯೇ?',
  },
  ml: {
    duration: 'ഈ പ്രശ്നം നിങ്ങൾക്ക് എത്ര നാളായി ഉണ്ട്, ഇത് പെട്ടെന്ന് തുടങ്ങിയതാണോ?',
    location: 'ഈ അസ്വസ്ഥത ശരീരത്തിന്റെ ഏത് ഭാഗത്താണ് ഏറ്റവും കൂടുതൽ അനുഭവപ്പെടുന്നത്?',
    severity: 'ഈ വേദനയുടെ തീവ്രത എങ്ങനെയുണ്ട് — നേരിയതോ, മിതമായതോ അതോ കഠിനമായതോ?',
    triggers: 'പ്രത്യേക ഭക്ഷണത്തിന് ശേഷമോ ജോലി ചെയ്യുമ്പോഴോ ഇത് കൂടുകയോ കുറയുകയോ ചെയ്യുന്നുണ്ടോ?',
    associated_symptoms: 'ഇതോടൊപ്പം പനി, ഛർദ്ദി, തലകറക്കം പോലുള്ള മറ്റ് ലക്ഷണങ്ങൾ ഉണ്ടോ?',
    medical_history: 'നിങ്ങൾക്ക് പ്രമേഹം അല്ലെങ്കിൽ രക്തസമ്മർദ്ദം പോലുള്ള മുൻകാല രോഗങ്ങൾ ഉണ്ടോ?',
    medications: 'നിങ്ങൾ ഇപ്പോൾ എന്തെങ്കിലും സ്ഥിരം മരുന്നുകൾ കഴിക്കുന്നുണ്ടോ?',
    allergies: 'നിങ്ങൾക്ക് എന്തെങ്കിലും മരുന്നിനോടോ ഭക്ഷണത്തോടോ അലർജി ഉണ്ടോ?',
  },
  mr: {
    duration: 'हा त्रास तुम्हाला किती दिवसांपासून होत आहे, आणि तो अचानक सुरू झाला होता का?',
    location: 'हा त्रास किंवा वेदना शरीराच्या कोणत्या भागात जास्त जाणवत आहे?',
    severity: 'या वेदनेची तीव्रता किती आहे — सौम्य, मध्यम की खूप तीव्र?',
    triggers: 'कोणत्याही विशिष्ट कामामुळे किंवा खाण्यामुळे हा त्रास वाढतो किंवा कमी होतो का?',
    associated_symptoms: 'यासोबत तुम्हाला ताप, उलट्या, चक्कर येणे किंवा थकवा यासारखी इतर लक्षणे आहेत का?',
    medical_history: 'तुम्हाला आधीपासून बीपी, मधुमेह किंवा इतर कोणताही आजार आहे का?',
    medications: 'तुम्ही सध्या कोणत्याही आजारासाठी नियमित औषध घेत आहात का?',
    allergies: 'तुम्हाला कोणत्याही औषधाची किंवा अन्नाची ॲलर्जी आहे का?',
  },
  gu: {
    duration: 'આ સમસ્યા તમને કેટલા સમયથી થઈ રહી છે, અને શું તે અચાનક શરૂ થઈ હતી?',
    location: 'આ દુખાવો કે અસ્વસ્થતા શરીરના કયા ભાગમાં સૌથી વધુ અનુભવાય છે?',
    severity: 'આ દુખાવાની તીવ્રતા કેવી છે — હળવી, મધ્યમ કે ખૂબ તીવ્ર?',
    triggers: 'કોઈ ચોક્કસ કામ કે ખોરાક પછી આ તકલીફ વધે છે કે ઘટે છે?',
    associated_symptoms: 'આની સાથે તાવ, ઉલટી કે ચક્કર જેવા અન્ય કોઈ લક્ષણો છે?',
    medical_history: 'તમને પહેલાથી ડાયાબિટીસ કે બીપી જેવી કોઈ બીમારી છે?',
    medications: 'શું તમે હાલમાં કોઈ નિયમિત દવા લઈ રહ્યા છો?',
    allergies: 'શું તમને કોઈ દવા કે ખોરાકથી એલર્જી છે?',
  },
  pa: {
    duration: 'ਇਹ ਸਮੱਸਿਆ ਤੁਹਾਨੂੰ ਕਿੰਨੇ ਚਿਰ ਤੋਂ ਹੋ ਰਹੀ ਹੈ, ਅਤੇ ਕੀ ਇਹ ਅਚਾਨਕ ਸ਼ੁਰੂ ਹੋਈ ਸੀ?',
    location: 'ਇਹ ਦਰਦ ਜਾਂ ਬੇਅਰਾਮੀ ਸਰੀਰ ਦੇ ਕਿਸ ਹਿੱਸੇ ਵਿੱਚ ਸਭ ਤੋਂ ਵੱਧ ਮਹਿਸੂਸ ਹੋ ਰਹੀ ਹੈ?',
    severity: 'ਇਸ ਦਰਦ ਦੀ ਤੀਬਰਤਾ ਕਿੰਨੀ ਹੈ — ਹਲਕੀ, ਦਰਮਿਆਨੀ ਜਾਂ ਬਹੁਤ ਤੇਜ਼?',
    triggers: 'ਕੀ ਕਿਸੇ ਖਾਸ ਕੰਮ ਜਾਂ ਖਾਣ-ਪੀਣ ਤੋਂ ਬਾਅਦ ਇਹ ਸਮੱਸਿਆ ਵਧਦੀ ਜਾਂ ਘਟਦੀ ਹੈ?',
    associated_symptoms: 'ਕੀ ਇਸ ਦੇ ਨਾਲ ਬੁਖਾਰ, ਉਲਟੀ ਜਾਂ ਚੱਕਰ ਆਉਣ ਵਰਗੇ ਕੋਈ ਹੋਰ ਲੱਛਣ ਹਨ?',
    medical_history: 'ਕੀ ਤੁਹਾਨੂੰ ਪਹਿਲਾਂ ਤੋਂ ਬੀਪੀ ਜਾਂ ਸ਼ੂਗਰ ਵਰਗੀ ਕੋਈ ਬਿਮਾਰੀ ਹੈ?',
    medications: 'ਕੀ ਤੁਸੀਂ ਹੁਣ ਕੋਈ ਨਿਯਮਤ ਦਵਾਈ ਲੈ ਰਹੇ ਹੋ?',
    allergies: 'ਕੀ ਤੁਹਾਨੂੰ ਕਿਸੇ ਦਵਾਈ ਜਾਂ ਖਾਣ-ਪੀਣ ਦੀ ਚੀਜ਼ ਤੋਂ ਐਲਰਜੀ ਹੈ?',
  },
  od: {
    duration: 'ଏହି ସମସ୍ୟା ଆପଣଙ୍କୁ କେତେ ଦିନରୁ ହେଉଛି, ଏବଂ ଏହା ହଠାତ୍ ଆରମ୍ଭ ହୋଇଥିଲା କି?',
    location: 'ଏହି ଯନ୍ତ୍ରଣା ଶରୀରର କେଉଁ ଅଂଶରେ ସବୁଠାରୁ ଅଧିକ ଅନୁଭୂତ ହେଉଛି?',
    severity: 'ଏହି ଯନ୍ତ୍ରଣାର ତୀବ୍ରତା କିପରି — କମ୍, ମଧ୍ୟମ କିମ୍ବା ବହୁତ ଅଧିକ?',
    triggers: 'କୌଣସି କାର୍ଯ୍ୟ କିମ୍ବା ଖାଦ୍ୟ ପରେ ଏହା ବଢୁଛି କି କମୁଛି?',
    associated_symptoms: 'ଏହା ସହିତ ଜ୍ୱର, ବାନ୍ତି କିମ୍ବା ମୁଣ୍ଡ ବୁଲାଇବା ଭଳି ଅନ୍ୟ କୌଣସି ଲକ୍ଷଣ ଅଛି କି?',
    medical_history: 'ଆପଣଙ୍କର ପୂର୍ବରୁ କୌଣସି ରୋଗ ଯଥା ଡାଇବେଟିସ୍ କିମ୍ବା ବିପି ଅଛି କି?',
    medications: 'ଆପଣ ବର୍ତ୍ତମାନ କୌଣସି ନିୟମିତ ଔଷଧ ଖାଉଛନ୍ତି କି?',
    allergies: 'କୌଣସି ଔଷଧ କିମ୍ବା ଖାଦ୍ୟ ପ୍ରତି ଆପଣଙ୍କର ଆଲର୍ଜି ଅଛି କି?',
  },
};

    // 6. Generate next question via Sarvam Conversation Engine
    const askedTopics = session.askedQuestions.map((q) => q.topic);
    const sarvamTurn = await generateSarvamTurn(
      session.conversationHistory,
      session.patientCase,
      askedTopics,
      session.missingInformation,
      session.selectedLanguage
    );

    const patientTurns = session.conversationHistory.filter((t) => t.role === 'patient').length;

    // Safeguard: Check if topic already answered or max loop reached
    let chosenQuestion = sarvamTurn.nextQuestion;
    let chosenTopic = sarvamTurn.questionTopic;

    const topicProgression = [
      'duration',
      'location',
      'severity',
      'triggers',
      'associated_symptoms',
      'medical_history',
      'medications',
      'allergies',
    ];

    // MANDATORY REQUIREMENT: Must ask AT LEAST 4 questions during voice intake
    if (patientTurns < 4) {
      sarvamTurn.isSufficient = false;

      // If the model thought it was done or repeated an already asked topic, pick next unasked topic
      if (
        chosenTopic === 'complete' ||
        sarvamTurn.isSufficient ||
        this.isTopicKnown(chosenTopic, session) ||
        askedTopics.includes(chosenTopic) ||
        session.clarificationCountPerTopic[chosenTopic] >= 2
      ) {
        const nextTopic = topicProgression.find((t) => !askedTopics.includes(t)) || 'associated_symptoms';
        chosenTopic = nextTopic;
        const qDict = CLINICAL_QUESTIONS[session.selectedLanguage] || CLINICAL_QUESTIONS.en;
        chosenQuestion = qDict[chosenTopic] || qDict.duration;
      }
    }

    // 7. Check if primary case intake is sufficient (Strictly requires >= 4 patient turns)
    const isSufficient = patientTurns >= 4 && (sarvamTurn.isSufficient || this.isCaseIntakeSufficient(session));

    if (isSufficient && session.status === 'active') {
      session.status = 'awaiting_personalized_questions';
      
      // Generate the two personalized questions:
      // Question 1: Sarvam
      const sarvamQ = await generateSarvamPersonalizedQuestion(
        session.patientCase,
        session.selectedLanguage
      );
      session.personalizedQuestions.sarvam = {
        source: 'sarvam',
        questionId: 'pq-sarvam-1',
        question: sarvamQ.question,
        category: sarvamQ.category,
        answer: null,
      };

      // Question 2: Gemini (Prompted with Sarvam's question to guarantee deduplication)
      const geminiQ = await generateGeminiPersonalizedQuestion(
        session.patientCase,
        sarvamQ.question,
        session.askedQuestions.map((q) => q.question),
        session.selectedLanguage
      );
      session.personalizedQuestions.gemini = {
        source: 'gemini',
        questionId: 'pq-gemini-2',
        question: geminiQ.question,
        category: geminiQ.category,
        answer: null,
      };

      chosenQuestion = session.selectedLanguage === 'hi'
        ? 'धन्यवाद, आपकी सभी प्राथमिक जानकारी नोट कर ली गई है। अब हम आपके अपॉइंटमेंट और डॉक्टर परामर्श के लिए आगे बढ़ रहे हैं।'
        : 'Thank you, your clinical intake details have been thoroughly noted. We are now proceeding to the next step for appointment and doctor consultation.';
      chosenTopic = 'complete';
    }

    // 8. Sanitize message to strip any leaked tool tags before TTS and display
    chosenQuestion = cleanAssistantMessage(chosenQuestion);

    // 9. Generate TTS speech for the assistant message
    const ttsResult = await synthesizeSpeech(chosenQuestion, session.selectedLanguage);

    // 10. Add assistant turn to conversation history
    const assistantTurn: ConversationTurn = {
      id: `turn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      role: 'assistant',
      text: chosenQuestion,
      audioBase64: ttsResult?.audioBase64,
      mimeType: ttsResult?.mimeType,
      source: 'VOICE',
      timestamp: new Date().toISOString(),
      questionTopic: chosenTopic,
      language: session.selectedLanguage,
    };
    session.conversationHistory.push(assistantTurn);

    // Record asked question
    if (chosenTopic !== 'complete') {
      session.askedQuestions.push({
        id: `q-${session.askedQuestions.length + 1}`,
        topic: chosenTopic,
        question: chosenQuestion,
        turnIndex: session.conversationHistory.length - 1,
      });
      if (!session.answeredTopics.includes(chosenTopic)) {
        session.answeredTopics.push(chosenTopic);
      }
    }

    // 10. Persist updated session to database
    await db.saveSession(session);

    return {
      sessionId: session.sessionId,
      transcript: source === 'VOICE' ? cleanText : undefined,
      assistantMessage: chosenQuestion,
      audioBase64: ttsResult?.audioBase64,
      mimeType: ttsResult?.mimeType,
      questionTopic: chosenTopic,
      status: session.status,
      isComplete: session.status !== 'active',
      knownFacts: session.knownFacts,
      missingInformation: session.missingInformation,
      progress: this.calculateProgress(session),
    };
  }

  private isTopicKnown(topic: string, session: CaseSession): boolean {
    const pc = session.patientCase;
    switch (topic) {
      case 'duration': return Boolean(pc.duration);
      case 'location': return Boolean(pc.location);
      case 'severity': return Boolean(pc.severity);
      case 'triggers': return pc.triggeringFactors.length > 0;
      case 'associated_symptoms': return pc.associatedSymptoms.length > 0;
      case 'medical_history': return pc.medicalHistory.length > 0;
      case 'medications': return pc.medications.length > 0;
      case 'allergies': return pc.allergies.length > 0;
      default: return false;
    }
  }

  private computeMissingInformation(session: CaseSession): string[] {
    const missing: string[] = [];
    const pc = session.patientCase;
    if (!pc.chiefComplaint) missing.push('chief_complaint');
    if (!pc.duration) missing.push('duration');
    if (!pc.location) missing.push('location');
    if (!pc.severity) missing.push('severity');
    if (pc.triggeringFactors.length === 0) missing.push('triggers');
    if (pc.associatedSymptoms.length === 0) missing.push('associated_symptoms');
    if (pc.medicalHistory.length === 0) missing.push('medical_history');
    if (pc.medications.length === 0) missing.push('medications');
    if (pc.allergies.length === 0) missing.push('allergies');
    return missing;
  }

  private isCaseIntakeSufficient(session: CaseSession): boolean {
    const patientTurns = session.conversationHistory.filter((t) => t.role === 'patient').length;
    // Strictly require at least 4 patient turns before intake can conclude
    return patientTurns >= 4;
  }

  calculateProgress(session: CaseSession): { stage: string; step: number; totalSteps: number } {
    const turns = session.conversationHistory.filter((t) => t.role === 'patient').length;
    switch (session.status) {
      case 'active': {
        if (turns <= 0) return { stage: 'Chief Complaint', step: 1, totalSteps: 5 };
        if (turns === 1) return { stage: 'Duration & Onset', step: 2, totalSteps: 5 };
        if (turns === 2) return { stage: 'Severity & Location', step: 3, totalSteps: 5 };
        if (turns === 3) return { stage: 'Associated Symptoms & History', step: 4, totalSteps: 5 };
        return { stage: 'Finalizing Intake', step: 5, totalSteps: 5 };
      }
      case 'awaiting_personalized_questions':
        return { stage: 'Personalized Review', step: 5, totalSteps: 5 };
      case 'review':
      case 'finalized':
        return { stage: 'Doctor Consultation', step: 5, totalSteps: 5 };
      default:
        return { stage: 'Getting Started', step: 1, totalSteps: 5 };
    }
  }
}

export const conversationEngine = new ConversationEngine();
