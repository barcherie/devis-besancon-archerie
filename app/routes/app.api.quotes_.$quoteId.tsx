import type { ActionFunctionArgs } from "react-router";

import db from "../db.server";
import { authenticate } from "../shopify.server";

type ShopifyUserError = {
  message: string;
  field?: string[] | null;
};

type DraftOrderCreateResponse = {
  data?: {
    draftOrderCreate?: {
      draftOrder?: { id: string } | null;
      userErrors: ShopifyUserError[];
    };
  };
};

type DraftOrderCompleteResponse = {
  data?: {
    draftOrderComplete?: {
      draftOrder?: {
        id: string;
        order?: { id: string; name: string } | null;
      } | null;
      userErrors: ShopifyUserError[];
    };
  };
};

type DraftOrderResponse = {
  data?: {
    draftOrder?: {
      id: string;
      order?: { id: string; name: string } | null;
    } | null;
  };
};

function firstError(errors: ShopifyUserError[] | undefined) {
  return errors?.[0]?.message;
}

async function saveConvertedOrder(
  quoteId: string,
  draftOrderId: string,
  order: { id: string; name: string },
) {
  await db.quote.update({
    where: { id: quoteId },
    data: {
      status: "ACCEPTED",
      shopifyDraftOrderId: draftOrderId,
      shopifyOrderId: order.id,
      shopifyOrderName: order.name,
      convertedAt: new Date(),
    },
  });
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const quoteId = params.quoteId;

  if (!quoteId) {
    return Response.json({ error: "Identifiant manquant" }, { status: 400 });
  }

  const quote = await db.quote.findFirst({
    where: { id: quoteId, shop: session.shop },
    include: { lines: { orderBy: { position: "asc" } } },
  });

  if (!quote) {
    return Response.json({ error: "Devis introuvable" }, { status: 404 });
  }

  if (request.method === "DELETE") {
    await db.quote.delete({ where: { id: quote.id } });
    return Response.json({ deleted: true });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST, DELETE" },
    });
  }

  const body = (await request.json().catch(() => null)) as {
    intent?: unknown;
  } | null;

  if (body?.intent !== "convert") {
    return Response.json({ error: "Action invalide" }, { status: 400 });
  }

  if (quote.shopifyOrderId) {
    return Response.json(
      {
        order: {
          id: quote.shopifyOrderId,
          name: quote.shopifyOrderName,
        },
      },
      { status: 409 },
    );
  }

  try {
    let draftOrderId = quote.shopifyDraftOrderId;

    // Une tentative précédente peut avoir créé la commande sans avoir pu
    // enregistrer son numéro, faute du scope read_orders.
    if (draftOrderId) {
      const existingResponse = await admin.graphql(
        `#graphql
          query getConvertedQuoteOrder($id: ID!) {
            draftOrder(id: $id) {
              id
              order {
                id
                name
              }
            }
          }
        `,
        { variables: { id: draftOrderId } },
      );
      const existingJson =
        (await existingResponse.json()) as DraftOrderResponse;
      const existingOrder = existingJson.data?.draftOrder?.order;

      if (existingOrder) {
        await saveConvertedOrder(quote.id, draftOrderId, existingOrder);
        return Response.json({ order: existingOrder });
      }
    }

    if (!draftOrderId) {
      const lineItems = quote.lines.map((line) => {
        const discountPercent = Number(line.discountPercent);
        const appliedDiscount =
          discountPercent > 0
            ? {
                title: `Remise ${quote.number}`,
                description: "Remise issue du devis",
                value: discountPercent,
                valueType: "PERCENTAGE",
              }
            : undefined;

        const price = {
          amount: line.unitPriceTtc.toFixed(2),
          currencyCode: "EUR",
        };

        return line.shopifyVariantId
          ? {
              variantId: line.shopifyVariantId,
              quantity: Math.max(1, Math.round(Number(line.quantity))),
              priceOverride: price,
              appliedDiscount,
            }
          : {
              title: line.title,
              sku: line.sku || undefined,
              quantity: Math.max(1, Math.round(Number(line.quantity))),
              originalUnitPriceWithCurrency: price,
              taxable: Number(line.vatRate) > 0,
              appliedDiscount,
            };
      });

      const nameParts = quote.customerName.trim().split(/\s+/);
      const address = {
        firstName: nameParts[0] || undefined,
        lastName: nameParts.slice(1).join(" ") || undefined,
        company: quote.customerCompany || undefined,
        address1: quote.customerAddress1 || undefined,
        address2: quote.customerAddress2 || undefined,
        city: quote.customerCity || undefined,
        zip: quote.customerZip || undefined,
        country: quote.customerCountry || undefined,
      };
      const hasAddress = Boolean(
        quote.customerAddress1 ||
          quote.customerCity ||
          quote.customerZip ||
          quote.customerCountry,
      );

      const createResponse = await admin.graphql(
        `#graphql
          mutation createQuoteDraftOrder($input: DraftOrderInput!) {
            draftOrderCreate(input: $input) {
              draftOrder {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        {
          variables: {
            input: {
              purchasingEntity: quote.customerShopifyId
                ? { customerId: quote.customerShopifyId }
                : undefined,
              email: quote.customerEmail || undefined,
              phone: quote.customerPhone || undefined,
              useCustomerDefaultAddress: Boolean(quote.customerShopifyId),
              shippingAddress:
                !quote.customerShopifyId && hasAddress ? address : undefined,
              billingAddress:
                !quote.customerShopifyId && hasAddress ? address : undefined,
              note: `Commande créée depuis le devis ${quote.number}`,
              tags: ["devis", quote.number],
              visibleToCustomer: true,
              lineItems,
            },
          },
        },
      );

      const createJson =
        (await createResponse.json()) as DraftOrderCreateResponse;
      const createResult = createJson.data?.draftOrderCreate;
      const createError = firstError(createResult?.userErrors);

      if (createError || !createResult?.draftOrder?.id) {
        throw new Error(createError || "Création du brouillon Shopify impossible");
      }

      draftOrderId = createResult.draftOrder.id;
      await db.quote.update({
        where: { id: quote.id },
        data: { shopifyDraftOrderId: draftOrderId },
      });
    }

    const completeResponse = await admin.graphql(
      `#graphql
        mutation completeQuoteDraftOrder($id: ID!) {
          draftOrderComplete(id: $id, paymentPending: true) {
            draftOrder {
              id
              order {
                id
                name
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      { variables: { id: draftOrderId } },
    );

    const completeJson =
      (await completeResponse.json()) as DraftOrderCompleteResponse;
    const completeResult = completeJson.data?.draftOrderComplete;
    const completeError = firstError(completeResult?.userErrors);
    const order = completeResult?.draftOrder?.order;

    if (completeError || !order) {
      throw new Error(
        completeError || "Conversion en commande Shopify impossible",
      );
    }

    await saveConvertedOrder(quote.id, draftOrderId, order);

    return Response.json({ order });
  } catch (error) {
    console.error(
      "QUOTE_CONVERSION_ERROR",
      error instanceof Error ? error.message : String(error),
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Conversion en commande impossible",
      },
      { status: 502 },
    );
  }
};
