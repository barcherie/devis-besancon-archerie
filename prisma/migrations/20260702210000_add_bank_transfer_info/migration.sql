ALTER TABLE "ShopSettings"
    ADD COLUMN "bankTransferInfo" TEXT NOT NULL DEFAULT E'Informations en cas de virement :\nIBAN : FR76 1080 7000 3312 5212 1202 213\nBIC : CCBPFRPPDJN';
