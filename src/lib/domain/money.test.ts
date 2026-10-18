import { describe, expect, it } from "vitest";
import {
  bpsToPercent,
  fromMilli,
  fromMinor,
  lineAmountMinor,
  percentToBps,
  roundHalfUp,
  taxMinor,
  toMilli,
  toMinor,
} from "./money";

describe("toMinor / fromMinor", () => {
  it("converts plain decimals to cents", () => {
    expect(toMinor(19.99)).toBe(1999);
    expect(toMinor(2500)).toBe(250000);
    expect(toMinor(0)).toBe(0);
  });

  it("survives binary float artifacts", () => {
    expect(toMinor(0.1 + 0.2)).toBe(30); // 0.30000000000000004
    expect(toMinor(1.005)).toBe(101); // 1.005 * 100 = 100.49999… in float
  });

  it("rounds half-up at the cent boundary", () => {
    expect(toMinor(0.005)).toBe(1);
  });

  it("rejects junk input with 0", () => {
    expect(toMinor(Number.NaN)).toBe(0);
    expect(toMinor(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("round-trips through fromMinor", () => {
    expect(fromMinor(toMinor(19.99))).toBeCloseTo(19.99, 10);
    expect(fromMinor(1999)).toBe(19.99);
  });
});

describe("toMilli / fromMilli", () => {
  it("converts fractional quantities to milli-units", () => {
    expect(toMilli(0.5)).toBe(500);
    expect(toMilli(2.125)).toBe(2125);
    expect(fromMilli(500)).toBe(0.5);
  });

  it("rejects junk input with 0", () => {
    expect(toMilli(Number.NaN)).toBe(0);
  });
});

describe("roundHalfUp", () => {
  it("rounds .5 up", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(0.5)).toBe(1);
  });

  it("leaves exact values alone", () => {
    expect(roundHalfUp(4997)).toBe(4997);
  });
});

describe("lineAmountMinor", () => {
  it("multiplies quantity (milli) by unit price (minor)", () => {
    // 0.5 hours × $150.00 = $75.00
    expect(lineAmountMinor(500, 15000)).toBe(7500);
  });

  it("rounds half-up exactly once per line", () => {
    // 2.5 × $19.99 = $49.975 → $49.98
    expect(lineAmountMinor(2500, 1999)).toBe(4998);
  });

  it("handles a zero price", () => {
    expect(lineAmountMinor(1000, 0)).toBe(0);
  });
});

describe("taxMinor", () => {
  it("applies basis points to the taxable amount", () => {
    // $1944.00 at 8% (800 bps) = $155.52
    expect(taxMinor(194400, 800)).toBe(15552);
    expect(taxMinor(10000, 850)).toBe(850); // 8.5% of $100
  });

  it("rounds half-up once", () => {
    // 5% of $9.99 = $0.4995 → $0.50
    expect(taxMinor(999, 500)).toBe(50);
  });

  it("charges nothing at zero rate", () => {
    expect(taxMinor(194400, 0)).toBe(0);
  });
});

describe("percentToBps / bpsToPercent", () => {
  it("converts percentages to integer basis points", () => {
    expect(percentToBps(8.5)).toBe(850);
    expect(percentToBps(0)).toBe(0);
    expect(percentToBps(-3)).toBe(0);
  });

  it("clamps above 100%", () => {
    expect(percentToBps(150)).toBe(10000);
  });

  it("round-trips", () => {
    expect(bpsToPercent(percentToBps(8.5))).toBe(8.5);
  });
});
