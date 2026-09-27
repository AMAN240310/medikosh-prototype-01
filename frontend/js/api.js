export const GATEWAY_URL =
  window.location.port === "5000" ||
  window.location.hostname.includes("ngrok") ||
  window.location.hostname.includes("loca.lt")
    ? window.location.origin
    : (window.location.port === "3000"
        ? `${window.location.protocol}//${window.location.hostname}:5000`
        : window.location.origin);

/** Returns the Authorization header object if a token is stored, else empty object. */
function authHeaders() {
  const token = localStorage.getItem("medicare_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Redirect to login if a 401 is returned */
function handleUnauthorized(res) {
  if (res.status === 401) {
    localStorage.removeItem("medicare_token");
    localStorage.removeItem("patient_authenticated");
    window.location.href = "/login.html";
  }
  return res;
}

export async function fetchAppointments() {
  try {
    const res = handleUnauthorized(
      await fetch(`${GATEWAY_URL}/api/appointments`, {
        headers: { ...authHeaders() },
      })
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.appointments || [];
  } catch (err) {
    console.warn("Using fallback appointments:", err);
    return [];
  }
}

export async function quickBookAppointment(payload) {
  const res = handleUnauthorized(
    await fetch(`${GATEWAY_URL}/api/appointments/quick-book`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    })
  );
  return await res.json();
}

export async function scheduleRevisit(payload) {
  const res = handleUnauthorized(
    await fetch(`${GATEWAY_URL}/api/appointments/revisit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    })
  );
  return await res.json();
}

export async function cancelAppointment(appointmentId) {
  const res = handleUnauthorized(
    await fetch(`${GATEWAY_URL}/api/appointments/${appointmentId}/cancel`, {
      method: "POST",
      headers: { ...authHeaders() },
    })
  );
  return await res.json();
}

export async function fetchRecords() {
  try {
    const res = handleUnauthorized(
      await fetch(`${GATEWAY_URL}/api/records`, {
        headers: { ...authHeaders() },
      })
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.records || [];
  } catch (err) {
    console.warn("Using fallback records:", err);
    return [];
  }
}

export async function uploadMedicalRecord(formData) {
  const res = handleUnauthorized(
    await fetch(`${GATEWAY_URL}/api/records/upload`, {
      method: "POST",
      headers: { ...authHeaders() },
      body: formData,
    })
  );
  return await res.json();
}

export async function processFullIntake(formData) {
  const res = handleUnauthorized(
    await fetch(`${GATEWAY_URL}/api/intake/process`, {
      method: "POST",
      headers: { ...authHeaders() },
      body: formData,
    })
  );
  return await res.json();
}
