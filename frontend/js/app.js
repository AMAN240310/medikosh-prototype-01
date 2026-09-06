import {
  fetchAppointments,
  quickBookAppointment,
  scheduleRevisit,
  cancelAppointment,
  fetchRecords,
  uploadMedicalRecord,
} from "./api.js";

let appointments = [];
let records = [];

document.addEventListener("DOMContentLoaded", async () => {
  if (window.lucide) window.lucide.createIcons();

  setupNavigation();
  setupModals();
  setupQuickBookingForm();
  setupStandaloneRecordUpload();
  setupSearchAndFilters();

  await loadAppointments();
  await loadRecords();
});

// Navigation logic
function setupNavigation() {
  window.showPage = function (pageId) {
    document.querySelectorAll(".page").forEach((page) => page.classList.add("hidden"));
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.remove("active", "text-indigo-600", "bg-indigo-50/80");
      btn.classList.add("text-slate-600");
    });

    const target = document.getElementById(pageId);
    if (target) target.classList.remove("hidden");

    const activeBtn = document.querySelector(`.nav-btn[data-page="${pageId}"]`);
    if (activeBtn) {
      activeBtn.classList.add("active", "text-indigo-600", "bg-indigo-50/80");
      activeBtn.classList.remove("text-slate-600");
    }

    const backdrop = document.getElementById("sidebarBackdrop");
    const sidebar = document.getElementById("sidebar");
    if (sidebar && !sidebar.classList.contains("-translate-x-full")) {
      sidebar.classList.add("-translate-x-full");
      if (backdrop) backdrop.classList.add("hidden", "opacity-0");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => window.showPage(btn.dataset.page));
  });

  // Mobile drawer
  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  const sidebar = document.getElementById("sidebar");
  const sidebarBackdrop = document.getElementById("sidebarBackdrop");

  if (mobileMenuBtn && sidebar && sidebarBackdrop) {
    mobileMenuBtn.addEventListener("click", () => {
      sidebarBackdrop.classList.remove("hidden");
      setTimeout(() => {
        sidebarBackdrop.classList.remove("opacity-0");
        sidebar.classList.remove("-translate-x-full");
      }, 10);
    });

    sidebarBackdrop.addEventListener("click", () => {
      sidebar.classList.add("-translate-x-full");
      sidebarBackdrop.classList.add("opacity-0");
      setTimeout(() => sidebarBackdrop.classList.add("hidden"), 300);
    });
  }

  // Logout button
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      showConfirmModal("Log Out", "Are you sure you want to end your current session?", () => {
        showToast("Logged out successfully.", "info");
      });
    });
  }
}

// Modals setup
function setupModals() {
  const choiceModal = document.getElementById("bookingChoiceModal");
  const wizardModal = document.getElementById("intakeWizardModal");

  window.openBookingChoiceModal = () => choiceModal?.classList.remove("hidden");
  window.closeBookingChoiceModal = () => choiceModal?.classList.add("hidden");

  // Redirect directly to dedicated React voice case taking intake
  window.openIntakeWizardModal = () => {
    closeBookingChoiceModal();
    window.location.href = "/intake/";
  };

  window.closeIntakeWizardModal = () => {
    wizardModal?.classList.add("hidden");
  };

  // Button triggers
  document.getElementById("openIntakeModalBtn")?.addEventListener("click", window.openBookingChoiceModal);
  document.getElementById("heroBookApptBtn")?.addEventListener("click", () => {
    window.showPage("appointments");
  });
  document.getElementById("heroVoiceIntakeBtn")?.addEventListener("click", () => {
    window.location.href = "/intake/";
  });

  // Choice modal cards
  document.getElementById("choiceQuickForm")?.addEventListener("click", () => {
    window.closeBookingChoiceModal();
    window.showPage("appointments");
    document.getElementById("specialty")?.focus();
  });

  document.getElementById("choiceVoiceIntake")?.addEventListener("click", () => {
    window.location.href = "/intake/";
  });
}

