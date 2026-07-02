import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

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

  return (
    <s-page heading="Mes devis">
      <s-button slot="primary-action" variant="primary" href="/app">
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
