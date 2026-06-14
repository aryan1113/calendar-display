#!/usr/bin/env python3

import argparse
import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile


NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
CELL_REF_RE = re.compile(r"([A-Z]+)(\d+)")
TIME_RANGE_RE = re.compile(r"^(\d{2})\.(\d{2})-(\d{2})\.(\d{2})$")
TRAILING_BATCH_RE = re.compile(r"^(.*)-([A-Z])$")
INLINE_BATCH_RE = re.compile(r"^(.*)-([A-Z])(\s+\(.+\))$")
IGNORED_CELL_VALUES = {
    "LUNCH BREAK",
    "MEETING",
    "MID TERM EXAMINATION",
    "END TERM EXAMINATION",
    "INDEPENDENCE DAY",
    "REGISTRATION (JUNE 08TH & 09TH, 2026)",
}
ABBREVIATION_ALIASES = {
    ("PGP29", "RTM"): "MRBDM",
}


def col_to_num(col_letters):
    value = 0
    for ch in col_letters:
        value = value * 26 + ord(ch) - 64
    return value


def parse_shared_strings(workbook_zip):
    try:
        root = ET.fromstring(workbook_zip.read("xl/sharedStrings.xml"))
    except KeyError:
        return []

    values = []
    for item in root.findall("main:si", NS):
        text = "".join(node.text or "" for node in item.iter(f"{{{NS['main']}}}t"))
        values.append(text)
    return values


def cell_value(cell, shared_strings):
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        inline = cell.find("main:is", NS)
        if inline is None:
            return ""
        return "".join(node.text or "" for node in inline.iter(f"{{{NS['main']}}}t"))

    value_node = cell.find("main:v", NS)
    if value_node is None:
        return ""

    raw_value = value_node.text or ""
    if cell_type == "s":
        return shared_strings[int(raw_value)]
    return raw_value


def load_sheet_targets(workbook_zip):
    workbook_root = ET.fromstring(workbook_zip.read("xl/workbook.xml"))
    relationships_root = ET.fromstring(workbook_zip.read("xl/_rels/workbook.xml.rels"))

    relationship_map = {
        rel.attrib["Id"]: rel.attrib["Target"] for rel in relationships_root.findall("*")
    }

    targets = {}
    for sheet in workbook_root.find("main:sheets", NS):
        name = sheet.attrib["name"]
        rel_id = sheet.attrib[f"{{{NS['rel']}}}id"]
        targets[name] = "xl/" + relationship_map[rel_id]
    return targets


def parse_sheet(workbook_zip, sheet_target, shared_strings):
    root = ET.fromstring(workbook_zip.read(sheet_target))
    cells = {}
    for cell in root.findall(".//main:sheetData/main:row/main:c", NS):
        match = CELL_REF_RE.fullmatch(cell.attrib["r"])
        if not match:
            continue
        col_letters, row_text = match.groups()
        cells[(int(row_text), col_to_num(col_letters))] = cell_value(cell, shared_strings).strip()

    merged_ranges = []
    merge_cells = root.find("main:mergeCells", NS)
    if merge_cells is not None:
        for merge_cell in merge_cells.findall("main:mergeCell", NS):
            start_ref, end_ref = merge_cell.attrib["ref"].split(":")
            start_match = CELL_REF_RE.fullmatch(start_ref)
            end_match = CELL_REF_RE.fullmatch(end_ref)
            merged_ranges.append(
                (
                    int(start_match.group(2)),
                    col_to_num(start_match.group(1)),
                    int(end_match.group(2)),
                    col_to_num(end_match.group(1)),
                )
            )

    return cells, merged_ranges


def get_cell_display_value(row_idx, col_idx, cells, merged_ranges):
    value = cells.get((row_idx, col_idx), "")
    if value != "":
        return value

    for start_row, start_col, end_row, end_col in merged_ranges:
        if start_row <= row_idx <= end_row and start_col <= col_idx <= end_col:
            return cells.get((start_row, start_col), "")
    return ""


def canonicalize_abbreviation(value):
    return re.sub(r"\s+", "", str(value or "")).upper()


def canonicalize_programme(value):
    return re.sub(r"[^A-Z0-9]+", "", str(value or "").upper())


