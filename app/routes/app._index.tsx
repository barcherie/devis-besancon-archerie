import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { useAppBridge } from "@shopify/app-bridge-react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

const APP_VERSION = "V1.7";

type QuoteLine = {
  id: string;
  title: string;
  sku: string;
  quantity: number;
  priceTtc: number;
  imageUrl: string;
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

function formatMoney(value: number) {
  return `${value.toFixed(2).replace(".", ",")} €`;
}

function getVatFromTtc(ttc: number, rate = 20) {
  const ht = ttc / (1 + rate / 100);
  const vat = ttc - ht;
  return { ht, vat, ttc };
}


function generateQuoteNumber() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function getProductImage(product: any) {
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
  page: any,
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

    selected.forEach((product: any) => {
      const variants = product.variants || [];
      const imageUrl = getProductImage(product);

      if (variants.length === 0) {
        newLines.push({
          id: product.id,
          title: product.title || "Produit sélectionné",
          sku: "",
          quantity: 1,
          priceTtc: 0,
          imageUrl,
        });
        return;
      }

      variants.forEach((variant: any) => {
        newLines.push({
          id: variant.id,
          title:
            variant.title && variant.title !== "Default Title"
              ? `${product.title} - ${variant.title}`
              : product.title,
          sku: variant.sku || "",
          quantity: 1,
          priceTtc: Number(variant.price || 0),
          imageUrl,
        });
      });
    });

    setLines((current) => [...current, ...newLines]);
  };

  const updateQuantity = (id: string, quantity: number) => {
    setLines((current) =>
      current.map((line) =>
        line.id === id
          ? { ...line, quantity: Math.max(1, quantity || 1) }
          : line,
      ),
    );
  };

  const removeLine = (id: string) => {
    setLines((current) => current.filter((line) => line.id !== id));
  };

  const totals = lines.reduce(
    (acc, line) => {
      const lineTtc = line.priceTtc * line.quantity;
      const amounts = getVatFromTtc(lineTtc);

      acc.ht += amounts.ht;
      acc.vat += amounts.vat;
      acc.ttc += amounts.ttc;

      return acc;
    },
    { ht: 0, vat: 0, ttc: 0 },
  );

  const generatePdf = async () => {
    const quoteNumber = generateQuoteNumber();

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

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

    page.drawText("Image", { x: 50, y, size: 10, font: bold });
    page.drawText("Désignation", { x: 95, y, size: 10, font: bold });
    page.drawText("Qté", { x: 300, y, size: 10, font: bold });
    page.drawText("PU TTC", { x: 345, y, size: 10, font: bold });
    page.drawText("Total TTC", { x: 455, y, size: 10, font: bold });

    y -= 8;

    page.drawLine({
      start: { x: 50, y },
      end: { x: 545, y },
      thickness: 1,
      color: rgb(0, 0, 0),
    });

    y -= 38;

    for (const line of lines) {
      await drawProductImage(pdfDoc, page, line.imageUrl, 50, y - 8);

      page.drawText(line.title.slice(0, 34), { x: 95, y, size: 9, font });

      if (line.sku) {
        page.drawText(`SKU : ${line.sku}`.slice(0, 34), {
          x: 95,
          y: y - 12,
          size: 7,
          font,
          color: rgb(0.35, 0.35, 0.35),
        });
      }

      page.drawText(String(line.quantity), { x: 305, y, size: 9, font });
      page.drawText(formatMoney(line.priceTtc), { x: 345, y, size: 9, font });
      page.drawText(formatMoney(line.priceTtc * line.quantity), {
        x: 455,
        y,
        size: 9,
        font,
      });

      y -= 45;
    }

    y -= 20;

    page.drawText(`Total HT : ${formatMoney(totals.ht)}`, {
      x: 360,
      y,
      size: 11,
      font,
    });
    y -= 18;

    page.drawText(`TVA 20% : ${formatMoney(totals.vat)}`, {
      x: 360,
      y,
      size: 11,
      font,
    });
    y -= 20;

    page.drawText(`Total TTC : ${formatMoney(totals.ttc)}`, {
      x: 360,
      y,
      size: 14,
      font: bold,
    });

    y = 120;

    page.drawLine({
      start: { x: 50, y },
      end: { x: 545, y },
      thickness: 1,
      color: rgb(0.6, 0.6, 0.6),
    });

    y -= 25;

    page.drawText("Besançon Archerie - SAS au capital de 5 000 €", {
      x: 50,
      y,
      size: 9,
      font,
    });

    y -= 14;

    page.drawText(
      "SIREN : 979 490 794 - SIRET : 979 490 794 00018 - TVA : FR81979490794",
      { x: 50, y, size: 9, font },
    );

    y -= 14;

    page.drawText("25 Grande Rue, 25770 Franois", {
      x: 50,
      y,
      size: 9,
      font,
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
  };

  return (
    <s-page heading="Créer un devis">
      <s-section>
        <s-badge>Version fichier : {APP_VERSION}</s-badge>
      </s-section>

      <s-button slot="primary-action" variant="primary" onClick={generatePdf}>
        Générer le PDF
      </s-button>

      <s-section heading="Client">
        <s-stack gap="base">
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
            const lineTotal = line.priceTtc * line.quantity;
            const amounts = getVatFromTtc(lineTotal);

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
                    <s-text-field
                      label="Quantité"
                      value={String(line.quantity)}
                      onInput={(event) =>
                        updateQuantity(
                          line.id,
                          Number(event.currentTarget.value),
                        )
                      }
                    />

                    <s-text>PU TTC : {formatMoney(line.priceTtc)}</s-text>
                    <s-text>HT : {formatMoney(amounts.ht)}</s-text>
                    <s-text>TVA : {formatMoney(amounts.vat)}</s-text>
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
        <s-paragraph>TVA 20% : {formatMoney(totals.vat)}</s-paragraph>
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
