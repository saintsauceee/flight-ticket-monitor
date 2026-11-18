import type { Usage } from '@shared/types';
import { HttpError, type Ctx } from '../context';
import { currentMonth } from '../lib/dates';

function budgetFor(ctx: Ctx): number | null {
  return ctx.provider.info.costPerSearch > 0 ? ctx.config.serpapi.monthlyBudget : null;
}

export function getUsage(ctx: Ctx): Usage {
  const month = currentMonth(ctx.now());
  const row = ctx.db.prepare('SELECT count FROM provider_usage WHERE provider = ? AND month = ?').get(ctx.provider.info.id, month) as
    | { count: number }
    | undefined;
  return { month, used: row?.count ?? 0, budget: budgetFor(ctx) };
}

/** Throws when spending `cost` more searches would exceed this month's budget. */
export function assertBudget(ctx: Ctx, cost: number): void {
  if (cost <= 0) return;
  const { used, budget } = getUsage(ctx);
  if (budget != null && used + cost > budget) {
    throw new HttpError(
      429,
      `Monthly search budget reached (${used} of ${budget} used). It resets next month; raise SERPAPI_MONTHLY_BUDGET if your plan allows more.`,
      'budget_exhausted',
    );
  }
}

export function recordUsage(ctx: Ctx, cost: number): void {
  if (cost <= 0) return;
  ctx.db
    .prepare(
      `INSERT INTO provider_usage (provider, month, count) VALUES (?, ?, ?)
       ON CONFLICT(provider, month) DO UPDATE SET count = count + excluded.count`,
    )
    .run(ctx.provider.info.id, currentMonth(ctx.now()), cost);
}
