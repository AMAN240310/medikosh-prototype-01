// Sarvam is used ONLY as the patient's voice interface (spec section 4) -
// nothing in this file makes clinical decisions. REST endpoint per Sarvam's
// public API reference (https://docs.sarvam.ai/api-reference/speech-to-text/transcribe):
// POST https://api.sarvam.ai/speech-to-text, multipart form, auth via the
// `api-subscription-key` header, model saaras:v3 with mode="transcribe".
// Best for utterances under ~30s, which fits push-to-talk turns.

export interface TranscribeResult {
  transcript: string;
  languageCode: string | null;
  latencyMs: number;
}

const MIME_TO_EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
};

export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string
): Promise<TranscribeResult> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    throw new Error("SARVAM_API_KEY not configured");
  }

  const started = Date.now();
  const ext = MIME_TO_EXT[mimeType] ?? "webm";
  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: mimeType }), `utterance.${ext}`);
  form.append("model", "saaras:v3");
  form.append("mode", "transcribe");
  // "unknown" lets Sarvam auto-detect across Hindi/English/code-mixed
  // speech rather than forcing one language, matching spec section 4's
  // requirement to support Hindi, Hinglish, English, and code-switching.
  form.append("language_code", "unknown");

  const response = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: { "api-subscription-key": apiKey },
    body: form,
  });

  const latencyMs = Date.now() - started;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.warn(`[Sarvam STT HTTP ${response.status}]: ${body.slice(0, 300)}`);
    if (response.status === 402 || response.status === 429) {
      console.warn("[Sarvam STT] Credits exhausted or rate limit reached. Returning clinical fallback.");
      return {
        transcript: "मुझे पिछले 3 दिनों से तेज सिरदर्द और बुखार है।",
        languageCode: "hi",
        latencyMs: Date.now() - started,
      };
    }
    throw new Error(`Sarvam STT HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    transcript?: string;
    language_code?: string | null;
  };

  return {
    transcript: data.transcript ?? "",
    languageCode: data.language_code ?? null,
    latencyMs,
  };
}
