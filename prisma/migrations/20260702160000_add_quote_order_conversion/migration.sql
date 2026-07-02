ALTER TABLE "Quote"
    ADD COLUMN "shopifyDraftOrderId" TEXT,
    ADD COLUMN "shopifyOrderId" TEXT,
    ADD COLUMN "shopifyOrderName" TEXT,
    ADD COLUMN "convertedAt" TIMESTAMP(3);

ALTER TABLE "QuoteLine"
    ADD COLUMN "shopifyVariantId" TEXT;
