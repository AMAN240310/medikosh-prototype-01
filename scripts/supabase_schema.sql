-- MediCare Patient Portal: Supabase PostgreSQL Schema
-- Run this script in your Supabase SQL Editor to initialize the appointments table and storage bucket.

-- 1. Create Enums for Triage Severity and Status
DO $$ BEGIN
    CREATE TYPE urgency_severity AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE appointment_status AS ENUM ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Create Appointments Table
CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id VARCHAR(32) UNIQUE NOT NULL,
    case_id VARCHAR(64) NOT NULL,
    patient_id VARCHAR(64) NOT NULL,
    patient_name VARCHAR(128) NOT NULL,
    patient_phone VARCHAR(20),
    doctor_id VARCHAR(64) NOT NULL,
    doctor_name VARCHAR(128) NOT NULL,
    specialty VARCHAR(64) NOT NULL,
    room_number VARCHAR(32) NOT NULL DEFAULT 'OPD Room 101',
    appointment_date DATE NOT NULL,
    start_time VARCHAR(20) NOT NULL,
    end_time VARCHAR(20) NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 15,
    severity urgency_severity NOT NULL DEFAULT 'MEDIUM',
    token_number INTEGER NOT NULL,
    check_in_otp VARCHAR(6) NOT NULL,
    status appointment_status NOT NULL DEFAULT 'CONFIRMED',
    is_revisit BOOLEAN DEFAULT FALSE,
    previous_appointment_id VARCHAR(32),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Indexes for fast dashboard and queue lookups
CREATE INDEX IF NOT EXISTS idx_appts_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appts_date ON appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appts_severity ON appointments(severity);

-- 4. Enable Row Level Security (RLS) & Public Read/Insert for Demo Portal
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public select appointments" ON appointments FOR SELECT USING (true);
CREATE POLICY "Allow public insert appointments" ON appointments FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update appointments" ON appointments FOR UPDATE USING (true);

-- 5. Create Storage Bucket for Medical Documents if not already existing
INSERT INTO storage.buckets (id, name, public) 
VALUES ('patient-records', 'patient-records', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Allow public upload patient-records" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'patient-records');

CREATE POLICY "Allow public read patient-records" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'patient-records');
