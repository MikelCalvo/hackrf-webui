export type PmrBand = {
  id: string;
  name: string;
  region: string;
  description: string;
};

export type PmrChannel = {
  id: string;
  bandId: string;
  number: number;
  freqMhz: number;
  label: string;
  notes?: string;
};

export const PMR_BANDS: PmrBand[] = [
  {
    id: "pmr446",
    name: "PMR446",
    region: "EU / Global",
    description: "License-free UHF, 16 analog channels · 446 MHz",
  },
  {
    id: "frs",
    name: "FRS",
    region: "US / Canada",
    description: "Family Radio Service, 22 channels · 462–467 MHz",
  },
  {
    id: "uhf-cb",
    name: "UHF CB",
    region: "AU / NZ",
    description: "UHF Citizens Band, 40 simplex channels · 476–477 MHz",
  },
  {
    id: "murs",
    name: "MURS",
    region: "US",
    description: "Multi-Use Radio Service, 5 VHF channels · 151–154 MHz",
  },
];

// PMR446 EU — 16 analog channels, 12.5 kHz spacing (CEPT/ERC Decision 08(08), updated 2016)
// CH1–8: 446.00625–446.09375 MHz (original band)
// CH9–16: 446.10625–446.19375 MHz (extended band, supported by modern handhelds)
const pmr446Channels: PmrChannel[] = Array.from({ length: 16 }, (_, i) => ({
  id: `pmr446-${i + 1}`,
  bandId: "pmr446",
  number: i + 1,
  freqMhz: Number((446.00625 + i * 0.0125).toFixed(5)),
  label: `CH${i + 1}`,
  notes: i >= 8 ? "Extended band (post-2016)" : undefined,
}));

// FRS US — 22 channels
const frsFreqs = [
  462.5625, 462.5875, 462.6125, 462.6375, 462.6625, 462.6875, 462.7125, // CH1–7
  467.5625, 467.5875, 467.6125, 467.6375, 467.6625, 467.6875, 467.7125, // CH8–14 (low power)
  462.5500, 462.5750, 462.6000, 462.6250, 462.6500, 462.6750, 462.7000, 462.7250, // CH15–22
];
const frsLowPower = new Set([8, 9, 10, 11, 12, 13, 14]);
const frsChannels: PmrChannel[] = frsFreqs.map((freq, i) => ({
  id: `frs-${i + 1}`,
  bandId: "frs",
  number: i + 1,
  freqMhz: freq,
  label: `CH${i + 1}`,
  notes: frsLowPower.has(i + 1) ? "Low power" : undefined,
}));

// UHF CB AU — CH1–40 simplex (25 kHz spacing from 476.425 MHz)
const uhfCbNotes: Record<number, string> = {
  5: "Emergency / travellers",
  10: "Data",
  11: "Calling",
  17: "Road transport",
  40: "Emergency (nationwide)",
};
const uhfCbChannels: PmrChannel[] = Array.from({ length: 40 }, (_, i) => ({
  id: `uhf-cb-${i + 1}`,
  bandId: "uhf-cb",
  number: i + 1,
  freqMhz: Number((476.425 + i * 0.025).toFixed(3)),
  label: `CH${i + 1}`,
  notes: uhfCbNotes[i + 1],
}));

// MURS US — 5 VHF channels
const mursChannels: PmrChannel[] = [
  { id: "murs-1", bandId: "murs", number: 1, freqMhz: 151.820, label: "CH1" },
  { id: "murs-2", bandId: "murs", number: 2, freqMhz: 151.880, label: "CH2" },
  { id: "murs-3", bandId: "murs", number: 3, freqMhz: 151.940, label: "CH3" },
  { id: "murs-4", bandId: "murs", number: 4, freqMhz: 154.570, label: "CH4" },
  { id: "murs-5", bandId: "murs", number: 5, freqMhz: 154.600, label: "CH5" },
];

export const PMR_CHANNELS: PmrChannel[] = [
  ...pmr446Channels,
  ...frsChannels,
  ...uhfCbChannels,
  ...mursChannels,
];

export function getChannelsForBand(bandId: string): PmrChannel[] {
  return PMR_CHANNELS.filter(ch => ch.bandId === bandId);
}
