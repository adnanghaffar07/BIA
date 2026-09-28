import { inflateRawSync } from 'node:zlib';

/**
 * Enough of .xlsx to read a verifier's result file.
 *
 * ── Why this exists rather than a library ───────────────────────────────────
 * The workbooks actually arrive as .xlsx — that is what Zoya exports and what Frank
 * forwards. Asking somebody to "save as CSV first" is the step that gets skipped, and when
 * it is skipped the file is read as text: the upload screen printed 40 KB of zip bytes back
 * at the user as "headings found".
 *
 * A spreadsheet library would do this and a great deal more. This project has four runtime
 * dependencies and none of them parse documents; adding one to read two columns out of a
 * file is a dependency to keep patched forever. What is here reads a ZIP and some XML.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 * No formulas, no styles, no number formats, no dates. A verifier's file is text in two
 * columns. Dates come back as the serial number Excel stores, which is honest — a date
 * silently converted with the wrong epoch is worse than a number nobody mistakes for one.
 */

export type Sheet = { name: string; rows: string[][] };

/** ZIP end-of-central-directory, searched from the back as the spec requires. */
function findEocd(buf: Buffer): number {
  const MIN = 22;
  const start = Math.max(0, buf.length - 0xffff - MIN);
  for (let i = buf.length - MIN; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/**
 * Every file in the archive, decompressed.
 *
 * Only stored (0) and deflate (8) are handled, which is everything Excel and every tool
 * that writes .xlsx produces. Anything else throws by name rather than returning a
 * half-read entry.
 */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('Not a zip archive');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // The local header repeats the name and extra fields, and its lengths are the ones that
    // count — some writers pad the extra field differently in the two places.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);

    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
    else throw new Error(`Unsupported compression in ${name}`);

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const unesc = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  // Last, or an escaped &amp;lt; becomes a tag.
  .replace(/&amp;/g, '&');

const colIndex = (ref: string) =>
  [...ref].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

/** True when these bytes are a ZIP, which is what an .xlsx is. */
export function looksLikeXlsx(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

/**
 * Read every worksheet as rows of strings.
 *
 * Cells are placed by their own column reference rather than in encounter order, because a
 * row with empty cells simply omits them — reading positionally shifts every value left and
 * files a phone number as an email address.
 */
export function readXlsx(buf: Buffer): Sheet[] {
  const files = unzip(buf);

  const sharedXml = files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1])).join(''));

  const wb = files.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const relsXml = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const rels = new Map([...relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
    .map((m) => [m[1], m[2].replace(/^\/?xl\//, '')]));

  const sheets: Sheet[] = [];
  for (const m of wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"/g)) {
    const target = rels.get(m[2]);
    if (!target) continue;
    const xml = files.get(`xl/${target}`)?.toString('utf8');
    if (!xml) continue;

    const rows: string[][] = [];
    for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cm of rm[2].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const ref = (cm[1].match(/r="([A-Z]+)\d+"/) ?? [])[1];
        const type = (cm[1].match(/t="([^"]+)"/) ?? [])[1] ?? 'n';
        let v = '';
        if (type === 'inlineStr') {
          v = [...cm[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1])).join('');
        } else {
          const raw = (cm[2].match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
          if (raw != null) v = type === 's' ? (shared[Number(raw)] ?? '') : unesc(raw);
        }
        if (ref) cells[colIndex(ref)] = v;
      }
      rows[Number(rm[1]) - 1] = cells;
    }

    sheets.push({
      name: unesc(m[1]).trim(),
      rows: rows.filter((r) => r && r.some((c) => String(c ?? '').trim()))
        .map((r) => Array.from(r, (c) => c ?? '')),
    });
  }
  return sheets;
}
