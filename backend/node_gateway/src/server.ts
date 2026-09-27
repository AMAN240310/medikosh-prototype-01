import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { authRouter } from "./routes/auth.routes.js";
import { authenticatePatient } from "./middleware/auth.middleware.js";

import type { ConversationState, TurnMetrics } from "./voice/types/index";
import { extractFromUtterance } from "./voice/clinical/symptomExtractor";
import { checkEmergency, EMERGENCY_RESPONSE_HI } from "./voice/clinical/emergencyRules";
import { selectNextQuestion } from "./voice/clinical/questionEngine";
import { OPENING_QUESTION_HI } from "./voice/clinical/questionBank";
import {
  createSession,
  deleteSession,
  getSession,
  markComplete,
  markEscalated,
  mergeExtraction,
  recordQuestionAsked,
} from "./voice/clinical/stateManager";
import { transcribeAudio } from "./voice/voice/sarvamSTT";
import { synthesizeSpeech } from "./voice/voice/sarvamTTS";

import { connectMongo } from "./db/mongo";
import { intakeRouter } from "./routes/intake.routes";
import { appointmentsRouter } from "./routes/appointments.routes";
import { recordsRouter } from "./routes/records.routes";
import caseTakingRoutes from "./voice-engine/routes/caseTakingRoutes.js";
import { doctorsRouter } from "./routes/doctors.routes.js";

const PORT = Number(process.env.PORT) || 5000;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Always allow local dev origins; production adds real domains via ALLOWED_ORIGINS env var
const DEFAULT_ORIGINS = [
  "http://localhost:5000",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:3001",
];

const allowedOriginSet = new Set([...DEFAULT_ORIGINS, ...ALLOWED_ORIGINS]);

const app = express();
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow same-origin requests (no Origin header) or listed origins
      if (!origin || allowedOriginSet.has(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "api-subscription-key", "Accept"],
  })
);
app.options("*", cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Mount API Routers
app.use("/api/auth", authRouter);
app.use("/api/doctors", doctorsRouter);          // public — patients browse doctors before login
app.use("/api/case-taking", caseTakingRoutes);
// Patient routes — protected by JWT; demo tokens issued by /api/auth/login/patient are accepted
app.use("/api/intake", authenticatePatient, intakeRouter);
app.use("/api/appointments", authenticatePatient, appointmentsRouter);
app.use("/api/records", authenticatePatient, recordsRouter);

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "medicare-patient-gateway",
    time: new Date().toISOString(),
  });
});

// Serve Frontend Static Assets (Landing, Portal, Voice Kiosk)
const frontendPath = fileURLToPath(new URL("../../../frontend", import.meta.url));
app.use(express.static(frontendPath));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOriginSet.has(origin)) callback(null, true);
      else callback(new Error(`Socket.IO CORS: origin ${origin} not allowed`));
    },
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 5 * 1024 * 1024,
});

