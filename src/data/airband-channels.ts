import type { RadioBand, RadioChannel } from "@/lib/radio";

export type AirbandBand = RadioBand;
export type AirbandChannel = RadioChannel;

export const AIRBAND_BANDS: AirbandBand[] = [
  {
    id: "all",
    name: "All",
    region: "Mixed",
    description: "Saved presets plus every built-in airband starter channel",
  },
  {
    id: "saved",
    name: "Saved",
    region: "Local",
    description: "Favorite airband frequencies stored locally in this browser",
  },
  {
    id: "common",
    name: "Common",
    region: "Global",
    description: "Widely monitored civil AM channels to get started quickly",
  },
  {
    id: "guard",
    name: "Guard",
    region: "Global",
    description: "Emergency and safety watch channels",
  },
];

const airbandCommonChannels: AirbandChannel[] = [
  {
    id: "airband-common-122750",
    bandId: "common",
    number: 1,
    freqMhz: 122.750,
    label: "Advisory 122.750",
    notes: "Common air-to-air or local advisory usage",
  },
  {
    id: "airband-common-123450",
    bandId: "common",
    number: 2,
    freqMhz: 123.450,
    label: "Air-Air 123.450",
    notes: "Widely monitored air-to-air common",
  },
  {
    id: "airband-common-123500",
    bandId: "common",
    number: 3,
    freqMhz: 123.500,
    label: "Club Ops 123.500",
    notes: "Common light-aviation and club coordination",
  },
];

const airbandGuardChannels: AirbandChannel[] = [
  {
    id: "airband-guard-121500",
    bandId: "guard",
    number: 1,
    freqMhz: 121.500,
    label: "Guard 121.500",
    notes: "International civil emergency frequency",
  },
  {
    id: "airband-guard-123100",
    bandId: "guard",
    number: 2,
    freqMhz: 123.100,
    label: "SAR 123.100",
    notes: "Common search-and-rescue coordination",
  },
];

export const AIRBAND_CHANNELS: AirbandChannel[] = [
  ...airbandCommonChannels,
  ...airbandGuardChannels,
];

export function getAirbandChannelsForBand(bandId: string): AirbandChannel[] {
  return AIRBAND_CHANNELS.filter((channel) => channel.bandId === bandId);
}