def normalize_sheet_name(requested_name, available_names):
    wanted = requested_name.strip().lower()
    for name in available_names:
        if name.strip().lower() == wanted:
            return name
    raise KeyError(f"Sheet '{requested_name}' not found. Available sheets: {', '.join(available_names)}")


def excel_serial_to_ymd(value):
    serial = float(value)
    base = datetime(1899, 12, 30)
    return (base + timedelta(days=serial)).strftime("%Y-%m-%d")


def parse_time_range(value):
    match = TIME_RANGE_RE.fullmatch(str(value or "").strip())
    if not match:
        return None
    start_hh, start_mm, end_hh, end_mm = match.groups()
    return f"{start_hh}:{start_mm}:00", f"{end_hh}:{end_mm}:00"


def build_course_catalog(cells, merged_ranges):
    header_row = 2
    headers = {
        get_cell_display_value(header_row, col, cells, merged_ranges): col for col in range(1, 8)
    }
    required = ["Programme", "Course", "Section", "Abbr.", "Credit", "Faculty"]
    missing = [name for name in required if name not in headers]
    if missing:
        raise ValueError(f"Missing Course Details columns: {', '.join(missing)}")

    max_row = max(row for row, _ in cells.keys())
    catalog = {}
    abbreviation_index = {}

    for row in range(3, max_row + 1):
        programme = get_cell_display_value(row, headers["Programme"], cells, merged_ranges).strip()
        subject = get_cell_display_value(row, headers["Course"], cells, merged_ranges).strip()
        section = get_cell_display_value(row, headers["Section"], cells, merged_ranges).strip()
        abbreviation = get_cell_display_value(row, headers["Abbr."], cells, merged_ranges).strip()
        credit = get_cell_display_value(row, headers["Credit"], cells, merged_ranges).strip()
        faculty = get_cell_display_value(row, headers["Faculty"], cells, merged_ranges).strip()

        if not programme or not subject or not abbreviation:
            continue

        program_key = canonicalize_programme(programme)
        abbr_key = canonicalize_abbreviation(abbreviation)
        entry = {
            "programme": programme,
            "subject": subject,
            "sectionPattern": section,
            "abbreviation": abbreviation,
            "credit": credit,
            "faculty": faculty,
        }
        catalog[(program_key, abbr_key)] = entry
        abbreviation_index.setdefault(abbr_key, []).append(entry)

    return catalog, abbreviation_index


def resolve_course_entry(programme, token, catalog, abbreviation_index):
    program_key = canonicalize_programme(programme)
    normalized = canonicalize_abbreviation(token)
    alias = ABBREVIATION_ALIASES.get((program_key, normalized))
    if alias:
        normalized = canonicalize_abbreviation(alias)
    direct = catalog.get((program_key, normalized))
    if direct:
        return direct, None

    match = TRAILING_BATCH_RE.fullmatch(token)
    if match:
        base_token = match.group(1).strip()
        batch = match.group(2).strip().upper()
        base_entry = catalog.get((program_key, canonicalize_abbreviation(base_token)))
        if base_entry:
            return base_entry, batch

    inline_match = INLINE_BATCH_RE.fullmatch(token)
    if inline_match:
        base_token = f"{inline_match.group(1).strip()}{inline_match.group(3)}"
        batch = inline_match.group(2).strip().upper()
        base_entry = catalog.get((program_key, canonicalize_abbreviation(base_token)))
        if base_entry:
            return base_entry, batch

    candidates = abbreviation_index.get(normalized, [])
    if len(candidates) == 1:
        return candidates[0], None

    if match:
        candidates = abbreviation_index.get(canonicalize_abbreviation(match.group(1).strip()), [])
        if len(candidates) == 1:
            return candidates[0], batch

    return None, None


def make_event(date_ymd, time_range, section, cell_lines, course_entry, batch):
    start_time, end_time = time_range
    room_note = ", ".join(part.strip() for part in cell_lines[1:] if part.strip())
    location = f"{room_note}, IIM Kozhikode" if room_note else f"Section {section}, IIM Kozhikode"
    start_iso = f"{date_ymd}T{start_time}"
    return {
        "id": f"{date_ymd.replace('-', '')}T{start_time.replace(':', '')}-{section}@iimk-schedule",
        "subject": course_entry["subject"],
        "batch": batch,
        "start": start_iso,
        "end": f"{date_ymd}T{end_time}",
        "location": location,
        "faculty": course_entry["faculty"] or None,
        "section": section,
        "programme": course_entry["programme"],
        "abbreviation": course_entry["abbreviation"],
        "credit": course_entry["credit"] or None,
    }


