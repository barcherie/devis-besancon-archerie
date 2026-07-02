import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
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

type ActionData = {
  saved?: boolean;
  error?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { settings: await getShopSettings(session.shop) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const body = (await request.json().catch(() => null)) as Partial<
    Record<keyof LegalInfo, unknown>
  > | null;

  if (!body) {
    return Response.json({ error: "Données invalides" }, { status: 400 });
  }

  const settings = Object.fromEntries(
    settingKeys.map((key) => [
      key,
      typeof body[key] === "string"
        ? body[key]
            .trim()
            .slice(
              0,
              key === "logoDataUrl"
                ? 1_500_000
                : key === "additionalLegal" || key === "bankTransferInfo"
                  ? 1000
                  : 200,
            )
        : "",
    ]),
  ) as LegalInfo;

  if (!settings.companyName) {
    return Response.json(
      { error: "La raison sociale est obligatoire" },
      { status: 400 },
    );
  }

  if (
    !/^#[0-9a-f]{6}$/i.test(settings.primaryColor) ||
    !/^#[0-9a-f]{6}$/i.test(settings.accentColor)
  ) {
    return Response.json(
      { error: "Les couleurs doivent être au format #RRGGBB" },
      { status: 400 },
    );
  }

  if (
    settings.logoDataUrl &&
    !/^data:image\/(png|jpeg);base64,/i.test(settings.logoDataUrl)
  ) {
    return Response.json(
      { error: "Le logo doit être une image PNG ou JPG" },
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
  const fetcher = useFetcher<typeof action>();
  const [settings, setSettings] = useState<LegalInfo>(initialSettings);
  const wasSubmitting = useRef(false);
  const isSaving = fetcher.state !== "idle";

  const update = (key: keyof LegalInfo, value: string) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  useEffect(() => {
    if (fetcher.state !== "idle") {
      wasSubmitting.current = true;
      return;
    }

    if (!wasSubmitting.current) return;
    wasSubmitting.current = false;

    const result = fetcher.data as ActionData | undefined;
    if (result?.saved) {
      shopify.toast.show("Informations enregistrées");
    } else {
      const message = result?.error || "Enregistrement impossible";
      shopify.toast.show(message, { isError: true });
    }
  }, [fetcher.data, fetcher.state, shopify]);

  const save = () => {
    void fetcher.submit(settings, {
      method: "POST",
      encType: "application/json",
      action: "/app/settings",
    });
  };

  const selectLogo = (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      shopify.toast.show("Choisis une image PNG ou JPG", { isError: true });
      return;
    }
    if (file.size > 1_000_000) {
      shopify.toast.show("Le logo ne doit pas dépasser 1 Mo", {
        isError: true,
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => update("logoDataUrl", String(reader.result || ""));
    reader.onerror = () =>
      shopify.toast.show("Impossible de lire cette image", { isError: true });
    reader.readAsDataURL(file);
  };

  return (
    <s-page heading="Paramètres">
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={isSaving}
        onClick={save}
      >
        {isSaving ? "Enregistrement…" : "Enregistrer"}
      </s-button>

      <s-section heading="Identité visuelle du PDF">
        <s-stack gap="base">
          {settings.logoDataUrl && (
            <img
              src={settings.logoDataUrl}
              alt="Aperçu du logo"
              style={{
                width: 160,
                height: 90,
                objectFit: "contain",
                objectPosition: "left center",
              }}
            />
          )}
          <label>
            Logo PNG ou JPG (1 Mo maximum)
            <br />
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(event) => selectLogo(event.currentTarget.files?.[0])}
            />
          </label>
          {settings.logoDataUrl && (
            <s-button
              tone="critical"
              variant="tertiary"
              onClick={() => update("logoDataUrl", "")}
            >
              Supprimer le logo
            </s-button>
          )}
          <s-stack direction="inline" gap="base">
            <label>
              Couleur principale
              <br />
              <input
                type="color"
                value={settings.primaryColor}
                onChange={(event) =>
                  update("primaryColor", event.currentTarget.value)
                }
              />
            </label>
            <s-text-field
              label="Code couleur principale"
              value={settings.primaryColor}
              onInput={(event) =>
                update("primaryColor", event.currentTarget.value)
              }
            />
            <label>
              Couleur d’accent
              <br />
              <input
                type="color"
                value={settings.accentColor}
                onChange={(event) =>
                  update("accentColor", event.currentTarget.value)
                }
              />
            </label>
            <s-text-field
              label="Code couleur d’accent"
              value={settings.accentColor}
              onInput={(event) =>
                update("accentColor", event.currentTarget.value)
              }
            />
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Entreprise">
        <s-stack gap="base">
          <s-text-field
            label="Raison sociale"
            value={settings.companyName}
            onInput={(event) =>
              update("companyName", event.currentTarget.value)
            }
          />
          <s-stack direction="inline" gap="base">
            <s-text-field
              label="Forme juridique"
              value={settings.legalForm}
              onInput={(event) =>
                update("legalForm", event.currentTarget.value)
              }
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
              onInput={(event) =>
                update("vatNumber", event.currentTarget.value)
              }
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
        <s-stack gap="base">
          <s-text-area
            label="Informations en cas de virement"
            value={settings.bankTransferInfo}
            rows={4}
            onInput={(event) =>
              update("bankTransferInfo", event.currentTarget.value)
            }
          />
          <s-text-area
            label="Texte affiché en bas du devis"
            value={settings.additionalLegal}
            rows={4}
            onInput={(event) =>
              update("additionalLegal", event.currentTarget.value)
            }
          />
        </s-stack>
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
