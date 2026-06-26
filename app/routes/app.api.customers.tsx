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
              email
              phone
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
      }
    `,
    {
      variables: {
        query: `${q}*`,
      },
    },
  );

  const json = await response.json();

  const customers =
    json.data?.customers?.edges?.map((edge: any) => {
      const customer = edge.node;
      const address = customer.defaultAddress || {};

      return {
        id: customer.id,
        name: customer.displayName || "",
        email: customer.email || "",
        phone: customer.phone || "",
        company: address.company || "",
        address1: address.address1 || "",
        address2: address.address2 || "",
        zip: address.zip || "",
        city: address.city || "",
        country: address.country || "",
      };
    }) || [];

  return Response.json({ customers });
};