import { DynamicPlatformPlugin, PlatformAccessory, PlatformConfig, Characteristic, Service, Logger, API } from 'homebridge';
import VeSyncPurAccessory from './VeSyncPurAccessory';
import VeSyncHumAccessory from './VeSyncHumAccessory';
import VeSyncHumidifier from './api/VeSyncHumidifier';
import { ExperimentalFeatures } from './types';
import VeSyncFan from './api/VeSyncFan';
import DebugMode from './debugMode';
export interface VeSyncContext {
    name: string;
    device: VeSyncFan | VeSyncHumidifier;
}
export declare enum VeSyncAdditionalType {
    Sensor = 0,
    Light = 1
}
export interface VeSyncAdditionalContext {
    name: string;
    parent: string;
    type: VeSyncAdditionalType;
}
export type VeSyncPlatformAccessory = PlatformAccessory<VeSyncContext | VeSyncAdditionalContext>;
export interface Config extends PlatformConfig {
    experimentalFeatures: ExperimentalFeatures[];
    enableDebugMode?: boolean;
    countryCode?: string;
    updateInterval?: number;
    password: string;
    email: string;
}
export default class Platform implements DynamicPlatformPlugin {
    readonly log: Logger;
    readonly config: Config;
    readonly api: API;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    readonly registeredDevices: (VeSyncPurAccessory | VeSyncHumAccessory)[];
    readonly cachedAccessories: VeSyncPlatformAccessory[];
    readonly cachedAdditional: VeSyncPlatformAccessory[];
    readonly debugger: DebugMode;
    private readonly client?;
    constructor(log: Logger, config: Config, api: API);
    configureAccessory(accessory: VeSyncPlatformAccessory): void;
    private cleanAccessories;
    private discoverDevices;
    private loadDevice;
    private checkOldDevices;
    private loadAdditional;
}
//# sourceMappingURL=platform.d.ts.map