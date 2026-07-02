import db from "./db.server";

export const defaultShopSettings = {
  companyName: "Besançon Archerie",
  legalForm: "SAS",
  shareCapital: "5 000 €",
  siren: "979 490 794",
  siret: "979 490 794 00018",
  vatNumber: "FR81979490794",
  address1: "25 Grande Rue",
  address2: "",
  postalCode: "25770",
  city: "Franois",
  country: "France",
  email: "",
  phone: "",
  website: "",
  additionalLegal: "",
  bankTransferInfo:
    "Informations en cas de virement :\nIBAN : FR76 1080 7000 3312 5212 1202 213\nBIC : CCBPFRPPDJN",
};

export type LegalInfo = typeof defaultShopSettings;

export async function getShopSettings(shop: string): Promise<LegalInfo> {
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings) return defaultShopSettings;

  return {
    companyName: settings.companyName,
    legalForm: settings.legalForm,
    shareCapital: settings.shareCapital,
    siren: settings.siren,
    siret: settings.siret,
    vatNumber: settings.vatNumber,
    address1: settings.address1,
    address2: settings.address2,
    postalCode: settings.postalCode,
    city: settings.city,
    country: settings.country,
    email: settings.email,
    phone: settings.phone,
    website: settings.website,
    additionalLegal: settings.additionalLegal,
    bankTransferInfo: settings.bankTransferInfo,
  };
}