// Load and Render Appointments (Supabase PostgreSQL)
async function loadAppointments() {
  appointments = await fetchAppointments();
  renderAppointmentsList();
  renderDashboardAppointments();
  const badge = document.getElementById("apptCountBadge");
  if (badge) badge.textContent = appointments.filter((a) => a.status !== "CANCELLED").length;
}

function renderAppointmentsList() {
  const container = document.getElementById("appointmentList");
  if (!container) return;

  if (appointments.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 p-4 text-center">No active appointments scheduled.</p>`;
    return;
  }

  container.innerHTML = appointments
    .map((appt) => {
      const isCancelled = appt.status === "CANCELLED";
      const severityClass =
        appt.severity === "CRITICAL"
          ? "bg-rose-100 text-rose-700"
          : appt.severity === "HIGH"
          ? "bg-amber-100 text-amber-700"
          : "bg-emerald-100 text-emerald-700";

      // Parse date for badge
      const d = new Date(appt.appointment_date || Date.now());
      const monthStr = isNaN(d.getTime()) ? "SEP" : d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
      const dayStr = isNaN(d.getTime()) ? "12" : String(d.getDate()).padStart(2, '0');
      const dayOfWeek = isNaN(d.getTime()) ? "Fri" : d.toLocaleString('en-US', { weekday: 'short' });

      return `
      <article class="p-5 rounded-3xl neo-raised-sm space-y-4 ${isCancelled ? 'opacity-60' : ''}">
        <!-- Top row: Date Badge, Doctor Info, Status and Action Menu -->
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3.5">
            <!-- Date Badge -->
            <div class="w-14 h-16 rounded-2xl neo-raised-pill bg-blue-50/60 flex flex-col items-center justify-center border border-blue-100/70">
              <span class="text-[10px] font-bold text-blue-600 uppercase tracking-wide">${monthStr}</span>
              <span class="text-xl font-extrabold text-slate-900 leading-none">${dayStr}</span>
              <span class="text-[10px] font-medium text-slate-500">${dayOfWeek}</span>
            </div>
            <!-- Avatar & Names -->
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-2xl neo-raised-sm overflow-hidden flex items-center justify-center bg-blue-50 border border-white text-lg">
                👨🏻‍⚕️
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h4 class="text-sm font-bold text-slate-900">${appt.doctor_name}</h4>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold ${severityClass}">${appt.severity}</span>
                  ${appt.is_revisit ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">3-Day Revisit</span>` : ""}
                </div>
                <p class="text-xs text-slate-500 font-medium">${appt.specialty} • ${appt.room_number || 'OPD Room 102'}</p>
              </div>
            </div>
          </div>

          <!-- Status Dot and Cancel Option -->
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full ${isCancelled ? 'bg-slate-400' : 'bg-emerald-500 animate-pulse'}"></span>
              <span class="text-xs font-semibold text-slate-600 hidden sm:inline">${isCancelled ? 'Cancelled' : 'Alert Active'}</span>
            </div>
          </div>
        </div>

        <!-- Middle row: Meta -->
        <div class="flex flex-wrap items-center gap-y-2 gap-x-5 text-xs text-slate-600 pt-1">
          <div class="flex items-center gap-1.5 font-bold text-indigo-700">
            <svg class="w-4 h-4 stroke-current stroke-[2]" fill="none" viewBox="0 0 24 24">
              <path d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            <span>Token: #TK-${appt.token_number}</span>
          </div>
          <div class="flex items-center gap-1.5 font-medium text-slate-600">
            <svg class="w-3.5 h-3.5 text-blue-600 stroke-[2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M6.75 3v2.25M17.25 3v2.253M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            <span>${appt.appointment_date}</span>
          </div>
          <div class="flex items-center gap-1.5 font-medium text-slate-600">
            <svg class="w-3.5 h-3.5 text-blue-600 stroke-[2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            <span>${appt.start_time} - ${appt.end_time}</span>
          </div>
          ${appt.check_in_otp ? `
          <div class="flex items-center gap-1 text-slate-500 font-medium">
            <span>PIN:</span>
            <span class="font-bold text-slate-800">${appt.check_in_otp}</span>
          </div>` : ''}
        </div>

        <!-- Action buttons: Reschedule & Cancel -->
        <div class="flex items-center justify-end gap-3 pt-2">
          ${!isCancelled ? `
          <button class="px-4 py-2 rounded-xl neo-raised text-indigo-700 font-bold text-xs flex items-center gap-1.5 neo-button-interactive cursor-pointer" onclick="showToast('Reschedule requested for slot ${appt.start_time}', 'info')">
            <svg class="w-3.5 h-3.5 stroke-current stroke-[2.2]" fill="none" viewBox="0 0 24 24">
              <path d="M6.75 3v2.25M17.25 3v2.253M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            <span>Reschedule</span>
          </button>
          <button class="cancel-appt-btn px-4 py-2 rounded-xl neo-raised text-rose-500 font-bold text-xs flex items-center gap-1.5 neo-button-interactive cursor-pointer" data-id="${appt.appointment_id}">
            <svg class="w-3.5 h-3.5 stroke-current stroke-[2.5]" fill="none" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            <span>Cancel</span>
          </button>
          ` : `<span class="text-xs font-semibold text-slate-400">Appointment Cancelled</span>`}
        </div>
      </article>
    `;
    })
    .join("");

  // Attach cancel listeners
  container.querySelectorAll(".cancel-appt-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const apptId = btn.dataset.id;
      showConfirmModal("Cancel Appointment", `Are you sure you want to cancel appointment ${apptId}?`, async () => {
        await cancelAppointment(apptId);
        showToast("Appointment cancelled successfully", "warning");
        loadAppointments();
      });
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

function renderDashboardAppointments() {
  const container = document.getElementById("dashboardApptsList");
  if (!container) return;

  const active = appointments.filter((a) => a.status !== "CANCELLED").slice(0, 2);
  if (active.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 p-3">No upcoming appointments scheduled.</p>`;
    return;
  }

  container.innerHTML = active
    .map((a) => {
      const d = new Date(a.appointment_date || Date.now());
      const monthStr = isNaN(d.getTime()) ? "SEP" : d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
      const dayStr = isNaN(d.getTime()) ? "12" : String(d.getDate()).padStart(2, '0');
      const dayOfWeek = isNaN(d.getTime()) ? "Fri" : d.toLocaleString('en-US', { weekday: 'short' });

      return `
      <div class="neu-flat-sm p-3.5 rounded-2xl flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-xl neu-inset flex flex-col items-center justify-center text-center">
            <span class="text-[9px] uppercase font-bold text-slate-400 tracking-wider">${monthStr}</span>
            <span class="text-sm font-extrabold text-blue-600 leading-none">${dayStr}</span>
            <span class="text-[8px] font-semibold text-slate-400">${dayOfWeek}</span>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 rounded-full neu-flat flex items-center justify-center text-xs">👨🏻‍⚕️</div>
              <div class="text-xs font-bold text-slate-800">${a.doctor_name}</div>
            </div>
            <div class="text-[11px] text-slate-400 mt-1">${a.specialty}</div>
            <div class="flex items-center gap-2 mt-1 text-[10px] text-slate-500 font-medium">
              <span>🕒 ${a.start_time}</span>
              <span>📍 ${a.room_number || 'OPD Room 102'}</span>
            </div>
          </div>
        </div>
        <button onclick="showPage('appointments')" aria-label="Appointment details" class="w-7 h-7 rounded-full neu-flat flex items-center justify-center text-slate-400 hover:text-blue-500 transition-colors cursor-pointer">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
          </svg>
        </button>
      </div>
    `;
    })
    .join("");
}

