// Sarvam TTS per https://docs.sarvam.ai/api-reference/text-to-speech/convert:
// POST https://api.sarvam.ai/text-to-speech, JSON body, auth via the
// `api-subscription-key` header. bulbul:v3 returns base64 WAV audio in
// `audios[0]`. Kept independent of the clinical engine so the voice
// provider can be swapped later (spec section 20).

export interface SynthesizeResult {
  audioBase64: string;
  mimeType: string;
  latencyMs: number;
}

export async function synthesizeSpeech(
  text: string,
  languageCode: string = "hi-IN"
): Promise<SynthesizeResult> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    throw new Error("SARVAM_API_KEY not configured");
  }

  const started = Date.now();
  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: text.slice(0, 2500), // bulbul:v3 hard limit
      language_code: languageCode,
      model: "bulbul:v3",
      speaker: "shubh",
      pace: 1.0,
      speech_sample_rate: 22050,
    }),
  });

  const latencyMs = Date.now() - started;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Sarvam TTS HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as { audios?: string[] };
  const audioBase64 = data.audios?.[0];
  if (!audioBase64) {
    throw new Error("Sarvam TTS returned no audio");
  }

  return { audioBase64, mimeType: "audio/wav", latencyMs };
}
