import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

type CustomerNode = {
  id: string;
  displayName: string;
  defaultEmailAddress?: {
    emailAddress: string;
  } | null;
  defaultPhoneNumber?: {
    phoneNumber: string;
  } | null;
  defaultAddress?: {
    company?: string | null;
    address1?: string | null;
    address2?: string | null;
    zip?: string | null;
    city?: string | null;
    country?: string | null;
  } | null;
};

type CustomerSearchResponse = {
  data?: {
    customers?: {
      nodes?: CustomerNode[];
    };
  };
  errors?: unknown;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (!q) {
    return Response.json({ customers: [] });
  }

  try {
    const response = await admin.graphql(
      `#graphql
        query searchCustomers($query: String!) {
          customers(first: 10, query: $query) {
            nodes {
              id
              displayName
              defaultEmailAddress {
                emailAddress
              }
              defaultPhoneNumber {
                phoneNumber
              }
              defaultAddress {
                company
                address1
                address2
                zip
                city
                country
              }
            }
          }
        }
      `,
      {
        variables: {
          query: `${q}*`,
        },
      },
    );

    const json = (await response.json()) as CustomerSearchResponse;

    if (json.errors) {
      console.error(
        "CUSTOMER_SEARCH_GRAPHQL_ERROR",
        JSON.stringify(json.errors),
      );
      return Response.json(
        { customers: [], error: "La recherche Shopify a échoué" },
        { status: 502 },
      );
    }

    const customers =
      json.data?.customers?.nodes?.map((customer) => {
        const address = customer.defaultAddress;

        return {
          id: customer.id,
          name: customer.displayName,
          email: customer.defaultEmailAddress?.emailAddress || "",
          phone: customer.defaultPhoneNumber?.phoneNumber || "",
          company: address?.company || "",
          address1: address?.address1 || "",
          address2: address?.address2 || "",
          zip: address?.zip || "",
          city: address?.city || "",
          country: address?.country || "",
        };
      }) || [];

    return Response.json({ customers });
  } catch (error: unknown) {
    console.error(
      "CUSTOMER_SEARCH_ERROR",
      error instanceof Error ? error.message : String(error),
    );

    return Response.json(
      { customers: [], error: "La recherche Shopify a échoué" },
      { status: 502 },
    );
  }
};
