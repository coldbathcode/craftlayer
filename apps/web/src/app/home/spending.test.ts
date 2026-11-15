import { describe, expect, it } from "vitest";
import { fillDays, paidPolicy, roomFor, spendCsv } from "./spending.js";

const row = (day: string, used: string, calls: number) => ({
  day,
  used_micro: used,
  reserved_micro: "0",
  calls,
  input_tokens: calls * 1000,
  output_tokens: calls * 20,
});

describe("AI player spending history (G9)", () => {
  it("fills every UTC day in the window with zero for quiet days", () => {
    const days = fillDays(
      [row("2026-11-13", "1500", 3), row("2026-11-15", "250", 1)],
      4,
      new Date("2026-11-15T23:30:00Z"),
    );
    expect(days.map((d) => [d.day, d.used_micro, d.calls])).toEqual([
      ["2026-11-12", "0", 0],
      ["2026-11-13", "1500", 3],
      ["2026-11-14", "0", 0],
      ["2026-11-15", "250", 1],
    ]);
  });
  it("exports dollars and token counts as CSV, quoting awkward names", () => {
    expect(
      spendCsv('Pip, "the helper"', [row("2026-11-15", "1234567", 2)]),
    ).toBe(
      'player,day_utc,spent_usd,held_usd,model_calls,input_tokens,output_tokens\n"Pip, ""the helper""",2026-11-15,1.234567,0.000000,2,2000,40\n',
    );
  });
});

describe("paid model settings (G10)", () => {
  const limits = {
    calls: 10,
    input_tokens: 163840,
    output_tokens: 20480,
    total_tokens: 184320,
    micro_usd: "0",
    concurrent: 2,
  };
  it("raises the hourly room for calls and tokens but never lowers it", () => {
    expect(roomFor(limits, "1000000")).toMatchObject({
      calls: 600,
      micro_usd: "1000000",
      input_tokens: 6_000_000,
    });
    expect(roomFor({ ...limits, calls: 2000 }, "0").calls).toBe(2000);
  });
  it("turns paid models on with a cap, and off again", () => {
    const base = {
      allowed_models: null,
      free_only: true,
      allow_paid_fallback: false,
      max_paid_micro_usd: "0",
      allow_hosted: false,
      max_input_tokens: 16384,
      max_output_tokens: 2048,
      max_attempts: 2,
    };
    expect(paidPolicy(base, "500000")).toMatchObject({
      free_only: false,
      allow_hosted: true,
      max_paid_micro_usd: "500000",
      allow_paid_fallback: false,
    });
    expect(paidPolicy({ ...base, free_only: false }, "0")).toMatchObject({
      free_only: true,
      max_paid_micro_usd: "0",
    });
  });
});
