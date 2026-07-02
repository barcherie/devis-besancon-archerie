import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { PDFDocument, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { useAppBridge } from "@shopify/app-bridge-react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

const APP_VERSION = "V1.9";

type QuoteLine = {
  id: string;
  title: string;
  sku: string;
  quantity: number;
  priceTtc: number;
  vatRate: number;
  discountPercent: number;
  imageUrl: string;
};

type SavedQuote = {
  id: string;
  number: string;
};

type CustomerResult = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  address1: string;
  address2: string;
  zip: string;
  city: string;
  country: string;
};

type PickerImage = {
  url?: string;
  originalSrc?: string;
};

type PickerVariant = {
  id: string;
  title?: string;
  sku?: string;
  price?: string | number;
};

type PickerProduct = {
  id: string;
  title?: string;
  featuredImage?: PickerImage;
  images?: PickerImage[];
  variants?: PickerVariant[];
};

function formatMoney(value: number) {
  return `${value.toFixed(2).replace(".", ",")} €`;
}

function getLineAmounts(line: QuoteLine) {
  const grossTtc = line.priceTtc * line.quantity;
  const discount = grossTtc * (line.discountPercent / 100);
  const ttc = grossTtc - discount;
  const ht = ttc / (1 + line.vatRate / 100);
  const vat = ttc - ht;
  return { grossTtc, discount, ht, vat, ttc };
}

function getProductImage(product: PickerProduct) {
  return (
    product.featuredImage?.url ||
    product.featuredImage?.originalSrc ||
    product.images?.[0]?.url ||
    product.images?.[0]?.originalSrc ||
    ""
  );
}

async function drawProductImage(
  pdfDoc: PDFDocument,
  page: PDFPage,
  imageUrl: string,
  x: number,
  y: number,
) {
  if (!imageUrl) return;

  try {
    const response = await fetch(imageUrl);
    const imageBytes = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "";

    const image = contentType.includes("png")
      ? await pdfDoc.embedPng(imageBytes)
      : await pdfDoc.embedJpg(imageBytes);

    page.drawImage(image, { x, y, width: 32, height: 32 });
  } catch (error) {
    console.warn("Image non intégrée au PDF :", error);
  }
}

