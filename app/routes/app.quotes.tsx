import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import db from "../db.server";
import { authenticate } from "../shopify.server";

const statusLabels = {
  DRAFT: "Brouillon",
  SENT: "Envoyé",
  ACCEPTED: "Accepté",
  REFUSED: "Refusé",
} as const;

function formatMoney(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const quotes = await db.quote.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      number: true,
      status: true,
      customerName: true,
      customerCompany: true,
      totalTtc: true,
      shopifyOrderId: true,
      shopifyOrderName: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { lines: true } },
    },
  });

  return {
    quotes: quotes.map(({ _count, ...quote }) => ({
      ...quote,
      totalTtc: Number(quote.totalTtc),
      createdAt: quote.createdAt.toISOString(),
      updatedAt: quote.updatedAt.toISOString(),
      lineCount: _count.lines,
    })),
  };
};

export default function QuotesPage() {
  const { quotes } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const [processingId, setProcessingId] = useState<string | null>(null);

  const deleteQuote = async (id: string, number: string) => {
    if (!window.confirm(`Supprimer définitivement le devis ${number} ?`)) {
      return;
    }

    setProcessingId(id);
    try {
      const response = await fetch(`/app/api/quotes/${id}`, {
        method: "DELETE",
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error || "Suppression impossible");

      shopify.toast.show(`Devis ${number} supprimé`);
      await revalidator.revalidate();
    } catch (error) {
      shopify.toast.show(
        error instanceof Error ? error.message : "Suppression impossible",
        { isError: true },
      );
    } finally {
      setProcessingId(null);
    }
  };

  const convertQuote = async (id: string, number: string) => {
    if (
      !window.confirm(
        `Valider ${number} et créer une commande Shopify avec paiement en attente ?`,
      )
    ) {
      return;
    }

    setProcessingId(id);
    try {
      const response = await fetch(`/app/api/quotes/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "convert" }),
      });
      const json = (await response.json()) as {
        error?: string;
        order?: { id: string; name?: string | null };
      };
      if (!response.ok || !json.order) {
        throw new Error(json.error || "Conversion impossible");
      }

      shopify.toast.show(
        `Commande ${json.order.name || "Shopify"} créée avec paiement en attente`,
      );
      await revalidator.revalidate();
    } catch (error) {
      shopify.toast.show(
        error instanceof Error ? error.message : "Conversion impossible",
        { isError: true },
      );
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <s-page heading="Mes devis">
      <s-button
        slot="primary-action"
        variant="primary"
        href="/app/quotes/new"
      >
        Nouveau devis
      </s-button>

      {quotes.length === 0 ? (
        <s-section heading="Aucun devis enregistré">
          <s-paragraph>
            Crée ton premier devis : il apparaîtra automatiquement ici.
          </s-paragraph>
        </s-section>
      ) : (
        <s-stack gap="base">
          {quotes.map((quote) => (
            <s-section
              key={quote.id}
              heading={`${quote.number} — ${quote.customerName}`}
            >
              <s-stack gap="small">
                <s-badge>{statusLabels[quote.status]}</s-badge>
                {quote.customerCompany && (
                  <s-paragraph>{quote.customerCompany}</s-paragraph>
                )}
                <s-paragraph>
                  Créé le{" "}
                  {new Date(quote.createdAt).toLocaleDateString("fr-FR")} ·{" "}
                  {quote.lineCount} ligne{quote.lineCount > 1 ? "s" : ""}
                </s-paragraph>
                <s-heading>{formatMoney(quote.totalTtc)} TTC</s-heading>

                {quote.shopifyOrderId && (
                  <s-paragraph>
                    Commande Shopify :{" "}
                    {quote.shopifyOrderName || quote.shopifyOrderId}
                  </s-paragraph>
                )}

                <s-stack direction="inline" gap="small">
                  <s-button
                    href={`/app/quotes/${quote.id}`}
                    disabled={processingId === quote.id}
                  >
                    Modifier
                  </s-button>
                  {quote.shopifyOrderId ? (
                    <s-button
                      variant="primary"
                      href={`shopify://admin/orders/${quote.shopifyOrderId.split("/").pop()}`}
                    >
                      Voir la commande
                    </s-button>
                  ) : (
                    <s-button
                      variant="primary"
                      disabled={processingId === quote.id}
                      onClick={() =>
                        void convertQuote(quote.id, quote.number)
                      }
                    >
                      Valider et créer la commande
                    </s-button>
                  )}
                  <s-button
                    tone="critical"
                    disabled={processingId === quote.id}
                    onClick={() => void deleteQuote(quote.id, quote.number)}
                  >
                    Supprimer
                  </s-button>
                </s-stack>
              </s-stack>
            </s-section>
          ))}
        </s-stack>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
