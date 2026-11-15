import type {
  AiPlayerSpendHistory,
  BudgetLimits,
  ModelPolicy,
} from "@craftlayer/contracts";

/** CSV of the daily spending rows; amounts in dollars, tokens as counts. */
export function spendCsv(name: string, days: AiPlayerSpendHistory["days"]) {
  const rows = [
    [
      "player",
      "day_utc",
      "spent_usd",
      "held_usd",
      "model_calls",
      "input_tokens",
      "output_tokens",
    ],
    ...days.map((d) => [
      name,
      d.day,
      (Number(d.used_micro) / 1e6).toFixed(6),
      (Number(d.reserved_micro) / 1e6).toFixed(6),
      String(d.calls),
      String(d.input_tokens),
      String(d.output_tokens),
    ]),
  ];
  return `${rows
    .map((r) =>
      r
        .map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v))
        .join(","),
    )
    .join("\n")}\n`;
}
/** Every UTC day in the window, oldest first, with zero for days without calls. */
export function fillDays(
  days: AiPlayerSpendHistory["days"],
  span: number,
  today: Date,
) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const out: AiPlayerSpendHistory["days"] = [];
  for (let i = span - 1; i >= 0; i--) {
    const date = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - i,
      ),
    );
    const day = date.toISOString().slice(0, 10);
    out.push(
      byDay.get(day) ?? {
        day,
        used_micro: "0",
        reserved_micro: "0",
        calls: 0,
        input_tokens: 0,
        output_tokens: 0,
      },
    );
  }
  return out;
}
/**
 * Hourly room an AI player needs besides money: each turn is one call of a few
 * thousand tokens. The money cap is the owner's choice; these only stop the
 * default (10 calls an hour) from blocking a player that is within its limits.
 */
export function roomFor(current: BudgetLimits, microUsd: string): BudgetLimits {
  return {
    calls: Math.max(current.calls, 600),
    input_tokens: Math.max(current.input_tokens, 6_000_000),
    output_tokens: Math.max(current.output_tokens, 300_000),
    total_tokens: Math.max(current.total_tokens, 6_300_000),
    concurrent: Math.max(current.concurrent, 2),
    micro_usd: microUsd,
  };
}
export function paidPolicy(
  current: ModelPolicy,
  microUsd: string,
): ModelPolicy {
  return microUsd === "0"
    ? { ...current, free_only: true, max_paid_micro_usd: "0" }
    : {
        ...current,
        free_only: false,
        allow_hosted: true,
        max_paid_micro_usd: microUsd,
      };
}
