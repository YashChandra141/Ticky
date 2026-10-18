import { PDFDocument, StandardFonts, rgb, type Color, type PDFFont, type PDFPage } from "pdf-lib";
import { bpsToPercent, fromMilli, lineAmountMinor } from "./domain/money";
import { deriveStatus } from "./domain/status";
import { formatDate } from "./format";
import { effectiveTotals } from "./totals";
import type { Invoice, Settings } from "./types";

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const M = 48;
const RIGHT = PAGE_W - M;

const INK = rgb(0.09, 0.11, 0.13);
const MUTED = rgb(0.45, 0.48, 0.53);
const LINE = rgb(0.85, 0.86, 0.88);
const SOFT = rgb(0.955, 0.965, 0.955);
const ACCENT = rgb(0.05, 0.4, 0.26); // ledger green

const SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "EUR ", GBP: "\u00A3", INR: "Rs. ", JPY: "\u00A5", CNY: "\u00A5",
  CAD: "$", AUD: "$", NZD: "$", CHF: "CHF ", SEK: "kr ", NOK: "kr ",
  MXN: "$", BRL: "R$", ZAR: "R ", SGD: "$", HKD: "$", AED: "AED ",
};

const STATUS_TEXT: Record<string, string> = {
  draft: "DRAFT",
  issued: "ISSUED",
  partially_paid: "PARTIALLY PAID",
  paid: "PAID",
  overdue: "OVERDUE",
  void: "VOID",
};

