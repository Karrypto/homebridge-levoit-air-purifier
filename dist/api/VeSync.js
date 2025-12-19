"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HumidifierBypassMethod = exports.BypassMethod = void 0;
const axios_1 = __importDefault(require("axios"));
const async_lock_1 = __importDefault(require("async-lock"));
const crypto_1 = __importDefault(require("crypto"));
const deviceTypes_1 = __importStar(require("./deviceTypes"));
const VeSyncHumidifier_1 = __importDefault(require("./VeSyncHumidifier"));
const VeSyncFan_1 = __importDefault(require("./VeSyncFan"));
var BypassMethod;
(function (BypassMethod) {
    BypassMethod["STATUS"] = "getPurifierStatus";
    BypassMethod["MODE"] = "setPurifierMode";
    BypassMethod["NIGHT"] = "setNightLight";
    BypassMethod["DISPLAY"] = "setDisplay";
    BypassMethod["LOCK"] = "setChildLock";
    BypassMethod["SWITCH"] = "setSwitch";
    BypassMethod["SPEED"] = "setLevel";
})(BypassMethod || (exports.BypassMethod = BypassMethod = {}));
var HumidifierBypassMethod;
(function (HumidifierBypassMethod) {
    HumidifierBypassMethod["HUMIDITY"] = "setTargetHumidity";
    HumidifierBypassMethod["STATUS"] = "getHumidifierStatus";
    HumidifierBypassMethod["MIST_LEVEL"] = "setVirtualLevel";
    HumidifierBypassMethod["MODE"] = "setHumidityMode";
    HumidifierBypassMethod["DISPLAY"] = "setDisplay";
    HumidifierBypassMethod["SWITCH"] = "setSwitch";
    HumidifierBypassMethod["LEVEL"] = "setLevel";
})(HumidifierBypassMethod || (exports.HumidifierBypassMethod = HumidifierBypassMethod = {}));
const lock = new async_lock_1.default();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Retry-Logik mit exponential backoff
const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000, retryableErrors) => {
    var _a, _b, _c;
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            const statusCode = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status;
            const errorCode = (_c = (_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.code;
            // Prüfe ob Fehler retrybar ist
            const isRetryable = statusCode === 429 || // Rate Limiting
                statusCode === 503 || // Service Unavailable
                statusCode === 502 || // Bad Gateway
                statusCode === 504 || // Gateway Timeout
                (statusCode >= 500 && statusCode < 600) || // Server Errors
                (retryableErrors && retryableErrors.includes(errorCode)) ||
                (error === null || error === void 0 ? void 0 : error.code) === 'ECONNRESET' ||
                (error === null || error === void 0 ? void 0 : error.code) === 'ETIMEDOUT' ||
                (error === null || error === void 0 ? void 0 : error.code) === 'ENOTFOUND';
            if (!isRetryable || attempt === maxRetries) {
                throw error;
            }
            // Exponential backoff: baseDelay * 2^attempt
            const delayMs = baseDelay * Math.pow(2, attempt);
            await delay(delayMs);
        }
    }
    throw lastError;
};
const isTokenInvalidCode = (code) => code === -11012001 || code === -11012002;
class VeSync {
    get AXIOS_OPTIONS() {
        return {
            baseURL: this.baseURL,
            timeout: 30000
        };
    }
    constructor(email, password, debugMode, log, options = {}) {
        var _a, _b, _c, _d, _e;
        this.email = email;
        this.password = password;
        this.debugMode = debugMode;
        this.log = log;
        this.options = options;
        this.TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        // Wir imitieren für die API bewusst ein Android-Device-Fingerprint, da VeSync Server teilweise nach Client-Typ gatekeept.
        this.OS = 'Android';
        this.LANG = 'en';
        this.APP_VERSION = (_a = this.options.appVersion) !== null && _a !== void 0 ? _a : '5.7.60';
        this.COUNTRY_CODE = ((_b = this.options.countryCode) !== null && _b !== void 0 ? _b : 'US').toUpperCase();
        // Stabile Device-ID: wenn nicht gesetzt, deterministisch aus der E-Mail ableiten,
        // damit sich die "Device Identität" über Neustarts nicht ändert.
        const emailKey = ((_c = this.email) !== null && _c !== void 0 ? _c : '').trim().toLowerCase();
        const hex = crypto_1.default.createHash('md5').update(emailKey).digest('hex'); // 32 chars
        // Einige Backends akzeptieren hier nur ein "Token"-Format ohne Trennzeichen.
        this.DEVICE_ID = (_d = this.options.deviceId) !== null && _d !== void 0 ? _d : hex;
        this.AGENT = `VeSync/VeSync ${this.APP_VERSION}(F5321;HomeBridge-VeSync)`;
        // Endpoint-Handling: EU-Accounts laufen i. d. R. über smartapi.vesync.eu
        this.baseURL = (_e = this.options.baseURL) !== null && _e !== void 0 ? _e : (this.isEuCountryCode(this.COUNTRY_CODE)
            ? 'https://smartapi.vesync.eu'
            : 'https://smartapi.vesync.com');
    }
    isEuCountryCode(countryCode) {
        // Basierend auf TSVESync Doku: EU Accounts => smartapi.vesync.eu
        // (siehe https://github.com/mickgiles/homebridge-tsvesync)
        const euLike = new Set([
            // EU27
            'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
            // EEA/Europe often routed to EU endpoint
            'GB', 'NO', 'IS', 'LI', 'CH'
        ]);
        return euLike.has((countryCode !== null && countryCode !== void 0 ? countryCode : '').toUpperCase());
    }
    getAlternateBaseURL() {
        return this.baseURL.includes('vesync.eu')
            ? 'https://smartapi.vesync.com'
            : 'https://smartapi.vesync.eu';
    }
    generateDetailBody() {
        return {
            appVersion: this.APP_VERSION,
            // VeSync erwartet hier in der Praxis mobile-like Felder
            phoneBrand: 'samsung',
            // traceId als String, da einige Backends bei Number-Format "illegal argument" liefern
            traceId: String(Date.now()),
            phoneOS: this.OS
        };
    }
    generateBody(includeAuth = false) {
        return {
            acceptLanguage: this.LANG,
            timeZone: this.TIMEZONE,
            ...(includeAuth
                ? {
                    accountID: this.accountId,
                    token: this.token
                }
                : {})
        };
    }
    generateV2Body(fan, method, data = {}) {
        return {
            method: 'bypassV2',
            debugMode: false,
            deviceRegion: fan.region,
            cid: fan.cid,
            configModule: fan.configModule,
            payload: {
                data: {
                    ...data
                },
                method,
                source: 'APP'
            }
        };
    }
    async sendCommand(fan, method, body = {}) {
        return lock.acquire('api-call', async () => {
            var _a, _b, _c, _d, _e;
            try {
                if (!this.api) {
                    throw new Error('The user is not logged in!');
                }
                this.debugMode.debug('[SEND COMMAND]', `Sending command ${method} to ${fan.name}`, `with (${JSON.stringify(body)})...`);
                // WICHTIG: Kein rekursiver Aufruf innerhalb des Locks (Deadlock-Risiko).
                for (let attempt = 0; attempt < 2; attempt++) {
                    const response = await retryWithBackoff(() => this.api.put('cloud/v2/deviceManaged/bypassV2', {
                        ...this.generateV2Body(fan, method, body),
                        ...this.generateDetailBody(),
                        ...this.generateBody(true)
                    }), 3, // maxRetries
                    1000 // baseDelay
                    );
                    if (!(response === null || response === void 0 ? void 0 : response.data)) {
                        this.debugMode.debug('[SEND COMMAND]', 'No response data!! JSON:', JSON.stringify(response));
                        return false;
                    }
                    const isSuccess = ((_a = response === null || response === void 0 ? void 0 : response.data) === null || _a === void 0 ? void 0 : _a.code) === 0;
                    if (isSuccess) {
                        await delay(500);
                        return true;
                    }
                    const errorMsg = ((_b = response === null || response === void 0 ? void 0 : response.data) === null || _b === void 0 ? void 0 : _b.msg) || 'Unknown error';
                    const errorCode = (_c = response === null || response === void 0 ? void 0 : response.data) === null || _c === void 0 ? void 0 : _c.code;
                    // Bei Token-Fehlern: EINMAL Re-Login und erneut versuchen (ohne Rekursion/Lock-Reentry)
                    if (isTokenInvalidCode(errorCode) && attempt === 0) {
                        this.debugMode.debug('[SEND COMMAND]', 'Token expired, attempting re-login...');
                        const loginSuccess = await this.loginInternal();
                        if (loginSuccess) {
                            continue;
                        }
                    }
                    this.debugMode.debug('[SEND COMMAND]', `Failed to send command ${method} to ${fan.name}`, `with (${JSON.stringify(body)})!`, `Response: ${JSON.stringify(response.data)}`);
                    this.log.error(`Failed to send command ${method} to ${fan.name}: ${errorMsg} (Code: ${errorCode})`);
                    await delay(500);
                    return false;
                }
                return false;
            }
            catch (error) {
                const statusCode = (_d = error === null || error === void 0 ? void 0 : error.response) === null || _d === void 0 ? void 0 : _d.status;
                const errorMessage = ((_e = error === null || error === void 0 ? void 0 : error.response) === null || _e === void 0 ? void 0 : _e.data)
                    ? JSON.stringify(error.response.data)
                    : (error === null || error === void 0 ? void 0 : error.message) || 'Unknown error';
                // Rate Limiting Fehler separat behandeln
                if (statusCode === 429) {
                    this.log.warn(`Rate limit erreicht für ${fan === null || fan === void 0 ? void 0 : fan.name}. Bitte warten...`);
                }
                else {
                    this.log.error(`Failed to send command ${method} to ${fan === null || fan === void 0 ? void 0 : fan.name}`, `Error: ${errorMessage}`);
                }
                this.debugMode.debug('[SEND COMMAND]', 'Error details:', errorMessage);
                return false;
            }
        });
    }
    async getDeviceInfo(fan, humidifier = false) {
        return lock.acquire('api-call', async () => {
            var _a, _b;
            try {
                if (!this.api) {
                    throw new Error('The user is not logged in!');
                }
                this.debugMode.debug('[GET DEVICE INFO]', 'Getting device info...');
                // Kein rekursiver Aufruf innerhalb des Locks (Deadlock-Risiko).
                for (let attempt = 0; attempt < 2; attempt++) {
                    const response = await retryWithBackoff(() => this.api.post('cloud/v2/deviceManaged/bypassV2', {
                        ...this.generateV2Body(fan, humidifier ? HumidifierBypassMethod.STATUS : BypassMethod.STATUS),
                        ...this.generateDetailBody(),
                        ...this.generateBody(true)
                    }), 3, // maxRetries
                    1000 // baseDelay
                    );
                    if (!(response === null || response === void 0 ? void 0 : response.data)) {
                        this.debugMode.debug('[GET DEVICE INFO]', 'No response data!! JSON:', JSON.stringify(response));
                        return null;
                    }
                    // Prüfe auf API-Fehler
                    if (response.data.code !== 0 && response.data.code !== undefined) {
                        const errorMsg = response.data.msg || 'Unknown error';
                        const errorCode = response.data.code;
                        this.debugMode.debug('[GET DEVICE INFO]', `API error: ${errorMsg} (Code: ${errorCode})`, JSON.stringify(response.data));
                        if (isTokenInvalidCode(errorCode) && attempt === 0) {
                            this.debugMode.debug('[GET DEVICE INFO]', 'Token expired, attempting re-login...');
                            const loginSuccess = await this.loginInternal();
                            if (loginSuccess) {
                                continue;
                            }
                        }
                        return null;
                    }
                    await delay(500);
                    this.debugMode.debug('[GET DEVICE INFO]', 'JSON:', JSON.stringify(response.data));
                    return response.data;
                }
                return null;
            }
            catch (error) {
                const statusCode = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status;
                const errorMessage = ((_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.data)
                    ? JSON.stringify(error.response.data)
                    : (error === null || error === void 0 ? void 0 : error.message) || 'Unknown error';
                // Rate Limiting Fehler separat behandeln
                if (statusCode === 429) {
                    this.log.warn(`Rate limit erreicht beim Abrufen von Geräteinformationen für ${fan === null || fan === void 0 ? void 0 : fan.name}. Bitte warten...`);
                }
                else {
                    this.log.error(`Failed to get device info for ${fan === null || fan === void 0 ? void 0 : fan.name}`, `Error: ${errorMessage}`);
                }
                this.debugMode.debug('[GET DEVICE INFO]', 'Error details:', errorMessage);
                return null;
            }
        });
    }
    async startSession() {
        this.debugMode.debug('[START SESSION]', 'Starting auth session...');
        const firstLoginSuccess = await this.login();
        // Stoppe vorhandenes Interval, falls vorhanden
        if (this.loginInterval) {
            clearInterval(this.loginInterval);
        }
        // Token alle 55 Minuten erneuern (Token ist 60 Minuten gültig)
        this.loginInterval = setInterval(async () => {
            this.debugMode.debug('[TOKEN REFRESH]', 'Refreshing token...');
            await this.login();
        }, 1000 * 60 * 55);
        return firstLoginSuccess;
    }
    stopSession() {
        if (this.loginInterval) {
            clearInterval(this.loginInterval);
            this.loginInterval = undefined;
            this.debugMode.debug('[STOP SESSION]', 'Session stopped');
        }
    }
    async login() {
        return lock.acquire('api-call', async () => this.loginInternal());
    }
    /**
     * Login ohne Lock.acquire – nur aufrufen, wenn das Lock bereits gehalten wird.
     * (Wichtig, um Deadlocks bei Token-Refresh innerhalb anderer API-Calls zu vermeiden.)
     */
    async loginInternal() {
        var _a, _b, _c;
        try {
            if (!this.email || !this.password) {
                throw new Error('Email and password are required');
            }
            this.debugMode.debug('[LOGIN]', 'Logging in...');
            const pwdHashed = crypto_1.default
                .createHash('md5')
                .update(this.password)
                .digest('hex');
            // Manche Accounts schlagen fehl, wenn man den falschen regionalen Endpoint nutzt.
            // Daher: erst aktueller baseURL, bei bestimmten Fehlern einmal den Alternate probieren.
            const tryLoginOnce = async () => {
                return axios_1.default.post('cloud/v1/user/login', {
                    email: this.email,
                    password: pwdHashed,
                    // devToken muss beim Login leer sein; einige Backends lehnen self-generated IDs ab.
                    devToken: '',
                    userType: 1,
                    method: 'login',
                    token: '',
                    ...this.generateDetailBody(),
                    ...this.generateBody()
                }, {
                    ...this.AXIOS_OPTIONS,
                    // Auch beim Login die erwarteten Header setzen (einige Backends prüfen appversion/user-agent bereits hier).
                    headers: {
                        'content-type': 'application/json',
                        'accept-language': this.LANG,
                        'user-agent': this.AGENT,
                        appversion: this.APP_VERSION,
                        tz: this.TIMEZONE,
                    }
                });
            };
            let response = await tryLoginOnce();
            if (!(response === null || response === void 0 ? void 0 : response.data)) {
                this.debugMode.debug('[LOGIN]', 'No response data!! JSON:', JSON.stringify(response));
                return false;
            }
            // Prüfe auf API-Fehler
            if (response.data.code !== 0 && response.data.code !== undefined) {
                // Fallback: auf anderen Endpoint wechseln und nochmals versuchen
                // (VeSync liefert hier oft generische Fehlertexte, auch wenn eigentlich Region falsch ist)
                const code = response.data.code;
                if (code === -11012022) {
                    const alternate = this.getAlternateBaseURL();
                    if (alternate !== this.baseURL) {
                        this.debugMode.debug('[LOGIN]', `Retrying login on alternate endpoint: ${alternate}`);
                        this.baseURL = alternate;
                        response = await tryLoginOnce();
                    }
                }
                if (((_a = response === null || response === void 0 ? void 0 : response.data) === null || _a === void 0 ? void 0 : _a.code) !== 0 && ((_b = response === null || response === void 0 ? void 0 : response.data) === null || _b === void 0 ? void 0 : _b.code) !== undefined) {
                    this.debugMode.debug('[LOGIN]', 'The authentication failed!! JSON:', JSON.stringify(response.data));
                    this.log.error(`Login failed: ${response.data.msg || 'Unknown error'} (Code: ${response.data.code})`);
                    return false;
                }
            }
            const { result } = response.data;
            const { token, accountID } = result !== null && result !== void 0 ? result : {};
            if (!token || !accountID) {
                this.debugMode.debug('[LOGIN]', 'The authentication failed!! JSON:', JSON.stringify(response.data));
                this.log.error('Login failed: Missing token or accountID');
                return false;
            }
            this.debugMode.debug('[LOGIN]', 'The authentication success');
            this.accountId = accountID;
            this.token = token;
            this.api = axios_1.default.create({
                ...this.AXIOS_OPTIONS,
                headers: {
                    'content-type': 'application/json',
                    'accept-language': this.LANG,
                    accountid: this.accountId,
                    'user-agent': this.AGENT,
                    appversion: this.APP_VERSION,
                    tz: this.TIMEZONE,
                    tk: this.token
                }
            });
            await delay(500);
            return true;
        }
        catch (error) {
            const errorMessage = ((_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.data)
                ? JSON.stringify(error.response.data)
                : (error === null || error === void 0 ? void 0 : error.message) || 'Unknown error';
            this.log.error('Failed to login', `Error: ${errorMessage}`);
            this.debugMode.debug('[LOGIN]', 'Login error details:', errorMessage);
            return false;
        }
    }
    async getDevices() {
        return lock.acquire('api-call', async () => {
            var _a, _b, _c, _d, _e;
            try {
                if (!this.api) {
                    throw new Error('The user is not logged in!');
                }
                for (let attempt = 0; attempt < 2; attempt++) {
                    const response = await retryWithBackoff(() => this.api.post('cloud/v2/deviceManaged/devices', {
                        method: 'devices',
                        pageNo: 1,
                        pageSize: 1000,
                        ...this.generateDetailBody(),
                        ...this.generateBody(true)
                    }), 3, // maxRetries
                    1000 // baseDelay
                    );
                    if (!(response === null || response === void 0 ? void 0 : response.data)) {
                        this.debugMode.debug('[GET DEVICES]', 'No response data!! JSON:', JSON.stringify(response));
                        return {
                            purifiers: [],
                            humidifiers: []
                        };
                    }
                    // Prüfe auf API-Fehler
                    if (response.data.code !== 0 && response.data.code !== undefined) {
                        const errorMsg = response.data.msg || 'Unknown error';
                        const errorCode = response.data.code;
                        this.debugMode.debug('[GET DEVICES]', `API error: ${errorMsg} (Code: ${errorCode})`, JSON.stringify(response.data));
                        if (isTokenInvalidCode(errorCode) && attempt === 0) {
                            this.debugMode.debug('[GET DEVICES]', 'Token expired, attempting re-login...');
                            const loginSuccess = await this.loginInternal();
                            if (loginSuccess) {
                                continue;
                            }
                        }
                        return {
                            purifiers: [],
                            humidifiers: []
                        };
                    }
                    if (!Array.isArray((_b = (_a = response.data) === null || _a === void 0 ? void 0 : _a.result) === null || _b === void 0 ? void 0 : _b.list)) {
                        this.debugMode.debug('[GET DEVICES]', 'No list found!! JSON:', JSON.stringify(response.data));
                        return {
                            purifiers: [],
                            humidifiers: []
                        };
                    }
                    const { list } = (_c = response.data.result) !== null && _c !== void 0 ? _c : { list: [] };
                    this.debugMode.debug('[GET DEVICES]', 'Device List -> JSON:', JSON.stringify(list));
                    let purifiers = list
                        .filter(({ deviceType, type, extension }) => !!deviceTypes_1.default.find(({ isValid }) => isValid(deviceType)) &&
                        type === 'wifi-air' &&
                        !!(extension === null || extension === void 0 ? void 0 : extension.fanSpeedLevel))
                        .map(VeSyncFan_1.default.fromResponse(this));
                    // Newer Vital purifiers
                    purifiers = purifiers.concat(list
                        .filter(({ deviceType, type, deviceProp }) => !!deviceTypes_1.default.find(({ isValid }) => isValid(deviceType)) &&
                        type === 'wifi-air' &&
                        !!deviceProp)
                        .map((fan) => ({ ...fan, extension: { ...fan.deviceProp, airQualityLevel: fan.deviceProp.AQLevel, mode: fan.deviceProp.workMode } }))
                        .map(VeSyncFan_1.default.fromResponse(this)));
                    const humidifiers = list
                        .filter(({ deviceType, type, extension }) => !!deviceTypes_1.humidifierDeviceTypes.find(({ isValid }) => isValid(deviceType)) &&
                        type === 'wifi-air' &&
                        !extension)
                        .map(VeSyncHumidifier_1.default.fromResponse(this));
                    await delay(1500);
                    return {
                        purifiers,
                        humidifiers
                    };
                }
                return {
                    purifiers: [],
                    humidifiers: []
                };
            }
            catch (error) {
                const statusCode = (_d = error === null || error === void 0 ? void 0 : error.response) === null || _d === void 0 ? void 0 : _d.status;
                const errorMessage = ((_e = error === null || error === void 0 ? void 0 : error.response) === null || _e === void 0 ? void 0 : _e.data)
                    ? JSON.stringify(error.response.data)
                    : (error === null || error === void 0 ? void 0 : error.message) || 'Unknown error';
                // Rate Limiting Fehler separat behandeln
                if (statusCode === 429) {
                    this.log.warn('Rate limit erreicht beim Abrufen der Geräteliste. Bitte warten...');
                }
                else {
                    this.log.error('Failed to get devices', `Error: ${errorMessage}`);
                }
                this.debugMode.debug('[GET DEVICES]', 'Error details:', errorMessage);
                return {
                    purifiers: [],
                    humidifiers: []
                };
            }
        });
    }
}
exports.default = VeSync;
//# sourceMappingURL=VeSync.js.map