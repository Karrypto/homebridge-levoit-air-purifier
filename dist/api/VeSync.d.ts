import { Logger } from 'homebridge';
import VeSyncHumidifier from './VeSyncHumidifier';
import { VeSyncGeneric } from './VeSyncGeneric';
import DebugMode from '../debugMode';
import VeSyncFan from './VeSyncFan';
export declare enum BypassMethod {
    STATUS = "getPurifierStatus",
    MODE = "setPurifierMode",
    NIGHT = "setNightLight",
    DISPLAY = "setDisplay",
    LOCK = "setChildLock",
    SWITCH = "setSwitch",
    SPEED = "setLevel"
}
export declare enum HumidifierBypassMethod {
    HUMIDITY = "setTargetHumidity",
    STATUS = "getHumidifierStatus",
    MIST_LEVEL = "setVirtualLevel",
    MODE = "setHumidityMode",
    DISPLAY = "setDisplay",
    SWITCH = "setSwitch",
    LEVEL = "setLevel"
}
export interface VeSyncClientOptions {
    countryCode?: string;
    storagePath?: string;
}
export default class VeSync {
    private readonly email;
    private readonly password;
    readonly debugMode: DebugMode;
    readonly log: Logger;
    private readonly options;
    private api?;
    private accountId?;
    private token?;
    private tokenExpiresAt?;
    private loginInterval?;
    private terminalId?;
    private appId?;
    private readonly APP_VERSION;
    private readonly CLIENT_VERSION;
    private readonly COUNTRY_CODE;
    private baseURL;
    private readonly AGENT;
    private readonly TIMEZONE;
    private readonly OS;
    private readonly LANG;
    private readonly PHONE_BRAND;
    private readonly CLIENT_INFO;
    private readonly sessionFilePath?;
    private get AXIOS_OPTIONS();
    constructor(email: string, password: string, debugMode: DebugMode, log: Logger, options?: VeSyncClientOptions);
    private isEuCountryCode;
    private getAlternateBaseURL;
    private loadPersistedSession;
    private saveSession;
    private clearPersistedSession;
    private generateDetailBody;
    private generateBody;
    private generateV2Body;
    sendCommand(fan: VeSyncGeneric, method: BypassMethod | HumidifierBypassMethod, body?: {}): Promise<boolean>;
    getDeviceInfo(fan: VeSyncGeneric, humidifier?: boolean): Promise<any>;
    startSession(): Promise<boolean>;
    stopSession(): void;
    private login;
    private loginInternal;
    private loginLegacy;
    getDevices(): Promise<{
        purifiers: VeSyncFan[];
        humidifiers: VeSyncHumidifier[];
    }>;
}
//# sourceMappingURL=VeSync.d.ts.map