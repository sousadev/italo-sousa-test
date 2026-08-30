import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { type GapReport, MetricSource } from "./reconciliation.types";

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  private parseDateOnly(dateStr: string): Date {
    const iso = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
    return new Date(`${iso}T00:00:00.000Z`);
  }

  private formatDateKey(date: Date): string {
    return date.toISOString().split("T")[0];
  }

  private generateDateSeries(from: string, to: string): string[] {
    const dates: string[] = [];
    const curr = this.parseDateOnly(from);
    const end = this.parseDateOnly(to);

    while (curr <= end) {
      dates.push(this.formatDateKey(curr));
      curr.setUTCDate(curr.getUTCDate() + 1);
    }

    return dates;
  }

  async findGaps(from: string, to: string): Promise<GapReport[]> {
    const fromDate = this.parseDateOnly(from);
    const toDate = this.parseDateOnly(to);
    const dateSeries = this.generateDateSeries(from, to);

    // 1. Busca todos os sites conhecidos no SiteMapping
    const siteMappings = await this.prisma.siteMapping.findMany({
      orderBy: { facebookSiteRef: "asc" },
    });

    if (siteMappings.length === 0 || dateSeries.length === 0) {
      return [];
    }

    const gaps: GapReport[] = [];

    for (const site of siteMappings) {
      // 2. Busca registros existentes de Facebook para o site no período
      const fbRecords = await this.prisma.facebookAdMetric.findMany({
        where: {
          siteRef: site.facebookSiteRef,
          localDate: {
            gte: fromDate,
            lte: toDate,
          },
        },
        select: { localDate: true },
      });

      const fbDates = new Set<string>(
        fbRecords.map((r) => this.formatDateKey(r.localDate)),
      );

      // 3. Busca registros existentes de GAM para o site no período
      const gamRecords = await this.prisma.gamAdMetric.findMany({
        where: {
          siteCode: site.gamSiteCode,
          utcDate: {
            gte: fromDate,
            lte: toDate,
          },
        },
        select: { utcDate: true },
      });

      const gamDates = new Set<string>(
        gamRecords.map((r) => this.formatDateKey(r.utcDate)),
      );

      // 4. Identifica dias faltantes na série temporal
      for (const date of dateSeries) {
        if (!fbDates.has(date)) {
          gaps.push({
            source: MetricSource.Facebook,
            site: site.facebookSiteRef,
            date,
          });
        }

        if (!gamDates.has(date)) {
          gaps.push({
            source: MetricSource.Gam,
            site: site.gamSiteCode,
            date,
          });
        }
      }
    }

    if (gaps.length > 0) {
      this.logger.warn(
        `Detectados ${gaps.length} gaps no período [${from} a ${to}].`,
      );
    }

    return gaps;
  }
}
