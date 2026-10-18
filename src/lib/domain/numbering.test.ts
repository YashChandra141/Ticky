import { describe, expect, it } from "vitest";
import { DEFAULT_NUMBERING, formatInvoiceNumber, numberingConfig } from "./numbering";

describe("formatInvoiceNumber", () => {
  it("formats with the default config", () => {
    expect(formatInvoiceNumber(DEFAULT_NUMBERING, 1)).toBe("INV-0001");
    expect(formatInvoiceNumber(DEFAULT_NUMBERING, 42)).toBe("INV-0042");
  });

  it("never truncates sequences longer than the padding", () => {
    expect(formatInvoiceNumber(DEFAULT_NUMBERING, 12345)).toBe("INV-12345");
  });

  it("supports custom prefix, separator and padding", () => {
    expect(formatInvoiceNumber({ prefix: "TICKY", separator: "/", padding: 2 }, 7)).toBe("TICKY/07");
  });

  it("clamps junk sequences to 1", () => {
    expect(formatInvoiceNumber(DEFAULT_NUMBERING, 0)).toBe("INV-0001");
    expect(formatInvoiceNumber(DEFAULT_NUMBERING, -5)).toBe("INV-0001");
  });
});

describe("numberingConfig", () => {
  it("reads the config from settings", () => {
    expect(
      numberingConfig({ numberPrefix: "T", numberSeparator: "-", numberPadding: 3 }),
    ).toEqual({ prefix: "T", separator: "-", padding: 3 });
  });

  it("falls back to the default prefix on blank", () => {
    expect(numberingConfig({ numberPrefix: "  ", numberSeparator: "-", numberPadding: 4 }).prefix).toBe("INV");
  });
});
