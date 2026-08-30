import { Prisma } from "@prisma-client";

export interface MoneyInput {
  grossRevenueUsd: number | Prisma.Decimal | string;
  revSharePct: number | Prisma.Decimal | string;
  taxOnRevenuePct: number | Prisma.Decimal | string;
  fxRate: number | Prisma.Decimal | string; // 1 se o site já é USD
  mediaCostLocal: number | Prisma.Decimal | string;
  taxOnMediaCostPct: number | Prisma.Decimal | string;
}

export interface MoneyResult {
  netRevenueUsd: number;
  netRevenueAfterTaxUsd: number;
  netRevenueLocal: number;
  mediaCostWithTaxLocal: number;
  profitLocal: number;
  roas: number;
}

export interface MoneyDecimalResult {
  netRevenueUsd: Prisma.Decimal;
  netRevenueAfterTaxUsd: Prisma.Decimal;
  netRevenueLocal: Prisma.Decimal;
  mediaCostWithTaxLocal: Prisma.Decimal;
  profitLocal: Prisma.Decimal;
  roas: Prisma.Decimal;
}
