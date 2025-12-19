export enum DeviceName {
  Core602S = '602S',
  Core601S = '601S',
  Core600S = '600S',
  Core401S = '401S',
  Core400S = '400S',
  Core303S = '303S', // 300S Pro
  Core302S = '302S',
  Core301S = '301S',
  Core300S = '300S',
  Core201S = '201S',
  Core200S = '200S',
  Vital100S  = 'V102S',
  Vital200S = 'V201S',
}

export enum HumidifierDeviceName {
  Dual200SLeg = 'Dual200S',
  Dual200S = 'D301S',
}

const normalize = (input: string) => (input ?? '').toUpperCase();

export interface DeviceType {
  isValid: (input: string) => boolean;
  hasAirQuality: boolean;
  hasAutoMode: boolean;
  speedMinStep: number;
  speedLevels: number; // With night mode
  hasPM25: boolean;
}

export type DeviceCategory = 'Core' | 'Vital';

export type HumidifierDeviceType = Omit<DeviceType, 'hasPM25' | 'hasAirQuality'> & { isHumidifier: true };

const deviceTypes: DeviceType[] = [
  {
    isValid: (input: string) => {
      const i = normalize(input);
      return (
        i.includes(DeviceName.Core602S) ||
        i.includes(DeviceName.Core601S) ||
        i.includes(DeviceName.Core600S) ||
        i.includes(DeviceName.Core401S) ||
        i.includes(DeviceName.Core400S)
      );
    },
    hasAirQuality: true,
    hasAutoMode: true,
    speedMinStep: 20,
    speedLevels: 5,
    hasPM25: true
  },
  {
    isValid: (input: string) => {
      const i = normalize(input);
      // 300S Pro: je nach API/Region tauchen unterschiedliche Modelstrings auf,
      // daher etwas toleranter matchen.
      return (
        i.includes(DeviceName.Core303S) || // 300S Pro (z.B. "...303S...")
        i.includes('300S PRO') ||
        i.includes('300SPRO') ||
        i.includes(DeviceName.Core302S) ||
        i.includes(DeviceName.Core301S) ||
        i.includes(DeviceName.Core300S)
      );
    },
    hasAirQuality: true,
    hasAutoMode: true,
    speedMinStep: 25,
    speedLevels: 4,
    hasPM25: true
  },
  {
    isValid: (input: string) => {
      const i = normalize(input);
      return (
        (i.includes(DeviceName.Core201S) && !i.includes(DeviceName.Vital200S)) ||
        i.includes(DeviceName.Core200S)
      );
    },
    hasAirQuality: false,
    hasAutoMode: false,
    speedMinStep: 25,
    speedLevels: 4,
    hasPM25: false
  },
  {
    isValid: (input: string) => {
      const i = normalize(input);
      return i.includes(DeviceName.Vital100S) || i.includes(DeviceName.Vital200S);
    },
    hasAirQuality: true,
    hasAutoMode: true,
    speedMinStep: 25,
    speedLevels: 4,
    hasPM25: true
  },
];

export const humidifierDeviceTypes: HumidifierDeviceType[] = [
  {
    isValid: (input: string) => {
      const i = normalize(input);
      return i.includes(HumidifierDeviceName.Dual200S) || i.includes(HumidifierDeviceName.Dual200SLeg);
    },
    hasAutoMode: true,
    speedMinStep: 50,
    speedLevels: 2,
    isHumidifier: true
  }
];

export default deviceTypes;