// Quick Booking Form
function setupQuickBookingForm() {
  const form = document.getElementById("quickAppointmentForm");
  if (!form) return;

  // Set default date to tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateInput = document.getElementById("appointmentDate");
  if (dateInput) dateInput.value = tomorrow.toISOString().split("T")[0];

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const specialty = document.getElementById("specialty")?.value;
    const appointmentDate = document.getElementById("appointmentDate")?.value;
    const timeSlot = document.getElementById("appointmentTime")?.value;
    const reason = document.getElementById("appointmentReason")?.value;

    try {
      const res = await quickBookAppointment({
        specialty,
        appointmentDate,
        timeSlot,
        reason,
      });

      if (res.success) {
        showToast(`Token #${res.appointment.token_number} generated for ${specialty}!`, "success");
        form.reset();
        if (dateInput) dateInput.value = tomorrow.toISOString().split("T")[0];
        await loadAppointments();
      } else {
        showToast(res.error || "Booking failed", "warning");
      }
    } catch (err) {
      showToast("Booking failed: " + err.message, "warning");
    }
  });

  // 3-Day Revisit Trigger Button
  const revisitBtn = document.getElementById("quickRevisitTriggerBtn");
  if (revisitBtn) {
    revisitBtn.addEventListener("click", () => {
      showConfirmModal(
        "Schedule 3-Day Follow-Up",
        "Doctor requested a revisit in 3 days. Would you like to schedule with Dr. Rahul Mehta?",
        async () => {
          const res = await scheduleRevisit({
            previousDoctorId: "DOC003",
            days: 3,
          });
          if (res.success) {
            showToast(`Follow-up confirmed! Token #${res.appointment.token_number}`, "success");
            await loadAppointments();
          }
        }
      );
    });
  }
}

