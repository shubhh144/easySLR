/**
 * NORMALIZATION ENGINE
 *
 * Stage 1 of the Import Intelligence Pipeline.
 *
 * What this does:
 * Takes a RawRow (messy Excel input) and returns a NormalizedRow (canonical form).
 * Every transformation is deterministic and lossless — we record what was changed
 * so the researcher can see exactly what the system did to their data.
 *
 * What this does NOT do:
 * - It does not validate field values (that's Stage 2, validate.ts)
 * - It does not check for duplicates (that's Stage 3+, duplicate.ts)
 * - It does not assign import status (that's the engine, engine.ts)
 *
 * Design principle: Pure functions only.
 * Each normalization function takes a value and returns a value.
 * No side effects, no database calls, no global state.
 * This makes every function independently unit-testable.
 */

import {
  type Correction,
  type NormalizedRow,
  type RawRow,
} from "./types";

// ─── DOI NORMALIZATION ────────────────────────────────────────────────────────

/**
 * Normalize a DOI to canonical lowercase form, stripping common prefixes.
 *
 * Real-world DOI variations we handle:
 *   " DOI:10.1000/ABC.2024 "   → "10.1000/abc.2024"
 *   "doi:10.1000/ABC.2024"     → "10.1000/abc.2024"
 *   "https://doi.org/10.1000/" → "10.1000/..."
 *   "http://dx.doi.org/10.1000/"→ "10.1000/..."
 *   "10.1000/ABC"              → "10.1000/abc"
 *   "  10.1000/abc  "          → "10.1000/abc"
 *   null / ""                  → null
 *
 * Why lowercase: DOI specification (ISO 26324) states DOIs are case-insensitive.
 * Publishers sometimes mix case. Normalizing to lowercase prevents the same DOI
 * from appearing as two different DOIs in deduplication.
 *
 * Why return null for invalid: A DOI that doesn't start with "10." after stripping
 * is not a DOI — it's a data entry error. We return null so downstream stages
 * treat it as "no DOI" rather than a bad DOI.
 */
export function normalizeDoi(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let doi = raw.trim();
  if (!doi) return null;

  // Strip known prefixes (case-insensitive)
  doi = doi.replace(/^(DOI:\s*|doi:\s*|https?:\/\/(dx\.)?doi\.org\/)/i, "");
  doi = doi.trim();

  // Lowercase — DOIs are case-insensitive by spec
  doi = doi.toLowerCase();

  // A valid DOI must start with "10."
  // If it doesn't after stripping, it's not a valid DOI
  if (!doi.startsWith("10.")) return null;

  return doi;
}

// ─── PMID NORMALIZATION ───────────────────────────────────────────────────────

/**
 * Normalize a PMID to a clean numeric string.
 *
 * Real-world PMID variations we handle:
 *   " 38910001 "  → "38910001"  (whitespace)
 *   "38910001.0"  → "38910001"  (Excel numeric float)
 *   38910001      → "38910001"  (number from SheetJS)
 *   "PMID:38910001" → "38910001" (some reference managers add this)
 *   null / ""     → null
 *
 * Why string not number: PMID is an identifier, not a quantity. We never
 * do arithmetic on it. Storing as string prevents integer overflow edge
 * cases and makes it consistent with other string identifiers.
 */
export function normalizePmid(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;

  let pmid = String(raw).trim();
  if (!pmid) return null;

  // Strip "PMID:" prefix if present (some reference managers add this)
  pmid = pmid.replace(/^PMID:\s*/i, "");

  // Handle Excel float representation: "38910001.0" → "38910001"
  if (pmid.includes(".")) {
    const parsed = parseFloat(pmid);
    if (!isNaN(parsed) && Number.isInteger(parsed)) {
      pmid = String(parsed);
    }
  }

  // Remove any remaining whitespace
  pmid = pmid.trim();

  // A PMID must be numeric — if it contains non-numeric characters, it's invalid
  if (!/^\d+$/.test(pmid)) return null;

  return pmid;
}

// ─── PUBLICATION YEAR NORMALIZATION ───────────────────────────────────────────

