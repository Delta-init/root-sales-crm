import { Router, type Response, type NextFunction } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { financeAging, financeCommission, financeExpenses, financePayroll, financeOrganizations, financeOverview, financeRevenue } from "../services/reportOrgFinanceService.js";
import { sendSuccess, sendError } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/index.js";

/*
 * The Report Org — the org that lives inside Root (2026-11-26). Its Finance and revenue section first: finance's
 * organizations, one organization's headline figures, the Revenue report (invoiced or collected, grouped and
 * filtered) and the Expense report, each asked of finance and passed on as it answers.
 *
 * Root admins only, and decided here: finance's side of this checks nothing but Root's secret, so this is the only
 * place that says who may read the company's revenue. Somebody viewing as another person has that person's role.
 */
const router = Router();
router.use(authenticate, requireRole("root_admin"));

const answer = (title: string, run: (q: Record<string, unknown>) => Promise<unknown>) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      sendSuccess(res, title, await run(req.query as Record<string, unknown>));
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status) return sendError(res, (error as Error).message, status);
      next(error);
    }
  };

router.get("/finance/organizations", answer("Finance organizations", () => financeOrganizations()));
router.get("/finance/overview", answer("Finance overview", financeOverview));
router.get("/finance/revenue", answer("Revenue report", financeRevenue));
router.get("/finance/expenses", answer("Expense report", financeExpenses));
router.get("/finance/aging", answer("What is still owed", financeAging));
router.get("/finance/commission", answer("Commission report", financeCommission));
router.get("/finance/payroll", answer("Payroll report", financePayroll));

export default router;
