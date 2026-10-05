export const DEFAULT_OFFICE = "MADHAV MEHTA";

export const OFFICES = [
  { id: "madhav-mehta", name: "MADHAV MEHTA", label: "Madhav Mehta" },
  //{ id: "canyon-tuman", name: "CANYON TUMAN", label: "Canyon Tuman" },
 // { id: "collin-wilhelm", name: "COLLIN WILHELM", label: "Collin Willhelm" },
 // { id: "keasel-broome", name: "KEASEL BROOME", label: "Keasel Broom" },
];

// WorkMyT currently contains two separate options with the same KEASEL BROOM
// label. Both are collected and merged into the one Keasel Broom office shown
// in the app.
export const WORKMYT_CAMPAIGN_TARGETS = [
  { office: "MADHAV MEHTA", campaign: "MADHAV MEHTA", occurrence: 0 },
 // { office: "CANYON TUMAN", campaign: "CANYON TUMAN", occurrence: 0 },
 // { office: "COLLIN WILHELM", campaign: "COLLIN WILHELM", occurrence: 0 },
 // { office: "KEASEL BROOME", campaign: "KEASEL BROOME", occurrence: 0 },
  //{ office: "KEASEL BROOME", campaign: "KEASEL BROOME", occurrence: 1 },
];

export function normalizeOffice(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function canonicalOffice(value) {
  const normalized = normalizeOffice(value);
  return OFFICES.find((office) => office.name === normalized)?.name || DEFAULT_OFFICE;
}

export function officeLabel(value) {
  const canonical = canonicalOffice(value);
  return OFFICES.find((office) => office.name === canonical)?.label || canonical;
}

export function officeSlug(value) {
  const canonical = canonicalOffice(value);
  return OFFICES.find((office) => office.name === canonical)?.id || "madhav-mehta";
}

export function officeRecordKey(repName, office) {
  const normalizedName = String(repName || "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${canonicalOffice(office)}|${normalizedName}`;
}
