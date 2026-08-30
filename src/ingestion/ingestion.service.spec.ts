import { describe, expect, it, vi, beforeEach } from "vitest";
import { IngestionService } from "./ingestion.service";
import type { PrismaService } from "../prisma/prisma.service";

describe("IngestionService", () => {
  let service: IngestionService;
  let mockPrisma: any;
  let mockTx: any;

  beforeEach(() => {
    mockTx = {
      facebookAdMetric: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      gamAdMetric: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    };

    mockPrisma = {
      $transaction: vi.fn(async (cb: (tx: any) => Promise<void>) => {
        return cb(mockTx);
      }),
    };

    service = new IngestionService(mockPrisma as unknown as PrismaService);
  });

  it("insere novos registros quando não existem no banco", async () => {
    mockTx.facebookAdMetric.findFirst.mockResolvedValue(null);
    mockTx.gamAdMetric.findFirst.mockResolvedValue(null);

    await service.processMetrics(
      [
        {
          externalCampaignId: "camp-1",
          campaignName: "Test FB",
          siteRef: "site-1",
          localDate: "2026-08-01",
          accountTimezone: "America/Sao_Paulo",
          accountCurrency: "BRL",
          spend: 100,
          impressions: 1000,
          clicks: 50,
        },
      ],
      [
        {
          networkCode: "net-1",
          siteCode: "SITE_1",
          utcDate: "2026-08-01",
          currencyCode: "USD",
          adRevenue: 20,
          impressions: 900,
          adRequests: 1200,
        },
      ],
    );

    expect(mockTx.facebookAdMetric.create).toHaveBeenCalledTimes(1);
    expect(mockTx.gamAdMetric.create).toHaveBeenCalledTimes(1);
    expect(mockTx.facebookAdMetric.update).not.toHaveBeenCalled();
    expect(mockTx.gamAdMetric.update).not.toHaveBeenCalled();
  });

  it("garante idempotência: atualiza registros existentes sem duplicar ao reenviar o mesmo payload", async () => {
    mockTx.facebookAdMetric.findFirst.mockResolvedValue({ id: "existing-fb-id" });
    mockTx.gamAdMetric.findFirst.mockResolvedValue({ id: "existing-gam-id" });

    await service.processMetrics(
      [
        {
          externalCampaignId: "camp-1",
          campaignName: "Updated FB",
          siteRef: "site-1",
          localDate: "2026-08-01",
          accountTimezone: "America/Sao_Paulo",
          accountCurrency: "BRL",
          spend: 120,
          impressions: 1200,
          clicks: 60,
        },
      ],
      [
        {
          networkCode: "net-1",
          siteCode: "SITE_1",
          utcDate: "2026-08-01",
          currencyCode: "USD",
          adRevenue: 25,
          impressions: 1000,
          adRequests: 1300,
        },
      ],
    );

    expect(mockTx.facebookAdMetric.update).toHaveBeenCalledTimes(1);
    expect(mockTx.facebookAdMetric.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-fb-id" },
      }),
    );
    expect(mockTx.gamAdMetric.update).toHaveBeenCalledTimes(1);
    expect(mockTx.gamAdMetric.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-gam-id" },
      }),
    );
    expect(mockTx.facebookAdMetric.create).not.toHaveBeenCalled();
    expect(mockTx.gamAdMetric.create).not.toHaveBeenCalled();
  });

  it("processa arrays vazios [] sem erro e sem alterar dados", async () => {
    await service.processMetrics([], []);

    expect(mockTx.facebookAdMetric.findFirst).not.toHaveBeenCalled();
    expect(mockTx.facebookAdMetric.create).not.toHaveBeenCalled();
    expect(mockTx.gamAdMetric.findFirst).not.toHaveBeenCalled();
    expect(mockTx.gamAdMetric.create).not.toHaveBeenCalled();
  });
});
