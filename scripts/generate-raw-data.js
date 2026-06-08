/*
 * Browser-safe ICS parser function + Node.js wrapper for generating JSON.
 * The parser itself has no Node dependencies.
 */
function parseIcsToNormalizedEvents(rawIcsArray) {
  if (!Array.isArray(rawIcsArray)) return [];

  const unfoldIcs = (text) =>
    String(text || "")
      .replace(/\r\n[ \t]/g, "")
      .replace(/\n[ \t]/g, "");

  const unescapeIcsValue = (value) =>
    String(value || "")
      .replace(/\\n/gi, "\n")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";")
      .replace(/\\\\/g, "\\")
      .trim();

  const formatIcsDateTime = (value) => {
    const v = String(value || "").trim();
    const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
    if (!m) return null;
    return m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":" + m[6];
  };

  const parseEventBlock = (eventText) => {
    const lines = eventText.split(/\r?\n/).filter(Boolean);
    const entries = [];

    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;

      const left = line.slice(0, idx).trim();
      const value = line.slice(idx + 1);
      if (!left) continue;

      const name = left.split(";")[0].toUpperCase();
      entries.push({ name, left, value });
    }

    const getProp = (name) => {
      const found = entries.find((e) => e.name === name);
      return found ? found.value : null;
    };

    const getDateProp = (name) => {
      const tzMatch = entries.find(
        (e) => e.name === name && /TZID=Asia\/Kolkata/i.test(e.left)
      );
      if (tzMatch) return tzMatch.value;
      const any = entries.find((e) => e.name === name);
      return any ? any.value : null;
    };

    const uid = unescapeIcsValue(getProp("UID"));
    const summary = unescapeIcsValue(getProp("SUMMARY"));
    const description = unescapeIcsValue(getProp("DESCRIPTION"));
    const location = unescapeIcsValue(getProp("LOCATION"));

    let subject = summary;
    let batch = null;

    const summaryBatchMatch = summary.match(
      /^(.*?)(?:\s*[·-]\s*Batch\s+([A-Za-z0-9]+))?\s*$/i
    );
    if (summaryBatchMatch) {
      subject = (summaryBatchMatch[1] || "").trim();
      if (summaryBatchMatch[2]) batch = summaryBatchMatch[2].trim();
    }

    if (!batch) {
      const descriptionBatchMatch = description.match(/(?:^|\n)Batch:\s*([^\n]+)/i);
      if (descriptionBatchMatch) batch = descriptionBatchMatch[1].trim();
    }

    const facultyMatch = description.match(/(?:^|\n)Faculty:\s*(.+?)(?:\n|$)/i);
    const sectionMatch = description.match(/(?:^|\n)Section:\s*(.+?)(?:\n|$)/i);

    const start = formatIcsDateTime(getDateProp("DTSTART"));
    const end = formatIcsDateTime(getDateProp("DTEND"));

    return {
      id: uid || null,
      subject: subject || null,
      batch: batch || null,
      start,
      end,
      location: location || null,
      faculty: facultyMatch ? facultyMatch[1].trim() : null,
      section: sectionMatch ? sectionMatch[1].trim() : null
    };
  };

  const allEvents = [];

  for (const raw of rawIcsArray) {
    const text = unfoldIcs(raw);
    const eventRegex = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
    let match;

    while ((match = eventRegex.exec(text)) !== null) {
      const eventObj = parseEventBlock(match[1]);
      if (eventObj.id) allEvents.push(eventObj);
    }
  }

  return allEvents;
}

// Expose for browser usage.
if (typeof window !== "undefined") {
  window.parseIcsToNormalizedEvents = parseIcsToNormalizedEvents;
}

// Node wrapper only for local JSON generation.
if (typeof module !== "undefined" && typeof require !== "undefined") {
  module.exports = { parseIcsToNormalizedEvents };

  if (require.main === module) {
    const fs = require("fs");
    const path = require("path");

    const repoRoot = path.resolve(__dirname, "..");
    const dataDir = path.join(repoRoot, "data");
    const outFile = path.join(dataDir, "raw-events.json");

    const args = process.argv.slice(2);
    const usage = [
      "Usage:",
      "  node scripts/generate-raw-data.js [--append] [--files file1.ics,file2.ics] [file3.ics ...]",
      "",
      "Options:",
      "  --append               Append parsed events to existing data/raw-events.json",
      "  --files <list>         Comma-separated .ics file names or paths",
      "  --help                 Show this message"
    ].join("\n");

    const options = {
      append: false,
      requestedFiles: []
    };

    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];

      if (arg === "--help" || arg === "-h") {
        console.log(usage);
        process.exit(0);
      }

      if (arg === "--append") {
        options.append = true;
        continue;
      }

      if (arg === "--files") {
        const next = args[i + 1];
        if (!next || next.startsWith("--")) {
          console.error("Missing value for --files");
          console.error(usage);
          process.exit(1);
        }

        const requested = next
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean);

        options.requestedFiles.push(...requested);
        i += 1;
        continue;
      }

      if (arg.startsWith("--")) {
        console.error(`Unknown option: ${arg}`);
        console.error(usage);
        process.exit(1);
      }

      options.requestedFiles.push(arg);
    }

    const resolveIcsPath = (nameOrPath) => {
      const candidate = path.isAbsolute(nameOrPath)
        ? nameOrPath
        : path.join(dataDir, nameOrPath);
      return path.normalize(candidate);
    };

    const icsFiles =
      options.requestedFiles.length > 0
        ? options.requestedFiles.map(resolveIcsPath)
        : fs
            .readdirSync(dataDir)
            .filter((name) => name.toLowerCase().endsWith(".ics"))
            .map((name) => path.join(dataDir, name));

    if (icsFiles.length === 0) {
      console.error("No ICS files found to parse.");
      process.exit(1);
    }

    const missingOrInvalid = icsFiles.filter(
      (file) => !file.toLowerCase().endsWith(".ics") || !fs.existsSync(file)
    );

    if (missingOrInvalid.length > 0) {
      console.error("Invalid or missing ICS files:");
      missingOrInvalid.forEach((file) => console.error(`- ${file}`));
      process.exit(1);
    }

    const raws = icsFiles.map((file) => fs.readFileSync(file, "utf8"));
    const parsed = parseIcsToNormalizedEvents(raws);

    let outputEvents = parsed;
    if (options.append && fs.existsSync(outFile)) {
      const existingRaw = fs.readFileSync(outFile, "utf8");
      const existing = JSON.parse(existingRaw);
      if (!Array.isArray(existing)) {
        console.error("Existing raw-events.json is not an array. Cannot append.");
        process.exit(1);
      }
      outputEvents = existing.concat(parsed);
    }

    fs.writeFileSync(outFile, JSON.stringify(outputEvents, null, 2), "utf8");

    console.log(
      `Parsed ${parsed.length} events from ${icsFiles.length} ICS files (${options.append ? "append" : "overwrite"} mode).`
    );
    console.log(`Output contains ${outputEvents.length} events.`);
    console.log(`Wrote ${outFile}`);
  }
}
