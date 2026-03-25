export type AudioControls = {
  lna: number;
  vga: number;
  audioGain: number;
};

export type RadioBand = {
  id: string;
  name: string;
  region: string;
  description: string;
};

export type RadioChannel = {
  id: string;
  bandId: string;
  number: number;
  freqMhz: number;
  label: string;
  notes?: string;
  removable?: boolean;
};
