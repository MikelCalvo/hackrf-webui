export const COUNTRY_METADATA_OVERRIDES = {
  BE: {
    coverageStatus: "partial",
    coverageTier: "official-partial",
    coverageScope: "regional",
    sourceQuality: "official-public-sector",
    notesPath: "docs/fm/belgium-source-notes.md",
    coverageNotes:
      "Hybrid regional result built from Flemish and CSA authority sources. Wallonia and Brussels can temporarily depend on cached fallback when CSA is unstable.",
    coverageScore: 58,
  },
  ES: {
    coverageStatus: "partial",
    coverageTier: "official-partial",
    coverageScope: "regional",
    sourceQuality: "mixed",
    notesPath: "docs/fm/spain-source-notes.md",
    coverageNotes:
      "Spain currently mixes regional official datasets with a curated broadcaster/city supplement rather than a clean nationwide FM registry.",
    coverageScore: 56,
  },
  GB: {
    coverageStatus: "manual",
    coverageTier: "manual-seed",
    coverageScope: "city-seed",
    sourceQuality: "manual-curated",
    hasOfficialImporter: false,
    notesPath: "docs/fm/uk-source-notes.md",
    coverageNotes:
      "Only a tiny manual seed is shipped. Official Ofcom downloads remain Cloudflare-blocked from this environment.",
    coverageScore: 12,
  },
  IE: {
    coverageStatus: "partial",
    coverageTier: "official-partial",
    coverageScope: "public-service-only",
    sourceQuality: "official-public-sector",
    coverageNotes:
      "Current Irish coverage comes from the 2RN public-service network table, not a full commercial-market register.",
    coverageScore: 48,
  },
  IN: {
    coverageStatus: "partial",
    coverageTier: "official-substantial",
    coverageScope: "national",
    sourceQuality: "mixed",
    notesPath: "docs/fm/india-source-notes.md",
    coverageNotes:
      "Strong national baseline from MIB and Prasar Bharati, but not yet a complete all-broadcaster registry.",
    coverageScore: 72,
  },
  JP: {
    coverageStatus: "manual",
    coverageTier: "manual-seed",
    coverageScope: "city-seed",
    sourceQuality: "manual-curated",
    hasOfficialImporter: false,
    notesPath: "docs/fm/japan-source-notes.md",
    coverageNotes:
      "Japan currently ships only a small manual seed while the official nationwide import path remains blocked.",
    coverageScore: 12,
  },
  KR: {
    coverageStatus: "manual",
    coverageTier: "manual-seed",
    coverageScope: "city-seed",
    sourceQuality: "manual-curated",
    hasOfficialImporter: false,
    coverageNotes:
      "South Korea currently ships only a small manual seed because the best official path is API-limited.",
    coverageScore: 14,
  },
  MY: {
    coverageStatus: "partial",
    coverageTier: "official-partial",
    coverageScope: "public-service-only",
    sourceQuality: "official-public-sector",
    coverageNotes: "Current Malaysia coverage is derived from RTM station data only.",
    coverageScore: 42,
  },
  PH: {
    coverageStatus: "partial",
    coverageTier: "official-partial",
    coverageScope: "regional",
    sourceQuality: "official-regulator",
    coverageNotes:
      "Only the official NTC Region VII FM table is landed so far; the broader national path remains blocked from this environment.",
    coverageScore: 36,
  },
  PT: {
    coverageStatus: "partial",
    coverageTier: "official-partial",
    coverageScope: "national",
    sourceQuality: "official-regulator",
    notesPath: "docs/fm/portugal-source-notes.md",
    coverageNotes:
      "Portugal currently relies on the last public bulk export rather than a live ANACOM technical registry.",
    coverageScore: 60,
  },
};
