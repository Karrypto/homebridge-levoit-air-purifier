import { HumidifierDeviceType } from './deviceTypes';
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
    Auto = "auto"
}
export default class VeSyncHumidifier implements VeSyncGeneric {
    private readonly client;
    readonly name: string;
    readonly uuid: string;
    private _isOn;
    readonly cid: string;
    readonly region: string;
    readonly model: string;
    readonly mac: string;
    readonly configModule: string;
    readonly deviceType: HumidifierDeviceType;
    private lock;
    private lastCheck;
    private _mode;
    private _autoTargetHumidity;
    private _screenVisible;
    private _idle;
    private _humidity;
    private _speed;
    readonly manufacturer = "Levoit";
    get screenVisible(): boolean;
    get isOn(): boolean;
    get speed(): number;
    get humidity(): number;
    get targetHumidity(): number;
    get mode(): Mode;
    get currentState(): 0 | 1 | 2;
    constructor(client: VeSync, name: string, uuid: string, _isOn: boolean, cid: string, region: string, model: string, mac: string, configModule: string);
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
    };
    setPower(power: boolean): Promise<boolean>;
    setTarget(value: number): Promise<boolean>;
    setMode(mode: Mode): Promise<boolean>;
    setSpeed(value: number): Promise<boolean>;
    updateInfo(): Promise<void>;
    static fromResponse: (client: VeSync) => ({ deviceStatus, deviceName, uuid, cid, deviceRegion, deviceType, macID, configModule, }: {
        deviceStatus: any;
        deviceName: any;
        uuid: any;
        cid: any;
        deviceRegion: any;
        deviceType: any;
        macID: any;
        configModule: any;
    }) => VeSyncHumidifier;
}
//# sourceMappingURL=VeSyncHumidifier.d.ts.map