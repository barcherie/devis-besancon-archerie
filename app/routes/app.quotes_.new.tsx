import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import QuoteEditor from "../components/QuoteEditor";
import { getShopSettings } from "../shop-settings.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { legalInfo: await getShopSettings(session.shop) };
};

export default function NewQuotePage() {
  const { legalInfo } = useLoaderData<typeof loader>();
  return <QuoteEditor legalInfo={legalInfo} />;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