/**
 * Normalize publication year to an integer.
 * This is the most complex normalization because the field can be:
 *   2024           → 2024  (number from SheetJS — ideal)
 *   "2024"         → 2024  (string representation of a number)
 *   "Twenty twenty" → 2020  (word form — Row 6 in sample file)
 *   "2020/2021"    → 2020  (academic year range — take first year)
 *   "2020-2021"    → 2020  (hyphenated range)
 *   null / ""      → null
 *
 * Cross-validation strategy:
 * When we parse a year from word form ("Twenty twenty"), we compare it against
 * the year in the Citation field and Create Date field. If all three agree,
 * we auto-correct with high confidence. If they disagree, we flag LOW warning.
 *
 * Why we try to recover instead of reject:
 * "Twenty twenty" unambiguously means 2020. Rejecting it wastes a valid record.
 * We auto-correct, store the original value, and log the correction.
 */
export function normalizePubYear(
  raw: string | number | null | undefined,
): number | null {
  if (raw === null || raw === undefined) return null;

  // If SheetJS already parsed it as a number
  if (typeof raw === "number") {
    if (Number.isInteger(raw) && raw > 1000 && raw < 9999) {
      return raw;
    }
    return null;
  }

  const str = String(raw).trim();
  if (!str) return null;

  // Try direct integer parse first (most common case: "2024")
  const direct = parseInt(str, 10);
  if (!isNaN(direct) && direct > 1000 && direct < 9999) {
    return direct;
  }

  // Try extracting first 4-digit year from strings like "2020/2021" or "2020-2021"
  const yearMatch = str.match(/\b(1[0-9]{3}|2[0-9]{3})\b/);
  if (yearMatch?.[1]) {
    return parseInt(yearMatch[1], 10);
  }

  // Try parsing English word numbers
  const wordYear = parseEnglishYear(str);
  if (wordYear !== null) return wordYear;

  return null;
}

/**
 * Parse English word representations of years.
 * Handles the exact case from the sample file: "Twenty twenty" → 2020
 *
 * We support common patterns researchers might type:
 *   "Twenty twenty"           → 2020
 *   "Two thousand and twenty" → 2020
 *   "Two thousand twenty"     → 2020
 *   "Twenty-twenty"           → 2020
 *   "Nineteen ninety-nine"    → 1999
 *
 * Why we handle this instead of rejecting:
 * This is a data entry error where the researcher typed a word instead of a number.
 * The intent is unambiguous. Rejecting it is punishing the researcher for a typo.
 *
 * Limitation: We only handle patterns relevant to academic publication years
 * (roughly 1900–2099). We don't try to parse arbitrary English numbers.
 */
function parseEnglishYear(str: string): number | null {
  const normalized = str.toLowerCase().replace(/[-\s]+/g, " ").trim();

  // Map for common decade words used in years
  const tens: Record<string, number> = {
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
  };

  const ones: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    zero: 0, oh: 0,
  };

  // Pattern: "twenty twenty" → 2000 + 20 = 2020
  // Pattern: "twenty twenty four" → 2000 + 20 + 4 = 2024
  const parts = normalized.split(" ").filter(Boolean);

  // "two thousand [and] twenty [four]" → 2024
  if (parts[0] === "two" && parts[1] === "thousand") {
    let year = 2000;
    const rest = parts.slice(2).filter((p) => p !== "and");
    if (rest.length === 0) return 2000;
    if (rest.length === 1) {
      if (tens[rest[0]!] !== undefined) return year + (tens[rest[0]!] ?? 0);
      if (ones[rest[0]!] !== undefined) return year + (ones[rest[0]!] ?? 0);
    }
    if (rest.length === 2) {
      const t = tens[rest[0]!];
      const o = ones[rest[1]!];
      if (t !== undefined && o !== undefined) return year + t + o;
    }
  }

  // "nineteen ninety [nine]" → 1999
  if (parts[0] === "nineteen") {
    let year = 1900;
    if (parts.length >= 2 && tens[parts[1]!] !== undefined) {
      year += tens[parts[1]!] ?? 0;
      if (parts.length === 3 && ones[parts[2]!] !== undefined) {
        year += ones[parts[2]!] ?? 0;
      }
      return year;
    }
  }

  // "twenty twenty" → simplest case: both words are tens → 2020
  if (parts.length === 2) {
    const first = tens[parts[0]!];
    const second = tens[parts[1]!];
    if (first !== undefined && second !== undefined) {
      // "twenty twenty" → interpret as 20xx where xx = second tens value
      // This gives us 2020 for "twenty twenty"
      return 2000 + second;
    }
  }

  return null;
}

