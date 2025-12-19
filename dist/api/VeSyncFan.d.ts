import { DeviceType, DeviceCategory } from './deviceTypes';
import VeSync from './VeSync';
import { VeSyncGeneric } from './VeSyncGeneric';
export declare enum AirQuality {
    VERY_GOOD = 1,
    MODERATE = 3,
    UNKNOWN = 0,
    GOOD = 2,
    POOR = 4
}
export declare enum Mode {
    Manual = "manual",
    Sleep = "sleep",
    Auto = "auto"
}
export default class VeSyncFan implements VeSyncGeneric {
    private readonly client;
    readonly name: string;
    private _mode;
    private _speed;
    readonly uuid: string;
    private _isOn;
    private _airQualityLevel;
    readonly configModule: string;
    readonly cid: string;
    readonly region: string;
    readonly model: string;
    readonly mac: string;
    private lock;
    readonly deviceType: DeviceType;
    readonly deviceCategory: DeviceCategory;
    private lastCheck;
    private _screenVisible;
    private _childLock;
    private _filterLife;
    private _pm25;
    readonly manufacturer = "Levoit";
    get airQualityLevel(): AirQuality;
    get screenVisible(): boolean;
    get filterLife(): number;
    get childLock(): boolean;
    get speed(): number;
    get mode(): Mode;
    get isOn(): boolean;
    get pm25(): number;
    constructor(client: VeSync, name: string, _mode: Mode, _speed: number, uuid: string, _isOn: boolean, _airQualityLevel: AirQuality, configModule: string, cid: string, region: string, model: string, mac: string);
    /**
     * Custom toJSON to prevent circular reference errors when Homebridge saves cached accessories.
     * Excludes the VeSync client reference which contains timers.
     */
    toJSON(): {
        name: string;
        uuid: string;
        configModule: string;
        cid: string;
        region: string;
        model: string;
        mac: string;
        manufacturer: string;
        deviceCategory: DeviceCategory;
    };
    setChildLock(lock: boolean): Promise<boolean>;
    setPower(power: boolean): Promise<boolean>;
    changeMode(mode: Mode): Promise<boolean>;
    changeSpeed(speed: number): Promise<boolean>;
    setDisplay(display: boolean): Promise<boolean>;
    updateInfo(): Promise<void>;
    static fromResponse: (client: VeSync) => ({ deviceStatus, deviceName, extension: { airQualityLevel, fanSpeedLevel, mode }, uuid, configModule, cid, deviceRegion, deviceType, macID }: {
        deviceStatus: any;
        deviceName: any;
        extension: {
            airQualityLevel: any;
            fanSpeedLevel: any;
            mode: any;
        };
        uuid: any;
        configModule: any;
        cid: any;
        deviceRegion: any;
        deviceType: any;
        macID: any;
    }) => VeSyncFan;
}
//# sourceMappingURL=VeSyncFan.d.ts.map