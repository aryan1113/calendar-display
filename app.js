const DATA_URL = "./data/raw-events.json";
// --- Supabase config ---
// Fill in your Project URL and anon key from Supabase Settings > API.
// These values are safe to commit; they are public by design.
const SUPABASE_URL = "https://xdudwozkvxcttadtuksg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_syX5In3Y1M3ZFwJdbCIaXA__mt5-WP_";
const FN_BASE = `${SUPABASE_URL}/functions/v1`;

const SESSION_STORAGE_KEY = "calendar-display-admin-session-v1";

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
];

const state = {
  baseEvents: [],
  events: [],
  courseMap: new Map(),
  courseIndexMap: new Map(),
  selectedCourses: new Set(),
  search: "",
  shareName: "",
  weekOffset: 0,
  weekLabelText: "Current week",
  updates: [],
  auditLog: [],
  adminSession: null,
  auditLogDisplayCount: 3,
  activeUpdatesDisplayCount: 3
};

const EXPORT_IMAGE_NAME = "iimk-timetable.png";

function toSafeFileSlug(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function parseIsoToLocalDate(isoDateTime) {
  if (!isoDateTime) return null;
  const m = isoDateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6])
  );
}

function parseYmdToLocalDate(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

function toYmd(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toIsoWithTimeFromYmd(ymd, hhmmss) {
  return `${ymd}T${hhmmss}`;
}

function dateOnlyFromIso(isoDateTime) {
  const m = String(isoDateTime || "").match(/^(\d{4}-\d{2}-\d{2})T/);
  return m ? m[1] : null;
}

function timeOnlyFromIso(isoDateTime) {
  const m = String(isoDateTime || "").match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})$/);
  return m ? m[1] : null;
}

function getSessionJson(key, fallback) {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function setSessionJson(key, value) {
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

function removeSessionKey(key) {
  window.sessionStorage.removeItem(key);
}

async function callFunction(name, body) {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`❌ ${name} error response:`, data);
    console.error(`Request body was:`, body);
    throw new Error(data.error || `Function ${name} failed (${res.status})`);
  }
  return data;
}

function mapUpdateFromApi(row) {
  return {
    id: row.id,
    courseKey: row.course_key,
    updateType: row.update_type,
    effectiveMode: row.effective_mode,
    startDate: row.start_date,
    endDate: row.end_date,
    newVenue: row.new_venue ?? "",
    newStartTime: row.new_start_time ? String(row.new_start_time).slice(0, 5) : "",
    newEndTime: row.new_end_time ? String(row.new_end_time).slice(0, 5) : "",
    reason: row.reason ?? "",
    adminId: row.admin_id,
    createdAt: row.created_at,
    isDeleted: row.is_deleted ?? false,
    eventId: row.event_id ?? null,
    classCode: row.class_code ?? null
  };
}

function mapAuditFromApi(row) {
  return {
    id: row.id,
    timestamp: row.action_ts,
    adminId: row.admin_id,
    courseKey: row.course_key,
    updateType: row.update_type,
    startDate: row.start_date ?? "-",
    endDate: row.end_date ?? "-",
    prevState: row.prev_state ?? "",
    newState: row.new_state ?? "",
    reason: row.reason ?? ""
  };
}

function formatUpdateType(type) {
  if (type === "cancellation") return "Cancellation";
  if (type === "venue_change") return "Venue Change";
  if (type === "time_change") return "Time Change";
  return "Update";
}

function findDuplicateUpdate(courseKey, updateType, startDate, endDate, newVenue, newStartTime, newEndTime) {
  return state.updates.find(update => {
    if (update.isDeleted) return false;
    if (update.courseKey !== courseKey) return false;
    if (update.updateType !== updateType) return false;
    if (update.startDate !== startDate || update.endDate !== endDate) return false;

    if (updateType === "venue_change" && update.newVenue !== newVenue) return false;
    if (updateType === "time_change" && (update.newStartTime !== newStartTime || update.newEndTime !== newEndTime)) return false;

    return true;
  });
}

function getWeekRange(weekOffset = 0) {
  const now = new Date();
  const monday = new Date(now);
  const day = monday.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + mondayOffset);
  monday.setDate(monday.getDate() + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

function isEventInWeek(event, weekRange) {
  const d = parseIsoToLocalDate(event.start);
  if (!d) return false;
  return d >= weekRange.start && d <= weekRange.end;
}

function hasSelectedEventsInWeek(weekOffset) {
  if (!state.selectedCourses.size) return false;

  const weekRange = getWeekRange(weekOffset);
  return state.events.some(
    (event) => state.selectedCourses.has(normalizeCourseKey(event)) && isEventInWeek(event, weekRange)
  );
}

function buildCourseIndexMap(courseMap) {
  const indexMap = new Map();
  [...courseMap.keys()].forEach((key, idx) => {
    indexMap.set(key, idx.toString(36));
  });
  return indexMap;
}

function getSelectionFromUrl(courseMap, courseIndexMap) {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("c");
  if (!raw) return new Set();

  const reverse = new Map([...courseIndexMap.entries()].map(([key, id]) => [id, key]));
  const next = new Set();

  raw
    .split(".")
    .map((v) => v.trim())
    .filter(Boolean)
    .forEach((encodedId) => {
      const key = reverse.get(encodedId);
      if (key && courseMap.has(key)) {
        next.add(key);
      }
    });

  return next;
}

function getShareNameFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("n") || "").trim();
}

function writeSelectionToUrl() {
  const selectedIds = [...state.selectedCourses]
    .map((key) => state.courseIndexMap.get(key))
    .filter(Boolean)
    .sort();

  const params = new URLSearchParams(window.location.search);
  if (selectedIds.length) {
    params.set("c", selectedIds.join("."));
  } else {
    params.delete("c");
  }

  if (state.shareName) {
    params.set("n", state.shareName);
  } else {
    params.delete("n");
  }

  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", nextUrl);
}

async function copyShareLink() {
  const btn = document.querySelector("#copy-link");
  if (!btn) return;

  const link = window.location.href;
  try {
    await writeTextToClipboard(link);
    btn.textContent = "Copied";
  } catch (_) {
    btn.textContent = "Copy failed";
  }

  setTimeout(() => {
    btn.textContent = "Copy share link";
  }, 1200);
}

async function writeTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const ok = document.execCommand("copy");
  textarea.remove();

  if (!ok) {
    throw new Error("Clipboard copy is not available.");
  }
}

async function downloadBlob(blob, fileName) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function getShareIntroText() {
  const name = state.shareName || "Someone";
  return `Checkout ${name}'s timetable from: ${window.location.href}`;
}

async function copyCustomShareText() {
  const btn = document.querySelector("#copy-share-text");
  if (!btn) return;

  const text = getShareIntroText();
  try {
    await writeTextToClipboard(text);
    btn.textContent = "Text copied";
  } catch (_) {
    btn.textContent = "Copy failed";
  }

  setTimeout(() => {
    btn.textContent = "Copy share text";
  }, 1200);
}

