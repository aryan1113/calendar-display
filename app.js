const DATA_URL = "./data/raw-events.json";

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
  events: [],
  courseMap: new Map(),
  courseIndexMap: new Map(),
  selectedCourses: new Set(),
  search: "",
  shareName: "",
  weekLabelText: "Current week"
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

function getCurrentWeekRange() {
  const now = new Date();
  const monday = new Date(now);
  const day = monday.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

function isEventInCurrentWeek(event, weekRange) {
  const d = parseIsoToLocalDate(event.start);
  if (!d) return false;
  return d >= weekRange.start && d <= weekRange.end;
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
  const weekRange = getCurrentWeekRange();
  const selectedCourseEvents = state.events.filter((event) => selected.has(normalizeCourseKey(event)));

  const currentWeekEvents = selectedCourseEvents.filter((event) => isEventInCurrentWeek(event, weekRange));

  const nextMonday = new Date(weekRange.start);
  nextMonday.setDate(nextMonday.getDate() + 7);

  const nextMondayEvents = selectedCourseEvents.filter((event) => isEventOnLocalDate(event, nextMonday));

  const hasNextMondayPreview = nextMondayEvents.length > 0;
  const previewRowKey = "__NEXT_MONDAY__";
  const rows = DAYS.map((day) => ({ key: day, label: day }));

  if (hasNextMondayPreview) {
    const fmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" });
    rows.push({
      key: previewRowKey,
      label: `Monday (next week: ${fmt.format(nextMonday)})`
    });
  }

  const selectedEvents = hasNextMondayPreview
    ? [...currentWeekEvents, ...nextMondayEvents]
    : currentWeekEvents;

  const slots = Array.from(
    new Set(
      selectedEvents
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
      section: event.section || ""
    };

    const dedupeKey = `${entry.subject}||${entry.batch}||${entry.location}||${entry.section}`;
    const seen = new Set(
      grid[day][slot].map((item) => `${item.subject}||${item.batch}||${item.location}||${item.section}`)
    );
    if (!seen.has(dedupeKey)) {
      grid[day][slot].push(entry);
    }
  }

  if (hasNextMondayPreview) {
    for (const event of nextMondayEvents) {
      const slot = getSlotLabel(event.start);
      if (!slot || !grid[previewRowKey] || !grid[previewRowKey][slot]) continue;

      const entry = {
        subject: event.subject || "Untitled",
        batch: event.batch || "",
        location: normalizeLocation(event.location),
        section: event.section || ""
      };

      const dedupeKey = `${entry.subject}||${entry.batch}||${entry.location}||${entry.section}`;
      const seen = new Set(
        grid[previewRowKey][slot].map(
          (item) => `${item.subject}||${item.batch}||${item.location}||${item.section}`
        )
      );
      if (!seen.has(dedupeKey)) {
        grid[previewRowKey][slot].push(entry);
      }
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

  return { slots, grid, weekRange, rows, hasNextMondayPreview };
}

function renderTimetable() {
  const table = document.querySelector("#timetable");
  const { slots, grid, weekRange, rows, hasNextMondayPreview } = buildTimetableData();
  const label = document.querySelector("#week-label");
  const now = new Date();
  const todayKey = DAYS[now.getDay() === 0 ? 6 : now.getDay() - 1];
  const previewRowKey = "__NEXT_MONDAY__";

  if (label) {
    const fmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" });
    state.weekLabelText = `Current week: ${fmt.format(weekRange.start)} - ${fmt.format(weekRange.end)}`;
    if (hasNextMondayPreview) {
      state.weekLabelText += " + next Monday preview";
    }
    label.textContent = state.weekLabelText;
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
    const isToday = row.key === todayKey;
    const isPreview = row.key === previewRowKey;
    const rowClass = [isToday ? "row-today" : "", isPreview ? "row-preview" : ""]
      .filter(Boolean)
      .join(" ");

    const rowLabel = `${escapeHtml(row.label)}${
      isToday ? '<span class="day-pill">Today</span>' : ""
    }${isPreview ? '<span class="day-pill day-pill-preview">Next week</span>' : ""}`;

    const cols = slots
      .map((slot) => {
        const entries = grid[row.key][slot] || [];
        if (!entries.length) return "<td></td>";

        const content = entries
          .map(
            (entry) =>
              `<span class=\"slot-title\">${escapeHtml(entry.subject)}${
                entry.batch ? ` (Batch ${escapeHtml(entry.batch)})` : ""
              }</span><span class=\"slot-venue\">${escapeHtml(entry.location || "Venue TBA")}</span>`
          )
          .join("<hr>");

        return `<td class=\"filled\">${content}</td>`;
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
}

function bindEvents() {
  const searchInput = document.querySelector("#course-search");
  const list = document.querySelector("#course-list");
  const clearBtn = document.querySelector("#clear-selection");
  const copyBtn = document.querySelector("#copy-link");
  const copyShareTextBtn = document.querySelector("#copy-share-text");
  const downloadImageBtn = document.querySelector("#download-image");
  const shareImageBtn = document.querySelector("#share-image");
  const shareNameInput = document.querySelector("#share-name");

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
}

async function init() {
  const table = document.querySelector("#timetable");
  table.innerHTML = "<thead><tr><th>Loading...</th></tr></thead>";

  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to load data: ${res.status}`);
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error("raw-events.json is not an array.");
    }

    state.events = data;
    state.courseMap = buildCourseMap(data);
    state.courseIndexMap = buildCourseIndexMap(state.courseMap);
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

init();
