# Calendar Display

Static, client-side timetable web app for IIMK course schedules, can be extended for literally evertthing

It parses raw ICS calendars into normalized JSON and renders a weekly timetable where:
- rows are days
- columns are time slots
- empty cells mean no class
- filled cells show Course Name + Venue

## What This Repo Does

1. Stores raw source calendars in ICS format in [data](data).
2. Converts one or more ICS files into a single normalized JSON dataset.
3. Provides a static web app for course selection and timetable rendering.
4. Filters timetable to only the current week (Monday-Sunday) using local browser time.
5. Supports shareable timetable selection through URL query params (no account needed).

## Project Structure

- [index.html](index.html): app markup
- [styles.css](styles.css): app styling
- [app.js](app.js): browser logic (course selection, URL state, weekly table)
- [scripts/generate-raw-data.js](scripts/generate-raw-data.js): ICS to JSON generator script
- [data](data): raw ICS files + generated JSON
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
	"section": "D1"
}
```

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

Expected output:
- event count parsed
- generated file path for [data/raw-events.json](data/raw-events.json)

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

1. Replace/add ICS files in [data](data).
2. Run:

```bash
node scripts/generate-raw-data.js
```

3. Commit updated [data/raw-events.json](data/raw-events.json).
4. Push to update GitHub Pages data.