function buildCaptureMarkup() {
  const table = document.querySelector("#timetable");
  if (!table) return "";

  const selectedCount = state.selectedCourses.size;
  const selectedLabel = selectedCount === 1 ? "course" : "courses";
  const namePrefix = state.shareName ? `${escapeHtml(state.shareName)}'s` : "My";

  return `
    <div class="capture-card">
      <h3>${namePrefix} IIMK Timetable</h3>
      <p class="capture-subtitle">${escapeHtml(state.weekLabelText)}</p>
      <p class="capture-meta">${selectedCount} ${selectedLabel} selected</p>
      ${table.outerHTML}
    </div>
  `;
}

async function getTimetableBlob() {
  const captureRoot = document.querySelector("#capture-root");
  if (!captureRoot) {
    throw new Error("Capture area not found.");
  }

  captureRoot.innerHTML = buildCaptureMarkup();

  const card = captureRoot.querySelector(".capture-card");
  if (!card) {
    throw new Error("Could not build timetable capture.");
  }

  if (typeof window.html2canvas !== "function") {
    throw new Error("Image exporter is not loaded yet. Please refresh and try again.");
  }

  const canvas = await window.html2canvas(card, {
    backgroundColor: "#fffdf9",
    scale: 2,
    useCORS: true,
    logging: false
  });

  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      captureRoot.innerHTML = "";
      if (!blob) {
        reject(new Error("Failed to convert image."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function setButtonState(selector, disabled, textWhenBusy) {
  const btn = document.querySelector(selector);
  if (!btn) return;

  if (disabled) {
    btn.setAttribute("disabled", "true");
    if (textWhenBusy) {
      btn.dataset.prevText = btn.textContent;
      btn.textContent = textWhenBusy;
    }
    return;
  }

  btn.removeAttribute("disabled");
  if (btn.dataset.prevText) {
    btn.textContent = btn.dataset.prevText;
    delete btn.dataset.prevText;
  }
}

async function downloadTimetableImage() {
  if (!state.selectedCourses.size) {
    window.alert("Select at least one course before exporting an image.");
    return;
  }

  setButtonState("#download-image", true, "Preparing...");
  try {
    const blob = await getTimetableBlob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeName = toSafeFileSlug(state.shareName);
    const fileName = safeName ? `iimk-timetable-${safeName}.png` : EXPORT_IMAGE_NAME;
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    window.alert(err.message || "Could not export the image.");
  } finally {
    setButtonState("#download-image", false);
  }
}

async function shareTimetableImage() {
  if (!state.selectedCourses.size) {
    window.alert("Select at least one course before sharing an image.");
    return;
  }

  setButtonState("#share-image", true, "Preparing...");
  try {
    const blob = await getTimetableBlob();
    const safeName = toSafeFileSlug(state.shareName);
    const fileName = safeName ? `iimk-timetable-${safeName}.png` : EXPORT_IMAGE_NAME;
    const file = new File([blob], fileName, { type: "image/png" });

    if (!navigator.share) {
      await downloadBlob(blob, fileName);
      await writeTextToClipboard(getShareIntroText()).catch(() => {});
      window.alert("Native share is not available in this browser. The image was downloaded instead.");
      return;
    }

    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      await downloadBlob(blob, fileName);
      await writeTextToClipboard(getShareIntroText()).catch(() => {});
      window.alert("This browser cannot share image files. The image was downloaded instead.");
      return;
    }

    await navigator.share({
      files: [file],
      text: getShareIntroText(),
      title: "IIMK Timetable"
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      return;
    }
    window.alert(err.message || "Could not share the timetable image.");
  } finally {
    setButtonState("#share-image", false);
  }
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeCourseKey(event) {
  const subject = (event.subject || "").trim();
  const batch = (event.batch || "").trim();
  return batch ? `${subject} [Batch ${batch}]` : subject;
}

function normalizeLocation(location) {
  const raw = String(location || "").trim();
  if (!raw) return "";

  return raw.replace(/\s*,\s*iim\s*kozhikode\s*$/i, "").trim();
}

function getWeekdayName(isoDateTime) {
  if (!isoDateTime) return null;
  // Parse as local date parts to avoid timezone shifting in the browser.
  const m = isoDateTime.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return DAYS[date.getDay() === 0 ? 6 : date.getDay() - 1];
}

function getSlotLabel(isoDateTime) {
  if (!isoDateTime) return null;
  const m = isoDateTime.match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}):\d{2}$/);
  return m ? m[1] : null;
}

function isEventOnLocalDate(event, targetDate) {
  const eventDate = parseIsoToLocalDate(event.start);
  if (!eventDate || !targetDate) return false;

  return (
    eventDate.getFullYear() === targetDate.getFullYear() &&
    eventDate.getMonth() === targetDate.getMonth() &&
    eventDate.getDate() === targetDate.getDate()
  );
}

function buildCourseMap(events) {
  const map = new Map();

  for (const event of events) {
    const key = normalizeCourseKey(event);
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        key,
        subject: event.subject || "Untitled",
        batch: event.batch || "",
        faculty: event.faculty || "",
        section: event.section || ""
      });
    }
  }

  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function updateAffectsEvent(update, event) {
  if (!update || !event) return false;
  if (normalizeCourseKey(event) !== update.courseKey) return false;

  const eventDateYmd = dateOnlyFromIso(event.start);
  if (!eventDateYmd) return false;
  return eventDateYmd >= update.startDate && eventDateYmd <= update.endDate;
}

