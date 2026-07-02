import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

import type { LegalInfo } from "./shop-settings.server";

export type PdfQuote = {
  number: string;
  customerName: string;
  customerCompany: string;
  customerAddress1: string;
  customerAddress2: string;
  customerZip: string;
  customerCity: string;
  customerCountry: string;
  customerEmail: string;
  customerPhone: string;
  lines: {
    title: string;
    sku: string;
    quantity: number;
    priceTtc: number;
    vatRate: number;
    discountPercent: number;
    imageUrl: string;
  }[];
};

function money(value: number) {
  return `${value.toFixed(2).replace(".", ",")} €`;
}

function amounts(line: PdfQuote["lines"][number]) {
  const grossTtc = line.priceTtc * line.quantity;
  const discount = grossTtc * (line.discountPercent / 100);
  const ttc = grossTtc - discount;
  const ht = ttc / (1 + line.vatRate / 100);
  return { discount, ttc, ht, vat: ttc - ht };
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

async function drawImage(
  pdf: PDFDocument,
  page: PDFPage,
  url: string,
  x: number,
  y: number,
) {
  if (!url) return;
  try {
    const response = await fetch(url);
    if (!response.ok) return;
    const bytes = await response.arrayBuffer();
    const image = (response.headers.get("content-type") || "").includes("png")
      ? await pdf.embedPng(bytes)
      : await pdf.embedJpg(bytes);
    page.drawImage(image, { x, y, width: 32, height: 32 });
  } catch {
    // Une image distante indisponible ne doit pas bloquer le devis.
  }
}

export async function createQuotePdf(quote: PdfQuote, legal: LegalInfo) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.08, 0.13, 0.2);
  const gold = rgb(0.82, 0.62, 0.2);
  const lightGold = rgb(0.97, 0.95, 0.89);
  const pale = rgb(0.96, 0.97, 0.98);
  const grey = rgb(0.38, 0.42, 0.47);
  const white = rgb(1, 1, 1);

  const drawRight = (
    page: PDFPage,
    text: string,
    right: number,
    y: number,
    size: number,
    selectedFont = font,
    color = navy,
  ) => {
    page.drawText(text, {
      x: right - selectedFont.widthOfTextAtSize(text, size),
      y,
      size,
      font: selectedFont,
      color,
    });
  };

  const drawHeader = (page: PDFPage, continuation = false) => {
    page.drawRectangle({ x: 0, y: 742, width: 595, height: 100, color: navy });
    page.drawRectangle({ x: 0, y: 736, width: 595, height: 6, color: gold });
    page.drawText(legal.companyName.toUpperCase(), {
      x: 40,
      y: 790,
      size: 20,
      font: bold,
      color: white,
    });
    page.drawText(continuation ? "DEVIS - SUITE" : "DEVIS", {
      x: 40,
      y: 765,
      size: 10,
      font: bold,
      color: gold,
    });
    drawRight(page, quote.number, 555, 786, 15, bold, white);
    drawRight(
      page,
      new Date().toLocaleDateString("fr-FR"),
      555,
      765,
      9,
      font,
      white,
    );
  };

  const drawTableHeader = (page: PDFPage, startY: number) => {
    page.drawRectangle({
      x: 40,
      y: startY - 7,
      width: 515,
      height: 27,
      color: navy,
    });
    (
      [
        ["PRODUIT", 52],
        ["QTE", 278],
        ["PU HT", 310],
        ["PU TTC", 355],
        ["REM.", 411],
        ["TOTAL HT", 445],
        ["TOTAL TTC", 500],
      ] as const
    ).forEach(([label, x]) =>
      page.drawText(label, {
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
    const page = pdf.addPage([595, 842]);
    drawHeader(page, true);
    return { page, y: drawTableHeader(page, 700) };
  };

  let page = pdf.addPage([595, 842]);
  drawHeader(page);

  const sellerLines = [
    legal.companyName,
    legal.address1,
    legal.address2,
    `${legal.postalCode} ${legal.city}`.trim(),
    legal.country,
  ].filter(Boolean);
  const customerLines = [
    quote.customerCompany || quote.customerName,
    quote.customerCompany && quote.customerName ? quote.customerName : "",
    quote.customerAddress1,
    quote.customerAddress2,
    `${quote.customerZip} ${quote.customerCity}`.trim(),
    quote.customerCountry,
    quote.customerEmail,
    quote.customerPhone,
  ].filter(Boolean);

  const card = (title: string, values: string[], x: number, width: number) => {
    page.drawRectangle({
      x,
      y: 590,
      width,
      height: 116,
      color: pale,
      borderColor: rgb(0.88, 0.89, 0.91),
      borderWidth: 0.7,
    });
    page.drawText(title, {
      x: x + 14,
      y: 683,
      size: 8,
      font: bold,
      color: gold,
    });
    values.slice(0, 7).forEach((value, index) => {
      const selectedFont = index === 0 ? bold : font;
      page.drawText(fitText(value, selectedFont, 8.5, width - 28), {
        x: x + 14,
        y: 665 - index * 13,
        size: 8.5,
        font: selectedFont,
        color: navy,
      });
    });
  };

  card("EMETTEUR", sellerLines, 40, 247);
  card("DESTINATAIRE", customerLines, 307, 248);

  let y = drawTableHeader(page, 552);
  for (let index = 0; index < quote.lines.length; index += 1) {
    const line = quote.lines[index];
    if (y < 180) {
      const continuation = addContinuationPage();
      page = continuation.page;
      y = continuation.y;
    }
    const lineAmounts = amounts(line);
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
    await drawImage(pdf, page, line.imageUrl, 48, y - 19);
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
    drawRight(page, String(line.quantity), 302, y - 2, 7.5);
    drawRight(page, money(unitPriceHt), 352, y - 2, 7.5);
    drawRight(page, money(line.priceTtc), 405, y - 2, 7.5);
    drawRight(page, `${line.discountPercent}%`, 441, y - 2, 7.5);
    drawRight(page, money(lineAmounts.ht), 497, y - 2, 7.5);
    drawRight(page, money(lineAmounts.ttc), 545, y - 2, 7.5, bold);
    page.drawLine({
      start: { x: 40, y: y - 27 },
      end: { x: 555, y: y - 27 },
      thickness: 0.35,
      color: rgb(0.85, 0.86, 0.88),
    });
    y -= 43;
  }

  if (y < 390) {
    page = pdf.addPage([595, 842]);
    drawHeader(page, true);
    y = 680;
  }

  const totals = quote.lines.reduce(
    (sum, line) => {
      const value = amounts(line);
      sum.ht += value.ht;
      sum.vat += value.vat;
      sum.ttc += value.ttc;
      sum.discount += value.discount;
      return sum;
    },
    { ht: 0, vat: 0, ttc: 0, discount: 0 },
  );
  const totalBoxHeight = totals.discount > 0 ? 118 : 96;
  page.drawRectangle({
    x: 330,
    y: y - totalBoxHeight,
    width: 225,
    height: totalBoxHeight,
    color: lightGold,
  });
  let totalY = y - 25;
  const rows: [string, string][] = [
    ["Total HT", money(totals.ht)],
    ["TVA", money(totals.vat)],
  ];
  if (totals.discount > 0) rows.push(["Remises", `-${money(totals.discount)}`]);
  rows.forEach(([label, value]) => {
    page.drawText(label, { x: 347, y: totalY, size: 9, font, color: grey });
    drawRight(page, value, 538, totalY, 9);
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
  drawRight(page, money(totals.ttc), 538, totalY - 8, 13, bold);

  if (legal.bankTransferInfo) {
    const bankLines = wrapText(legal.bankTransferInfo, font, 7.5, 236).slice(
      0,
      7,
    );
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

  const legalLine = [
    [
      legal.legalForm,
      legal.shareCapital ? `au capital de ${legal.shareCapital}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    legal.siren ? `SIREN ${legal.siren}` : "",
    legal.siret ? `SIRET ${legal.siret}` : "",
    legal.vatNumber ? `TVA ${legal.vatNumber}` : "",
  ]
    .filter(Boolean)
    .join("  •  ");
  const contactLine = [legal.email, legal.phone, legal.website]
    .filter(Boolean)
    .join("  •  ");
  const pages = pdf.getPages();
  pages.forEach((footerPage, index) => {
    footerPage.drawRectangle({
      x: 0,
      y: 0,
      width: 595,
      height: 92,
      color: navy,
    });
    footerPage.drawText(fitText(legalLine, font, 7.5, 465), {
      x: 40,
      y: 60,
      size: 7.5,
      font,
      color: white,
    });
    if (contactLine) {
      footerPage.drawText(fitText(contactLine, font, 7.5, 465), {
        x: 40,
        y: 45,
        size: 7.5,
        font,
        color: white,
      });
    }
    wrapText(legal.additionalLegal, font, 6.5, 465)
      .slice(0, 2)
      .forEach((value, lineIndex) => {
        footerPage.drawText(value, {
          x: 40,
          y: 29 - lineIndex * 9,
          size: 6.5,
          font,
          color: rgb(0.76, 0.79, 0.83),
        });
      });
    drawRight(
      footerPage,
      `${index + 1} / ${pages.length}`,
      555,
      45,
      8,
      bold,
      gold,
    );
  });

  return pdf.save();
}
