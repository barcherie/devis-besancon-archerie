import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

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
              firstName
              lastName
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
      `,
      {
        variables: {
          query: q,
        },
      },
    );

    const json = await response.json();

    const customers =
      json.data?.customers?.nodes?.map((customer: any) => {
        const address = customer.defaultAddress || {};

        return {
          id: customer.id,
          name:
            customer.displayName ||
            `${customer.firstName || ""} ${customer.lastName || ""}`.trim(),
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
  } catch (error: any) {
    console.error("CUSTOMER_SEARCH_ERROR");
    console.error(JSON.stringify(error?.body?.errors?.graphQLErrors ?? error?.body?.errors ?? error, null, 2));

    return Response.json(
      {
        customers: [],
        error: "Erreur pendant la recherche client",
      },
      { status: 500 },
    );
  }
};
//test