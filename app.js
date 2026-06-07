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
  search: ""
};

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

  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", nextUrl);
}

async function copyShareLink() {
  const btn = document.querySelector("#copy-link");
  if (!btn) return;

  const link = window.location.href;
  try {
    await navigator.clipboard.writeText(link);
    btn.textContent = "Copied";
  } catch (_) {
    btn.textContent = "Copy failed";
  }

  setTimeout(() => {
    btn.textContent = "Copy share link";
  }, 1200);
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

function filterCourseEntries() {
  const q = state.search.trim().toLowerCase();
  const entries = [...state.courseMap.values()];

  if (!q) return entries;

  return entries.filter((course) => {
    const hay = [course.subject, course.batch, course.faculty, course.section, course.key]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
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
  const selectedEvents = state.events.filter(
    (event) => selected.has(normalizeCourseKey(event)) && isEventInCurrentWeek(event, weekRange)
  );

  const slots = Array.from(
    new Set(
      selectedEvents
        .map((event) => getSlotLabel(event.start))
        .filter(Boolean)
    )
  ).sort();

  const grid = {};
  for (const day of DAYS) {
    grid[day] = {};
    for (const slot of slots) {
      grid[day][slot] = [];
    }
  }

  for (const event of selectedEvents) {
    const day = getWeekdayName(event.start);
    const slot = getSlotLabel(event.start);
    if (!day || !slot || !grid[day] || !grid[day][slot]) continue;

    const entry = {
      subject: event.subject || "Untitled",
      location: event.location || "",
      section: event.section || ""
    };

    const dedupeKey = `${entry.subject}||${entry.location}||${entry.section}`;
    const seen = new Set(grid[day][slot].map((item) => `${item.subject}||${item.location}||${item.section}`));
    if (!seen.has(dedupeKey)) {
      grid[day][slot].push(entry);
    }
  }

  for (const day of DAYS) {
    for (const slot of slots) {
      grid[day][slot].sort((a, b) => {
        const aKey = `${a.subject} ${a.location}`;
        const bKey = `${b.subject} ${b.location}`;
        return aKey.localeCompare(bKey);
      });
    }
  }

  return { slots, grid, weekRange };
}

function renderTimetable() {
  const table = document.querySelector("#timetable");
  const { slots, grid, weekRange } = buildTimetableData();
  const label = document.querySelector("#week-label");

  if (label) {
    const fmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" });
    label.textContent = `Current week: ${fmt.format(weekRange.start)} - ${fmt.format(weekRange.end)}`;
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

  const bodyRows = DAYS.map((day) => {
    const cols = slots
      .map((slot) => {
        const entries = grid[day][slot] || [];
        if (!entries.length) return "<td></td>";

        const content = entries
          .map(
            (entry) =>
              `<span class=\"slot-title\">${escapeHtml(entry.subject)}</span><span class=\"slot-venue\">${escapeHtml(entry.location || "Venue TBA")}</span>`
          )
          .join("<hr>");

        return `<td class=\"filled\">${content}</td>`;
      })
      .join("");

    return `<tr><th>${day}</th>${cols}</tr>`;
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
