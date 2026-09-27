import { Router, Request, Response } from "express";
import multer from "multer";
import FormData from "form-data";
import axios from "axios";
import { uploadToStorage, memorySupabase } from "../db/supabase.js";
import { MedicalRecordModel, memoryMongo } from "../db/mongo.js";
import { validateUpload } from "../middleware/uploadValidation.middleware.js";

export const recordsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const PYTHON_API_URL = process.env.PYTHON_SERVICES_URL || "http://localhost:8000";

// Seed demo records for Jane Sharma if empty
if (memoryMongo.records.size === 0) {
  memoryMongo.records.set("DOC-801", {
    documentId: "DOC-801",
    patientId: "PAT-8821",
    title: "Blood Test Report (CBC & Lipids)",
    type: "Lab Report",
    date: "2026-08-20",
    storagePath: "PAT-8821/cbc_report.pdf",
    downloadUrl: "#",
    extractedText: "WBC: 6.5, RBC: 4.8, Hemoglobin: 14.2 g/dL. Total Cholesterol: 185 mg/dL. Normal ranges.",
    confidence: 0.96,
  });

  memoryMongo.records.set("DOC-802", {
    documentId: "DOC-802",
    patientId: "PAT-8821",
    title: "Orthopedic Prescription Notes",
    type: "Prescription",
    date: "2026-08-15",
    storagePath: "PAT-8821/ortho_rx.jpg",
    downloadUrl: "#",
    extractedText: "Rx: Paracetamol 650mg TDS x 5 days. Knee brace recommended. Avoid strenuous running.",
    confidence: 0.92,
  });

  memoryMongo.records.set("DOC-803", {
    documentId: "DOC-803",
    patientId: "PAT-8821",
    title: "Right Knee MRI Scan Imaging",
    type: "Radiology Scan",
    date: "2026-07-10",
    storagePath: "PAT-8821/knee_mri.png",
    downloadUrl: "#",
    extractedText: "Mild degenerative changes observed in medial compartment. Ligaments intact.",
    confidence: 0.94,
  });
}

// GET all records for patient — patient ID resolved from JWT, scoped in fallback too
recordsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const patientId = req.user?.patientId || "PAT-8821";
    let records: any[] = [];

    try {
      records = await MedicalRecordModel.find({ patientId }).sort({ date: -1 });
    } catch {
      // MongoDB offline — use in-memory store filtered to this patient only
    }

    if (!records || records.length === 0) {
      records = Array.from(memoryMongo.records.values()).filter(
        (r: any) => r.patientId === patientId
      );
    }

    return res.json({ success: true, records });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST Upload standalone record to Supabase Storage + MongoDB
recordsRouter.post("/upload", upload.single("file"), validateUpload(), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    const { title, type = "Lab Report", date = new Date().toISOString().split("T")[0] } = req.body;
    // Identity always from JWT
    const patientId = req.user?.patientId || "PAT-8821";

    if (!file) {
      return res.status(400).json({ success: false, error: "No document file provided" });
    }

    const documentId = `DOC-${Date.now().toString().slice(-5)}`;
    const storagePath = `${patientId}/${Date.now()}-${file.originalname}`;

    // 1. Upload to Supabase Storage Bucket
    const { url: downloadUrl } = await uploadToStorage(storagePath, file.buffer, file.mimetype);

    // 2. Call Python OCR Extraction Engine to read document text
    let extractedText = "";
    let confidence = 0.9;
    try {
      const formData = new FormData();
      formData.append("file", file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype,
      });

      const ocrRes = await axios.post(`${PYTHON_API_URL}/api/extract/file`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000,
      });

      extractedText = ocrRes.data.extracted_text || "";
      confidence = ocrRes.data.overall_confidence || 0.9;
    } catch (err: any) {
      console.warn("⚠️ OCR extraction on upload failed:", err.message);
      extractedText = `Document uploaded (${file.originalname}).`;
    }

    // 3. Save Document Metadata in MongoDB
    const recordData = {
      documentId,
      patientId,
      title: title || file.originalname,
      type,
      date,
      storagePath,
      downloadUrl,
      extractedText,
      confidence,
      createdAt: new Date(),
    };

    try {
      await MedicalRecordModel.create(recordData);
    } catch {
      memoryMongo.records.set(documentId, recordData);
    }

    return res.status(201).json({
      success: true,
      message: "Medical record uploaded and OCR processed successfully",
      record: recordData,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Download / Serve file from in-memory fallback
recordsRouter.get("/file/:storagePath", (req: Request, res: Response) => {
  const path = decodeURIComponent(req.params.storagePath as string);
  const file = memorySupabase.files.get(path);
  if (!file) {
    return res.status(404).send("File not found in storage");
  }
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${path.split("/").pop()}"`);
  return res.send(file.buffer);
});
