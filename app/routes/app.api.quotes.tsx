import type { ActionFunctionArgs } from "react-router";

import db from "../db.server";
import { authenticate } from "../shopify.server";

type QuoteLineInput = {
  variantId?: string;
  title: string;
  sku: string;
  quantity: number;
  priceTtc: number;
  vatRate: number;
  discountType: "PERCENTAGE" | "AMOUNT";
  discountPercent: number;
  discountAmount: number;
  imageUrl: string;
};

type QuoteInput = {
  id?: string;
  customerShopifyId?: string;
  customerName: string;
  customerCompany: string;
  customerAddress1: string;
  customerAddress2: string;
  customerZip: string;
  customerCity: string;
  customerCountry: string;
  customerEmail: string;
  customerPhone: string;
  globalDiscountPercent: number;
  globalDiscountAmount: number;
  lines: QuoteLineInput[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseNumber(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

function parseDiscountType(value: unknown): "PERCENTAGE" | "AMOUNT" {
  return value === "AMOUNT" ? "AMOUNT" : "PERCENTAGE";
}

function parseQuoteInput(value: unknown): QuoteInput | null {
  if (!isRecord(value) || !Array.isArray(value.lines)) return null;

  const customerName = optionalString(value.customerName, 200);
  if (!customerName || value.lines.length === 0 || value.lines.length > 100) {
    return null;
  }

  const lines: QuoteLineInput[] = [];

  for (const item of value.lines) {
    if (!isRecord(item)) return null;

    const title = optionalString(item.title, 500);
    const quantity = parseNumber(item.quantity, 0.01, 100000);
    const priceTtc = parseNumber(item.priceTtc, 0, 10000000);
    const vatRate = parseNumber(item.vatRate, 0, 100);
    const discountType = parseDiscountType(item.discountType);
    const discountPercent = parseNumber(item.discountPercent, 0, 100);
    const discountAmount = parseNumber(item.discountAmount, 0, 10000000);

    if (
      !title ||
      quantity === null ||
      priceTtc === null ||
      vatRate === null ||
      discountPercent === null ||
      discountAmount === null
    ) {
      return null;
    }

    lines.push({
      variantId: optionalString(item.variantId, 200) || undefined,
      title,
      sku: optionalString(item.sku, 200),
      quantity,
      priceTtc,
      vatRate,
      discountType,
      discountPercent,
      discountAmount,
      imageUrl: optionalString(item.imageUrl, 2000),
    });
  }

  return {
    id: optionalString(value.id, 100) || undefined,
    customerShopifyId:
      optionalString(value.customerShopifyId, 200) || undefined,
    customerName,
    customerCompany: optionalString(value.customerCompany, 200),
    customerAddress1: optionalString(value.customerAddress1, 300),
    customerAddress2: optionalString(value.customerAddress2, 300),
    customerZip: optionalString(value.customerZip, 50),
    customerCity: optionalString(value.customerCity, 200),
    customerCountry: optionalString(value.customerCountry, 200),
    customerEmail: optionalString(value.customerEmail, 320),
    customerPhone: optionalString(value.customerPhone, 100),
    globalDiscountPercent:
      parseNumber(value.globalDiscountPercent, 0, 100) ?? 0,
    globalDiscountAmount:
      parseNumber(value.globalDiscountAmount, 0, 10000000) ?? 0,
    lines,
  };
}

function getLineDiscount(line: QuoteLineInput) {
  const grossTtc = line.priceTtc * line.quantity;
  if (line.discountType === "AMOUNT") {
    return Math.min(grossTtc, line.discountAmount);
  }
  return grossTtc * (line.discountPercent / 100);
}

function calculateTotals(input: QuoteInput) {
  const lineAmounts = input.lines.map((line) => {
    const grossTtc = line.priceTtc * line.quantity;
    const discount = getLineDiscount(line);
    const totalTtc = Math.max(0, grossTtc - discount);
    return { line, discount, totalTtc };
  });
  const totalAfterLineDiscounts = lineAmounts.reduce(
    (sum, line) => sum + line.totalTtc,
    0,
  );
  const globalPercentDiscount =
    totalAfterLineDiscounts * (input.globalDiscountPercent / 100);
  const remainingAfterPercent = Math.max(
    0,
    totalAfterLineDiscounts - globalPercentDiscount,
  );
  const globalAmountDiscount = Math.min(
    remainingAfterPercent,
    input.globalDiscountAmount,
  );
  const globalDiscountTotal = globalPercentDiscount + globalAmountDiscount;

  return lineAmounts.reduce(
    (totals, lineAmount) => {
      const share =
        totalAfterLineDiscounts > 0
          ? lineAmount.totalTtc / totalAfterLineDiscounts
          : 0;
      const totalTtc = Math.max(
        0,
        lineAmount.totalTtc - globalDiscountTotal * share,
      );
      const subtotalHt = totalTtc / (1 + lineAmount.line.vatRate / 100);

      totals.subtotalHt += subtotalHt;
      totals.vatTotal += totalTtc - subtotalHt;
      totals.discountTotal += lineAmount.discount + globalDiscountTotal * share;
      totals.totalTtc += totalTtc;
      return totals;
    },
    { subtotalHt: 0, vatTotal: 0, discountTotal: 0, totalTtc: 0 },
  );
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  if (request.method !== "POST" && request.method !== "PUT") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST, PUT" },
    });
  }

  const input = parseQuoteInput(await request.json().catch(() => null));
  if (!input) {
    return Response.json(
      { error: "Données du devis invalides" },
      { status: 400 },
    );
  }

  const totals = calculateTotals(input);
  const quoteData = {
    customerShopifyId: input.customerShopifyId,
    customerName: input.customerName,
    customerCompany: input.customerCompany || null,
    customerAddress1: input.customerAddress1 || null,
    customerAddress2: input.customerAddress2 || null,
    customerZip: input.customerZip || null,
    customerCity: input.customerCity || null,
    customerCountry: input.customerCountry || null,
    customerEmail: input.customerEmail || null,
    customerPhone: input.customerPhone || null,
    subtotalHt: totals.subtotalHt,
    vatTotal: totals.vatTotal,
    discountTotal: totals.discountTotal,
    globalDiscountPercent: input.globalDiscountPercent,
    globalDiscountAmount: input.globalDiscountAmount,
    totalTtc: totals.totalTtc,
    lines: {
      create: input.lines.map((line, position) => ({
        position,
        shopifyVariantId: line.variantId,
        title: line.title,
        sku: line.sku || null,
        quantity: line.quantity,
        unitPriceTtc: line.priceTtc,
        vatRate: line.vatRate,
        discountType: line.discountType,
        discountPercent: line.discountPercent,
        discountAmount: line.discountAmount,
        imageUrl: line.imageUrl || null,
      })),
    },
  };

  if (request.method === "PUT") {
    if (!input.id) {
      return Response.json({ error: "Identifiant manquant" }, { status: 400 });
    }

    const existingQuote = await db.quote.findFirst({
      where: { id: input.id, shop: session.shop },
      select: { id: true },
    });

    if (!existingQuote) {
      return Response.json({ error: "Devis introuvable" }, { status: 404 });
    }

    const quote = await db.$transaction(async (transaction) => {
      await transaction.quoteLine.deleteMany({
        where: { quoteId: existingQuote.id },
      });

      return transaction.quote.update({
        where: { id: existingQuote.id },
        data: quoteData,
        select: { id: true, number: true, status: true, updatedAt: true },
      });
    });

    return Response.json({ quote });
  }

  const year = new Date().getFullYear();
  const quote = await db.$transaction(async (transaction) => {
    const counter = await transaction.quoteCounter.upsert({
      where: { shop_year: { shop: session.shop, year } },
      create: { shop: session.shop, year, value: 1 },
      update: { value: { increment: 1 } },
    });

    const number = `DEV-${year}-${String(counter.value).padStart(4, "0")}`;

    return transaction.quote.create({
      data: {
        shop: session.shop,
        number,
        ...quoteData,
      },
      select: { id: true, number: true, status: true, updatedAt: true },
    });
  });

  return Response.json({ quote }, { status: 201 });
};
