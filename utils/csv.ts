// utils/csv.ts
//
// CSV in and out, for bringing another app's workout history in and sending
// ours out (utils/workoutImport.ts, utils/workoutExport.ts). RFC 4180: a field
// in double quotes may hold the separator, line breaks, and "" for a quote.
// Reads commas, semicolons or tabs, whichever the header row uses (Strong's
// newer export is semicolons), with or without a byte-order mark, and CRLF or
// LF line ends.
//
// Pure, so scripts/verify-import.ts covers it.

export type Delimiter = "," | ";" | "\t";

/** The separator the first line uses most, outside quotes. Commas when there's
 *  nothing to go on. */
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) break;
    else if (!quoted && (c === "," || c === ";" || c === "\t")) counts[c] += 1;
  }
  if (counts[";"] > counts[","] && counts[";"] >= counts["\t"]) return ";";
  if (counts["\t"] > counts[","]) return "\t";
  return ",";
}

/**
 * Every row of `text` as its fields, in order. Blank lines are left out. A
 * quote that's never closed runs to the end of the text, as spreadsheet apps
 * read it.
 */
export function parseCsv(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // Whether this field opened with a quote, so `a,"b"c` keeps its text.
  let started = false;
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endField = () => {
    row.push(field);
    field = "";
    started = false;
  };
  const endRow = () => {
    endField();
    // A blank line reads as one empty field.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && !started && field === "") { quoted = true; started = true; continue; }
    if (c === delimiter) { endField(); continue; }
    if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
      continue;
    }
    if (c === "\n") { endRow(); continue; }
    field += c;
    started = true;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** One field as it's written: quoted when it holds a separator, a quote, a
 *  line break, or space at either end, which a spreadsheet would trim. */
function writeField(value: string | number): string {
  const s = String(value);
  if (/[",;\t\r\n]/.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * `rows` as CSV text: commas, CRLF line ends, and a byte-order mark first, so
 * Excel reads accented letters in notes as the UTF-8 they are (Numbers and
 * Google Sheets read it either way).
 */
export function toCsv(rows: (string | number)[][]): string {
  return `﻿${rows.map(r => r.map(writeField).join(",")).join("\r\n")}\r\n`;
}
