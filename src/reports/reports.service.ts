import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma-client";
import { PrismaService } from "../prisma/prisma.service";
import { MoneyService } from "../money/money.service";
import type { SiteReportEntry } from "./reports.types";

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moneyService: MoneyService,
  ) { }

  private parseDateOnly(dateStr: string): Date {
    const iso = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
    return new Date(`${iso}T00:00:00.000Z`);
  }

  private formatDateKey(date: Date): string {
    return date.toISOString().split("T")[0];
  }

  async getReport(
    from: string,
    to: string,
    siteRef?: string,
  ): Promise<SiteReportEntry[]> {
    const fromDate = this.parseDateOnly(from);
    const toDate = this.parseDateOnly(to);

    // 1 Buscar os mapeamentos de sites conhecidos
    const siteMappings = await this.prisma.siteMapping.findMany({
      where: siteRef ? { facebookSiteRef: siteRef } : undefined,
      orderBy: { facebookSiteRef: "asc" },
    });

    if (siteMappings.length === 0) {
      return [];
    }

    // 2 Busca todas as cotações no período
    const fxRates = await this.prisma.fxRate.findMany({
      where: {
        date: {
          gte: fromDate,
          lte: toDate,
        },
      },
    });

    const fxRateMap = new Map<string, Prisma.Decimal>();
    for (const fx of fxRates) {
      fxRateMap.set(this.formatDateKey(fx.date), fx.usdBrl);
    }

    const reportEntries: SiteReportEntry[] = [];

    for (const site of siteMappings) {
      // 3- Busca métricas do Facebook no período para este site
      const fbMetrics = await this.prisma.facebookAdMetric.findMany({
        where: {
          siteRef: site.facebookSiteRef,
          localDate: {
            gte: fromDate,
            lte: toDate,
          },
        },
      });

      // 4 - Busca métricas do GAM no período para este site
      const gamMetrics = await this.prisma.gamAdMetric.findMany({
        where: {
          siteCode: site.gamSiteCode,
          utcDate: {
            gte: fromDate,
            lte: toDate,
          },
        },
      });

      // Determina a moeda da conta do site (a partir dos dados do FB ou muda para BRL)
      let currency = "BRL";
      if (fbMetrics.length > 0) {
        currency = fbMetrics[0].accountCurrency;
      } else {
        const anyFbMetric = await this.prisma.facebookAdMetric.findFirst({
          where: { siteRef: site.facebookSiteRef },
        });
        if (anyFbMetric) {
          currency = anyFbMetric.accountCurrency;
        }
      }

      // 5. Agrupa dados por dia (data ISO YYYY-MM-DD)
      const dailyData = new Map<
        string,
        {
          mediaCostLocal: Prisma.Decimal;
          impressions: number;
          clicks: number;
          grossRevenueUsd: Prisma.Decimal;
        }
      >();

      for (const fb of fbMetrics) {
        const key = this.formatDateKey(fb.localDate);
        const current = dailyData.get(key) || {
          mediaCostLocal: new Prisma.Decimal(0),
          impressions: 0,
          clicks: 0,
          grossRevenueUsd: new Prisma.Decimal(0),
        };
        current.mediaCostLocal = current.mediaCostLocal.add(fb.spend);
        current.impressions += fb.impressions;
        current.clicks += fb.clicks;
        dailyData.set(key, current);
      }

      for (const gam of gamMetrics) {
        const key = this.formatDateKey(gam.utcDate);
        const current = dailyData.get(key) || {
          mediaCostLocal: new Prisma.Decimal(0),
          impressions: 0,
          clicks: 0,
          grossRevenueUsd: new Prisma.Decimal(0),
        };
        current.grossRevenueUsd = current.grossRevenueUsd.add(gam.adRevenue);
        dailyData.set(key, current);
      }

      let totalImpressions = 0;
      let totalClicks = 0;
      let totalMediaCostLocal = new Prisma.Decimal(0);
      let totalMediaCostWithTaxLocal = new Prisma.Decimal(0);
      let totalGrossRevenueUsd = new Prisma.Decimal(0);
      let totalNetRevenueLocal = new Prisma.Decimal(0);
      let totalProfitLocal = new Prisma.Decimal(0);

      // Processamento do cálculo dia a dia com MoneyService
      for (const [dateKey, day] of dailyData.entries()) {
        totalImpressions += day.impressions;
        totalClicks += day.clicks;
        totalMediaCostLocal = totalMediaCostLocal.add(day.mediaCostLocal);
        totalGrossRevenueUsd = totalGrossRevenueUsd.add(day.grossRevenueUsd);

        let fxRate: Prisma.Decimal;
        if (currency.toUpperCase() === "USD") {
          fxRate = new Prisma.Decimal(1);
        } else {
          fxRate = fxRateMap.get(dateKey) || new Prisma.Decimal(1);
        }

        const dayMoneyResult = this.moneyService.calculateDecimal({
          grossRevenueUsd: day.grossRevenueUsd,
          revSharePct: site.revSharePct,
          taxOnRevenuePct: site.taxOnRevenuePct,
          fxRate: fxRate,
          mediaCostLocal: day.mediaCostLocal,
          taxOnMediaCostPct: site.taxOnMediaCostPct,
        });

        totalMediaCostWithTaxLocal = totalMediaCostWithTaxLocal.add(
          dayMoneyResult.mediaCostWithTaxLocal,
        );
        totalNetRevenueLocal = totalNetRevenueLocal.add(
          dayMoneyResult.netRevenueLocal,
        );
        totalProfitLocal = totalProfitLocal.add(dayMoneyResult.profitLocal);
      }

      // Métricas derivadas do período
      const ctr =
        totalImpressions > 0 ? totalClicks / totalImpressions : 0;
      const cpa =
        totalClicks > 0
          ? totalMediaCostWithTaxLocal
            .div(new Prisma.Decimal(totalClicks))
            .toNumber()
          : 0;
      const roas = totalMediaCostWithTaxLocal.isZero()
        ? 0
        : totalNetRevenueLocal
          .div(totalMediaCostWithTaxLocal)
          .toNumber();

      reportEntries.push({
        siteRef: site.facebookSiteRef,
        siteCode: site.gamSiteCode,
        displayName: site.displayName,
        currency,
        impressions: totalImpressions,
        clicks: totalClicks,
        ctr,
        cpa,
        mediaCostLocal: totalMediaCostLocal.toNumber(),
        mediaCostWithTaxLocal: totalMediaCostWithTaxLocal.toNumber(),
        grossRevenueUsd: totalGrossRevenueUsd.toNumber(),
        netRevenueLocal: totalNetRevenueLocal.toNumber(),
        profitLocal: totalProfitLocal.toNumber(),
        roas,
      });
    }

    return reportEntries;
  }
}
