import type { LoaderFunctionArgs } from "react-router";

import db from "../db.server";
import { createQuotePdf } from "../quote-pdf.server";
import { getShopSettings } from "../shop-settings.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const quote = await db.quote.findFirst({
    where: { id: params.quoteId, shop: session.shop },
    include: { lines: { orderBy: { position: "asc" } } },
  });

  if (!quote) {
    return Response.json({ error: "Devis introuvable" }, { status: 404 });
  }

  const bytes = await createQuotePdf(
    {
      number: quote.number,
      customerName: quote.customerName,
      customerCompany: quote.customerCompany || "",
      customerAddress1: quote.customerAddress1 || "",
      customerAddress2: quote.customerAddress2 || "",
      customerZip: quote.customerZip || "",
      customerCity: quote.customerCity || "",
      customerCountry: quote.customerCountry || "",
      customerEmail: quote.customerEmail || "",
      customerPhone: quote.customerPhone || "",
      lines: quote.lines.map((line) => ({
        title: line.title,
        sku: line.sku || "",
        quantity: Number(line.quantity),
        priceTtc: Number(line.unitPriceTtc),
        vatRate: Number(line.vatRate),
        discountPercent: Number(line.discountPercent),
        imageUrl: line.imageUrl || "",
      })),
    },
    await getShopSettings(session.shop),
  );
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="devis-${quote.number}-besancon-archerie.pdf"`,
      "Cache-Control": "no-store",
    },
  });
};
