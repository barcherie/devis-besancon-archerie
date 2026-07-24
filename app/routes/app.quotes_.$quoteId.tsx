import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import QuoteEditor from "../components/QuoteEditor";
import db from "../db.server";
import { getShopSettings } from "../shop-settings.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const quote = await db.quote.findFirst({
    where: {
      id: params.quoteId,
      shop: session.shop,
    },
    include: {
      lines: { orderBy: { position: "asc" } },
    },
  });

  if (!quote) {
    throw new Response("Devis introuvable", { status: 404 });
  }

  return {
    legalInfo: await getShopSettings(session.shop),
    autoGeneratePdf:
      new URL(request.url).searchParams.get("download") === "pdf",
    initialQuote: {
      id: quote.id,
      number: quote.number,
      status: quote.status,
      customerShopifyId: quote.customerShopifyId || undefined,
      customerName: quote.customerName,
      customerCompany: quote.customerCompany || "",
      customerAddress1: quote.customerAddress1 || "",
      customerAddress2: quote.customerAddress2 || "",
      customerZip: quote.customerZip || "",
      customerCity: quote.customerCity || "",
      customerCountry: quote.customerCountry || "",
      customerEmail: quote.customerEmail || "",
      customerPhone: quote.customerPhone || "",
      globalDiscountPercent: Number(quote.globalDiscountPercent),
      globalDiscountAmount: Number(quote.globalDiscountAmount),
      lines: quote.lines.map((line) => ({
        id: line.id,
        variantId: line.shopifyVariantId || undefined,
        title: line.title,
        sku: line.sku || "",
        quantity: Number(line.quantity),
        priceTtc: Number(line.unitPriceTtc),
        vatRate: Number(line.vatRate),
        discountType:
          line.discountType === "AMOUNT"
            ? ("AMOUNT" as const)
            : ("PERCENTAGE" as const),
        discountPercent: Number(line.discountPercent),
        discountAmount: Number(line.discountAmount),
        imageUrl: line.imageUrl || "",
      })),
    },
  };
};

export default function EditQuotePage() {
  const { initialQuote, legalInfo, autoGeneratePdf } =
    useLoaderData<typeof loader>();
  return (
    <QuoteEditor
      initialQuote={initialQuote}
      legalInfo={legalInfo}
      autoGeneratePdf={autoGeneratePdf}
    />
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
