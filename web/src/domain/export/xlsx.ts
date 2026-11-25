// Minimal but valid OOXML (.xlsx) writer without third-party libraries (SheetJS npm builds carry
// open CVEs). Inline strings, numeric cells, styles, column widths and frozen header rows.
// Pure TypeScript (no DOM) so it runs under `node --test`.
import type { Estimate } from "../model.ts";
import { currencyFractionDigits } from "../money.ts";
import { convertedTotals, detailHeaders, detailRows, stripControlChars, summaryRows } from "./common.ts";
import type { ExportOptions, Results } from "./common.ts";
import { createZip } from "./zip.ts";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const MAX_CELL_TEXT = 32767;
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Cell style ids (indexes into cellXfs of styles.xml). */
const S = {
  default: 0,
  header: 1,
  money: 2,
  unitPrice: 3,
  wrap: 4,
  totalMoney: 5,
  totalLabel: 6,
  title: 7,
  label: 8,
} as const;

type CellValue = string | number | null | undefined;
interface Cell {
  v: CellValue;
  s?: number;
}
type Row = Cell[];

interface SheetSpec {
  name: string;
  rows: Row[];
  widths: number[];
  /** Number of rows frozen at the top (0 = none). */
  freezeRows: number;
  selected?: boolean;
}

/** XML text/attribute escaping; drops XML-invalid characters and protects literal "_xHHHH_". */
export function xmlEscape(text: string): string {
  return stripControlChars(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cellText(text: string): string {
  let t = stripControlChars(text);
  if (t.length > MAX_CELL_TEXT) t = `${t.slice(0, MAX_CELL_TEXT - 1)}…`;
  // ST_Xstring treats _xHHHH_ as an escape: encode the underscore of literal occurrences.
  return xmlEscape(t.replace(/_(x[0-9A-Fa-f]{4}_)/g, "_x005F_$1"));
}

export function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function numberText(n: number): string {
  // Round binary noise (e.g. 0.1 + 0.2) without losing meaningful precision.
  return String(Number(n.toPrecision(15)));
}

function cellXml(cell: Cell, ref: string): string {
  const style = cell.s ? ` s="${cell.s}"` : "";
  const v = cell.v;
  if (typeof v === "number") {
    return Number.isFinite(v) ? `<c r="${ref}"${style}><v>${numberText(v)}</v></c>` : style ? `<c r="${ref}"${style}/>` : "";
  }
  if (typeof v === "string" && v !== "") {
    return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${cellText(v)}</t></is></c>`;
  }
  return style ? `<c r="${ref}"${style}/>` : "";
}

function sheetXml(spec: SheetSpec): string {
  const maxCols = spec.rows.reduce((n, r) => Math.max(n, r.length), Math.max(1, spec.widths.length));
  const lastRef = `${columnName(maxCols - 1)}${Math.max(1, spec.rows.length)}`;
  const freeze = spec.freezeRows > 0;
  const topLeft = `A${spec.freezeRows + 1}`;
  const view = freeze
    ? `<sheetView workbookViewId="0"${spec.selected ? ' tabSelected="1"' : ""}><pane ySplit="${spec.freezeRows}" topLeftCell="${topLeft}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${topLeft}" sqref="${topLeft}"/></sheetView>`
    : `<sheetView workbookViewId="0"${spec.selected ? ' tabSelected="1"' : ""}/>`;
  const cols = spec.widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");
  const rows = spec.rows
    .map((row, r) => {
      const cells = row.map((cell, c) => cellXml(cell, `${columnName(c)}${r + 1}`)).join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return (
    `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<dimension ref="A1:${lastRef}"/>` +
    `<sheetViews>${view}</sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${rows}</sheetData>` +
    `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
    `</worksheet>`
  );
}

function stylesXml(currency: string): string {
  const code = currency.replace(/[^A-Za-z]/g, "").toUpperCase() || "USD";
  const digits = currencyFractionDigits(code);
  const amount = digits > 0 ? `#,##0.${"0".repeat(digits)}` : "#,##0";
  const unit = `#,##0.${"0".repeat(Math.max(digits, 2))}####`;
  const fmt = (pattern: string) => xmlEscape(`${pattern} "${code}"`);
  return (
    `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">` +
    `<numFmts count="2"><numFmt numFmtId="164" formatCode="${fmt(amount)}"/><numFmt numFmtId="165" formatCode="${fmt(unit)}"/></numFmts>` +
    `<fonts count="3">` +
    `<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
    `<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
    `<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>` +
    `</fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFDEEAF6"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border><left/><right/><top style="thin"><color auto="1"/></top><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="9">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>` +
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>` +
    `</styleSheet>`
  );
}

function contentTypesXml(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return (
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
    `</Types>`
  );
}

const ROOT_RELS =
  `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
  `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
  `</Relationships>`;

function appXml(sheetNames: string[]): string {
  const titles = sheetNames.map((n) => `<vt:lpstr>${xmlEscape(n)}</vt:lpstr>`).join("");
  return (
    `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    `<Application>Azure Price Calculator</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>` +
    `<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>` +
    `<TitlesOfParts><vt:vector size="${sheetNames.length}" baseType="lpstr">${titles}</vt:vector></TitlesOfParts>` +
    `<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion>` +
    `</Properties>`
  );
}

function coreXml(title: string, created: Date): string {
  const when = created.toISOString().replace(/\.\d{3}Z$/, "Z");
  return (
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${xmlEscape(title)}</dc:title><dc:creator>Azure Price Calculator</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified>` +
    `</cp:coreProperties>`
  );
}

/** Sheet names: max 31 chars, no []:*?/\ and not starting/ending with an apostrophe. */
export function sanitizeSheetName(name: string, fallback = "Sheet"): string {
  const clean = stripControlChars(name).replace(/[[\]:*?/\\]+/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31).trim();
  return clean || fallback;
}

function workbookXml(sheetNames: string[]): string {
  const sheets = sheetNames.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  return (
    `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000" activeTab="0"/></bookViews>` +
    `<sheets>${sheets}</sheets></workbook>`
  );
}

function workbookRels(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join("");
  return (
    `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${sheets}` +
    `<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`
  );
}

const text = (v: string, s?: number): Cell => ({ v, s });
const num = (v: number | null, s?: number): Cell => ({ v, s });

export interface XlsxOptions extends ExportOptions {
  /** Creation time written to docProps and the ZIP entries (default: now). */
  now?: Date;
}

/**
 * Workbook with three sheets: "Summary" (estimate name, prices date, currency, one row per item,
 * totals), "Detail" (one row per line, like the CSV, plus TOTAL) and "Assumptions".
 */
export async function estimateToXlsx(estimate: Estimate, results: Results, opts: XlsxOptions): Promise<Uint8Array> {
  const now = opts.now ?? new Date();
  const totals = convertedTotals(estimate, results, opts);
  const currency = totals.currency;

  const meta: Row[] = [
    [text(estimate.name || "Estimate", S.title)],
    [text("Prices as of", S.label), text(opts.pricesDate ? `${opts.pricesDate} (Azure Retail Prices API, list prices)` : "Azure Retail Prices API, list prices")],
    [text("Currency", S.label), text(currency === "USD" ? "USD" : `${currency} (indicative, converted from USD)`)],
    [text("Exported", S.label), text(now.toISOString().slice(0, 10))],
    [],
  ];
  const summaryHeader = ["Item", "Service", "Region", "Configuration", "Status", `Monthly (${currency})`, `Upfront (${currency})`, `Amortized monthly (${currency})`];
  const summary: Row[] = [...meta, summaryHeader.map((h) => text(h, S.header))];
  for (const r of summaryRows(estimate, results, opts)) {
    summary.push([
      text(r.item, S.wrap),
      text(r.service),
      text(r.region),
      text(r.configuration, S.wrap),
      text(r.status, S.wrap),
      num(r.monthly, S.money),
      num(r.upfront, S.money),
      num(r.amortizedMonthly, S.money),
    ]);
  }
  summary.push([
    text("TOTAL", S.totalLabel),
    text("", S.totalLabel),
    text("", S.totalLabel),
    text("", S.totalLabel),
    text("", S.totalLabel),
    num(totals.monthly, S.totalMoney),
    num(totals.upfront, S.totalMoney),
    num(totals.amortizedMonthly, S.totalMoney),
  ]);
  summary.push([text("Annual (monthly × 12 + upfront)", S.label), text(""), text(""), text(""), text(""), num(totals.annual, S.money)]);

  const detail: Row[] = [detailHeaders(currency).map((h) => text(h, S.header))];
  for (const r of detailRows(estimate, results, opts)) {
    detail.push([
      text(r.item),
      text(r.service),
      text(r.region),
      text(r.line, S.wrap),
      text(r.detail, S.wrap),
      text(r.commitment),
      num(r.quantity),
      text(r.unit),
      num(r.unitPrice, S.unitPrice),
      num(r.monthly, S.money),
      num(r.upfront, S.money),
      num(r.amortizedMonthly, S.money),
      text(r.notes, S.wrap),
    ]);
  }
  detail.push([
    text("TOTAL", S.totalLabel),
    ...Array.from({ length: 8 }, () => text("", S.totalLabel)),
    num(totals.monthly, S.totalMoney),
    num(totals.upfront, S.totalMoney),
    num(totals.amortizedMonthly, S.totalMoney),
    text("", S.totalLabel),
  ]);

  const assumptions: Row[] = [[text("Assumptions", S.header)], ...(opts.assumptions ?? []).map((a) => [text(a, S.wrap)])];

  const sheets: SheetSpec[] = [
    { name: "Summary", rows: summary, widths: [28, 22, 18, 48, 24, 16, 16, 20], freezeRows: meta.length + 1, selected: true },
    { name: "Detail", rows: detail, widths: [24, 20, 16, 34, 34, 14, 12, 14, 16, 16, 16, 20, 50], freezeRows: 1 },
    { name: "Assumptions", rows: assumptions, widths: [120], freezeRows: 1 },
  ];
  const names = sheets.map((s) => sanitizeSheetName(s.name));
  const enc = new TextEncoder();
  const files: Array<[string, string]> = [
    ["[Content_Types].xml", contentTypesXml(sheets.length)],
    ["_rels/.rels", ROOT_RELS],
    ["docProps/app.xml", appXml(names)],
    ["docProps/core.xml", coreXml(estimate.name || "Estimate", now)],
    ["xl/workbook.xml", workbookXml(names)],
    ["xl/_rels/workbook.xml.rels", workbookRels(sheets.length)],
    ["xl/styles.xml", stylesXml(currency)],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  return createZip(
    files.map(([name, xml]) => ({ name, data: enc.encode(xml) })),
    { date: now },
  );
}