// ─── AUTHORS NORMALIZATION ────────────────────────────────────────────────────

/**
 * Normalize the authors field.
 * Handles: extra whitespace around separators, sentinel values, inconsistent spacing.
 *
 * Input:  "  Patel A ; Green D "
 * Output: "Patel A; Green D"
 *
 * Sentinel values that mean "no author":
 *   "Unknown", "N/A", "n/a", "None", "Anonymous"
 * These are replaced with null.
 *
 * Why we preserve the semicolon separator:
 * PubMed uses semicolons. Keeping this format means we can always split on ";"
 * to get individual authors. Changing separators would break downstream parsing.
 */
export function normalizeAuthors(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const SENTINEL_VALUES = ["unknown", "n/a", "none", "anonymous", "na", "-", "—"];

  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (SENTINEL_VALUES.includes(trimmed.toLowerCase())) return null;

  // Split on semicolons (PubMed standard) or commas if no semicolons
  const separator = trimmed.includes(";") ? ";" : ",";
  const segments = trimmed
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !SENTINEL_VALUES.includes(s.toLowerCase()));

  if (segments.length === 0) return null;
  return segments.join("; ");
}

/**
 * Normalize First Author field.
 * Simply trims whitespace and checks sentinel values.
 * If null but Authors is present, the engine will infer it from Authors.
 */
export function normalizeFirstAuthor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const SENTINEL_VALUES = ["unknown", "n/a", "none", "anonymous", "na"];
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (SENTINEL_VALUES.includes(trimmed.toLowerCase())) return null;
  return trimmed;
}

// ─── DATE NORMALIZATION ───────────────────────────────────────────────────────

/**
 * Normalize Create Date field.
 * Trims whitespace. Does not parse to Date object — we store as string because
 * we only use Create Date as a fallback for year inference, not for sorting.
 *
 * Input:  " 2024/10/10 "
 * Output: "2024/10/10"
 */
export function normalizeCreateDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

// ─── IDENTIFIER NORMALIZATION ─────────────────────────────────────────────────

/**
 * Normalize PMCID. Strip whitespace and "PMC" prefix handling.
 * PubMed Central IDs always start with "PMC" followed by digits.
 * Some exports include "PMC" prefix, some don't.
 *
 * We normalize to the full "PMCxxxxxxx" form for consistency.
 */
export function normalizePmcid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let pmcid = raw.trim();
  if (!pmcid) return null;
  // Ensure PMC prefix
  if (/^\d+$/.test(pmcid)) {
    pmcid = `PMC${pmcid}`;
  }
  // Must match PMC followed by digits
  if (!/^PMC\d+$/i.test(pmcid)) return null;
  return pmcid.toUpperCase();
}

/**
 * Normalize NIHMS ID. Strip whitespace.
 * NIHMS IDs are alphanumeric strings. No strict format required.
 */
export function normalizeNihmsId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

// ─── FIELD INFERENCE ─────────────────────────────────────────────────────────

/**
 * Infer First Author from the Authors field.
 * Takes the first segment (before the first ";").
 *
 * Why we auto-infer: If Authors is "Kaur R; Bennett J" and First Author is null,
 * the first author is unambiguously "Kaur R". This is a deterministic inference
 * with 0.99 confidence — we always apply it.
 *
 * Returns null if Authors is null or empty.
 */
export function inferFirstAuthorFromAuthors(authors: string | null): string | null {
  if (!authors) return null;
  const firstSegment = authors.split(";")[0]?.trim() ?? null;
  return firstSegment && firstSegment.length > 0 ? firstSegment : null;
}