function applyUpdatesToEvents(baseEvents, updates) {
  const sortedUpdates = [...updates].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let working = baseEvents.map((event) => ({ ...event }));

  for (const update of sortedUpdates) {
    if (!update || update.isDeleted) continue;

    if (update.updateType === "bulk_add") {
      // Find course by class code in base events
      const courseCode = update.classCode;
      const normalizedCode = courseCode.toUpperCase().trim();

      const courseEvent = baseEvents.find(event => {
        const abbrev = (event.abbreviation || "").toUpperCase().trim();
        const batch = (event.batch || "").toUpperCase().trim();

        // Exact matches
        if (abbrev === normalizedCode) return true;
        if (abbrev && batch && `${abbrev}-${batch}` === normalizedCode) return true;
        if (abbrev && batch && `${abbrev}${batch}` === normalizedCode) return true;

        // Prefix match: user code is prefix of abbreviation (e.g., "HSCM" matches "HSCM (LSM)")
        const abbrevBase = abbrev.split(/[\s(]/)[0].trim();
        if (abbrevBase === normalizedCode) return true;

        // Batch suffix match with prefix (e.g., "GT-A" matches abbreviated "GT" with batch "A")
        if (abbrevBase && batch) {
          if (`${abbrevBase}-${batch}` === normalizedCode) return true;
          if (`${abbrevBase}${batch}` === normalizedCode) return true;
        }

        return false;
      });

      if (courseEvent) {
        const startTime = update.newStartTime || update.startTime;
        const endTime = update.newEndTime || update.endTime;
        const syntheticId = `${update.startDate}T${startTime.replace(':', '')}00-${courseCode}@bulk-import`;

        // Check if already added
        if (!working.find(e => e.id === syntheticId)) {
          const startISO = toIsoWithTimeFromYmd(update.startDate, `${startTime}:00`);
          const endISO = toIsoWithTimeFromYmd(update.startDate, `${endTime}:00`);

          working.push({
            ...courseEvent,
            id: syntheticId,
            start: startISO,
            end: endISO,
            __addedBy: update.id,
            __isNew: true
          });
        }
      }
      continue;
    }

    working = working
      .map((event) => {
        if (!updateAffectsEvent(update, event)) {
          return event;
        }

        if (update.updateType === "cancellation") {
          return { ...event, __cancelledBy: update.id };
        }

        if (update.updateType === "venue_change") {
          return {
            ...event,
            location: update.newVenue || event.location,
            __changedBy: update.id
          };
        }

        if (update.updateType === "time_change") {
          const eventDate = dateOnlyFromIso(event.start);
          if (!eventDate) return event;

          const nextStart = toIsoWithTimeFromYmd(eventDate, `${update.newStartTime}:00`);
          const nextEnd = toIsoWithTimeFromYmd(eventDate, `${update.newEndTime}:00`);

          return {
            ...event,
            start: nextStart,
            end: nextEnd,
            __changedBy: update.id
          };
        }

        return event;
      })
  }

  return working;
}

function loadAdminSession() {
  const saved = getSessionJson(SESSION_STORAGE_KEY, null);
  state.adminSession = saved && saved.adminId && saved.token ? saved : null;
}

function saveAdminSession() {
  if (state.adminSession) {
    setSessionJson(SESSION_STORAGE_KEY, state.adminSession);
  } else {
    removeSessionKey(SESSION_STORAGE_KEY);
  }
}

async function fetchPublicData() {
  try {
    const data = await callFunction("get-public-data", {});
    state.updates = (data.updates ?? []).map(mapUpdateFromApi);
    state.auditLog = (data.auditLog ?? []).map(mapAuditFromApi);
    state.auditLogDisplayCount = 3;
    state.activeUpdatesDisplayCount = 3;
  } catch (_) {
    // Non-fatal: fall back to empty; timetable still renders from base events.
    state.updates = [];
    state.auditLog = [];
    state.auditLogDisplayCount = 3;
    state.activeUpdatesDisplayCount = 3;
  }
}

function buildAdminSummary(update, affectedEventsBefore) {
  const total = affectedEventsBefore.length;
  const oldVenueSet = new Set(affectedEventsBefore.map((v) => normalizeLocation(v.location || "")).filter(Boolean));
  const oldTimeSet = new Set(affectedEventsBefore.map((v) => `${getSlotLabel(v.start)}-${getSlotLabel(v.end)}`));

  if (update.updateType === "cancellation") {
    return {
      prevState: `${total} classes scheduled`,
      newState: `${total} classes cancelled`
    };
  }

  if (update.updateType === "venue_change") {
    const prevVenue = [...oldVenueSet].join(" | ") || "Venue TBA";
    return {
      prevState: `Venue: ${prevVenue}`,
      newState: `Venue: ${update.newVenue}`
    };
  }

  if (update.updateType === "time_change") {
    const prevTime = [...oldTimeSet].join(" | ");
    return {
      prevState: `Time: ${prevTime || "Unknown"}`,
      newState: `Time: ${update.newStartTime}-${update.newEndTime}`
    };
  }

  return { prevState: "Updated", newState: "Updated" };
}

function renderActiveUpdates() {
  const box = document.querySelector("#active-updates");
  if (!box) return;

  let updates = [...state.updates]
    .filter((item) => !item.isDeleted)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Deduplication: keep only the latest update for each unique (courseKey, prevState, newState, adminId)
  const seen = new Set();
  const dedupedUpdates = [];
  for (const update of updates) {
    const key = `${update.courseKey}|${update.prevState}|${update.newState}|${update.adminId}`;
    if (!seen.has(key)) {
      seen.add(key);
      dedupedUpdates.push(update);
    }
  }
  updates = dedupedUpdates;

  if (!updates.length) {
    box.innerHTML = '<div class="update-item"><p class="helper-text">No active updates right now.</p></div>';
    return;
  }

  const visibleUpdates = updates.slice(0, state.activeUpdatesDisplayCount);
  const hasMore = updates.length > state.activeUpdatesDisplayCount;

  let html = visibleUpdates
    .map((item) => {
      const dateLabel = item.startDate === item.endDate ? item.startDate : `${item.startDate} to ${item.endDate}`;
      const note = item.reason ? `<p class="update-meta">Reason: ${escapeHtml(item.reason)}</p>` : "";
      return `
        <article class="update-item">
          <h3>${escapeHtml(item.courseKey)} <span class="pill-type">${escapeHtml(formatUpdateType(item.updateType))}</span></h3>
          <p class="update-meta">Effective: ${escapeHtml(dateLabel)} | Updated by ${escapeHtml(item.adminId)}</p>
          ${note}
        </article>
      `;
    })
    .join("");

  if (hasMore) {
    html += `<button id="show-more-updates" class="ghost-btn" type="button" style="width: 100%; margin-top: 1rem;">Show more updates (${updates.length - state.activeUpdatesDisplayCount} more)</button>`;
  }

  box.innerHTML = html;

  if (hasMore) {
    const showMoreBtn = document.querySelector("#show-more-updates");
    if (showMoreBtn) {
      showMoreBtn.addEventListener("click", () => {
        state.activeUpdatesDisplayCount += 3;
        renderActiveUpdates();
      });
    }
  }
}

function renderAuditLog() {
  const box = document.querySelector("#audit-log");
  if (!box) return;

  const logs = [...state.auditLog].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (!logs.length) {
    box.innerHTML = '<div class="audit-item"><p class="helper-text">No admin actions logged yet.</p></div>';
    return;
  }

  const visibleLogs = logs.slice(0, state.auditLogDisplayCount);
  const hasMore = logs.length > state.auditLogDisplayCount;

  let html = visibleLogs
    .map((item) => {
      const dateLabel = item.startDate === item.endDate ? item.startDate : `${item.startDate} to ${item.endDate}`;
      const reason = item.reason ? `<p class="audit-meta">Reason: ${escapeHtml(item.reason)}</p>` : "";
      return `
        <article class="audit-item">
          <h3>${escapeHtml(item.adminId)} updated ${escapeHtml(item.courseKey)}</h3>
          <p class="audit-meta">${escapeHtml(formatUpdateType(item.updateType))} | ${escapeHtml(dateLabel)} | ${escapeHtml(item.timestamp)}</p>
          <p class="audit-meta">From: ${escapeHtml(item.prevState)}</p>
          <p class="audit-meta">To: ${escapeHtml(item.newState)}</p>
          ${reason}
        </article>
      `;
    })
    .join("");

  if (hasMore) {
    html += `<button id="show-more-logs" class="ghost-btn" type="button" style="width: 100%; margin-top: 1rem;">Show more logs (${logs.length - state.auditLogDisplayCount} more)</button>`;
  }

  box.innerHTML = html;

  if (hasMore) {
    const showMoreBtn = document.querySelector("#show-more-logs");
    if (showMoreBtn) {
      showMoreBtn.addEventListener("click", () => {
        state.auditLogDisplayCount += 3;
        renderAuditLog();
      });
    }
  }
}

function renderAdminUi() {
  const form = document.querySelector("#admin-update-form");
  const bulkForm = document.querySelector("#admin-bulk-form");
  const tabs = document.querySelector(".admin-tabs");
  const tabSingleBtn = document.querySelector("#admin-tab-single");
  const status = document.querySelector("#admin-auth-status");
  const loginBtn = document.querySelector("#admin-login");
  const logoutBtn = document.querySelector("#admin-logout");
  const courseSelect = document.querySelector("#admin-course");
  const auditPanel = document.querySelector(".audit-panel");
  if (!form || !status || !loginBtn || !logoutBtn || !courseSelect) return;

  if (state.adminSession && state.adminSession.adminId) {
    if (auditPanel) auditPanel.style.display = "block";
    status.textContent = `Signed in as ${state.adminSession.adminId}`;
    if (tabs) tabs.style.display = "flex";
    form.style.display = "grid";
    bulkForm.style.display = "none";
    if (tabSingleBtn) tabSingleBtn.classList.add("active");
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
  } else {
    if (auditPanel) auditPanel.style.display = "none";
    status.textContent = "Not signed in";
    if (tabs) tabs.style.display = "none";
    form.style.display = "none";
    bulkForm.style.display = "none";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
  }

  const courseOptions = [...state.courseMap.keys()]
    .map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(key)}</option>`)
    .join("");
  courseSelect.innerHTML = courseOptions;
}

function toggleAdminFieldVisibility() {
  const updateType = document.querySelector("#admin-update-type")?.value;
  const mode = document.querySelector("#admin-effective-mode")?.value;
  const endDate = document.querySelector("#admin-end-date");

  const venueFields = document.querySelectorAll(".js-venue-field");
  const timeFields = document.querySelectorAll(".js-time-field");

  venueFields.forEach((el) => {
    el.hidden = updateType !== "venue_change";
  });

  timeFields.forEach((el) => {
    el.hidden = updateType !== "time_change";
  });

  if (endDate) {
    endDate.disabled = mode !== "range";
    if (mode !== "range") {
      endDate.value = "";
    }
  }
}

function refreshDerivedEvents() {
  state.events = applyUpdatesToEvents(state.baseEvents, state.updates);
  state.courseMap = buildCourseMap(state.events);
  state.courseIndexMap = buildCourseIndexMap(state.courseMap);

  const cleaned = new Set();
  for (const key of state.selectedCourses) {
    if (state.courseMap.has(key)) {
      cleaned.add(key);
    }
  }
  state.selectedCourses = cleaned;
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function fuzzySubsequenceScore(text, query) {
  const haystack = normalizeSearchText(text);
  const needle = normalizeSearchText(query);

  if (!needle) return 0;
  if (!haystack) return Number.POSITIVE_INFINITY;

  let score = 0;
  let lastPos = -1;

  for (const ch of needle) {
    const pos = haystack.indexOf(ch, lastPos + 1);
    if (pos === -1) {
      return Number.POSITIVE_INFINITY;
    }

    if (lastPos === -1) {
      score += pos;
    } else {
      score += pos - lastPos - 1;
    }

    lastPos = pos;
  }

  // Prefer tighter matches and slightly favor shorter text fields.
  score += Math.max(0, haystack.length - needle.length) * 0.02;
  return score;
}

function levenshteinDistance(a, b) {
  const s = normalizeSearchText(a);
  const t = normalizeSearchText(b);
  const m = s.length;
  const n = t.length;

  if (!m) return n;
  if (!n) return m;

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j += 1) prev[j] = j;

  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

function typoFuzzyScore(text, query) {
  const haystack = normalizeSearchText(text);
  const needle = normalizeSearchText(query);

  if (!needle) return 0;
  if (!haystack) return Number.POSITIVE_INFINITY;

  const hayTokens = haystack.split(" ").filter(Boolean);
  const queryTokens = needle.split(" ").filter(Boolean);

  // Compare each query token with the closest token in the field.
  let tokenDistanceSum = 0;
  for (const qTok of queryTokens) {
    let best = Number.POSITIVE_INFINITY;
    for (const hTok of hayTokens) {
      const d = levenshteinDistance(qTok, hTok);
      if (d < best) best = d;
      if (best === 0) break;
    }
    tokenDistanceSum += best;
  }

  const wholeDistance = levenshteinDistance(needle, haystack);
  return Math.min(tokenDistanceSum, wholeDistance);
}

function filterCourseEntries() {
  const q = normalizeSearchText(state.search);
  const entries = [...state.courseMap.values()];

  if (!q) return entries;

  if (q.length === 1) {
    return entries.filter((course) => {
      const hay = [course.subject, course.batch, course.faculty, course.section, course.key]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  const subsequenceThreshold = q.length <= 3 ? 1.8 : q.length <= 5 ? 3.2 : 5.2;
  const typoThreshold = q.length <= 4 ? 2 : q.length <= 8 ? 2 : 3;
  const ranked = [];

  for (const course of entries) {
    const subjectText = normalizeSearchText(course.subject);
    const facultyText = normalizeSearchText(course.faculty);
    const batchText = normalizeSearchText(course.batch);
    const sectionText = normalizeSearchText(course.section);

    if ((batchText && batchText.includes(q)) || (sectionText && sectionText.includes(q))) {
      ranked.push({ course, matchType: 0, score: 0 });
      continue;
    }

    if ((subjectText && subjectText.includes(q)) || (facultyText && facultyText.includes(q))) {
      ranked.push({ course, matchType: 1, score: 0 });
      continue;
    }

    const subjectScore = fuzzySubsequenceScore(course.subject, q);
    const facultyScore = fuzzySubsequenceScore(course.faculty, q);
    const typoSubjectScore = typoFuzzyScore(course.subject, q);
    const typoFacultyScore = typoFuzzyScore(course.faculty, q);
    const bestSubsequenceScore = Math.min(subjectScore, facultyScore);
    const bestTypoScore = Math.min(typoSubjectScore, typoFacultyScore);

    if (bestTypoScore <= typoThreshold || bestSubsequenceScore <= subsequenceThreshold) {
      // Prioritize typo distance first, then subsequence as a tiebreaker.
      ranked.push({ course, matchType: 2, score: bestTypoScore + bestSubsequenceScore * 0.01 });
    }
  }

  ranked.sort(
    (a, b) =>
      a.matchType - b.matchType || a.score - b.score || a.course.key.localeCompare(b.course.key)
  );

  return ranked.map((item) => item.course);
}

function renderCourseList() {
  const list = document.querySelector("#course-list");
  const filtered = filterCourseEntries();

  if (!filtered.length) {
    list.innerHTML = '<li class="course-item">No courses match this search.</li>';
    return;
  }

  list.innerHTML = filtered
    .map((course) => {
      const isSelected = state.selectedCourses.has(course.key);
      return `
        <li class="course-item ${isSelected ? "selected" : ""}" data-course-key="${escapeHtml(course.key)}">
          <div class="course-title">${escapeHtml(course.subject)}${
            course.batch ? ` <span>(Batch ${escapeHtml(course.batch)})</span>` : ""
          }</div>
          <div class="course-meta">Faculty: ${escapeHtml(course.faculty || "N/A")} | Section: ${escapeHtml(course.section || "N/A")}</div>
        </li>
      `;
    })
    .join("");
}

function renderSelectedCourses() {
  const box = document.querySelector("#selected-courses");
  const count = document.querySelector("#selected-count");

  const selected = [...state.selectedCourses].sort((a, b) => a.localeCompare(b));
  count.textContent = `${selected.length} selected`;

  if (!selected.length) {
    box.innerHTML = '<span class="helper-text">No courses selected.</span>';
    return;
  }

  box.innerHTML = selected.map((key) => `<span class="tag">${escapeHtml(key)}</span>`).join("");
}

function buildTimetableData() {
  const selected = state.selectedCourses;
  const weekRange = getWeekRange(state.weekOffset);
  const selectedCourseEvents = state.events.filter((event) => selected.has(normalizeCourseKey(event)));

  const currentWeekEvents = selectedCourseEvents.filter((event) => isEventInWeek(event, weekRange));
  const rows = DAYS.map((day) => ({ key: day, label: day }));

  const slots = Array.from(
    new Set(
      currentWeekEvents
        .map((event) => getSlotLabel(event.start))
        .filter(Boolean)
    )
  ).sort();

  const grid = {};
  for (const row of rows) {
    grid[row.key] = {};
    for (const slot of slots) {
      grid[row.key][slot] = [];
    }
  }

  for (const event of currentWeekEvents) {
    const day = getWeekdayName(event.start);
    const slot = getSlotLabel(event.start);
    if (!day || !slot || !grid[day] || !grid[day][slot]) continue;

    const entry = {
      subject: event.subject || "Untitled",
      batch: event.batch || "",
      location: normalizeLocation(event.location),
      section: event.section || "",
      cancelled: !!event.__cancelledBy,
      isNew: !!event.__isNew
    };

    const dedupeKey = `${entry.subject}||${entry.batch}||${entry.location}||${entry.section}`;
    const seen = new Set(
      grid[day][slot].map((item) => `${item.subject}||${item.batch}||${item.location}||${item.section}`)
    );
    if (!seen.has(dedupeKey)) {
      grid[day][slot].push(entry);
    }
  }

  for (const row of rows) {
    for (const slot of slots) {
      grid[row.key][slot].sort((a, b) => {
        const aKey = `${a.subject} ${a.batch} ${a.location}`;
        const bKey = `${b.subject} ${b.batch} ${b.location}`;
        return aKey.localeCompare(bKey);
      });
    }
  }

  return { slots, grid, weekRange, rows };
}

function renderTimetable() {
  const table = document.querySelector("#timetable");
  const { slots, grid, weekRange, rows } = buildTimetableData();
  const label = document.querySelector("#week-label");
  const prevWeekBtn = document.querySelector("#prev-week");
  const nextWeekBtn = document.querySelector("#next-week");
  const today = new Date();
  const todayKey = DAYS[today.getDay() === 0 ? 6 : today.getDay() - 1];
  const isViewingCurrentWeek = state.weekOffset === 0;

  if (label) {
    const fmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" });
    const prefix = state.weekOffset === 0 ? "Current week" : state.weekOffset > 0 ? `Week +${state.weekOffset}` : `Week ${state.weekOffset}`;
    state.weekLabelText = `${prefix}: ${fmt.format(weekRange.start)} - ${fmt.format(weekRange.end)}`;
    label.textContent = state.weekLabelText;
  }

  if (prevWeekBtn) {
    prevWeekBtn.disabled = state.weekOffset <= 0;
  }

  if (nextWeekBtn) {
    nextWeekBtn.disabled = !hasSelectedEventsInWeek(state.weekOffset + 1);
  }

  if (!state.selectedCourses.size) {
    table.innerHTML = `
      <thead>
        <tr><th>Day</th><th>Select at least one course to build timetable</th></tr>
      </thead>
    `;
    return;
  }

  if (!slots.length) {
    table.innerHTML = `
      <thead>
        <tr><th>Day</th><th>No time slots found for selected courses</th></tr>
      </thead>
    `;
    return;
  }

  const head = `
    <thead>
      <tr>
        <th>Day</th>
        ${slots.map((slot) => `<th>${escapeHtml(slot)}</th>`).join("")}
      </tr>
    </thead>
  `;

  const bodyRows = rows.map((row) => {
    const rowDate = new Date(weekRange.start);
    rowDate.setDate(weekRange.start.getDate() + DAYS.indexOf(row.key));
    const isToday =
      isViewingCurrentWeek &&
      row.key === todayKey &&
      rowDate.getFullYear() === today.getFullYear() &&
      rowDate.getMonth() === today.getMonth() &&
      rowDate.getDate() === today.getDate();
    const rowClass = [isToday ? "row-today" : ""]
      .filter(Boolean)
      .join(" ");

    const rowLabel = `${escapeHtml(row.label)}${
      isToday ? '<span class="day-pill">Today</span>' : ""
    }`;

    const cols = slots
      .map((slot) => {
        const entries = grid[row.key][slot] || [];
        if (!entries.length) return "<td></td>";

        const content = entries
          .map(
            (entry) =>
              `<span class="${entry.isNew ? 'slot-title slot-new' : entry.cancelled ? 'slot-title slot-cancelled' : 'slot-title'}">${escapeHtml(entry.subject)}${
                entry.batch ? ` (Batch ${escapeHtml(entry.batch)})` : ""
              }</span>${entry.isNew ? '<span class="slot-new-badge">New</span>' : ''} ${entry.cancelled ? '<span class="slot-cancelled-badge">Cancelled</span>' : ''}<span class="${entry.isNew ? 'slot-venue slot-new' : entry.cancelled ? 'slot-venue slot-cancelled' : 'slot-venue'}">${escapeHtml(entry.location || "Venue TBA")}</span>`
          )
          .join("<hr>");

        const hasCancelled = entries.some((e) => e.cancelled);
        const hasNew = entries.some((e) => e.isNew);
        const hasActive = entries.some((e) => !e.cancelled && !e.isNew);
        let tdClass = "filled";
        if (!hasActive && hasCancelled) tdClass = "filled cell-all-cancelled";
        else if (hasNew && !hasActive) tdClass = "filled cell-all-new";
        else if (hasNew) tdClass = "filled cell-has-new";
        return `<td class="${tdClass}">${content}</td>`;
      })
      .join("");

    return `<tr class="${rowClass}"><th>${rowLabel}</th>${cols}</tr>`;
  }).join("");

  table.innerHTML = `${head}<tbody>${bodyRows}</tbody>`;
}

function rerender() {
  writeSelectionToUrl();
  renderCourseList();
  renderSelectedCourses();
  renderTimetable();
  renderActiveUpdates();
  renderAuditLog();
  renderAdminUi();
  toggleAdminFieldVisibility();
}

function bindEvents() {
  const searchInput = document.querySelector("#course-search");
  const list = document.querySelector("#course-list");
  const clearBtn = document.querySelector("#clear-selection");
  const copyBtn = document.querySelector("#copy-link");
  const copyShareTextBtn = document.querySelector("#copy-share-text");
  const downloadImageBtn = document.querySelector("#download-image");
  const shareImageBtn = document.querySelector("#share-image");
  const prevWeekBtn = document.querySelector("#prev-week");
  const nextWeekBtn = document.querySelector("#next-week");
  const shareNameInput = document.querySelector("#share-name");
  const adminPasscodeInput = document.querySelector("#admin-passcode");
  const adminLoginBtn = document.querySelector("#admin-login");
  const adminLogoutBtn = document.querySelector("#admin-logout");
  const adminPasscodeToggle = document.querySelector("#admin-passcode-toggle");
  const adminUpdateForm = document.querySelector("#admin-update-form");
  const adminTypeSelect = document.querySelector("#admin-update-type");
  const adminModeSelect = document.querySelector("#admin-effective-mode");
  const adminClearUpdatesBtn = document.querySelector("#admin-clear-updates");

  searchInput.addEventListener("input", (e) => {
    state.search = e.target.value || "";
    renderCourseList();
  });

  list.addEventListener("click", (e) => {
    const item = e.target.closest("[data-course-key]");
    if (!item) return;

    const key = item.getAttribute("data-course-key");
    if (!key) return;

    if (state.selectedCourses.has(key)) {
      state.selectedCourses.delete(key);
    } else {
      state.selectedCourses.add(key);
    }

    rerender();
  });

  clearBtn.addEventListener("click", () => {
    state.selectedCourses.clear();
    rerender();
  });

  if (copyBtn) {
    copyBtn.addEventListener("click", copyShareLink);
  }

  if (copyShareTextBtn) {
    copyShareTextBtn.addEventListener("click", copyCustomShareText);
  }

  if (downloadImageBtn) {
    downloadImageBtn.addEventListener("click", downloadTimetableImage);
  }

  if (shareImageBtn) {
    shareImageBtn.addEventListener("click", shareTimetableImage);
  }

  if (shareNameInput) {
    shareNameInput.addEventListener("input", (e) => {
      state.shareName = (e.target.value || "").trim();
      writeSelectionToUrl();
    });
  }

  if (prevWeekBtn) {
    prevWeekBtn.addEventListener("click", () => {
      if (state.weekOffset <= 0) return;
      state.weekOffset -= 1;
      renderTimetable();
    });
  }

  if (nextWeekBtn) {
    nextWeekBtn.addEventListener("click", () => {
      if (!hasSelectedEventsInWeek(state.weekOffset + 1)) return;
      state.weekOffset += 1;
      renderTimetable();
    });
  }

  if (adminTypeSelect) {
    adminTypeSelect.addEventListener("change", toggleAdminFieldVisibility);
  }

  if (adminPasscodeToggle && adminPasscodeInput) {
    adminPasscodeToggle.addEventListener("click", () => {
      const isHidden = adminPasscodeInput.type === "password";
      adminPasscodeInput.type = isHidden ? "text" : "password";
      adminPasscodeToggle.setAttribute("aria-label", isHidden ? "Hide passcode" : "Show passcode");
      adminPasscodeToggle.style.opacity = isHidden ? "1" : "0.5";
    });
  }

  if (adminModeSelect) {
    adminModeSelect.addEventListener("change", toggleAdminFieldVisibility);
  }

  if (adminLoginBtn && adminPasscodeInput) {
    adminLoginBtn.addEventListener("click", async () => {
      const pass = String(adminPasscodeInput.value || "").trim();
      if (!pass) {
        window.alert("Enter an admin passcode.");
        return;
      }

      adminLoginBtn.disabled = true;
      adminLoginBtn.textContent = "Signing in...";

      try {
        const result = await callFunction("admin-login", { passcode: pass });
        state.adminSession = { adminId: result.adminId, token: result.token };
        adminPasscodeInput.value = "";
        saveAdminSession();
        rerender();
      } catch (err) {
        window.alert(err.message || "Sign in failed.");
      } finally {
        adminLoginBtn.disabled = false;
        adminLoginBtn.textContent = "Sign in";
      }
    });
  }

  if (adminLogoutBtn) {
    adminLogoutBtn.addEventListener("click", () => {
      state.adminSession = null;
      saveAdminSession();
      rerender();
    });
  }

  if (adminUpdateForm) {
    adminUpdateForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.adminSession || !state.adminSession.adminId) {
        window.alert("Sign in as admin first.");
        return;
      }

      const courseKey = String(document.querySelector("#admin-course")?.value || "").trim();
      const updateType = String(document.querySelector("#admin-update-type")?.value || "").trim();
      const effectiveMode = String(document.querySelector("#admin-effective-mode")?.value || "single").trim();
      const startDate = String(document.querySelector("#admin-start-date")?.value || "").trim();
      const rawEndDate = String(document.querySelector("#admin-end-date")?.value || "").trim();
      const reason = String(document.querySelector("#admin-reason")?.value || "").trim();

      const newVenue = String(document.querySelector("#admin-new-venue")?.value || "").trim();
      const newStartTime = String(document.querySelector("#admin-new-start-time")?.value || "").trim();
      const newEndTime = String(document.querySelector("#admin-new-end-time")?.value || "").trim();

      if (!courseKey || !startDate) {
        window.alert("Course and start date are required.");
        return;
      }

      const endDate = effectiveMode === "range" ? rawEndDate : startDate;
      if (!endDate) {
        window.alert("End date is required for date range updates.");
        return;
      }
      if (endDate < startDate) {
        window.alert("End date cannot be before start date.");
        return;
      }

      if (updateType === "venue_change" && !newVenue) {
        window.alert("Provide the new venue.");
        return;
      }

      if (updateType === "time_change") {
        if (!newStartTime || !newEndTime) {
          window.alert("Provide both new start and end times.");
          return;
        }
        if (newEndTime <= newStartTime) {
          window.alert("New end time should be after start time.");
          return;
        }
      }

      const matchingBefore = state.baseEvents.filter(
        (event) =>
          normalizeCourseKey(event) === courseKey &&
          (() => {
            const ymd = dateOnlyFromIso(event.start);
            return ymd && ymd >= startDate && ymd <= endDate;
          })()
      );

      if (!matchingBefore.length) {
        window.alert("No classes found for the selected course in that date window.");
        return;
      }

      // Check for duplicate updates
      const duplicate = findDuplicateUpdate(courseKey, updateType, startDate, endDate, newVenue, newStartTime, newEndTime);
      if (duplicate) {
        const dateLabel = startDate === endDate ? startDate : `${startDate} to ${endDate}`;
        window.alert(`⚠️ An identical update already exists for this course on ${dateLabel}. Existing update created at ${duplicate.createdAt}.`);
        return;
      }

      const tempUpdate = {
        id: "__preview",
        courseKey, updateType, effectiveMode,
        startDate, endDate,
        newVenue, newStartTime, newEndTime,
        reason, adminId: state.adminSession.adminId,
        createdAt: new Date().toISOString(),
        isDeleted: false
      };
      const summary = buildAdminSummary(tempUpdate, matchingBefore);

      const publishBtn = document.querySelector("#admin-publish-update");
      if (publishBtn) { publishBtn.disabled = true; publishBtn.textContent = "Publishing..."; }

      try {
        await callFunction("publish-update", {
          token: state.adminSession.token,
          courseKey, updateType, effectiveMode,
          startDate, endDate,
          newVenue: newVenue || null,
          newStartTime: newStartTime || null,
          newEndTime: newEndTime || null,
          reason: reason || null,
          prevState: summary.prevState,
          newState: summary.newState
        });

        await fetchPublicData();
        refreshDerivedEvents();
        rerender();
        adminUpdateForm.reset();
        toggleAdminFieldVisibility();
      } catch (err) {
        window.alert(err.message || "Failed to publish update.");
      } finally {
        if (publishBtn) { publishBtn.disabled = false; publishBtn.textContent = "Publish update"; }
      }
    });
  }

  if (adminClearUpdatesBtn) {
    adminClearUpdatesBtn.addEventListener("click", async () => {
      if (!state.adminSession || !state.adminSession.adminId) {
        window.alert("Sign in as admin first.");
        return;
      }

      const ok = window.confirm("Clear all active updates? This resets timetable overrides.");
      if (!ok) return;

      adminClearUpdatesBtn.disabled = true;
      adminClearUpdatesBtn.textContent = "Clearing...";

      try {
        await callFunction("publish-update", {
          token: state.adminSession.token,
          action: "clear_all"
        });
        await fetchPublicData();
        refreshDerivedEvents();
        rerender();
      } catch (err) {
        window.alert(err.message || "Failed to clear updates.");
      } finally {
        adminClearUpdatesBtn.disabled = false;
        adminClearUpdatesBtn.textContent = "Clear all updates";
      }
    });
  }

  const adminTabSingleBtn = document.querySelector("#admin-tab-single");
  const adminTabBulkBtn = document.querySelector("#admin-tab-bulk");
  const adminBulkForm = document.querySelector("#admin-bulk-form");
  const adminBulkInput = document.querySelector("#admin-bulk-input");
  const adminBulkPreview = document.querySelector("#admin-bulk-preview");

  if (adminTabSingleBtn) {
    adminTabSingleBtn.addEventListener("click", () => {
      adminTabSingleBtn.classList.add("active");
      adminTabBulkBtn?.classList.remove("active");
      adminUpdateForm.style.display = "grid";
      adminBulkForm.style.display = "none";
    });
  }

  if (adminTabBulkBtn) {
    adminTabBulkBtn.addEventListener("click", () => {
      adminTabBulkBtn.classList.add("active");
      adminTabSingleBtn?.classList.remove("active");
      adminUpdateForm.style.display = "none";
      adminBulkForm.style.display = "grid";
    });
  }

  if (adminBulkInput) {
    adminBulkInput.addEventListener("input", () => {
      try {
        const text = adminBulkInput.value.trim();
        if (!text) {
          adminBulkPreview.innerHTML = "";
          return;
        }

        const entries = parseBulkScheduleText(text);
        console.log(`Parsed ${entries.length} schedule entries`);
        const matches = {};

        for (const entry of entries) {
          for (const classCode of entry.classCodes) {
            const key = `${entry.date}|${entry.startTime}|${entry.endTime}|${classCode}`;
            matches[key] = findMatchingEvents(state.baseEvents, classCode, entry.date, entry.startTime, entry.endTime);
          }
        }

        const summary = buildBulkImportSummary(entries, matches);
        console.log(`Summary: ${summary.totalClasses} codes, ${summary.foundCount} matches, ${summary.missingCodes.length} not found`);

        // Check for duplicates in bulk import
        const duplicates = [];
        for (const entry of entries) {
          for (const classCode of entry.classCodes) {
            const key = `${entry.date}|${entry.startTime}|${entry.endTime}|${classCode}`;
            const matchedEvents = matches[key];
            if (matchedEvents && matchedEvents.length > 0) {
              for (const event of matchedEvents) {
                const courseKey = normalizeCourseKey(event);
                const duplicate = state.updates.find(u =>
                  !u.isDeleted &&
                  u.updateType === "bulk_add" &&
                  u.courseKey === courseKey &&
                  u.startDate === entry.date
                );
                if (duplicate) {
                  duplicates.push(`${classCode} on ${entry.date}`);
                }
              }
            }
          }
        }

        let html = `<strong>Preview:</strong><br>`;
        html += `Total class codes: ${summary.totalClasses}<br>`;
        html += `Found matches: ${summary.foundCount}<br>`;

        if (duplicates.length > 0) {
          html += `<strong style="color: #ff9800;">⚠️ Already added (${duplicates.length}):</strong><br>`;
          html += duplicates.slice(0, 5).map(c => `• ${c}`).join("<br>");
          if (duplicates.length > 5) {
            html += `<br>... and ${duplicates.length - 5} more`;
          }
          html += `<br><br>`;
        }

        if (summary.missingCodes.length > 0) {
          html += `<strong style="color: #d32f2f;">Not found (${summary.missingCodes.length}):</strong><br>`;
          html += summary.missingCodes.slice(0, 5).map(c => `• ${c}`).join("<br>");
          if (summary.missingCodes.length > 5) {
            html += `<br>... and ${summary.missingCodes.length - 5} more`;
          }
        }

        adminBulkPreview.innerHTML = html;
      } catch (err) {
        console.error("Error in bulk preview:", err);
        adminBulkPreview.innerHTML = `<strong style="color: #d32f2f;">Error: ${escapeHtml(err.message)}</strong>`;
      }
    });
  }

  if (adminBulkForm) {
    adminBulkForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      console.log("Bulk import form submitted");

      if (!state.adminSession || !state.adminSession.token) {
        window.alert("Sign in as admin first.");
        return;
      }

      const text = adminBulkInput.value.trim();
      if (!text) {
        window.alert("Paste schedule data into the textarea.");
        return;
      }

      try {
        const entries = parseBulkScheduleText(text);
        console.log(`Parsed ${entries.length} entries`);

        if (entries.length === 0) {
          window.alert("Could not parse any schedule entries. Check the format.");
          return;
        }

        const matches = {};
        for (const entry of entries) {
          for (const classCode of entry.classCodes) {
            const key = `${entry.date}|${entry.startTime}|${entry.endTime}|${classCode}`;
            matches[key] = findMatchingEvents(state.baseEvents, classCode, entry.date, entry.startTime, entry.endTime);
          }
        }

        const summary = buildBulkImportSummary(entries, matches);
        console.log(`Found ${summary.foundCount} matches`);

        if (summary.foundCount === 0) {
          window.alert("No matching classes found. Check the class codes and dates.");
          return;
        }

        const msg = `Import ${summary.foundCount} classes? ${summary.missingCodes.length > 0 ? `(${summary.missingCodes.length} codes not found)` : ""}`;
        if (!window.confirm(msg)) return;

        const submitBtn = adminBulkForm.querySelector("button[type='submit']");
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Importing..."; }

        try {
          console.log("=== Starting bulk import ===");
          console.log("Entries parsed:", entries.length);
          console.log("Entries:", entries);
          console.log("Matches keys:", Object.keys(matches).length);

          await publishBulkImport(entries, matches);
          console.log("✓ Bulk import completed");

          await fetchPublicData();
          refreshDerivedEvents();
          rerender();
          adminBulkInput.value = "";
          adminBulkPreview.innerHTML = "";
          window.alert("Successfully imported bulk schedule!");
        } catch (err) {
          console.error("❌ Bulk import error:", err);
          console.error("Error type:", err.constructor.name);
          console.error("Error message:", err.message);
          if (err.response) {
            console.error("Response status:", err.response.status);
            console.error("Response body:", err.response);
          }
          window.alert(`Error: ${err.message || "Failed to import bulk schedule."}`);
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Import bulk schedule"; }
        }
      } catch (err) {
        console.error("Form submission error:", err);
        window.alert(`Error: ${err.message || "Failed to import bulk schedule."}`);
      }
    });
  }
}

async function init() {
  const table = document.querySelector("#timetable");
  table.innerHTML = "<thead><tr><th>Loading...</th></tr></thead>";

  try {
    const [eventsRes] = await Promise.all([
      fetch(DATA_URL, { cache: "no-store" })
    ]);

    if (!eventsRes.ok) {
      throw new Error(`Failed to load data: ${eventsRes.status}`);
    }

    const data = await eventsRes.json();
    if (!Array.isArray(data)) {
      throw new Error("raw-events.json is not an array.");
    }

    state.baseEvents = data;
    loadAdminSession();
    await fetchPublicData();
    refreshDerivedEvents();
    state.selectedCourses = getSelectionFromUrl(state.courseMap, state.courseIndexMap);
    state.shareName = getShareNameFromUrl();

    const shareNameInput = document.querySelector("#share-name");
    if (shareNameInput && state.shareName) {
      shareNameInput.value = state.shareName;
    }

    bindEvents();
    rerender();
  } catch (err) {
    table.innerHTML = `
      <thead>
        <tr><th>Error</th></tr>
      </thead>
      <tbody>
        <tr><td>${escapeHtml(err.message)}</td></tr>
      </tbody>
    `;
  }
}

function parseBulkScheduleText(text) {
  const lines = text.trim().split('\n').filter(line => line.trim());
  const entries = [];

  const dateRegex = /^([A-Za-z]+),\s+(\d+)\s+([A-Za-z]+),\s+(\d{4})/;
  const timeRegex = /(\d{1,2})\.(\d{2})-(\d{1,2})\.(\d{2})/;

  const monthMap = {
    'January': '01', 'February': '02', 'March': '03', 'April': '04',
    'May': '05', 'June': '06', 'July': '07', 'August': '08',
    'September': '09', 'October': '10', 'November': '11', 'December': '12'
  };

  for (const line of lines) {
    const dateMatch = line.match(dateRegex);
    if (!dateMatch) continue;

    const [, dayName, dayNum, monthName, year] = dateMatch;
    const monthNum = monthMap[monthName];
    if (!monthNum) continue;

    const dateYmd = `${year}-${monthNum}-${String(dayNum).padStart(2, '0')}`;

    const timeMatch = line.match(timeRegex);
    if (!timeMatch) continue;

    const [, startHour, startMin, endHour, endMin] = timeMatch;
    const startTime = `${String(startHour).padStart(2, '0')}:${startMin}`;
    const endTime = `${String(endHour).padStart(2, '0')}:${endMin}`;
    const originalTimeMatch = line.match(timeRegex);
    const originalTimeEnd = originalTimeMatch ? originalTimeMatch[0].length : 0;
    const timeStartPos = line.indexOf(originalTimeMatch[0]);
    const timeEndPos = timeStartPos + originalTimeEnd;

    const classPart = line.substring(timeEndPos).trim();
    const classList = classPart.split(/[\s\t]+/).filter(code => {
      const trimmed = code.trim();
      return trimmed.length > 0 &&
             trimmed !== "LUNCH" &&
             trimmed !== "BREAK" &&
             trimmed !== "MEETING" &&
             !trimmed.startsWith("(") &&
             !trimmed.startsWith('"') &&
             !trimmed.includes("Common Room") &&
             !trimmed.includes("EXAMINATION");
    });

    if (classList.length > 0) {
      entries.push({
        date: dateYmd,
        startTime,
        endTime,
        classCodesRaw: classPart,
        classCodes: classList
      });
    }
  }

  return entries;
}

function findMatchingEvents(baseEvents, classCode, date, startTime, endTime) {
  const normalizedCode = classCode.toUpperCase().trim();

  // Find ANY event with this course code (regardless of time/date)
  const courseEvent = baseEvents.find(event => {
    const abbrev = (event.abbreviation || "").toUpperCase().trim();
    const batch = (event.batch || "").toUpperCase().trim();

    // Exact matches
    if (abbrev === normalizedCode) return true;
    if (abbrev && batch && `${abbrev}-${batch}` === normalizedCode) return true;
    if (abbrev && batch && `${abbrev}${batch}` === normalizedCode) return true;

    // Prefix match: user code is prefix of abbreviation (e.g., "HSCM" matches "HSCM (LSM)")
    const abbrevBase = abbrev.split(/[\s(]/)[0].trim();
    if (abbrevBase === normalizedCode) return true;

    // Batch suffix match with prefix (e.g., "GT-A" matches abbreviated "GT" with batch "A")
    if (abbrevBase && batch) {
      if (`${abbrevBase}-${batch}` === normalizedCode) return true;
      if (`${abbrevBase}${batch}` === normalizedCode) return true;
    }

    return false;
  });

  // If course found, create a new event instance for the specified date/time
  if (courseEvent) {
    const dateObj = parseYmdToLocalDate(date);
    if (!dateObj) return [];

    const startISO = toIsoWithTimeFromYmd(date, `${startTime}:00`);
    const endISO = toIsoWithTimeFromYmd(date, `${endTime}:00`);

    return [{
      ...courseEvent,
      id: `${date}T${startTime.replace(':', '')}-${classCode}@bulk-import`,
      start: startISO,
      end: endISO,
      __isNew: true,
      __bulkImportCode: classCode
    }];
  }

  return [];
}

function buildBulkImportSummary(entries, matches) {
  const totalClasses = entries.reduce((sum, e) => sum + e.classCodes.length, 0);
  const foundCount = Object.values(matches).flat().length;
  const missingCodes = [];

  for (const entry of entries) {
    for (const code of entry.classCodes) {
      const key = `${entry.date}|${entry.startTime}|${entry.endTime}|${code}`;
      if (!matches[key] || matches[key].length === 0) {
        missingCodes.push(`${code} (${entry.date} ${entry.startTime}-${entry.endTime})`);
      }
    }
  }

  return {
    totalClasses,
    foundCount,
    missingCodes
  };
}

async function publishBulkImport(entries, matches) {
  if (!state.adminSession || !state.adminSession.token) {
    throw new Error("Admin session required");
  }

  const updates = [];

  for (const entry of entries) {
    for (const classCode of entry.classCodes) {
      const key = `${entry.date}|${entry.startTime}|${entry.endTime}|${classCode}`;
      const matchedEvents = matches[key];

      if (!matchedEvents || matchedEvents.length === 0) continue;

      for (const event of matchedEvents) {
        const courseKey = normalizeCourseKey(event);

        if (!courseKey) {
          console.warn(`Warning: No course key for event`, event);
          continue;
        }

        const update = {
          token: state.adminSession.token,
          updateType: "bulk_add",
          courseKey,
          date: entry.date,
          startTime: entry.startTime,
          endTime: entry.endTime,
          classCode,
          eventId: event.id,
          reason: `Added from bulk import on ${new Date().toLocaleDateString()}`,
          prevState: "Not in schedule",
          newState: `Scheduled: ${event.subject} at ${event.location}`
        };

        console.log(`Sending update to backend:`, JSON.stringify(update, null, 2).substring(0, 200));

        console.log(`Preparing bulk_add update:`, update);

        updates.push(
          callFunction("publish-update", update)
        );
      }
    }
  }

  if (updates.length === 0) {
    throw new Error("No matching classes to import");
  }

  console.log(`Sending ${updates.length} bulk import updates`);
  return Promise.all(updates);
}

init();
