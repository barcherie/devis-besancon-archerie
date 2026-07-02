CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REFUSED');

CREATE TABLE "QuoteCounter" (
    "shop" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuoteCounter_pkey" PRIMARY KEY ("shop", "year")
);

CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "customerShopifyId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerCompany" TEXT,
    "customerAddress1" TEXT,
    "customerAddress2" TEXT,
    "customerZip" TEXT,
    "customerCity" TEXT,
    "customerCountry" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "subtotalHt" DECIMAL(12,2) NOT NULL,
    "vatTotal" DECIMAL(12,2) NOT NULL,
    "discountTotal" DECIMAL(12,2) NOT NULL,
    "totalTtc" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unitPriceTtc" DECIMAL(12,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL,
    "imageUrl" TEXT,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Quote_shop_number_key" ON "Quote"("shop", "number");
CREATE INDEX "Quote_shop_createdAt_idx" ON "Quote"("shop", "createdAt");
CREATE INDEX "QuoteLine_quoteId_position_idx" ON "QuoteLine"("quoteId", "position");

ALTER TABLE "QuoteLine"
    ADD CONSTRAINT "QuoteLine_quoteId_fkey"
    FOREIGN KEY ("quoteId") REFERENCES "Quote"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
