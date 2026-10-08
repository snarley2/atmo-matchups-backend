export const DEFAULT_OFFICE = "MADHAV MEHTA";

export const OFFICES = [
  { id: "madhav-mehta", name: "MADHAV MEHTA", label: "Madhav Mehta" },
  { id: "canyon-tuman", name: "CANYON TUMAN", label: "Canyon Tuman" },
  { id: "collin-willhelm", name: "COLLIN WILLHELM", label: "Collin Willhelm" },
  { id: "keasel-broom", name: "KEASEL BROOM", label: "Keasel Broom" },
];

// The office label and the actual WorkMyT campaign label are intentionally distinct.
export const WORKMYT_CAMPAIGN_TARGETS = [
  { office: "MADHAV MEHTA", campaign: "MADHAV MEHTA", occurrence: 1 },
  { office: "CANYON TUMAN", campaign: "CANYON TUMAN", occurrence: 0 },
  { office: "COLLIN WILLHELM", campaign: "COLLIN WILLHELM", occurrence: 0 },
  { office: "KEASEL BROOM", campaign: "KEASEL BROOM", occurrence: 0 },
  { office: "KEASEL BROOM", campaign: "KEASEL BROOM", occurrence: 1 },
];

export function normalizeOffice(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function canonicalOffice(value) {
  const normalized = normalizeOffice(value);
  const aliases = {"MADHAV MEHAT":"MADHAV MEHTA","COLLIN WILHELM":"COLLIN WILLHELM","KEASEL BROOME":"KEASEL BROOM"};
  return OFFICES.find((office) => office.name === (aliases[normalized] || normalized))?.name || DEFAULT_OFFICE;
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
