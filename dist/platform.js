"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VeSyncAdditionalType = void 0;
const settings_1 = require("./settings");
const VeSyncPurAccessory_1 = __importDefault(require("./VeSyncPurAccessory"));
const VeSyncHumAccessory_1 = __importDefault(require("./VeSyncHumAccessory"));
const VeSyncHumidifier_1 = __importDefault(require("./api/VeSyncHumidifier"));
const types_1 = require("./types");
const VeSyncFan_1 = __importDefault(require("./api/VeSyncFan"));
const debugMode_1 = __importDefault(require("./debugMode"));
const VeSync_1 = __importDefault(require("./api/VeSync"));
var VeSyncAdditionalType;
(function (VeSyncAdditionalType) {
    VeSyncAdditionalType[VeSyncAdditionalType["Sensor"] = 0] = "Sensor";
    VeSyncAdditionalType[VeSyncAdditionalType["Light"] = 1] = "Light";
})(VeSyncAdditionalType || (exports.VeSyncAdditionalType = VeSyncAdditionalType = {}));
class Platform {
    constructor(log, config, api) {
        var _a;
        this.log = log;
        this.config = config;
        this.api = api;
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        this.registeredDevices = [];
        this.cachedAccessories = [];
        this.cachedAdditional = [];
        const { email, password, enableDebugMode, countryCode } = (_a = this.config) !== null && _a !== void 0 ? _a : {};
        this.debugger = new debugMode_1.default(!!enableDebugMode, this.log);
        try {
            if (!email || !password) {
                this.log.info('Setup the configuration first!');
                this.cleanAccessories();
                return;
            }
            this.debugger.debug('[PLATFORM]', 'Debug mode enabled');
            this.client = new VeSync_1.default(email, password, this.debugger, log, {
                countryCode,
                storagePath: this.api.user.storagePath(),
            });
            this.api.on('didFinishLaunching', () => {
                this.discoverDevices();
            });
            // Homebridge Best Practice: Ressourcen sauber beenden (Intervals/Session).
            // Siehe Homebridge Developer Docs: `https://developers.homebridge.io/#/`
            this.api.on('shutdown', () => {
                var _a;
                this.debugger.debug('[PLATFORM]', 'Shutdown received - stopping VeSync session...');
                (_a = this.client) === null || _a === void 0 ? void 0 : _a.stopSession();
            });
        }
        catch (error) {
            this.log.error(`Error: ${error === null || error === void 0 ? void 0 : error.message}`);
        }
    }
    configureAccessory(accessory) {
        const additional = accessory.context;
        if (additional.parent) {
            this.cachedAdditional.push(accessory);
            return;
        }
        this.log.info('Loading accessory from cache:', accessory.displayName);
        this.cachedAccessories.push(accessory);
    }
    cleanAccessories() {
        try {
            if (this.cachedAccessories.length > 0 || this.cachedAdditional.length > 0) {
                this.debugger.debug('[PLATFORM]', 'Removing cached accessories because the email and password are not set (Count:', `${this.cachedAccessories.length})`);
                this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [
                    ...this.cachedAccessories,
                    ...this.cachedAdditional
                ]);
            }
        }
        catch (error) {
            this.log.error(`Error for cached accessories: ${error === null || error === void 0 ? void 0 : error.message}`);
        }
    }
    async discoverDevices() {
        var _a;
        try {
            if (!this.client) {
                return;
            }
            this.log.info('Connecting to the servers...');
            const successLogin = await this.client.startSession();
            if (!successLogin) {
                return;
            }
            this.log.info('Discovering devices...');
            const { purifiers, humidifiers } = await this.client.getDevices();
            const experimentalFeatures = ((_a = this.config) === null || _a === void 0 ? void 0 : _a.experimentalFeatures) || [];
            await Promise.all(purifiers.map(this.loadDevice.bind(this)));
            if (experimentalFeatures.includes(types_1.ExperimentalFeatures.Humidifiers)) {
                await Promise.all(humidifiers.map(this.loadDevice.bind(this)));
            }
            this.checkOldDevices();
        }
        catch (error) {
            this.log.error(`Error: ${error === null || error === void 0 ? void 0 : error.message}`);
        }
    }
    async loadDevice(device) {
        try {
            await device.updateInfo();
            const { uuid, name } = device;
            const existingAccessory = this.cachedAccessories.find((accessory) => accessory.UUID === uuid);
            const additional = device instanceof VeSyncFan_1.default ? this.loadAdditional(device) : {};
            if (existingAccessory) {
                this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
                existingAccessory.context = {
                    name,
                    device
                };
                if (device instanceof VeSyncFan_1.default) {
                    this.registeredDevices.push(new VeSyncPurAccessory_1.default(this, existingAccessory, additional));
                }
                else if (device instanceof VeSyncHumidifier_1.default) {
                    this.registeredDevices.push(new VeSyncHumAccessory_1.default(this, existingAccessory));
                }
                return;
            }
            this.log.info('Adding new accessory:', name);
            const accessory = new this.api.platformAccessory(name, uuid);
            accessory.context = {
                name,
                device
            };
            if (device instanceof VeSyncFan_1.default) {
                this.registeredDevices.push(new VeSyncPurAccessory_1.default(this, accessory, additional));
            }
            else if (device instanceof VeSyncHumidifier_1.default) {
                this.registeredDevices.push(new VeSyncHumAccessory_1.default(this, accessory));
            }
            return this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [
                accessory
            ]);
        }
        catch (error) {
            this.log.error(`Error for device: ${device.name}:${device.uuid} | ${error === null || error === void 0 ? void 0 : error.message}`);
            return null;
        }
    }
    checkOldDevices() {
        const registeredDevices = this.registeredDevices.reduce((acc, device) => ({
            ...acc,
            [device.UUID]: true
        }), {});
        const additionalAccessories = this.cachedAdditional.reduce((acc, device) => {
            var _a, _b;
            return ({
                ...acc,
                [(_a = device.context.parent) !== null && _a !== void 0 ? _a : '']: [
                    ...(acc[(_b = device.context.parent) !== null && _b !== void 0 ? _b : ''] || []),
                    device
                ]
            });
        }, {});
        this.cachedAccessories.forEach((accessory) => {
            try {
                const exists = registeredDevices[accessory.UUID];
                const additional = additionalAccessories[accessory.UUID];
                if (!exists) {
                    this.log.info('Remove cached accessory:', accessory.displayName);
                    this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [
                        accessory,
                        ...(additional ? additional : [])
                    ]);
                }
            }
            catch (error) {
                this.log.error(`Error for device: ${accessory.displayName} | ${error === null || error === void 0 ? void 0 : error.message}`);
            }
        });
    }
    loadAdditional(device) {
        var _a;
        const { uuid, name } = device;
        const features = ((_a = this.config.experimentalFeatures) === null || _a === void 0 ? void 0 : _a.reduce((acc, feature) => ({ ...acc, [feature]: 1 }), {})) || {};
        const additionalAccessories = this.cachedAdditional.reduce((acc, additional) => {
            const context = additional.context;
            if (context.parent === uuid) {
                return {
                    ...acc,
                    [context.type]: additional
                };
            }
            return acc;
        }, {});
        if (!additionalAccessories[VeSyncAdditionalType.Sensor] && device.deviceType.hasAirQuality) {
            additionalAccessories[VeSyncAdditionalType.Sensor] = new this.api.platformAccessory(`${name} Sensor`, this.api.hap.uuid.generate(`${uuid}-sensor`));
            additionalAccessories[VeSyncAdditionalType.Sensor].context = {
                name: `${name} Sensor`,
                parent: uuid,
                type: VeSyncAdditionalType.Sensor
            };
            this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [
                additionalAccessories[VeSyncAdditionalType.Sensor]
            ]);
        }
        else if (additionalAccessories[VeSyncAdditionalType.Sensor] && !device.deviceType.hasAirQuality) {
            this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [
                additionalAccessories[VeSyncAdditionalType.Sensor]
            ]);
            delete additionalAccessories[VeSyncAdditionalType.Sensor];
        }
        if (features[types_1.ExperimentalFeatures.DeviceDisplay] && !additionalAccessories[VeSyncAdditionalType.Light]) {
            additionalAccessories[VeSyncAdditionalType.Light] = new this.api.platformAccessory(`${name} Display`, this.api.hap.uuid.generate(`${uuid}-light`));
            additionalAccessories[VeSyncAdditionalType.Light].context = {
                name: `${name} Display`,
                parent: uuid,
                type: VeSyncAdditionalType.Light
            };
            this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [
                additionalAccessories[VeSyncAdditionalType.Light]
            ]);
        }
        else if (!features[types_1.ExperimentalFeatures.DeviceDisplay] && additionalAccessories[VeSyncAdditionalType.Light]) {
            this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [
                additionalAccessories[VeSyncAdditionalType.Light]
            ]);
            delete additionalAccessories[VeSyncAdditionalType.Light];
        }
        return additionalAccessories;
    }
}
exports.default = Platform;
//# sourceMappingURL=platform.js.map