// Load and Render Records (Supabase Storage + MongoDB)
async function loadRecords() {
  records = await fetchRecords();
  renderRecordsList(records);
}

function renderRecordsList(list) {
  const container = document.getElementById("recordsList");
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 p-4 text-center">No documents in cloud vault.</p>`;
    return;
  }

  container.innerHTML = list
    .map(
      (rec) => `
    <article class="flex items-center justify-between p-4 hover:bg-slate-50/40 rounded-2xl transition-colors" data-type="${rec.type}">
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 rounded-2xl neo-button flex items-center justify-center text-indigo-600">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" x2="8" y1="13" y2="13"></line>
            <line x1="16" x2="8" y1="17" y2="17"></line>
          </svg>
        </div>
        <div>
          <h3 class="text-sm font-bold text-slate-800">${rec.title}</h3>
          <p class="text-xs font-medium text-slate-400 mt-0.5">${rec.type} • ${rec.date} • Cloud Stored</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button aria-label="View Document" class="preview-record-btn w-10 h-10 neo-icon-btn rounded-full flex items-center justify-center text-slate-500 cursor-pointer" data-title="${rec.title}" data-type="${rec.type}" data-date="${rec.date}" data-text="${rec.extractedText || "No text"}">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </button>
        <a href="${rec.downloadUrl || "#"}" target="_blank" aria-label="Download Document" class="w-10 h-10 neo-icon-btn rounded-full flex items-center justify-center text-slate-500 cursor-pointer">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" x2="12" y1="15" y2="3"></line>
          </svg>
        </a>
      </div>
    </article>
  `
    )
    .join("");

  container.querySelectorAll(".preview-record-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      openRecordPreview(btn.dataset.title, btn.dataset.type, btn.dataset.date, btn.dataset.text);
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

function setupStandaloneRecordUpload() {
  const addBtn = document.getElementById("addRecordBtn");
  const formContainer = document.getElementById("recordFormContainer");
  const form = document.getElementById("recordForm");
  const dropzone = document.getElementById("standaloneFileDropzone");
  const fileInput = document.getElementById("standaloneFileInput");
  const fileNameDisplay = document.getElementById("standaloneFileName");

  if (addBtn && formContainer) {
    addBtn.addEventListener("click", () => formContainer.classList.toggle("hidden"));
  }

  if (dropzone && fileInput) {
    dropzone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        fileNameDisplay.textContent = e.target.files[0].name;
      }
    });
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("recordName")?.value;
      const type = document.getElementById("recordType")?.value;
      const date = document.getElementById("recordDate")?.value;
      const file = fileInput?.files?.[0];

      if (!file) {
        showToast("Please select a file to upload", "warning");
        return;
      }

      showToast("Uploading to Supabase & running Python OCR...", "info");
      const formData = new FormData();
      formData.append("title", title);
      formData.append("type", type);
      formData.append("date", date);
      formData.append("file", file);

      try {
        const res = await uploadMedicalRecord(formData);
        if (res.success) {
          showToast("Document saved & OCR text extracted!", "success");
          form.reset();
          fileNameDisplay.textContent = "Click to upload file (PDF, PNG, JPG)";
          formContainer?.classList.add("hidden");
          await loadRecords();
        } else {
          showToast(res.error || "Upload failed", "warning");
        }
      } catch (err) {
        showToast("Upload failed: " + err.message, "warning");
      }
    });
  }
}

