import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma-client";
import { PrismaService } from "../prisma/prisma.service";
import type { FacebookMetricInput, GamMetricInput } from "./ingestion.types";

@Injectable()
export class IngestionService {
  constructor(private readonly prisma: PrismaService) { }

  private parseDate(dateStr: string): Date {
    const isoDate = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
    return new Date(`${isoDate}T00:00:00.000Z`);
  }

  async processMetrics(
    facebook: FacebookMetricInput[],
    gam: GamMetricInput[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const metric of facebook) {
        const localDate = this.parseDate(metric.localDate);
        const existing = await tx.facebookAdMetric.findFirst({
          where: {
            externalCampaignId: metric.externalCampaignId,
            siteRef: metric.siteRef,
            localDate: localDate,
          },
        });

        if (existing) {
          await tx.facebookAdMetric.update({
            where: { id: existing.id },
            data: {
              campaignName: metric.campaignName,
              accountTimezone: metric.accountTimezone,
              accountCurrency: metric.accountCurrency,
              spend: new Prisma.Decimal(metric.spend),
              impressions: metric.impressions,
              clicks: metric.clicks,
            },
          });
        } else {
          await tx.facebookAdMetric.create({
            data: {
              externalCampaignId: metric.externalCampaignId,
              campaignName: metric.campaignName,
              siteRef: metric.siteRef,
              localDate: localDate,
              accountTimezone: metric.accountTimezone,
              accountCurrency: metric.accountCurrency,
              spend: new Prisma.Decimal(metric.spend),
              impressions: metric.impressions,
              clicks: metric.clicks,
            },
          });
        }
      }

      for (const metric of gam) {
        const utcDate = this.parseDate(metric.utcDate);
        const existing = await tx.gamAdMetric.findFirst({
          where: {
            networkCode: metric.networkCode,
            siteCode: metric.siteCode,
            utcDate: utcDate,
          },
        });

        if (existing) {
          await tx.gamAdMetric.update({
            where: { id: existing.id },
            data: {
              currencyCode: metric.currencyCode,
              adRevenue: new Prisma.Decimal(metric.adRevenue),
              impressions: metric.impressions,
              adRequests: metric.adRequests,
            },
          });
        } else {
          await tx.gamAdMetric.create({
            data: {
              networkCode: metric.networkCode,
              siteCode: metric.siteCode,
              utcDate: utcDate,
              currencyCode: metric.currencyCode,
              adRevenue: new Prisma.Decimal(metric.adRevenue),
              impressions: metric.impressions,
              adRequests: metric.adRequests,
            },
          });
        }
      }
    });
  }
}
