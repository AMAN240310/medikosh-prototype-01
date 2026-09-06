export const GATEWAY_URL =
  window.location.port === "5000" ||
  window.location.hostname.includes("ngrok") ||
  window.location.hostname.includes("loca.lt")
    ? window.location.origin
    : (window.location.port === "3000"
        ? `${window.location.protocol}//${window.location.hostname}:5000`
        : window.location.origin);

export async function fetchAppointments() {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/appointments?patientId=PAT-8821`);
    const data = await res.json();
    return data.appointments || [];
  } catch (err) {
    console.warn("Using fallback appointments:", err);
    return [];
  }
}

export async function quickBookAppointment(payload) {
  const res = await fetch(`${GATEWAY_URL}/api/appointments/quick-book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }, 
    body: JSON.stringify(payload),
  });
  return await res.json();
}

export async function scheduleRevisit(payload) {
  const res = await fetch(`${GATEWAY_URL}/api/appointments/revisit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

export async function cancelAppointment(appointmentId) {
  const res = await fetch(`${GATEWAY_URL}/api/appointments/${appointmentId}/cancel`, {
    method: "POST",
  });
  return await res.json();
}

export async function fetchRecords() {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/records?patientId=PAT-8821`);
    const data = await res.json();
    return data.records || [];
  } catch (err) {
    console.warn("Using fallback records:", err);
    return [];
  }
}

export async function uploadMedicalRecord(formData) {
  const res = await fetch(`${GATEWAY_URL}/api/records/upload`, {
    method: "POST",
    body: formData,
  });
  return await res.json();
}

export async function processFullIntake(formData) {
  const res = await fetch(`${GATEWAY_URL}/api/intake/process`, {
    method: "POST",
    body: formData,
  });
  return await res.json();
}