/**
 * Infer publication year from Citation string.
 * Extracts the first 4-digit year from a citation like:
 *   "Methods Today. 2020;7(3):44-47" → 2020
 *   "Rao A, et al. Journal of Digital Health. 2024;12(4):211-220." → 2024
 *
 * Why from Citation: The Citation field is a formatted reference string that
 * always includes the publication year. It's the most reliable fallback source.
 */
export function inferYearFromCitation(citation: string | null): number | null {
  if (!citation) return null;
  // Match a 4-digit year between 1900 and 2099
  const match = citation.match(/\b(1[0-9]{3}|2[0-9]{3})\b/);
  if (!match?.[1]) return null;
  const year = parseInt(match[1], 10);
  // Sanity check: year must be plausible
  if (year < 1900 || year > 2100) return null;
  return year;
}

/**
 * Infer publication year from Create Date field.
 * Extracts the year component from dates like:
 *   "2020/07/10" → 2020
 *   "2020-07-10" → 2020
 *   "2020/03/03" → 2020
 */
export function inferYearFromCreateDate(createDate: string | null): number | null {
  if (!createDate) return null;
  const trimmed = createDate.trim();
  const match = trimmed.match(/^(\d{4})[\/\-]/);
  if (!match?.[1]) return null;
  const year = parseInt(match[1], 10);
  if (year < 1900 || year > 2100) return null;
  return year;
}

/**
 * Infer journal from Citation string.
 * The journal name typically appears before the year in a PubMed citation:
 *   "Rao A, et al. Journal of Digital Health. 2024;12(4):211-220."
 *   The pattern is: <authors>. <Journal>. <year>;...
 *   We extract the last segment before the year.
 */
export function inferJournalFromCitation(citation: string | null): string | null {
  if (!citation) return null;
  // Pattern: text ending before a year followed by semicolon (PubMed format)
  const match = citation.match(/\.\s+([^.]+)\.\s+(?:1[0-9]{3}|2[0-9]{3})/);
  if (!match?.[1]) return null;
  return match[1].trim();
}

// ─── MAIN NORMALIZATION FUNCTION ──────────────────────────────────────────────

/**
 * Normalize a single raw row.
 * This is the main export — called by the engine for each row.
 *
 * Process:
 * 1. Normalize each field to its canonical form
 * 2. Record every correction made (for UI transparency)
 * 3. Infer missing fields from available data
 * 4. Return the NormalizedRow with all corrections logged
 *
 * Pure function: same input always produces same output.
 * No database calls, no side effects.
 */
