import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma-client";
import type { MoneyDecimalResult, MoneyInput, MoneyResult } from "./money.types";

@Injectable()
export class MoneyService {
  private toDecimal(val: number | Prisma.Decimal | string): Prisma.Decimal {
    if (val instanceof Prisma.Decimal) {
      return val;
    }
    return new Prisma.Decimal(val);
  }

  public calculateDecimal(input: MoneyInput): MoneyDecimalResult {
    const grossRevenueUsd = this.toDecimal(input.grossRevenueUsd);
    const revSharePct = this.toDecimal(input.revSharePct);
    const taxOnRevenuePct = this.toDecimal(input.taxOnRevenuePct);
    const fxRate = this.toDecimal(input.fxRate);
    const mediaCostLocal = this.toDecimal(input.mediaCostLocal);
    const taxOnMediaCostPct = this.toDecimal(input.taxOnMediaCostPct);

    const netRevenueUsd = grossRevenueUsd.mul(new Prisma.Decimal(1).sub(revSharePct));
    const netRevenueAfterTaxUsd = netRevenueUsd.mul(new Prisma.Decimal(1).sub(taxOnRevenuePct));
    const netRevenueLocal = netRevenueAfterTaxUsd.mul(fxRate);
    const mediaCostWithTaxLocal = mediaCostLocal.mul(new Prisma.Decimal(1).add(taxOnMediaCostPct));
    const profitLocal = netRevenueLocal.sub(mediaCostWithTaxLocal);

    const roas = mediaCostWithTaxLocal.isZero()
      ? new Prisma.Decimal(0)
      : netRevenueLocal.div(mediaCostWithTaxLocal);

    return {
      netRevenueUsd,
      netRevenueAfterTaxUsd,
      netRevenueLocal,
      mediaCostWithTaxLocal,
      profitLocal,
      roas,
    };
  }

  public calculate(input: MoneyInput): MoneyResult {
    const res = this.calculateDecimal(input);
    return {
      netRevenueUsd: res.netRevenueUsd.toNumber(),
      netRevenueAfterTaxUsd: res.netRevenueAfterTaxUsd.toNumber(),
      netRevenueLocal: res.netRevenueLocal.toNumber(),
      mediaCostWithTaxLocal: res.mediaCostWithTaxLocal.toNumber(),
      profitLocal: res.profitLocal.toNumber(),
      roas: res.roas.toNumber(),
    };
  }
}