function minorMoney(minor: number, currency: string): string {
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  const formatted = (minor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${formatted}`;
}

/** pdf-lib standard fonts are WinAnsi-only; strip anything they can't draw. */
function sanitize(text: string): string {
  return text.replace(/\u20AC/g, "EUR ").replace(/[^\n\x20-\x7E\xA0]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export async function renderInvoicePdf(
  invoice: Invoice,
  settings: Settings,
  payments: ReadonlyArray<{ amountMinor: number }> = [],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${invoice.number} - ${invoice.customer.name}`);
  doc.setProducer("Ticky");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;

  type DrawOptions = {
    size: number;
    bold?: boolean;
    color?: Color;
    align?: "left" | "right";
    /** Defaults to the running cursor; pass explicitly to break out of the flow. */
    y?: number;
  };

  const draw = (text: string, x: number, opts: DrawOptions) => {
    const f = opts.bold ? bold : font;
    const clean = sanitize(text);
    const width = f.widthOfTextAtSize(clean, opts.size);
    page.drawText(clean, {
      x: opts.align === "right" ? x - width : x,
      y: opts.y ?? y,
      size: opts.size,
      font: f,
      color: opts.color ?? INK,
    });
  };

  const totals = effectiveTotals(invoice);
  const amountPaidMinor = payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  const balanceMinor = totals.totalMinor - amountPaidMinor;
  const customer = invoice.issuedSnapshot?.customer ?? invoice.customer;
  const status = deriveStatus(
    { status: invoice.status, dueDate: invoice.dueDate, totalMinor: totals.totalMinor },
    payments,
    invoice.issueDate, // anchor to the document, not "today"
  );

  // ---- header: company (left) / INVOICE title + meta (right) ----
  draw(settings.companyName || "Invoice", M, { bold: true, size: 15 });
  y -= 15;
  for (const line of wrap(settings.companyAddress, font, 9, 230)) {
    if (!line) continue;
    draw(line, M, { size: 9, color: MUTED });
    y -= 12;
  }
  if (settings.companyEmail) {
    draw(settings.companyEmail, M, { size: 9, color: MUTED });
    y -= 12;
  }

  let metaY = PAGE_H - M - 3;
  const title = "INVOICE";
  page.drawText(title, {
    x: RIGHT - bold.widthOfTextAtSize(title, 19),
    y: metaY,
    size: 19,
    font: bold,
    color: ACCENT,
  });
  metaY -= 24;
  const metaRows: Array<[string, string]> = [
    ["Invoice number", invoice.number],
    ["Issue date", formatDate(invoice.issueDate)],
    ["Due date", formatDate(invoice.dueDate)],
    ["Status", STATUS_TEXT[status] ?? status],
  ];
  for (const [label, value] of metaRows) {
    const labelWidth = font.widthOfTextAtSize(label, 8);
    page.drawText(label, { x: RIGHT - labelWidth, y: metaY, size: 8, font, color: MUTED });
    page.drawText(sanitize(value), {
      x: RIGHT - bold.widthOfTextAtSize(value, 10),
      y: metaY - 11,
      size: 10,
      font: bold,
      color: INK,
    });
    metaY -= 26;
  }

  y = Math.min(y, metaY) - 8;
  page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.75, color: LINE });

  // ---- bill to ----
  y -= 24;
  draw("Bill to", M, { size: 8, bold: true, color: MUTED });
  y -= 14;
  draw(customer.name, M, { size: 11, bold: true });
  y -= 13;
  const billToLines = [
    ...wrap(customer.address, font, 9, 260).filter(Boolean),
    ...(customer.email ? [customer.email] : []),
  ];
  for (const line of billToLines) {
    draw(line, M, { size: 9, color: MUTED });
    y -= 12;
  }

  // ---- items table ----
  const colQty = M + 330;
  const colUnit = M + 420;
  const colDescWidth = colQty - M - 24;

  y -= 34;
  page.drawRectangle({ x: M, y: y - 5, width: RIGHT - M, height: 20, color: SOFT });
  draw("Description", M + 8, { size: 8, bold: true, color: MUTED });
  draw("Qty", colQty, { size: 8, bold: true, color: MUTED, align: "right" });
  draw("Unit price", colUnit, { size: 8, bold: true, color: MUTED, align: "right" });
  draw("Amount", RIGHT, { size: 8, bold: true, color: MUTED, align: "right" });
  y -= 18;

  for (const item of invoice.items) {
    const descLines = wrap(item.description, font, 9.5, colDescWidth);
    const rowHeight = Math.max(descLines.length * 13, 18) + 7;
    if (y - rowHeight < M + 150) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - M;
    }
    let textY = y;
    for (const line of descLines) {
      draw(line, M + 8, { size: 9.5, y: textY });
      textY -= 13;
    }
    draw(String(fromMilli(item.quantityMilli)), colQty, { size: 9.5, align: "right" });
    draw(minorMoney(item.unitPriceMinor, invoice.currency), colUnit, { size: 9.5, align: "right" });
    draw(
      minorMoney(lineAmountMinor(item.quantityMilli, item.unitPriceMinor), invoice.currency),
      RIGHT,
      { size: 9.5, bold: true, align: "right" },
    );
    y -= rowHeight;
    page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.5, color: LINE });
  }

  // ---- totals ----
  y -= 26;
  if (y < M + 190) {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - M;
  }
  const labelX = M + 330;
  const totalRows: Array<[string, string]> = [
    ["Subtotal", minorMoney(totals.subtotalMinor, invoice.currency)],
  ];
  if (totals.discountMinor > 0) {
    totalRows.push(["Discount", `-${minorMoney(totals.discountMinor, invoice.currency)}`]);
  }
  if (totals.taxMinor > 0) {
    totalRows.push([
      `Tax (${bpsToPercent(invoice.taxRateBps)}%)`,
      minorMoney(totals.taxMinor, invoice.currency),
    ]);
  }
  for (const [label, value] of totalRows) {
    draw(label, labelX, { size: 9.5, color: MUTED });
    draw(value, RIGHT, { size: 9.5, align: "right" });
    y -= 16;
  }
  page.drawLine({
    start: { x: labelX - 10, y: y + 6 },
    end: { x: RIGHT, y: y + 6 },
    thickness: 0.75,
    color: INK,
  });
  draw(amountPaidMinor > 0 ? "Total" : "Total due", labelX, { size: 12, bold: true });
  draw(minorMoney(totals.totalMinor, invoice.currency), RIGHT, { size: 12, bold: true, align: "right" });

  if (amountPaidMinor > 0) {
    y -= 16;
    draw("Paid", labelX, { size: 9.5, color: MUTED });
    draw(`-${minorMoney(amountPaidMinor, invoice.currency)}`, RIGHT, { size: 9.5, align: "right" });
    y -= 15;
    draw("Balance due", labelX, { size: 10, bold: true });
    draw(minorMoney(balanceMinor, invoice.currency), RIGHT, { size: 10, bold: true, align: "right" });
  }

  // ---- notes / terms / payment details ----
  const sections = (
    [
      ["Notes", invoice.notes],
      ["Terms", invoice.terms],
      ["Payment details", settings.paymentDetails],
    ] as Array<[string, string]>
  ).filter(([, text]) => text.trim().length > 0);

  for (const [heading, body] of sections) {
    const lines = wrap(body, font, 9, RIGHT - M);
    if (y - (lines.length * 12 + 34) < M) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - M;
    }
    y -= 22;
    draw(heading, M, { size: 9, bold: true });
    y -= 13;
    for (const line of lines) {
      draw(line, M, { size: 9, color: MUTED });
      y -= 12;
    }
  }

  return doc.save();
}
