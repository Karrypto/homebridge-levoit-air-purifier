"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mode = exports.AirQuality = void 0;
const async_lock_1 = __importDefault(require("async-lock"));
const deviceTypes_1 = __importDefault(require("./deviceTypes"));
const VeSync_1 = require("./VeSync");
var AirQuality;
(function (AirQuality) {
    AirQuality[AirQuality["VERY_GOOD"] = 1] = "VERY_GOOD";
    AirQuality[AirQuality["MODERATE"] = 3] = "MODERATE";
    AirQuality[AirQuality["UNKNOWN"] = 0] = "UNKNOWN";
    AirQuality[AirQuality["GOOD"] = 2] = "GOOD";
    AirQuality[AirQuality["POOR"] = 4] = "POOR";
})(AirQuality || (exports.AirQuality = AirQuality = {}));
var Mode;
(function (Mode) {
    Mode["Manual"] = "manual";
    Mode["Sleep"] = "sleep";
    Mode["Auto"] = "auto";
})(Mode || (exports.Mode = Mode = {}));
class VeSyncFan {
    get airQualityLevel() {
        if (!this.deviceType.hasAirQuality) {
            return AirQuality.UNKNOWN;
        }
        return this._airQualityLevel;
    }
    get screenVisible() {
        return this._screenVisible;
    }
    get filterLife() {
        return this._filterLife;
    }
    get childLock() {
        return this._childLock;
    }
    get speed() {
        return this._speed;
    }
    get mode() {
        return this._mode;
    }
    get isOn() {
        return this._isOn;
    }
    get pm25() {
        if (!this.deviceType.hasPM25) {
            return 0;
        }
        const value = this._pm25;
        return value < 0 ? 0 : value > 1000 ? 1000 : value;
    }
    constructor(client, name, _mode, _speed, uuid, _isOn, _airQualityLevel, configModule, cid, region, model, mac) {
        this.client = client;
        this.name = name;
        this._mode = _mode;
        this._speed = _speed;
        this.uuid = uuid;
        this._isOn = _isOn;
        this._airQualityLevel = _airQualityLevel;
        this.configModule = configModule;
        this.cid = cid;
        this.region = region;
        this.model = model;
        this.mac = mac;
        this.lock = new async_lock_1.default();
        this.lastCheck = 0;
        this._screenVisible = true;
        this._childLock = false;
        this._filterLife = 0;
        this._pm25 = 0;
        this.manufacturer = 'Levoit';
        this.deviceType = deviceTypes_1.default.find(({ isValid }) => isValid(this.model));
        this.deviceCategory = this.model.includes('V') ? 'Vital' : 'Core';
    }
    /**
     * Custom toJSON to prevent circular reference errors when Homebridge saves cached accessories.
     * Excludes the VeSync client reference which contains timers.
     */
    toJSON() {
        return {
            name: this.name,
            uuid: this.uuid,
            configModule: this.configModule,
            cid: this.cid,
            region: this.region,
            model: this.model,
            mac: this.mac,
            manufacturer: this.manufacturer,
            deviceCategory: this.deviceCategory
        };
    }
    async setChildLock(lock) {
        const data = this.deviceCategory === 'Vital' ? {
            childLockSwitch: lock ? 1 : 0
        } : {
            child_lock: lock,
        };
        const success = await this.client.sendCommand(this, VeSync_1.BypassMethod.LOCK, data);
        if (success) {
            this._childLock = lock;
        }
        return success;
    }
    async setPower(power) {
        const data = this.deviceCategory === 'Vital' ? {
            powerSwitch: power ? 1 : 0,
            switchIdx: 0
        } : {
            enabled: power,
            id: 0
        };
        const success = await this.client.sendCommand(this, VeSync_1.BypassMethod.SWITCH, data);
        if (success) {
            this._isOn = power;
        }
        return success;
    }
    async changeMode(mode) {
        if ((mode === Mode.Auto || mode === Mode.Manual) &&
            !this.deviceType.hasAutoMode) {
            return false;
        }
        const data = this.deviceCategory === 'Vital' ? {
            workMode: mode.toString()
        } : {
            mode: mode.toString()
        };
        const success = await this.client.sendCommand(this, VeSync_1.BypassMethod.MODE, data);
        if (success) {
            this._mode = mode;
        }
        return success;
    }
    async changeSpeed(speed) {
        if (speed > this.deviceType.speedLevels - 1 || speed <= 0) {
            return false;
        }
        const data = this.deviceCategory === 'Vital' ? {
            manualSpeedLevel: speed,
            switchIdx: 0,
            type: 'wind'
        } : {
            level: speed,
            type: 'wind',
            id: 0
        };
        const success = await this.client.sendCommand(this, VeSync_1.BypassMethod.SPEED, data);
        if (success) {
            this._speed = speed;
        }
        return success;
    }
    async setDisplay(display) {
        const data = this.deviceCategory === 'Vital' ? {
            screenSwitch: display ? 1 : 0
        } : {
            state: display,
            id: 0
        };
        const success = await this.client.sendCommand(this, VeSync_1.BypassMethod.DISPLAY, data);
        if (success) {
            this._screenVisible = display;
        }
        return success;
    }
    async updateInfo() {
        return this.lock.acquire('update-info', async () => {
            var _a, _b, _c;
            try {
                if (Date.now() - this.lastCheck < 5 * 1000) {
                    return;
                }
                const data = await this.client.getDeviceInfo(this);
                this.lastCheck = Date.now();
                if (!((_a = data === null || data === void 0 ? void 0 : data.result) === null || _a === void 0 ? void 0 : _a.result)) {
                    return;
                }
                const result = (_b = data === null || data === void 0 ? void 0 : data.result) === null || _b === void 0 ? void 0 : _b.result;
                this._pm25 = this.deviceType.hasPM25 ? result.air_quality_value || result.PM25 : 0;
                this._airQualityLevel = this.deviceType.hasAirQuality
                    ? result.air_quality || result.AQLevel
                    : AirQuality.UNKNOWN;
                this._filterLife = result.filter_life || result.filterLifePercent;
                this._screenVisible = result.display || result.screenSwitch;
                this._childLock = result.child_lock || result.childLockSwitch;
                this._isOn = result.enabled || result.powerSwitch;
                this._speed = result.level || result.fanSpeedLevel;
                this._mode = result.mode || result.workMode;
            }
            catch (err) {
                const errorMessage = ((_c = err === null || err === void 0 ? void 0 : err.response) === null || _c === void 0 ? void 0 : _c.data)
                    ? JSON.stringify(err.response.data)
                    : (err === null || err === void 0 ? void 0 : err.message) || 'Unknown error';
                this.client.log.error(`Failed to update info for ${this.name}: ${errorMessage}`);
                this.client.debugMode.debug('[UPDATE INFO]', `Error for ${this.name}:`, errorMessage);
            }
        });
    }
}
VeSyncFan.fromResponse = (client) => ({ deviceStatus, deviceName, extension: { airQualityLevel, fanSpeedLevel, mode }, uuid, configModule, cid, deviceRegion, deviceType, macID }) => new VeSyncFan(client, deviceName, mode, parseInt(fanSpeedLevel !== null && fanSpeedLevel !== void 0 ? fanSpeedLevel : '0', 10), uuid, deviceStatus === 'on', airQualityLevel, configModule, cid, deviceRegion, deviceType, macID);
exports.default = VeSyncFan;
//# sourceMappingURL=VeSyncFan.js.map