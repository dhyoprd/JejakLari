export type CameraPreset = 'follow_runner' | 'drone' | 'front_hero' | 'side_profile' | 'chase';

export type SkyMode = 'morning' | 'day' | 'sunset' | 'night';

export type Gender = 'male' | 'female';

export type HairStyle = 'undercut' | 'spiky' | 'sidefade' | 'bob' | 'twintails' | 'hijab';

export type Accessory = 'none' | 'cap' | 'headband' | 'visor' | 'trail' | 'cat_ears' | 'bunny_ears';

export interface RunnerLook {
  name: string;
  bib: string;
  gender: Gender;
  hair: HairStyle;
  accessory: Accessory;
  skinColor: string;
  jerseyColor: string;
  shortsColor: string;
  shoeColor: string;
}

export interface SkyPalette {
  id: SkyMode;
  label: string;
  background: string;
  fog: string;
  ambient: string;
  ambientIntensity: number;
  sun: string;
  sunIntensity: number;
  rim: string;
  ground: string;
}

export const SKY_PALETTES: Record<SkyMode, SkyPalette> = {
  morning: {
    id: 'morning',
    label: 'Pagi',
    background: '#b9dcf5',
    fog: '#d7e9f5',
    ambient: '#e8f4ff',
    ambientIntensity: 1.5,
    sun: '#fff1cf',
    sunIntensity: 2.1,
    rim: '#fbbf24',
    ground: '#14251d',
  },
  day: {
    id: 'day',
    label: 'Siang',
    background: '#7cc6f5',
    fog: '#c7e6fa',
    ambient: '#ffffff',
    ambientIntensity: 1.7,
    sun: '#ffffff',
    sunIntensity: 2.6,
    rim: '#38bdf8',
    ground: '#1b2b22',
  },
  sunset: {
    id: 'sunset',
    label: 'Sore',
    background: '#f08a5d',
    fog: '#f7b267',
    ambient: '#ffe2c4',
    ambientIntensity: 1.35,
    sun: '#ffd9a0',
    sunIntensity: 2.3,
    rim: '#fb7185',
    ground: '#2a1a14',
  },
  night: {
    id: 'night',
    label: 'Malam',
    background: '#070d1c',
    fog: '#0f172a',
    ambient: '#5b7cbf',
    ambientIntensity: 0.75,
    sun: '#9ec5ff',
    sunIntensity: 0.9,
    rim: '#2dd4bf',
    ground: '#05080f',
  },
};

export const HAIR_STYLES: Array<{ id: HairStyle; label: string }> = [
  { id: 'undercut', label: 'Undercut' },
  { id: 'spiky', label: 'Spiky' },
  { id: 'sidefade', label: 'Side Fade' },
  { id: 'bob', label: 'Bob' },
  { id: 'twintails', label: 'Twintails' },
  { id: 'hijab', label: 'Hijab' },
];

export const ACCESSORIES: Array<{ id: Accessory; label: string; hint: string }> = [
  { id: 'none', label: 'Tanpa Aksesori', hint: 'Karakter polos' },
  { id: 'cap', label: 'Topi Sporty', hint: 'Topi lari atletis' },
  { id: 'headband', label: 'Headband', hint: 'Ikat kepala sporty' },
  { id: 'visor', label: 'Visor', hint: 'Visor terbuka' },
  { id: 'trail', label: 'Trail Vest', hint: 'Rompi trail + lampu' },
  { id: 'cat_ears', label: 'Cat Ears', hint: 'Telinga kucing' },
  { id: 'bunny_ears', label: 'Bunny Ears', hint: 'Telinga kelinci' },
];

export const CAMERA_PRESETS: Array<{ id: CameraPreset; label: string }> = [
  { id: 'drone', label: 'Drone' },
  { id: 'follow_runner', label: 'Follow' },
  { id: 'front_hero', label: 'Front' },
  { id: 'side_profile', label: 'Side' },
  { id: 'chase', label: 'Chase' },
];

export const DEFAULT_PRIMARY_LOOK: RunnerLook = {
  name: 'Kubita',
  bib: '2026',
  gender: 'male',
  hair: 'undercut',
  accessory: 'cap',
  skinColor: '#d9a273',
  jerseyColor: '#0d9488',
  shortsColor: '#1e293b',
  shoeColor: '#f8fafc',
};

export const DEFAULT_RIVAL_LOOK: RunnerLook = {
  name: 'Rival',
  bib: '2027',
  gender: 'female',
  hair: 'twintails',
  accessory: 'none',
  skinColor: '#e8b58c',
  jerseyColor: '#f97316',
  shortsColor: '#312e81',
  shoeColor: '#fde68a',
};

export const JERSEY_COLORS = ['#0d9488', '#0ea5e9', '#f97316', '#ef4444', '#8b5cf6', '#f59e0b', '#111827'];
export const SHOE_COLORS = ['#f8fafc', '#fde68a', '#38bdf8', '#fb7185', '#111827'];
export const SKIN_COLORS = ['#f2c9a0', '#d9a273', '#b97a4f', '#8a5a3b', '#5c3a26'];
