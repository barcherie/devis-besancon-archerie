import type { LoaderFunctionArgs } from "react-router";

import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  try {
    await db.$queryRaw`SELECT 1`;
    return new Response("OK devis-pdf-v1.14", {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("Service Unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
};
