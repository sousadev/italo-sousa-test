import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma-client";
import { MoneyService } from "./money.service";

describe("MoneyService", () => {
  const service = new MoneyService();

  it("aplica a ordem correta de operações financeiras", () => {
    const result = service.calculate({
      grossRevenueUsd: 100,
      revSharePct: 0.3,
      taxOnRevenuePct: 0.1,
      fxRate: 5,
      mediaCostLocal: 200,
      taxOnMediaCostPct: 0.02,
    });

    expect(result.netRevenueUsd).toBe(70);
    expect(result.netRevenueAfterTaxUsd).toBe(63);
    expect(result.netRevenueLocal).toBe(315);
    expect(result.mediaCostWithTaxLocal).toBe(204);
    expect(result.profitLocal).toBe(111);
    expect(result.roas).toBeCloseTo(1.5441176470588236, 10);
  });

  it("calcula com precisão decimal usando instâncias de Prisma.Decimal", () => {
    const result = service.calculateDecimal({
      grossRevenueUsd: new Prisma.Decimal("100.00"),
      revSharePct: new Prisma.Decimal("0.3000"),
      taxOnRevenuePct: new Prisma.Decimal("0.0500"),
      fxRate: new Prisma.Decimal("5.250000"),
      mediaCostLocal: new Prisma.Decimal("226.80"),
      taxOnMediaCostPct: new Prisma.Decimal("0.0200"),
    });

    expect(result.netRevenueUsd.toString()).toBe("70");
    expect(result.netRevenueAfterTaxUsd.toString()).toBe("66.5");
    expect(result.netRevenueLocal.toString()).toBe("349.125");
    expect(result.mediaCostWithTaxLocal.toString()).toBe("231.336");
    expect(result.profitLocal.toString()).toBe("117.789");
  });

  it("trata divisão por zero no cálculo do ROAS quando o custo de mídia é zero", () => {
    const result = service.calculate({
      grossRevenueUsd: 100,
      revSharePct: 0.3,
      taxOnRevenuePct: 0.1,
      fxRate: 1,
      mediaCostLocal: 0,
      taxOnMediaCostPct: 0,
    });

    expect(result.mediaCostWithTaxLocal).toBe(0);
    expect(result.roas).toBe(0);
    expect(result.profitLocal).toBe(63);
  });
});