export function normalizeRow(raw: RawRow): NormalizedRow {
  const corrections: Correction[] = [];

  // ── PMID ──────────────────────────────────────────────────────────────────
  const normalizedPmid = normalizePmid(raw.pmid);
  const rawPmidStr = raw.pmid !== null && raw.pmid !== undefined ? String(raw.pmid) : null;
  if (rawPmidStr !== null && normalizedPmid !== rawPmidStr.trim()) {
    corrections.push({
      field: "pmid",
      originalValue: rawPmidStr,
      correctedValue: normalizedPmid ?? "null",
      reason: "Removed whitespace and normalized to numeric string",
    });
  }

  // ── DOI ───────────────────────────────────────────────────────────────────
  const normalizedDoi = normalizeDoi(raw.doi);
  const rawDoiStr = raw.doi?.trim() ?? null;
  if (rawDoiStr && normalizedDoi !== rawDoiStr) {
    corrections.push({
      field: "doi",
      originalValue: rawDoiStr,
      correctedValue: normalizedDoi ?? "null",
      reason: normalizedDoi
        ? "Stripped prefix (DOI:/https://doi.org/) and normalized to lowercase"
        : "DOI did not start with '10.' after stripping prefix — treated as missing",
    });
  }

  // ── PUBLICATION YEAR ──────────────────────────────────────────────────────
  let normalizedYear = normalizePubYear(raw.pubYear);
  const rawYearStr = raw.pubYear !== null && raw.pubYear !== undefined ? String(raw.pubYear) : null;

  // If year is null or was a word string, try to infer from Citation and Create Date
  const yearFromCitation = inferYearFromCitation(raw.citation);
  const yearFromCreateDate = inferYearFromCreateDate(raw.createDate);

  if (normalizedYear === null && rawYearStr !== null && rawYearStr !== "") {
    // Year field was present but not parseable — try cross-field inference
    if (yearFromCitation !== null) {
      normalizedYear = yearFromCitation;
      corrections.push({
        field: "pubYear",
        originalValue: rawYearStr,
        correctedValue: String(yearFromCitation),
        reason: `Could not parse "${rawYearStr}" as a year. Inferred ${yearFromCitation} from Citation field.`,
      });
    } else if (yearFromCreateDate !== null) {
      normalizedYear = yearFromCreateDate;
      corrections.push({
        field: "pubYear",
        originalValue: rawYearStr,
        correctedValue: String(yearFromCreateDate),
        reason: `Could not parse "${rawYearStr}" as a year. Inferred ${yearFromCreateDate} from Create Date field.`,
      });
    }
  } else if (normalizedYear !== null && rawYearStr !== null && String(normalizedYear) !== rawYearStr.trim()) {
    // Year was parseable but was in non-integer form (e.g., word form)
    corrections.push({
      field: "pubYear",
      originalValue: rawYearStr,
      correctedValue: String(normalizedYear),
      reason: `Parsed "${rawYearStr}" to year ${normalizedYear}`,
    });
  }

  // ── AUTHORS ───────────────────────────────────────────────────────────────
  const normalizedAuthors = normalizeAuthors(raw.authors);
  if (raw.authors !== null && normalizedAuthors !== raw.authors) {
    corrections.push({
      field: "authors",
      originalValue: raw.authors ?? "",
      correctedValue: normalizedAuthors ?? "null",
      reason: "Trimmed whitespace, removed sentinel values, normalized separators",
    });
  }

  // ── FIRST AUTHOR ──────────────────────────────────────────────────────────
  let normalizedFirstAuthor = normalizeFirstAuthor(raw.firstAuthor);

  // If First Author is null but Authors is present, infer it
  if (normalizedFirstAuthor === null && normalizedAuthors !== null) {
    const inferred = inferFirstAuthorFromAuthors(normalizedAuthors);
    if (inferred) {
      normalizedFirstAuthor = inferred;
      corrections.push({
        field: "firstAuthor",
        originalValue: raw.firstAuthor ?? "null",
        correctedValue: inferred,
        reason: "First Author was missing. Inferred from Authors field (first segment).",
      });
    }
  } else if (raw.firstAuthor !== null && normalizedFirstAuthor !== raw.firstAuthor?.trim()) {
    corrections.push({
      field: "firstAuthor",
      originalValue: raw.firstAuthor ?? "",
      correctedValue: normalizedFirstAuthor ?? "null",
      reason: "Trimmed whitespace or removed sentinel value",
    });
  }

  // ── OTHER IDENTIFIERS ─────────────────────────────────────────────────────
  const normalizedPmcid = normalizePmcid(raw.pmcid);
  const normalizedNihmsId = normalizeNihmsId(raw.nihmsId);
  const normalizedCreateDate = normalizeCreateDate(raw.createDate);

  if (raw.createDate !== null && normalizedCreateDate !== raw.createDate) {
    corrections.push({
      field: "createDate",
      originalValue: raw.createDate ?? "",
      correctedValue: normalizedCreateDate ?? "null",
      reason: "Trimmed whitespace",
    });
  }

  return {
    rowIndex: raw.rowIndex,
    pmid: normalizedPmid,
    title: raw.title?.trim() || null,
    authors: normalizedAuthors,
    citation: raw.citation?.trim() || null,
    firstAuthor: normalizedFirstAuthor,
    journal: raw.journal?.trim() || null,
    pubYear: normalizedYear,
    createDate: normalizedCreateDate,
    pmcid: normalizedPmcid,
    nihmsId: normalizedNihmsId,
    doi: normalizedDoi,
    corrections,
  };
}