def generate_events_from_workbook(xlsx_path):
    with ZipFile(xlsx_path) as workbook_zip:
        shared_strings = parse_shared_strings(workbook_zip)
        sheet_targets = load_sheet_targets(workbook_zip)

        schedule_name = normalize_sheet_name("Term IV Schedule", sheet_targets.keys())
        details_name = normalize_sheet_name("Course Details", sheet_targets.keys())

        schedule_cells, schedule_merges = parse_sheet(
            workbook_zip, sheet_targets[schedule_name], shared_strings
        )
        course_cells, course_merges = parse_sheet(
            workbook_zip, sheet_targets[details_name], shared_strings
        )

    catalog, abbreviation_index = build_course_catalog(course_cells, course_merges)

    timetable_columns = []
    max_col = max(col for _, col in schedule_cells.keys())
    max_row = max(row for row, _ in schedule_cells.keys())
    for col in range(3, max_col + 1):
        programme = get_cell_display_value(4, col, schedule_cells, schedule_merges).strip()
        section = get_cell_display_value(5, col, schedule_cells, schedule_merges).strip()
        if programme and section:
            timetable_columns.append({"col": col, "programme": programme, "section": section})

    events = []
    unresolved = set()

    for row in range(6, max_row + 1):
        date_raw = get_cell_display_value(row, 1, schedule_cells, schedule_merges).strip()
        time_raw = get_cell_display_value(row, 2, schedule_cells, schedule_merges).strip()

        if not date_raw:
            continue

        try:
            date_ymd = excel_serial_to_ymd(date_raw)
        except ValueError:
            continue

        time_range = parse_time_range(time_raw)
        if not time_range:
            continue

        for column_meta in timetable_columns:
            raw_cell = get_cell_display_value(
                row, column_meta["col"], schedule_cells, schedule_merges
            ).strip()
            if not raw_cell:
                continue

            cell_lines = [part.strip() for part in raw_cell.splitlines() if part.strip()]
            if not cell_lines:
                continue

            token = cell_lines[0]
            token_upper = token.upper()
            if token_upper in IGNORED_CELL_VALUES or token_upper == "REGISTRATION":
                continue

            course_entry, batch = resolve_course_entry(
                column_meta["programme"], token, catalog, abbreviation_index
            )
            if not course_entry:
                unresolved.add(f"{column_meta['programme']}::{token}")
                continue

            events.append(
                make_event(date_ymd, time_range, column_meta["section"], cell_lines, course_entry, batch)
            )

    events.sort(key=lambda item: (item["start"], item["section"], item["subject"], item["batch"] or ""))
    return events, sorted(unresolved)


def build_parser():
    parser = argparse.ArgumentParser(
        description="Generate data/raw-events.json from an IIMK XLSX timetable workbook."
    )
    parser.add_argument(
        "--xlsx",
        default="PGP-29 Term IV Schedule.xlsx",
        help="Path to the source XLSX workbook (default: %(default)s)",
    )
    parser.add_argument(
        "--out",
        default="data/raw-events.json",
        help="Output JSON path (default: %(default)s)",
    )
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)

    repo_root = Path(__file__).resolve().parent.parent
    xlsx_path = (repo_root / args.xlsx).resolve() if not Path(args.xlsx).is_absolute() else Path(args.xlsx)
    out_path = (repo_root / args.out).resolve() if not Path(args.out).is_absolute() else Path(args.out)

    if not xlsx_path.exists():
        parser.error(f"XLSX file not found: {xlsx_path}")

    events, unresolved = generate_events_from_workbook(xlsx_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(events, indent=2) + "\n", encoding="utf-8")

    print(f"Parsed {len(events)} events from {xlsx_path.name}.")
    print(f"Wrote {out_path}")
    if unresolved:
        print("Unresolved timetable tokens:", file=sys.stderr)
        for item in unresolved:
            print(f"- {item}", file=sys.stderr)


if __name__ == "__main__":
    main()