async function speak(
  socket: Socket,
  text: string
): Promise<{ audioBase64: string | null; mimeType: string; ttsMs: number }> {
  try {
    const synth = await synthesizeSpeech(text);
    return { audioBase64: synth.audioBase64, mimeType: synth.mimeType, ttsMs: synth.latencyMs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    socket.emit("error", { message: `Text-to-speech unavailable: ${message}` });
    return { audioBase64: null, mimeType: "audio/wav", ttsMs: 0 };
  }
}

async function handleEmergency(
  socket: Socket,
  state: ConversationState,
  redFlags: string[],
  partialMetrics: Pick<TurnMetrics, "sttMs" | "processingMs">,
  turnStarted: number
) {
  markEscalated(state, redFlags);
  const { audioBase64, mimeType, ttsMs } = await speak(socket, EMERGENCY_RESPONSE_HI);
  const metrics: TurnMetrics = {
    ...partialMetrics,
    geminiUsed: false,
    geminiMs: 0,
    ttsMs,
    totalMs: Date.now() - turnStarted,
  };
  socket.emit("ai:emergency", {
    text: EMERGENCY_RESPONSE_HI,
    audioBase64,
    mimeType,
    redFlags,
    metrics,
  });
}

async function processTurn(
  socket: Socket,
  state: ConversationState,
  transcript: string,
  sttMs: number | null
) {
  const turnStarted = Date.now();
  socket.emit("patient:transcript", { text: transcript });

  if (state.conversation_status === "ESCALATED") {
    const { audioBase64, mimeType, ttsMs } = await speak(socket, EMERGENCY_RESPONSE_HI);
    socket.emit("ai:emergency", {
      text: EMERGENCY_RESPONSE_HI,
      audioBase64,
      mimeType,
      redFlags: state.red_flags,
      metrics: {
        sttMs,
        processingMs: 0,
        geminiUsed: false,
        geminiMs: 0,
        ttsMs,
        totalMs: Date.now() - turnStarted,
      } satisfies TurnMetrics,
    });
    return;
  }

  const processingStart = Date.now();
  const extraction = extractFromUtterance(transcript, {
    chiefComplaint: state.chief_complaint,
    lastAskedField: state.lastAskedField,
  });

  const turnHadResolution = state.lastAskedField
    ? Object.prototype.hasOwnProperty.call(extraction.updates, state.lastAskedField)
    : true;

  mergeExtraction(state, extraction.updates, extraction.detectedCategory, extraction.languageHint);

  const emergency = checkEmergency(state.known_information);
  const processingMs = Date.now() - processingStart;

  if (emergency.isEmergency) {
    await handleEmergency(socket, state, emergency.redFlags, { sttMs, processingMs }, turnStarted);
    return;
  }

  const nextQ = await selectNextQuestion(state, turnHadResolution);
  recordQuestionAsked(state, nextQ.questionId);
  if (nextQ.done) markComplete(state);

  const { audioBase64, mimeType, ttsMs } = await speak(socket, nextQ.questionText ?? "");

  const metrics: TurnMetrics = {
    sttMs,
    processingMs,
    geminiUsed: nextQ.geminiUsed,
    geminiMs: nextQ.geminiLatencyMs,
    ttsMs,
    totalMs: Date.now() - turnStarted,
  };

  socket.emit(nextQ.done ? "session:complete" : "ai:question", {
    questionId: nextQ.questionId,
    text: nextQ.questionText,
    priority: nextQ.priority,
    source: nextQ.source,
    geminiConfidence: nextQ.geminiConfidence,
    audioBase64,
    mimeType,
    metrics,
    knownInformation: state.known_information,
  });
}

io.on("connection", (socket: Socket) => {
  createSession(socket.id);
  socket.emit("session:ready", { sessionId: socket.id });

  socket.on("session:start", async () => {
    const state = getSession(socket.id) ?? createSession(socket.id);
    const turnStarted = Date.now();
    const { audioBase64, mimeType, ttsMs } = await speak(socket, OPENING_QUESTION_HI);
    socket.emit("ai:question", {
      questionId: null,
      text: OPENING_QUESTION_HI,
      priority: null,
      source: "opening",
      geminiConfidence: null,
      audioBase64,
      mimeType,
      metrics: {
        sttMs: null,
        processingMs: 0,
        geminiUsed: false,
        geminiMs: 0,
        ttsMs,
        totalMs: Date.now() - turnStarted,
      } satisfies TurnMetrics,
    });
  });

  socket.on("patient:audio", async (payload: { audioBase64: string; mimeType: string }) => {
    const state = getSession(socket.id);
    if (!state) return socket.emit("error", { message: "No active session - send session:start first" });

    try {
      const buffer = Buffer.from(payload.audioBase64, "base64");
      const baseMime = (payload.mimeType || "audio/webm").split(";")[0].trim();
      const stt = await transcribeAudio(buffer, baseMime);
      if (!stt.transcript.trim()) {
        socket.emit("error", { message: "Could not hear that clearly - please try again." });
        return;
      }
      await processTurn(socket, state, stt.transcript, stt.latencyMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      socket.emit("error", { message: `Speech recognition failed: ${message}` });
    }
  });

  socket.on("patient:text", async (payload: { text: string }) => {
    const state = getSession(socket.id);
    if (!state) return socket.emit("error", { message: "No active session - send session:start first" });
    if (!payload.text?.trim()) return;
    try {
      await processTurn(socket, state, payload.text.trim(), null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      socket.emit("error", { message: `Processing failed: ${message}` });
    }
  });

  socket.on("disconnect", () => {
    deleteSession(socket.id);
  });
});

// Boot Database & Server
async function start() {
  httpServer.listen(PORT, () => {
    console.log(`🚀 MediCare Patient Gateway listening on http://localhost:${PORT}`);
  });
  connectMongo().catch((err) => {
    console.warn("MongoDB initial connection error:", err.message);
  });
}

start();
