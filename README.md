# Calendar Display

Static, client-side timetable web app for IIMK course schedules.

It parses raw ICS calendars into normalized JSON and renders a weekly timetable where:
- rows are days
- columns are time slots
- empty cells mean no class
- filled cells show Course Name + Venue

## What This Repo Does

1. Stores raw source calendars in XLSX and optionally ICS format.
2. Converts one source workbook or one or more ICS files into a single normalized JSON dataset.
3. Provides a static web app for course selection and timetable rendering.
4. Filters timetable to only the current week (Monday-Sunday) using local browser time.
5. Supports shareable timetable selection through URL query params (no account needed).

## Project Structure

- [index.html](index.html): app markup
- [styles.css](styles.css): app styling
- [app.js](app.js): browser logic (course selection, URL state, weekly table)
- [scripts/generate-raw-data.js](scripts/generate-raw-data.js): ICS to JSON generator script
- [scripts/generate-raw-data-xlsx.py](scripts/generate-raw-data-xlsx.py): XLSX to JSON generator script
- [data](data): raw source files + generated JSON
- [data/raw-events.json](data/raw-events.json): normalized merged event data used by the app

## Data Schema

Generated JSON uses this shape per event:

```json
{
	"id": "20260609T143000-D1@iimk-schedule",
	"subject": "Game Theory",
	"batch": "C",
	"start": "2026-06-09T14:30:00",
	"end": "2026-06-09T15:45:00",
	"location": "Section D1, IIM Kozhikode",
	"faculty": "Prof. Anirban Ghatak",
	"section": "D1",
	"programme": "PGP 29",
	"abbreviation": "GT",
	"credit": "3.0"
}
```

The app only requires the original fields (`id`, `subject`, `batch`, `start`, `end`, `location`, `faculty`, `section`).
The extra workbook-derived metadata is preserved for future tooling.

## XLSX Parsing Workflow

Implemented in [scripts/generate-raw-data-xlsx.py](scripts/generate-raw-data-xlsx.py):

- reads the timetable workbook directly from `.xlsx`
- resolves merged-cell values by propagating each merged range's top-left cell
- builds an in-memory course catalog from the `Course Details` sheet
- parses the `Term IV Schedule` sheet by section column and time slot row
- expands timetable abbreviations into full course metadata
- filters out non-course schedule rows like registration, lunch, meetings, and exam banners
- writes [data/raw-events.json](data/raw-events.json)

### Generate JSON From XLSX

From repo root:

```bash
python3 scripts/generate-raw-data-xlsx.py
```

Optional arguments:

```bash
python3 scripts/generate-raw-data-xlsx.py --xlsx "PGP-29 Term IV Schedule.xlsx" --out data/raw-events.json
```

This is the recommended workflow when the workbook is the source of truth.

## How ICS Parsing Works

Implemented in [scripts/generate-raw-data.js](scripts/generate-raw-data.js):

- reads all .ics files in [data](data)
- extracts VEVENT blocks between BEGIN:VEVENT and END:VEVENT
- maps fields:
	- id from UID
	- subject from SUMMARY (Batch suffix removed)
	- batch from SUMMARY or DESCRIPTION
	- start/end from DTSTART/DTEND into YYYY-MM-DDTHH:mm:ss
	- location from LOCATION with ICS unescaping
	- faculty/section from DESCRIPTION
- merges all parsed events into a single flat array
- writes [data/raw-events.json](data/raw-events.json)

## Generate JSON Data

From repo root:

```bash
node scripts/generate-raw-data.js
```

Default behavior is overwrite mode: [data/raw-events.json](data/raw-events.json) is fully replaced.

Append mode (keeps existing rows and adds newly parsed rows):

```bash
node scripts/generate-raw-data.js --append
```

Parse only a subset of ICS files:

```bash
node scripts/generate-raw-data.js --files normal.ics,normal_2.ics
```

You can also pass specific files as positional args:

```bash
node scripts/generate-raw-data.js normal.ics normal_3.ics
```

Expected output:
- event count parsed
- generated file path for [data/raw-events.json](data/raw-events.json)

Use the ICS generator when your source data arrives as calendar exports rather than the master workbook.

## Run Locally

Use a local HTTP server (required for fetch):

```bash
python3 -m http.server 8080
```

Open:

```text
http://localhost:8080
```

Note: opening [index.html](index.html) directly via file explorer may fail to load JSON due to browser fetch restrictions.

## App Features

- course selection by:
	- search bar (subject, faculty, section, batch)
	- scrolling and clicking from course list
- selected course tags
- clear selection button
- current week timetable rendering
- dedup within each day+slot cell (same course/venue/section shown once)
- copy share link button
- custom share text using your name (`Checkout {name}'s timetable from: {link}`)
- export timetable as downloadable PNG image
- native image sharing (WhatsApp, Telegram, and any app supported by device share sheet)
- admin panel with passcode-based login for publishing updates
- update types: cancellation, venue change, and time change
- effective window: single date or date range
- public active-updates board (visible in the UI)
- public admin log showing who changed what from previous state to new state

## Admin Update Controls

Configured in [app.js](app.js):

- `ADMIN_PASSCODES` defines admin ID to passcode mappings
- each passcode signs in as that admin ID
- published updates are appended to audit log entries with:
	- timestamp
	- admin ID
	- course
	- update type
	- start/end date
	- previous state
	- new state

### Update Behavior

- cancellation: removes matched classes from timetable output
- venue change: replaces venue for matched classes
- time change: replaces start/end time for matched classes
- date range support: applies to all classes for the course between `start_date` and `end_date` (inclusive)

### Storage Note

Current implementation stores updates, admin session, and audit log in browser localStorage.

This means changes are persistent on that browser/device, but not globally synced across all users.
For shared multi-user production behavior, connect these records to a backend data store/API.

## Shareable URL State

The app stores selected courses in query param c using compact base36 ids.

Example:

```text
/?c=0.3.a.f
```

This allows sharing/viewing the same selected timetable across devices without authentication.

## Deploy To GitHub Pages

1. Push repo to GitHub.
2. Open repository Settings -> Pages.
3. Source: Deploy from a branch.
4. Branch: main, Folder: /(root).
5. Save.

GitHub Pages serves [index.html](index.html) and the app fetches [data/raw-events.json](data/raw-events.json).

## Maintenance Workflow

When schedules change:

1. If the workbook is authoritative, replace the `.xlsx` file in the repo root and run:

```bash
python3 scripts/generate-raw-data-xlsx.py
```

2. If the source data arrives as ICS files instead, replace/add them in [data](data) and run:

```bash
node scripts/generate-raw-data.js
```

3. Commit updated [data/raw-events.json](data/raw-events.json).
4. Push to update GitHub Pages data.
