CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL,
    "companyName" TEXT NOT NULL DEFAULT 'Besançon Archerie',
    "legalForm" TEXT NOT NULL DEFAULT 'SAS',
    "shareCapital" TEXT NOT NULL DEFAULT '5 000 €',
    "siren" TEXT NOT NULL DEFAULT '979 490 794',
    "siret" TEXT NOT NULL DEFAULT '979 490 794 00018',
    "vatNumber" TEXT NOT NULL DEFAULT 'FR81979490794',
    "address1" TEXT NOT NULL DEFAULT '25 Grande Rue',
    "address2" TEXT NOT NULL DEFAULT '',
    "postalCode" TEXT NOT NULL DEFAULT '25770',
    "city" TEXT NOT NULL DEFAULT 'Franois',
    "country" TEXT NOT NULL DEFAULT 'France',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "additionalLegal" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("shop")
);
