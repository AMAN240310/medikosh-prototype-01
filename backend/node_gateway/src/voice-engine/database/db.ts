import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { ENV } from '../config/env.js';
import type { CaseSession } from '../types/index.js';
import { CaseSessionModel } from './schemas/CaseSession.js';

class DualModeDatabase {
  private isConnectedToMongo = false;
  private memoryStore = new Map<string, CaseSession>();
  private localDataDir = path.resolve(process.cwd(), '.data');
  private localFilePath = path.resolve(this.localDataDir, 'sessions.json');

  constructor() {
    this.initLocalStore();
  }

  private initLocalStore() {
    try {
      if (!fs.existsSync(this.localDataDir)) {
        fs.mkdirSync(this.localDataDir, { recursive: true });
      }
      if (fs.existsSync(this.localFilePath)) {
        const raw = fs.readFileSync(this.localFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, CaseSession>;
        for (const [id, session] of Object.entries(parsed)) {
          this.memoryStore.set(id, session);
        }
      }
    } catch (e) {
      console.warn('[Database] Local file store initialization notice:', e);
    }
  }

  private persistLocalStore() {
    try {
      const obj: Record<string, CaseSession> = {};
      for (const [id, session] of this.memoryStore.entries()) {
        obj[id] = session;
      }
      fs.writeFileSync(this.localFilePath, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (e) {
      console.warn('[Database] Could not write to local sessions.json:', e);
    }
  }

  async connect(): Promise<boolean> {
    try {
      await mongoose.connect(ENV.MONGODB_URI, {
        serverSelectionTimeoutMS: 2000,
      });
      this.isConnectedToMongo = true;
      console.log('✅ [Database] Connected to MongoDB at:', ENV.MONGODB_URI);
      return true;
    } catch (err: any) {
      this.isConnectedToMongo = false;
      console.log('ℹ️ [Database] MongoDB not reachable. Resilient Dual-Mode active (Using file/memory store).');
      return false;
    }
  }

  isMongo(): boolean {
    return this.isConnectedToMongo;
  }

  async saveSession(session: CaseSession): Promise<CaseSession> {
    session.updatedAt = new Date().toISOString();
    this.memoryStore.set(session.sessionId, JSON.parse(JSON.stringify(session)));
    this.persistLocalStore();

    if (this.isConnectedToMongo) {
      try {
        await CaseSessionModel.findOneAndUpdate(
          { sessionId: session.sessionId },
          { $set: session },
          { upsert: true, new: true }
        );
      } catch (err) {
        console.warn('[Database] Failed to write to MongoDB, fallback preserved:', err);
      }
    }
    return session;
  }

  async getSession(sessionId: string): Promise<CaseSession | null> {
    if (this.isConnectedToMongo) {
      try {
        const doc = await CaseSessionModel.findOne({ sessionId }).lean();
        if (doc) {
          return doc as unknown as CaseSession;
        }
      } catch (err) {
        console.warn('[Database] Failed to read from MongoDB, checking memory store:', err);
      }
    }

    const mem = this.memoryStore.get(sessionId);
    return mem ? JSON.parse(JSON.stringify(mem)) : null;
  }

  async getAllSessions(): Promise<CaseSession[]> {
    if (this.isConnectedToMongo) {
      try {
        const docs = await CaseSessionModel.find().sort({ updatedAt: -1 }).lean();
        if (docs.length > 0) {
          return docs as unknown as CaseSession[];
        }
      } catch (err) {
        console.warn('[Database] Failed to fetch all from MongoDB, using memory store');
      }
    }
    return Array.from(this.memoryStore.values());
  }
}

export const db = new DualModeDatabase();
