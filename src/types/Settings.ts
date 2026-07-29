import { DEFAULT_TIMER_SECONDS } from '../constants/timer';

export type BackgroundColor = 'white' | 'gray' | 'black';

export type Settings = {
  backgroundColor: BackgroundColor;
  defaultTimer: number;
  autoNext: boolean;
  showGrid: boolean;
  lightAzimuth: number;    // 光の方位角(度) 0=正面, 90=右横, 180=真後ろ(逆光)
  lightElevation: number;  // 光の高度(度) 10=低い(影長い) 〜 90=真上
  lightIntensity: number;  // 主光の強さ
  ambientIntensity: number; // 環境光の強さ(下げると明暗くっきり)
  cameraFov: number; // カメラ視野角(度)。小=望遠(平面的) 大=広角(パース強)
};

export const defaultSettings: Settings = {
  backgroundColor: 'white',
  defaultTimer: DEFAULT_TIMER_SECONDS,
  autoNext: true,
  showGrid: true,
  lightAzimuth: 40,
  lightElevation: 55,
  lightIntensity: 1.1,
  cameraFov: 35,
  ambientIntensity: 0.35, // 元0.55から下げて、向きで陰影が変わるのを分かりやすく(B)
};