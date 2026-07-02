import { useEffect, useRef, useState } from "react";
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";
import { useAppBridge } from "@shopify/app-bridge-react";

import type { LegalInfo } from "../shop-settings.server";

const APP_VERSION = "V1.14";

export type QuoteLine = {
  id: string;
  variantId?: string;
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

export type InitialQuote = {
  id: string;
  number: string;
  status: "DRAFT" | "SENT" | "ACCEPTED" | "REFUSED";
  customerShopifyId?: string;
  customerName: string;
  customerCompany: string;
  customerAddress1: string;
  customerAddress2: string;
  customerZip: string;
  customerCity: string;
  customerCountry: string;
  customerEmail: string;
  customerPhone: string;
  lines: QuoteLine[];
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

function fitText(text: string, font: PDFFont, size: number, maxWidth: number) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let value = text;
  while (
    value.length > 1 &&
    font.widthOfTextAtSize(`${value}...`, size) > maxWidth
  ) {
    value = value.slice(0, -1);
  }
  return `${value}...`;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = fitText(word, font, size, maxWidth);
      }
    }
    if (line) lines.push(line);
  }
  return lines;
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

export default function QuoteEditor({
  initialQuote,
  legalInfo,
  autoGeneratePdf = false,
}: {
  initialQuote?: InitialQuote;
  legalInfo: LegalInfo;
  autoGeneratePdf?: boolean;
}) {
  const shopify = useAppBridge();
  const autoGenerationStarted = useRef(false);

  const [customerQuery, setCustomerQuery] = useState(
    initialQuote?.customerName || "",
  );
  const [customerResults, setCustomerResults] = useState<CustomerResult[]>([]);
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerResult | null>(
      initialQuote?.customerShopifyId
        ? {
            id: initialQuote.customerShopifyId,
            name: initialQuote.customerName,
            email: initialQuote.customerEmail,
            phone: initialQuote.customerPhone,
            company: initialQuote.customerCompany,
            address1: initialQuote.customerAddress1,
            address2: initialQuote.customerAddress2,
            zip: initialQuote.customerZip,
            city: initialQuote.customerCity,
            country: initialQuote.customerCountry,
          }
        : null,
    );

  const [clientName, setClientName] = useState(
    initialQuote?.customerName || "",
  );
  const [company, setCompany] = useState(
    initialQuote?.customerCompany || "",
  );
  const [address1, setAddress1] = useState(
    initialQuote?.customerAddress1 || "",
  );
  const [address2, setAddress2] = useState(
    initialQuote?.customerAddress2 || "",
  );
  const [zip, setZip] = useState(initialQuote?.customerZip || "");
  const [city, setCity] = useState(initialQuote?.customerCity || "");
  const [country, setCountry] = useState(
    initialQuote?.customerCountry || "",
  );
  const [email, setEmail] = useState(initialQuote?.customerEmail || "");
  const [phone, setPhone] = useState(initialQuote?.customerPhone || "");

  const [lines, setLines] = useState<QuoteLine[]>(
    initialQuote?.lines || [],
  );
  const [savedQuote, setSavedQuote] = useState<SavedQuote | null>(
    initialQuote
      ? { id: initialQuote.id, number: initialQuote.number }
      : null,
  );
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
          variantId: undefined,
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
          variantId: variant.id,
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
    if (field === "quantity") {
      normalizedValue = Math.max(1, Math.round(value));
    }
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
    const navy = rgb(0.08, 0.13, 0.2);
    const gold = rgb(0.82, 0.62, 0.2);
    const lightGold = rgb(0.97, 0.95, 0.89);
    const pale = rgb(0.96, 0.97, 0.98);
    const grey = rgb(0.38, 0.42, 0.47);
    const white = rgb(1, 1, 1);

    const drawRight = (
      targetPage: PDFPage,
      text: string,
      right: number,
      y: number,
      size: number,
      targetFont = font,
      color = navy,
    ) => {
      targetPage.drawText(text, {
        x: right - targetFont.widthOfTextAtSize(text, size),
        y,
        size,
        font: targetFont,
        color,
      });
    };

    const drawHeader = (targetPage: PDFPage, continuation = false) => {
      targetPage.drawRectangle({
        x: 0,
        y: 742,
        width: 595,
        height: 100,
        color: navy,
      });
      targetPage.drawRectangle({
        x: 0,
        y: 736,
        width: 595,
        height: 6,
        color: gold,
      });
      targetPage.drawText(legalInfo.companyName.toUpperCase(), {
        x: 40,
        y: 790,
        size: 20,
        font: bold,
        color: white,
      });
      targetPage.drawText(
        continuation ? "DEVIS - SUITE" : "DEVIS",
        { x: 40, y: 765, size: 10, font: bold, color: gold },
      );
      drawRight(targetPage, quoteNumber, 555, 786, 15, bold, white);
      drawRight(
        targetPage,
        new Date().toLocaleDateString("fr-FR"),
        555,
        765,
        9,
        font,
        white,
      );
    };

    const drawTableHeader = (targetPage: PDFPage, startY: number) => {
      targetPage.drawRectangle({
        x: 40,
        y: startY - 7,
        width: 515,
        height: 27,
        color: navy,
      });
      const labels = [
        ["PRODUIT", 52],
        ["QTE", 278],
        ["PU HT", 310],
        ["PU TTC", 355],
        ["REM.", 411],
        ["TOTAL HT", 445],
        ["TOTAL TTC", 500],
      ] as const;
      labels.forEach(([label, x]) =>
        targetPage.drawText(label, {
          x,
          y: startY + 2,
          size: 7.5,
          font: bold,
          color: white,
        }),
      );
      return startY - 40;
    };

    const addContinuationPage = () => {
      const targetPage = pdfDoc.addPage([595, 842]);
      drawHeader(targetPage, true);
      return { targetPage, startY: drawTableHeader(targetPage, 700) };
    };

    let page = pdfDoc.addPage([595, 842]);
    drawHeader(page);

    const sellerLines = [
      legalInfo.companyName,
      legalInfo.address1,
      legalInfo.address2,
      `${legalInfo.postalCode} ${legalInfo.city}`.trim(),
      legalInfo.country,
    ].filter(Boolean);
    const customerLines = [
      company || clientName,
      company && clientName ? clientName : "",
      address1,
      address2,
      `${zip} ${city}`.trim(),
      country,
      email,
      phone,
    ].filter(Boolean);

    const drawInfoCard = (
      title: string,
      cardLines: string[],
      x: number,
      width: number,
    ) => {
      page.drawRectangle({
        x,
        y: 590,
        width,
        height: 116,
        color: pale,
        borderColor: rgb(0.88, 0.89, 0.91),
        borderWidth: 0.7,
      });
      page.drawText(title, { x: x + 14, y: 683, size: 8, font: bold, color: gold });
      let cardY = 665;
      cardLines.slice(0, 7).forEach((value, index) => {
        page.drawText(fitText(value, index === 0 ? bold : font, 8.5, width - 28), {
          x: x + 14,
          y: cardY,
          size: 8.5,
          font: index === 0 ? bold : font,
          color: navy,
        });
        cardY -= 13;
      });
    };

    drawInfoCard("EMETTEUR", sellerLines, 40, 247);
    drawInfoCard("DESTINATAIRE", customerLines, 307, 248);

    let y = drawTableHeader(page, 552);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (y < 180) {
        const continuation = addContinuationPage();
        page = continuation.targetPage;
        y = continuation.startY;
      }

      const amounts = getLineAmounts(line);
      const unitPriceHt = line.priceTtc / (1 + line.vatRate / 100);
      if (index % 2 === 1) {
        page.drawRectangle({
          x: 40,
          y: y - 27,
          width: 515,
          height: 43,
          color: pale,
        });
      }

      await drawProductImage(pdfDoc, page, line.imageUrl, 48, y - 19);
      page.drawText(fitText(line.title, bold, 8.5, 170), {
        x: 90,
        y,
        size: 8.5,
        font: bold,
        color: navy,
      });
      if (line.sku) {
        page.drawText(fitText(`Réf. ${line.sku}`, font, 7, 170), {
          x: 90,
          y: y - 13,
          size: 7,
          font,
          color: grey,
        });
      }
      drawRight(page, String(line.quantity), 302, y - 2, 7.5, font);
      drawRight(page, formatMoney(unitPriceHt), 352, y - 2, 7.5, font);
      drawRight(page, formatMoney(line.priceTtc), 405, y - 2, 7.5, font);
      drawRight(page, `${line.discountPercent}%`, 441, y - 2, 7.5, font);
      drawRight(page, formatMoney(amounts.ht), 497, y - 2, 7.5, font);
      drawRight(page, formatMoney(amounts.ttc), 545, y - 2, 7.5, bold);
      page.drawLine({
        start: { x: 40, y: y - 27 },
        end: { x: 555, y: y - 27 },
        thickness: 0.35,
        color: rgb(0.85, 0.86, 0.88),
      });
      y -= 43;
    }

    if (y < 390) {
      page = pdfDoc.addPage([595, 842]);
      drawHeader(page, true);
      y = 680;
    }

    const totalBoxHeight = totals.discount > 0 ? 118 : 96;
    page.drawRectangle({
      x: 330,
      y: y - totalBoxHeight,
      width: 225,
      height: totalBoxHeight,
      color: lightGold,
    });
    let totalY = y - 25;
    const totalRows: [string, string, boolean][] = [
      ["Total HT", formatMoney(totals.ht), false],
      ["TVA", formatMoney(totals.vat), false],
    ];
    if (totals.discount > 0) {
      totalRows.push(["Remises", `-${formatMoney(totals.discount)}`, false]);
    }
    totalRows.forEach(([label, value]) => {
      page.drawText(label, { x: 347, y: totalY, size: 9, font, color: grey });
      drawRight(page, value, 538, totalY, 9, font, navy);
      totalY -= 20;
    });
    page.drawLine({
      start: { x: 347, y: totalY + 8 },
      end: { x: 538, y: totalY + 8 },
      thickness: 1,
      color: gold,
    });
    page.drawText("TOTAL TTC", {
      x: 347,
      y: totalY - 8,
      size: 11,
      font: bold,
      color: navy,
    });
    drawRight(page, formatMoney(totals.ttc), 538, totalY - 8, 13, bold, navy);

    if (legalInfo.bankTransferInfo) {
      const bankLines = wrapText(
        legalInfo.bankTransferInfo,
        font,
        7.5,
        236,
      ).slice(0, 7);
      page.drawRectangle({
        x: 40,
        y: y - totalBoxHeight,
        width: 270,
        height: totalBoxHeight,
        color: pale,
        borderColor: rgb(0.84, 0.85, 0.87),
        borderWidth: 0.6,
      });
      bankLines.forEach((value, index) => {
        page.drawText(value, {
          x: 57,
          y: y - 25 - index * 11,
          size: 7.5,
          font: index === 0 ? bold : font,
          color: index === 0 ? navy : grey,
        });
      });
    }

    const pages = pdfDoc.getPages();
    const legalLine = [
      [legalInfo.legalForm, legalInfo.shareCapital
        ? `au capital de ${legalInfo.shareCapital}`
        : ""].filter(Boolean).join(" "),
      legalInfo.siren ? `SIREN ${legalInfo.siren}` : "",
      legalInfo.siret ? `SIRET ${legalInfo.siret}` : "",
      legalInfo.vatNumber ? `TVA ${legalInfo.vatNumber}` : "",
    ].filter(Boolean).join("  •  ");
    const contactLine = [
      legalInfo.email,
      legalInfo.phone,
      legalInfo.website,
    ].filter(Boolean).join("  •  ");

    pages.forEach((pdfPage, index) => {
      pdfPage.drawRectangle({
        x: 0,
        y: 0,
        width: 595,
        height: 92,
        color: navy,
      });
      pdfPage.drawText(fitText(legalLine, font, 7.5, 465), {
        x: 40,
        y: 60,
        size: 7.5,
        font,
        color: white,
      });
      if (contactLine) {
        pdfPage.drawText(fitText(contactLine, font, 7.5, 465), {
          x: 40,
          y: 45,
          size: 7.5,
          font,
          color: white,
        });
      }
      if (legalInfo.additionalLegal) {
        const legalLines = wrapText(
          legalInfo.additionalLegal,
          font,
          6.5,
          465,
        ).slice(0, 2);
        legalLines.forEach((value, lineIndex) => {
          pdfPage.drawText(value, {
            x: 40,
            y: 29 - lineIndex * 9,
            size: 6.5,
            font,
            color: rgb(0.76, 0.79, 0.83),
          });
        });
      }
      drawRight(
        pdfPage,
        `${index + 1} / ${pages.length}`,
        555,
        45,
        8,
        bold,
        gold,
      );
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

  useEffect(() => {
    if (!autoGeneratePdf || autoGenerationStarted.current) return;
    autoGenerationStarted.current = true;
    void generatePdf();
    // Le téléchargement automatique ne doit être déclenché qu'une fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGeneratePdf]);

  return (
    <s-page
      heading={
        initialQuote ? `Modifier ${initialQuote.number}` : "Créer un devis"
      }
    >
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
          {legalInfo.companyName}
          <br />
          {[legalInfo.legalForm, legalInfo.shareCapital
            ? `au capital de ${legalInfo.shareCapital}`
            : ""]
            .filter(Boolean)
            .join(" ")}
          <br />
          SIREN : {legalInfo.siren || "—"}
          <br />
          SIRET : {legalInfo.siret || "—"}
          <br />
          TVA : {legalInfo.vatNumber || "—"}
          <br />
          {[legalInfo.address1, legalInfo.address2].filter(Boolean).join(", ")}
          <br />
          {[legalInfo.postalCode, legalInfo.city].filter(Boolean).join(" ")}
        </s-paragraph>
        <s-link href="/app/settings">Modifier mes informations</s-link>
      </s-section>
    </s-page>
  );
}
