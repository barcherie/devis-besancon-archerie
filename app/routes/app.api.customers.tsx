import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";

  if (!q.trim()) {
    return Response.json({ customers: [] });
  }

  const response = await admin.graphql(
    `#graphql
      query searchCustomers($query: String!) {
        customers(first: 10, query: $query) {
          edges {
            node {
              id
              displayName
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

  const json = await response.json();

  if (json.errors) {
    console.error("CUSTOMER_SEARCH_GRAPHQL_ERROR", JSON.stringify(json.errors));
    return Response.json({ customers: [], error: json.errors }, { status: 500 });
  }

  const customers =
    json.data?.customers?.edges?.map((edge: any) => ({
      id: edge.node.id,
      name: edge.node.displayName || "",
      email: "",
      phone: "",
      company: "",
      address1: "",
      address2: "",
      zip: "",
      city: "",
      country: "",
    })) || [];

  return Response.json({ customers });
};