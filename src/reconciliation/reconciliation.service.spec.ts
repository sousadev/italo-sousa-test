import { describe, expect, it, vi, beforeEach } from "vitest";
import { ReconciliationService } from "./reconciliation.service";
import { MetricSource } from "./reconciliation.types";
import type { PrismaService } from "../prisma/prisma.service";

describe("ReconciliationService", () => {
  let service: ReconciliationService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      siteMapping: {
        findMany: vi.fn(),
      },
      facebookAdMetric: {
        findMany: vi.fn(),
      },
      gamAdMetric: {
        findMany: vi.fn(),
      },
    };

    service = new ReconciliationService(mockPrisma as unknown as PrismaService);
  });

  it("retorna array vazio quando não existem gaps no período", async () => {
    mockPrisma.siteMapping.findMany.mockResolvedValue([
      {
        id: "site-1",
        facebookSiteRef: "site-nutrihealth",
        gamSiteCode: "NUTRIHEALTH_MAIN",
      },
    ]);

    mockPrisma.facebookAdMetric.findMany.mockResolvedValue([
      { localDate: new Date("2026-07-01T00:00:00.000Z") },
      { localDate: new Date("2026-07-02T00:00:00.000Z") },
    ]);

    mockPrisma.gamAdMetric.findMany.mockResolvedValue([
      { utcDate: new Date("2026-07-01T00:00:00.000Z") },
      { utcDate: new Date("2026-07-02T00:00:00.000Z") },
    ]);

    const gaps = await service.findGaps("2026-07-01", "2026-07-02");
    expect(gaps).toEqual([]);
  });

  it("identifica corretamente dias com dados faltantes no Facebook ou GAM", async () => {
    mockPrisma.siteMapping.findMany.mockResolvedValue([
      {
        id: "site-1",
        facebookSiteRef: "site-nutrihealth",
        gamSiteCode: "NUTRIHEALTH_MAIN",
      },
    ]);

    // FB tem dado no dia 01, mas falta dia 02
    mockPrisma.facebookAdMetric.findMany.mockResolvedValue([
      { localDate: new Date("2026-07-01T00:00:00.000Z") },
    ]);

    // GAM tem dado no dia 02, mas falta dia 01
    mockPrisma.gamAdMetric.findMany.mockResolvedValue([
      { utcDate: new Date("2026-07-02T00:00:00.000Z") },
    ]);

    const gaps = await service.findGaps("2026-07-01", "2026-07-02");
    expect(gaps).toEqual([
      {
        source: MetricSource.Gam,
        site: "NUTRIHEALTH_MAIN",
        date: "2026-07-01",
      },
      {
        source: MetricSource.Facebook,
        site: "site-nutrihealth",
        date: "2026-07-02",
      },
    ]);
  });
});