function setupSearchAndFilters() {
  const searchInput = document.getElementById("recordSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = records.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.type.toLowerCase().includes(q) ||
          (r.extractedText && r.extractedText.toLowerCase().includes(q))
      );
      renderRecordsList(filtered);
    });
  }

  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach((c) => {
        c.classList.remove("active", "bg-indigo-600", "text-white");
        c.classList.add("bg-white", "text-slate-600");
      });
      chip.classList.add("active", "bg-indigo-600", "text-white");
      chip.classList.remove("bg-white", "text-slate-600");

      const filter = chip.dataset.filter;
      const filtered = filter === "all" ? records : records.filter((r) => r.type === filter);
      renderRecordsList(filtered);
    });
  });
}

// Global UI Modals & Toasts
window.showToast = function (message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  let bgColors = "bg-slate-900 text-white border-slate-800";
  let icon = "info";

  if (type === "success") {
    bgColors = "bg-emerald-950 text-emerald-100 border-emerald-800";
    icon = "check-circle";
  } else if (type === "warning") {
    bgColors = "bg-amber-950 text-amber-100 border-amber-800";
    icon = "alert-circle";
  }

  toast.className = `pointer-events-auto p-3.5 rounded-xl shadow-lg border text-xs font-medium flex items-center justify-between gap-3 transform transition-all duration-300 translate-y-2 opacity-0 ${bgColors}`;
  toast.innerHTML = `
    <div class="flex items-center gap-2">
      <i data-lucide="${icon}" class="w-4 h-4 shrink-0"></i>
      <span>${message}</span>
    </div>
    <button class="opacity-60 hover:opacity-100 transition" onclick="this.parentElement.remove()">
      <i data-lucide="x" class="w-3.5 h-3.5"></i>
    </button>
  `;

  container.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();

  setTimeout(() => toast.classList.remove("translate-y-2", "opacity-0"), 10);
  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-y-2");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
};

window.showConfirmModal = function (title, message, onConfirm) {
  const modal = document.getElementById("confirmModal");
  const titleEl = document.getElementById("confirmModalTitle");
  const msgEl = document.getElementById("confirmModalMessage");
  const okBtn = document.getElementById("confirmOkBtn");
  const cancelBtn = document.getElementById("confirmCancelBtn");

  if (!modal) return;
  titleEl.textContent = title;
  msgEl.textContent = message;
  modal.classList.remove("hidden");

  const cleanup = () => {
    modal.classList.add("hidden");
    okBtn.onclick = null;
    cancelBtn.onclick = null;
  };

  okBtn.onclick = () => {
    cleanup();
    if (onConfirm) onConfirm();
  };
  cancelBtn.onclick = cleanup;
};

window.openRecordPreview = function (title, type, date, extractedText) {
  const modal = document.getElementById("previewModal");
  if (!modal) return;
  document.getElementById("previewModalTitle").textContent = title;
  document.getElementById("previewModalType").textContent = type;
  document.getElementById("previewModalDate").textContent = date;
  document.getElementById("previewModalExtractedText").textContent =
    extractedText || "No text extracted for this record.";
  modal.classList.remove("hidden");
};

window.closeRecordPreview = function () {
  document.getElementById("previewModal")?.classList.add("hidden");
};
