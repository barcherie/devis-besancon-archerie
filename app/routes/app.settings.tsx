import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import db from "../db.server";
import {
  defaultShopSettings,
  getShopSettings,
  type LegalInfo,
} from "../shop-settings.server";
import { authenticate } from "../shopify.server";

const settingKeys = Object.keys(defaultShopSettings) as (keyof LegalInfo)[];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { settings: await getShopSettings(session.shop) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const body = (await request.json().catch(() => null)) as
    | Partial<Record<keyof LegalInfo, unknown>>
    | null;

  if (!body) {
    return Response.json({ error: "Données invalides" }, { status: 400 });
  }

  const settings = Object.fromEntries(
    settingKeys.map((key) => [
      key,
      typeof body[key] === "string"
        ? body[key].trim().slice(0, key === "additionalLegal" ? 1000 : 200)
        : "",
    ]),
  ) as LegalInfo;

  if (!settings.companyName) {
    return Response.json(
      { error: "La raison sociale est obligatoire" },
      { status: 400 },
    );
  }

  const saved = await db.shopSettings.upsert({
    where: { shop: session.shop },
    create: { shop: session.shop, ...settings },
    update: settings,
  });

  return Response.json({ saved: true, settings: saved });
};

export default function SettingsPage() {
  const { settings: initialSettings } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const [settings, setSettings] = useState<LegalInfo>(initialSettings);
  const [isSaving, setIsSaving] = useState(false);

  const update = (key: keyof LegalInfo, value: string) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/app/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const result = (await response.json()) as {
        saved?: boolean;
        error?: string;
      };
      if (!response.ok || !result.saved) {
        throw new Error(result.error || "Enregistrement impossible");
      }
      shopify.toast.show("Informations enregistrées");
    } catch (error) {
      shopify.toast.show(
        error instanceof Error ? error.message : "Enregistrement impossible",
        { isError: true },
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <s-page heading="Mes informations">
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={isSaving}
        onClick={save}
      >
        {isSaving ? "Enregistrement…" : "Enregistrer"}
      </s-button>

      <s-section heading="Entreprise">
        <s-stack gap="base">
          <s-text-field
            label="Raison sociale"
            value={settings.companyName}
            onInput={(event) => update("companyName", event.currentTarget.value)}
          />
          <s-stack direction="inline" gap="base">
            <s-text-field
              label="Forme juridique"
              value={settings.legalForm}
              onInput={(event) => update("legalForm", event.currentTarget.value)}
            />
            <s-text-field
              label="Capital social"
              value={settings.shareCapital}
              onInput={(event) =>
                update("shareCapital", event.currentTarget.value)
              }
            />
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-text-field
              label="SIREN"
              value={settings.siren}
              onInput={(event) => update("siren", event.currentTarget.value)}
            />
            <s-text-field
              label="SIRET"
              value={settings.siret}
              onInput={(event) => update("siret", event.currentTarget.value)}
            />
            <s-text-field
              label="N° de TVA"
              value={settings.vatNumber}
              onInput={(event) => update("vatNumber", event.currentTarget.value)}
            />
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Coordonnées">
        <s-stack gap="base">
          <s-text-field
            label="Adresse"
            value={settings.address1}
            onInput={(event) => update("address1", event.currentTarget.value)}
          />
          <s-text-field
            label="Complément d’adresse"
            value={settings.address2}
            onInput={(event) => update("address2", event.currentTarget.value)}
          />
          <s-stack direction="inline" gap="base">
            <s-text-field
              label="Code postal"
              value={settings.postalCode}
              onInput={(event) =>
                update("postalCode", event.currentTarget.value)
              }
            />
            <s-text-field
              label="Ville"
              value={settings.city}
              onInput={(event) => update("city", event.currentTarget.value)}
            />
            <s-text-field
              label="Pays"
              value={settings.country}
              onInput={(event) => update("country", event.currentTarget.value)}
            />
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-text-field
              label="Email"
              value={settings.email}
              onInput={(event) => update("email", event.currentTarget.value)}
            />
            <s-text-field
              label="Téléphone"
              value={settings.phone}
              onInput={(event) => update("phone", event.currentTarget.value)}
            />
            <s-text-field
              label="Site internet"
              value={settings.website}
              onInput={(event) => update("website", event.currentTarget.value)}
            />
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Mentions complémentaires">
        <s-text-area
          label="Texte affiché en bas du devis"
          value={settings.additionalLegal}
          rows={4}
          onInput={(event) =>
            update("additionalLegal", event.currentTarget.value)
          }
        />
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
