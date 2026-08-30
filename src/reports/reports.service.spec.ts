import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma-client";
import { ReportsService } from "./reports.service";
import { MoneyService } from "../money/money.service";
import type { PrismaService } from "../prisma/prisma.service";

describe("ReportsService", () => {
  let service: ReportsService;
  let mockPrisma: any;
  const moneyService = new MoneyService();

  beforeEach(() => {
    mockPrisma = {
      siteMapping: {
        findMany: vi.fn(),
      },
      fxRate: {
        findMany: vi.fn(),
      },
      facebookAdMetric: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      gamAdMetric: {
        findMany: vi.fn(),
      },
    };

    service = new ReportsService(
      mockPrisma as unknown as PrismaService,
      moneyService,
    );
  });

  it("retorna array vazio quando nenhum siteMapping é encontrado", async () => {
    mockPrisma.siteMapping.findMany.mockResolvedValue([]);

    const result = await service.getReport(
      "2026-07-01",
      "2026-07-05",
      "site-inexistente",
    );
    expect(result).toEqual([]);
  });

  it("consolida métricas de Facebook e GAM com cálculo diário de câmbio", async () => {
    mockPrisma.siteMapping.findMany.mockResolvedValue([
      {
        id: "site-1",
        facebookSiteRef: "site-nutrihealth",
        gamSiteCode: "NUTRIHEALTH_MAIN",
        displayName: "Nutri Health",
        revSharePct: new Prisma.Decimal("0.3000"),
        taxOnRevenuePct: new Prisma.Decimal("0.1000"),
        taxOnMediaCostPct: new Prisma.Decimal("0.0200"),
      },
    ]);

    mockPrisma.fxRate.findMany.mockResolvedValue([
      {
        date: new Date("2026-07-01T00:00:00.000Z"),
        usdBrl: new Prisma.Decimal("5.000000"),
      },
    ]);

    mockPrisma.facebookAdMetric.findMany.mockResolvedValue([
      {
        externalCampaignId: "fb-1",
        campaignName: "Camp 1",
        siteRef: "site-nutrihealth",
        localDate: new Date("2026-07-01T00:00:00.000Z"),
        accountTimezone: "America/Sao_Paulo",
        accountCurrency: "BRL",
        spend: new Prisma.Decimal("200.00"),
        impressions: 1000,
        clicks: 100,
      },
    ]);

    mockPrisma.gamAdMetric.findMany.mockResolvedValue([
      {
        networkCode: "net-1",
        siteCode: "NUTRIHEALTH_MAIN",
        utcDate: new Date("2026-07-01T00:00:00.000Z"),
        currencyCode: "USD",
        adRevenue: new Prisma.Decimal("100.00"),
        impressions: 900,
        adRequests: 1000,
      },
    ]);

    const report = await service.getReport("2026-07-01", "2026-07-01");

    expect(report).toHaveLength(1);
    const entry = report[0];
    expect(entry.siteRef).toBe("site-nutrihealth");
    expect(entry.siteCode).toBe("NUTRIHEALTH_MAIN");
    expect(entry.currency).toBe("BRL");
    expect(entry.impressions).toBe(1000);
    expect(entry.clicks).toBe(100);
    expect(entry.ctr).toBe(0.1); // 100 / 1000
    expect(entry.mediaCostLocal).toBe(200);
    expect(entry.mediaCostWithTaxLocal).toBe(204); // 200 * 1.02
    expect(entry.grossRevenueUsd).toBe(100);
    // 100 * (1 - 0.3) * (1 - 0.1) * 5 = 315
    expect(entry.netRevenueLocal).toBe(315);
    // 315 - 204 = 111
    expect(entry.profitLocal).toBe(111);
    // 315 / 204 = 1.544117...
    expect(entry.roas).toBeCloseTo(1.5441176470588236, 6);
    // cpa = 204 / 100 = 2.04
    expect(entry.cpa).toBe(2.04);
  });
});