export default function Index() {
  const shopify = useAppBridge();

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerResult[]>([]);
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerResult | null>(null);

  const [clientName, setClientName] = useState("");
  const [company, setCompany] = useState("");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [zip, setZip] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [savedQuote, setSavedQuote] = useState<SavedQuote | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const searchCustomers = async (value: string) => {
    setCustomerQuery(value);

    if (value.trim().length < 2) {
      setCustomerResults([]);
      return;
    }

    const response = await fetch(
      `/app/api/customers?q=${encodeURIComponent(value)}`,
    );
    const json = await response.json();

    setCustomerResults(json.customers || []);
  };

  const selectCustomer = (customer: CustomerResult) => {
    setSelectedCustomer(customer);
    setCustomerQuery(customer.name);
    setClientName(customer.name);
    setCompany(customer.company || "");
    setAddress1(customer.address1 || "");
    setAddress2(customer.address2 || "");
    setZip(customer.zip || "");
    setCity(customer.city || "");
    setCountry(customer.country || "");
    setEmail(customer.email || "");
    setPhone(customer.phone || "");
    setCustomerResults([]);
  };

  const addProducts = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: true,
      filter: {
        variants: true,
        archived: false,
        draft: false,
      },
    });

    if (!selected) return;

    const newLines: QuoteLine[] = [];

    const products = selected as PickerProduct[];

    products.forEach((product) => {
      const variants = product.variants || [];
      const imageUrl = getProductImage(product);
      const productTitle = product.title || "Produit sélectionné";

      if (variants.length === 0) {
        newLines.push({
          id: `${product.id}-${crypto.randomUUID()}`,
          title: productTitle,
          sku: "",
          quantity: 1,
          priceTtc: 0,
          vatRate: 20,
          discountPercent: 0,
          imageUrl,
        });
        return;
      }

      variants.forEach((variant) => {
        newLines.push({
          id: `${variant.id}-${crypto.randomUUID()}`,
          title:
            variant.title && variant.title !== "Default Title"
              ? `${productTitle} - ${variant.title}`
              : productTitle,
          sku: variant.sku || "",
          quantity: 1,
          priceTtc: Number(variant.price || 0),
          vatRate: 20,
          discountPercent: 0,
          imageUrl,
        });
      });
    });

    setLines((current) => [...current, ...newLines]);
  };

  const updateLineNumber = (
    id: string,
    field: "quantity" | "priceTtc" | "vatRate" | "discountPercent",
    value: number,
  ) => {
    if (!Number.isFinite(value)) return;

    let normalizedValue = Math.max(0, value);
    if (field === "quantity") normalizedValue = Math.max(1, value);
    if (field === "vatRate" || field === "discountPercent") {
      normalizedValue = Math.min(100, normalizedValue);
    }

    setLines((current) =>
      current.map((line) =>
        line.id === id ? { ...line, [field]: normalizedValue } : line,
      ),
    );
  };

  const removeLine = (id: string) => {
    setLines((current) => current.filter((line) => line.id !== id));
  };

  const totals = lines.reduce(
    (acc, line) => {
      const amounts = getLineAmounts(line);

      acc.ht += amounts.ht;
      acc.vat += amounts.vat;
      acc.ttc += amounts.ttc;
      acc.discount += amounts.discount;

      return acc;
    },
    { ht: 0, vat: 0, ttc: 0, discount: 0 },
  );

  const saveQuote = async (showSuccessToast = true) => {
    if (!clientName.trim()) {
      shopify.toast.show("Sélectionne ou renseigne un client", {
        isError: true,
      });
      return null;
    }

    if (lines.length === 0) {
      shopify.toast.show("Ajoute au moins un produit au devis", {
        isError: true,
      });
      return null;
    }

    setIsSaving(true);

    try {
      const response = await fetch("/app/api/quotes", {
        method: savedQuote ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: savedQuote?.id,
          customerShopifyId: selectedCustomer?.id,
          customerName: clientName,
          customerCompany: company,
          customerAddress1: address1,
          customerAddress2: address2,
          customerZip: zip,
          customerCity: city,
          customerCountry: country,
          customerEmail: email,
          customerPhone: phone,
          lines,
        }),
      });

      const json = (await response.json()) as {
        quote?: SavedQuote;
        error?: string;
      };

      if (!response.ok || !json.quote) {
        throw new Error(json.error || "Enregistrement impossible");
      }

      setSavedQuote(json.quote);
      if (showSuccessToast) {
        shopify.toast.show(`Devis ${json.quote.number} enregistré`);
      }
      return json.quote;
    } catch (error) {
      console.error("QUOTE_SAVE_ERROR", error);
      shopify.toast.show("Impossible d’enregistrer le devis", {
        isError: true,
      });
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const generatePdf = async () => {
    const quote = await saveQuote(false);
    if (!quote) return;

    const quoteNumber = quote.number;

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const drawTableHeader = (targetPage: PDFPage, startY: number) => {
      targetPage.drawText("Image", { x: 40, y: startY, size: 8, font: bold });
      targetPage.drawText("Désignation", {
        x: 82,
        y: startY,
        size: 8,
        font: bold,
      });
      targetPage.drawText("Qté", { x: 282, y: startY, size: 8, font: bold });
      targetPage.drawText("PU TTC", { x: 310, y: startY, size: 8, font: bold });
      targetPage.drawText("Rem.", { x: 372, y: startY, size: 8, font: bold });
      targetPage.drawText("TVA", { x: 414, y: startY, size: 8, font: bold });
      targetPage.drawText("Total TTC", {
        x: 462,
        y: startY,
        size: 8,
        font: bold,
      });

      targetPage.drawLine({
        start: { x: 40, y: startY - 8 },
        end: { x: 555, y: startY - 8 },
        thickness: 1,
        color: rgb(0, 0, 0),
      });

      return startY - 38;
    };

    const addContinuationPage = () => {
      const targetPage = pdfDoc.addPage([595, 842]);
      targetPage.drawText("BESANÇON ARCHERIE", {
        x: 40,
        y: 790,
        size: 16,
        font: bold,
      });
      targetPage.drawText(`DEVIS ${quoteNumber} — suite`, {
        x: 40,
        y: 765,
        size: 11,
        font: bold,
      });
      return { targetPage, startY: drawTableHeader(targetPage, 730) };
    };

    let page = pdfDoc.addPage([595, 842]);
    let y = 790;

    page.drawText("BESANÇON ARCHERIE", { x: 50, y, size: 22, font: bold });
    y -= 30;

    page.drawText(`DEVIS ${quoteNumber}`, { x: 50, y, size: 18, font: bold });
    page.drawText(`Date : ${new Date().toLocaleDateString("fr-FR")}`, {
      x: 400,
      y,
      size: 10,
      font,
    });

    y -= 50;

    page.drawText("Client", { x: 50, y, size: 13, font: bold });
    y -= 22;

    const customerPdfLines = [
      clientName,
      company,
      address1,
      address2,
      `${zip} ${city}`.trim(),
      country,
      email ? `Email : ${email}` : "",
      phone ? `Téléphone : ${phone}` : "",
    ].filter(Boolean);

    if (customerPdfLines.length === 0) {
      page.drawText("-", { x: 50, y, size: 11, font });
      y -= 16;
    } else {
      for (const customerLine of customerPdfLines) {
        page.drawText(customerLine.slice(0, 70), { x: 50, y, size: 10, font });
        y -= 14;
      }
    }

    y -= 28;
    y = drawTableHeader(page, y);

    for (const line of lines) {
      if (y < 175) {
        const continuation = addContinuationPage();
        page = continuation.targetPage;
        y = continuation.startY;
      }

      const amounts = getLineAmounts(line);

      await drawProductImage(pdfDoc, page, line.imageUrl, 40, y - 8);

      page.drawText(line.title.slice(0, 32), { x: 82, y, size: 8, font });

      if (line.sku) {
        page.drawText(`SKU : ${line.sku}`.slice(0, 32), {
          x: 82,
          y: y - 12,
          size: 7,
          font,
          color: rgb(0.35, 0.35, 0.35),
        });
      }

      page.drawText(String(line.quantity), { x: 284, y, size: 8, font });
      page.drawText(formatMoney(line.priceTtc), {
        x: 310,
        y,
        size: 8,
        font,
      });
      page.drawText(`${line.discountPercent}%`, {
        x: 374,
        y,
        size: 8,
        font,
      });
      page.drawText(`${line.vatRate}%`, {
        x: 416,
        y,
        size: 8,
        font,
      });
      page.drawText(formatMoney(amounts.ttc), {
        x: 462,
        y,
        size: 8,
        font,
      });

      y -= 45;
    }

    y -= 10;

    if (y < 205) {
      page = pdfDoc.addPage([595, 842]);
      page.drawText("BESANÇON ARCHERIE", {
        x: 40,
        y: 790,
        size: 16,
        font: bold,
      });
      page.drawText(`RÉCAPITULATIF — DEVIS ${quoteNumber}`, {
        x: 40,
        y: 765,
        size: 11,
        font: bold,
      });
      y = 715;
    }

    page.drawText(`Total HT : ${formatMoney(totals.ht)}`, {
      x: 360,
      y,
      size: 11,
      font,
    });
    y -= 18;

    page.drawText(`Total TVA : ${formatMoney(totals.vat)}`, {
      x: 360,
      y,
      size: 11,
      font,
    });
    y -= 18;

    if (totals.discount > 0) {
      page.drawText(`Remises : -${formatMoney(totals.discount)}`, {
        x: 360,
        y,
        size: 11,
        font,
      });
      y -= 20;
    }

    page.drawText(`Total TTC : ${formatMoney(totals.ttc)}`, {
      x: 360,
      y,
      size: 14,
      font: bold,
    });

    const pages = pdfDoc.getPages();
    pages.forEach((pdfPage, index) => {
      pdfPage.drawLine({
        start: { x: 40, y: 120 },
        end: { x: 555, y: 120 },
        thickness: 1,
        color: rgb(0.6, 0.6, 0.6),
      });
      pdfPage.drawText("Besançon Archerie - SAS au capital de 5 000 €", {
        x: 40,
        y: 96,
        size: 8,
        font,
      });
      pdfPage.drawText(
        "SIREN : 979 490 794 - SIRET : 979 490 794 00018 - TVA : FR81979490794",
        { x: 40, y: 82, size: 8, font },
      );
      pdfPage.drawText("25 Grande Rue, 25770 Franois", {
        x: 40,
        y: 68,
        size: 8,
        font,
      });
      pdfPage.drawText(`Page ${index + 1}/${pages.length}`, {
        x: 500,
        y: 68,
        size: 8,
        font,
      });
    });

    const pdfBytes = await pdfDoc.save();

    const pdfArrayBuffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength,
    ) as ArrayBuffer;

    const blob = new Blob([pdfArrayBuffer], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `devis-${quoteNumber}-besancon-archerie.pdf`;
    link.click();

    URL.revokeObjectURL(url);
    shopify.toast.show(`Devis ${quoteNumber} généré`);
  };

  return (
    <s-page heading="Créer un devis">
      <s-section>
        <s-badge>Version fichier : {APP_VERSION}</s-badge>
      </s-section>

      <s-button
        slot="primary-action"
        variant="primary"
        disabled={isSaving}
        onClick={generatePdf}
      >
        Générer le PDF
      </s-button>

      <s-button
        slot="secondary-actions"
        disabled={isSaving}
        onClick={() => void saveQuote()}
      >
        Enregistrer le brouillon
      </s-button>

      <s-section heading="Client">
        <s-stack gap="base">
          {savedQuote && (
            <s-badge>Devis enregistré : {savedQuote.number}</s-badge>
          )}

          <s-text-field
            label="Rechercher un client Shopify"
            value={customerQuery}
            onInput={(event) => searchCustomers(event.currentTarget.value)}
          />

          {customerResults.length > 0 && (
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack gap="small">
                {customerResults.map((customer) => (
                  <s-button
                    key={customer.id}
                    variant="tertiary"
                    onClick={() => selectCustomer(customer)}
                  >
                    {customer.name}
                    {customer.email ? ` - ${customer.email}` : ""}
                  </s-button>
                ))}
              </s-stack>
            </s-box>
          )}

          {selectedCustomer && (
            <s-paragraph>
              Client sélectionné : {selectedCustomer.name}
            </s-paragraph>
          )}

          <s-text-field
            label="Nom du client"
            value={clientName}
            onInput={(event) => setClientName(event.currentTarget.value)}
          />

          <s-text-field
            label="Société"
            value={company}
            onInput={(event) => setCompany(event.currentTarget.value)}
          />

          <s-text-field
            label="Adresse"
            value={address1}
            onInput={(event) => setAddress1(event.currentTarget.value)}
          />

          <s-text-field
            label="Complément d'adresse"
            value={address2}
            onInput={(event) => setAddress2(event.currentTarget.value)}
          />

          <s-stack direction="inline" gap="base">
            <s-text-field
              label="Code postal"
              value={zip}
              onInput={(event) => setZip(event.currentTarget.value)}
            />

            <s-text-field
              label="Ville"
              value={city}
              onInput={(event) => setCity(event.currentTarget.value)}
            />
          </s-stack>

          <s-text-field
            label="Pays"
            value={country}
            onInput={(event) => setCountry(event.currentTarget.value)}
          />

          <s-stack direction="inline" gap="base">
            <s-text-field
              label="Email"
              value={email}
              onInput={(event) => setEmail(event.currentTarget.value)}
            />

            <s-text-field
              label="Téléphone"
              value={phone}
              onInput={(event) => setPhone(event.currentTarget.value)}
            />
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Produits du devis">
        <s-stack gap="base">
          <s-button onClick={addProducts}>Sélectionner des produits</s-button>

          {lines.length === 0 && (
            <s-paragraph>Aucun produit sélectionné pour le moment.</s-paragraph>
          )}

          {lines.map((line) => {
            const amounts = getLineAmounts(line);

            return (
              <s-box
                key={line.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack gap="small">
                  {line.imageUrl && (
                    <img
                      src={line.imageUrl}
                      alt={line.title}
                      style={{
                        width: 80,
                        height: 80,
                        objectFit: "cover",
                        borderRadius: 8,
                      }}
                    />
                  )}

                  <s-heading>{line.title}</s-heading>

                  {line.sku && <s-text>SKU : {line.sku}</s-text>}

                  <s-stack direction="inline" gap="base">
                    <s-number-field
                      label="Quantité"
                      min={1}
                      step={1}
                      value={String(line.quantity)}
                      onInput={(event) =>
                        updateLineNumber(
                          line.id,
                          "quantity",
                          Number(event.currentTarget.value),
                        )
                      }
                    />

                    <s-number-field
                      label="Prix unitaire TTC"
                      min={0}
                      step={0.01}
                      value={String(line.priceTtc)}
                      onInput={(event) =>
                        updateLineNumber(
                          line.id,
                          "priceTtc",
                          Number(event.currentTarget.value),
                        )
                      }
                    />

                    <s-number-field
                      label="TVA (%)"
                      min={0}
                      max={100}
                      step={0.1}
                      value={String(line.vatRate)}
                      onInput={(event) =>
                        updateLineNumber(
                          line.id,
                          "vatRate",
                          Number(event.currentTarget.value),
                        )
                      }
                    />

                    <s-number-field
                      label="Remise (%)"
                      min={0}
                      max={100}
                      step={0.1}
                      value={String(line.discountPercent)}
                      onInput={(event) =>
                        updateLineNumber(
                          line.id,
                          "discountPercent",
                          Number(event.currentTarget.value),
                        )
                      }
                    />

                    <s-text>HT : {formatMoney(amounts.ht)}</s-text>
                    <s-text>TVA : {formatMoney(amounts.vat)}</s-text>
                    {amounts.discount > 0 && (
                      <s-text>
                        Remise : -{formatMoney(amounts.discount)}
                      </s-text>
                    )}
                    <s-text>Total TTC : {formatMoney(amounts.ttc)}</s-text>

                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => removeLine(line.id)}
                    >
                      Supprimer
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            );
          })}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Totaux">
        <s-paragraph>Total HT : {formatMoney(totals.ht)}</s-paragraph>
        <s-paragraph>Total TVA : {formatMoney(totals.vat)}</s-paragraph>
        {totals.discount > 0 && (
          <s-paragraph>
            Remises appliquées : -{formatMoney(totals.discount)}
          </s-paragraph>
        )}
        <s-paragraph>Total TTC : {formatMoney(totals.ttc)}</s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Informations client">
        <s-paragraph>{clientName || "Client non sélectionné"}</s-paragraph>
        {company && <s-paragraph>{company}</s-paragraph>}
        {address1 && <s-paragraph>{address1}</s-paragraph>}
        {address2 && <s-paragraph>{address2}</s-paragraph>}
        {(zip || city) && <s-paragraph>{`${zip} ${city}`.trim()}</s-paragraph>}
        {country && <s-paragraph>{country}</s-paragraph>}
        {email && <s-paragraph>{email}</s-paragraph>}
        {phone && <s-paragraph>{phone}</s-paragraph>}
      </s-section>

      <s-section slot="aside" heading="Informations légales">
        <s-paragraph>
          Besançon Archerie
          <br />
          SAS au capital de 5 000 €
          <br />
          SIREN : 979 490 794
          <br />
          SIRET : 979 490 794 00018
          <br />
          TVA : FR81979490794
          <br />
          25 Grande Rue, 25770 Franois
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
