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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
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
            const isRetryable = statusCode === 429 ||
                statusCode === 503 ||
                statusCode === 502 ||
                statusCode === 504 ||
                (statusCode >= 500 && statusCode < 600) ||
                (retryableErrors && retryableErrors.includes(errorCode)) ||
                (error === null || error === void 0 ? void 0 : error.code) === 'ECONNRESET' ||
                (error === null || error === void 0 ? void 0 : error.code) === 'ETIMEDOUT' ||
                (error === null || error === void 0 ? void 0 : error.code) === 'ENOTFOUND';
            if (!isRetryable || attempt === maxRetries) {
                throw error;
            }
            const delayMs = baseDelay * Math.pow(2, attempt);
            await delay(delayMs);
        }
    }
    throw lastError;
};
const isTokenInvalidCode = (code) => code === -11012001 || code === -11012002;
const CROSS_REGION_ERROR_CODES = [-11260022, -11261022];
const CREDENTIAL_ERROR_CODES = [-11201129];
function generateAppId() {
    const chars = 'ABCDEFGHIJKLMNOPqRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
function generateTerminalId() {
    const chars = 'abcdef0123456789';
    let result = '';
    for (let i = 0; i < 16; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
class VeSync {
    get AXIOS_OPTIONS() {
        return {
            baseURL: this.baseURL,
            timeout: 30000
        };
    }
    constructor(email, password, debugMode, log, options = {}) {
        var _a;
        this.email = email;
        this.password = password;
        this.debugMode = debugMode;
        this.log = log;
        this.options = options;
        this.APP_VERSION = '5.7.16';
        this.CLIENT_VERSION = `VeSync ${this.APP_VERSION}`;
        this.AGENT = 'okhttp/3.12.1';
        this.TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
        this.OS = 'Android';
        this.LANG = 'en';
        this.PHONE_BRAND = 'SM N9005';
        this.CLIENT_INFO = 'SM N9005';
        this.COUNTRY_CODE = ((_a = this.options.countryCode) !== null && _a !== void 0 ? _a : 'US').toUpperCase();
        this.baseURL = this.isEuCountryCode(this.COUNTRY_CODE)
            ? 'https://smartapi.vesync.eu'
            : 'https://smartapi.vesync.com';
        // Token Persistence: Speicherpfad für Session
        if (this.options.storagePath) {
            this.sessionFilePath = path.join(this.options.storagePath, '.vesync-session.json');
        }
    }
    isEuCountryCode(countryCode) {
        const euLike = new Set([
            'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
            'GB', 'NO', 'IS', 'LI', 'CH'
        ]);
        return euLike.has((countryCode !== null && countryCode !== void 0 ? countryCode : '').toUpperCase());
    }
    getAlternateBaseURL() {
        return this.baseURL.includes('vesync.eu')
            ? 'https://smartapi.vesync.com'
            : 'https://smartapi.vesync.eu';
    }
    // === Token Persistence ===
    loadPersistedSession() {
        if (!this.sessionFilePath)
            return null;
        try {
            if (fs.existsSync(this.sessionFilePath)) {
                const data = fs.readFileSync(this.sessionFilePath, 'utf8');
                const session = JSON.parse(data);
                // Prüfe ob Token noch gültig (mit 5 Minuten Puffer)
                if (session.expiresAt && Date.now() > (session.expiresAt - 5 * 60 * 1000)) {
                    this.debugMode.debug('[SESSION]', 'Persisted session expired, will login fresh');
                    return null;
                }
                this.debugMode.debug('[SESSION]', 'Loaded persisted session');
                return session;
            }
        }
        catch (error) {
            this.debugMode.debug('[SESSION]', 'Failed to load persisted session:', error === null || error === void 0 ? void 0 : error.message);
        }
        return null;
    }
    saveSession() {
        if (!this.sessionFilePath || !this.token || !this.accountId)
            return;
        try {
            const session = {
                token: this.token,
                accountId: this.accountId,
                baseURL: this.baseURL,
                expiresAt: this.tokenExpiresAt
            };
            fs.writeFileSync(this.sessionFilePath, JSON.stringify(session), 'utf8');
            this.debugMode.debug('[SESSION]', 'Session persisted');
        }
        catch (error) {
            this.debugMode.debug('[SESSION]', 'Failed to persist session:', error === null || error === void 0 ? void 0 : error.message);
        }
    }
    clearPersistedSession() {
        if (!this.sessionFilePath)
            return;
        try {
            if (fs.existsSync(this.sessionFilePath)) {
                fs.unlinkSync(this.sessionFilePath);
            }
        }
        catch (_a) {
            // ignore
        }
    }
    generateDetailBody() {
        return {
            appVersion: this.APP_VERSION,
            phoneBrand: this.PHONE_BRAND,
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
            var _a, _b, _c;
            try {
                if (!this.api) {
                    throw new Error('The user is not logged in!');
                }
                this.debugMode.debug('[SEND COMMAND]', `${method} to ${fan.name}`);
                for (let attempt = 0; attempt < 2; attempt++) {
                    const response = await retryWithBackoff(() => this.api.put('cloud/v2/deviceManaged/bypassV2', {
                        ...this.generateV2Body(fan, method, body),
                        ...this.generateDetailBody(),
                        ...this.generateBody(true)
                    }), 3, 1000);
                    if (!(response === null || response === void 0 ? void 0 : response.data))
                        return false;
                    if (((_a = response === null || response === void 0 ? void 0 : response.data) === null || _a === void 0 ? void 0 : _a.code) === 0) {
                        await delay(500);
                        return true;
                    }
                    const errorCode = (_b = response === null || response === void 0 ? void 0 : response.data) === null || _b === void 0 ? void 0 : _b.code;
                    if (isTokenInvalidCode(errorCode) && attempt === 0) {
                        this.debugMode.debug('[SEND COMMAND]', 'Token expired, re-login...');
                        this.clearPersistedSession();
                        const loginSuccess = await this.loginInternal();
                        if (loginSuccess)
                            continue;
                    }
                    this.log.error(`Command ${method} failed: ${(_c = response === null || response === void 0 ? void 0 : response.data) === null || _c === void 0 ? void 0 : _c.msg} (${errorCode})`);
                    return false;
                }
                return false;
            }
            catch (error) {
                this.log.error(`Command ${method} error:`, error === null || error === void 0 ? void 0 : error.message);
                return false;
            }
        });
    }
    async getDeviceInfo(fan, humidifier = false) {
        return lock.acquire('api-call', async () => {
            try {
                if (!this.api) {
                    throw new Error('The user is not logged in!');
                }
                this.debugMode.debug('[GET DEVICE INFO]', 'Fetching...');
                for (let attempt = 0; attempt < 2; attempt++) {
                    const response = await retryWithBackoff(() => this.api.post('cloud/v2/deviceManaged/bypassV2', {
                        ...this.generateV2Body(fan, humidifier ? HumidifierBypassMethod.STATUS : BypassMethod.STATUS),
                        ...this.generateDetailBody(),
                        ...this.generateBody(true)
                    }), 3, 1000);
                    if (!(response === null || response === void 0 ? void 0 : response.data))
                        return null;
                    if (response.data.code !== 0 && response.data.code !== undefined) {
                        const errorCode = response.data.code;
                        if (isTokenInvalidCode(errorCode) && attempt === 0) {
                            this.clearPersistedSession();
                            const loginSuccess = await this.loginInternal();
                            if (loginSuccess)
                                continue;
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
                this.log.error(`Device info error for ${fan === null || fan === void 0 ? void 0 : fan.name}:`, error === null || error === void 0 ? void 0 : error.message);
                return null;
            }
        });
    }
    async startSession() {
        this.debugMode.debug('[START SESSION]', 'Starting auth session...');
        // Versuche zuerst, gespeicherte Session zu laden
        const persisted = this.loadPersistedSession();
        if (persisted) {
            this.token = persisted.token;
            this.accountId = persisted.accountId;
            this.baseURL = persisted.baseURL;
            this.tokenExpiresAt = persisted.expiresAt;
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
            this.log.info('Reusing persisted VeSync session');
            this.debugMode.debug('[SESSION]', `Token expires: ${this.tokenExpiresAt ? new Date(this.tokenExpiresAt).toISOString() : 'unknown'}`);
        }
        else {
            const loginSuccess = await this.login();
            if (!loginSuccess)
                return false;
        }
        if (this.loginInterval) {
            clearInterval(this.loginInterval);
        }
        // Token alle 55 Minuten erneuern
        this.loginInterval = setInterval(async () => {
            this.debugMode.debug('[TOKEN REFRESH]', 'Refreshing token...');
            await this.login();
        }, 1000 * 60 * 55);
        return true;
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
    async loginInternal() {
        var _a, _b;
        try {
            if (!this.email || !this.password) {
                throw new Error('Email and password are required');
            }
            this.debugMode.debug('[LOGIN]', 'Starting new auth flow...');
            const pwdHashed = crypto_1.default.createHash('md5').update(this.password).digest('hex');
            const appId = generateAppId();
            const terminalId = generateTerminalId();
            const authHeaders = {
                'Content-Type': 'application/json; charset=UTF-8',
                'User-Agent': this.AGENT,
                'accept-language': this.LANG,
                'appVersion': this.APP_VERSION,
                'clientVersion': this.CLIENT_VERSION
            };
            for (const baseUrl of [this.baseURL, this.getAlternateBaseURL()]) {
                this.debugMode.debug('[LOGIN]', `Trying endpoint: ${baseUrl}`);
                const step1Body = {
                    email: this.email,
                    method: 'authByPWDOrOTM',
                    password: pwdHashed,
                    acceptLanguage: this.LANG,
                    accountID: '',
                    authProtocolType: 'generic',
                    clientInfo: this.CLIENT_INFO,
                    clientType: 'vesyncApp',
                    clientVersion: this.CLIENT_VERSION,
                    debugMode: false,
                    osInfo: this.OS,
                    terminalId: terminalId,
                    timeZone: this.TIMEZONE,
                    token: '',
                    userCountryCode: this.COUNTRY_CODE,
                    appID: appId,
                    sourceAppID: appId,
                    traceId: `APP${appId}${Math.floor(Date.now() / 1000)}`
                };
                try {
                    const step1Response = await axios_1.default.post(`${baseUrl}/globalPlatform/api/accountAuth/v1/authByPWDOrOTM`, step1Body, { headers: authHeaders, timeout: 15000 });
                    if (!(step1Response === null || step1Response === void 0 ? void 0 : step1Response.data) || step1Response.data.code !== 0) {
                        const code = (_a = step1Response === null || step1Response === void 0 ? void 0 : step1Response.data) === null || _a === void 0 ? void 0 : _a.code;
                        if (CREDENTIAL_ERROR_CODES.includes(code)) {
                            this.log.error('Login failed: Invalid email or password');
                            return false;
                        }
                        if (CROSS_REGION_ERROR_CODES.includes(code)) {
                            this.debugMode.debug('[LOGIN]', 'Cross-region error, trying alternate...');
                            continue;
                        }
                        return await this.loginLegacy(pwdHashed, baseUrl);
                    }
                    const { authorizeCode, bizToken } = step1Response.data.result || {};
                    if (!authorizeCode)
                        continue;
                    this.debugMode.debug('[LOGIN]', 'Step 1 success');
                    const step2Body = {
                        method: 'loginByAuthorizeCode4Vesync',
                        authorizeCode: authorizeCode,
                        acceptLanguage: this.LANG,
                        clientInfo: this.CLIENT_INFO,
                        clientType: 'vesyncApp',
                        clientVersion: this.CLIENT_VERSION,
                        debugMode: false,
                        emailSubscriptions: false,
                        osInfo: this.OS,
                        terminalId: terminalId,
                        timeZone: this.TIMEZONE,
                        userCountryCode: this.COUNTRY_CODE,
                        traceId: `APP${appId}${Math.floor(Date.now() / 1000)}`
                    };
                    if (bizToken)
                        step2Body.bizToken = bizToken;
                    const step2Response = await axios_1.default.post(`${baseUrl}/user/api/accountManage/v1/loginByAuthorizeCode4Vesync`, step2Body, { headers: authHeaders, timeout: 15000 });
                    if (!(step2Response === null || step2Response === void 0 ? void 0 : step2Response.data) || step2Response.data.code !== 0) {
                        const code = (_b = step2Response === null || step2Response === void 0 ? void 0 : step2Response.data) === null || _b === void 0 ? void 0 : _b.code;
                        if (CROSS_REGION_ERROR_CODES.includes(code))
                            continue;
                        continue;
                    }
                    const { token, accountID } = step2Response.data.result || {};
                    if (!token || !accountID)
                        continue;
                    this.debugMode.debug('[LOGIN]', 'Authentication successful!');
                    this.baseURL = baseUrl;
                    this.token = token;
                    this.accountId = accountID;
                    // Token-Ablauf berechnen (typisch 1 Jahr, aber wir refreshen alle 55 Min)
                    this.tokenExpiresAt = Date.now() + (365 * 24 * 60 * 60 * 1000);
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
                    // Session persistieren
                    this.saveSession();
                    await delay(500);
                    return true;
                }
                catch (error) {
                    this.debugMode.debug('[LOGIN]', `Request error: ${error === null || error === void 0 ? void 0 : error.message}`);
                    continue;
                }
            }
            this.log.error('Login failed: Could not authenticate with any endpoint');
            return false;
        }
        catch (error) {
            this.log.error('Login failed:', error === null || error === void 0 ? void 0 : error.message);
            return false;
        }
    }
    async loginLegacy(pwdHashed, baseUrl) {
        this.debugMode.debug('[LOGIN LEGACY]', 'Trying legacy login...');
        try {
            const response = await axios_1.default.post(`${baseUrl}/cloud/v1/user/login`, {
                email: this.email,
                password: pwdHashed,
                devToken: '',
                userType: 1,
                method: 'login',
                token: '',
                ...this.generateDetailBody(),
                ...this.generateBody()
            }, {
                headers: {
                    'content-type': 'application/json',
                    'accept-language': this.LANG,
                    'user-agent': this.AGENT,
                    appversion: this.APP_VERSION,
                    tz: this.TIMEZONE,
                },
                timeout: 15000
            });
            if (!(response === null || response === void 0 ? void 0 : response.data) || (response.data.code !== 0 && response.data.code !== undefined)) {
                return false;
            }
            const { token, accountID } = response.data.result || {};
            if (!token || !accountID)
                return false;
            this.debugMode.debug('[LOGIN LEGACY]', 'Success!');
            this.baseURL = baseUrl;
            this.token = token;
            this.accountId = accountID;
            this.tokenExpiresAt = Date.now() + (365 * 24 * 60 * 60 * 1000);
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
            this.saveSession();
            await delay(500);
            return true;
        }
        catch (error) {
            this.debugMode.debug('[LOGIN LEGACY]', 'Error:', error === null || error === void 0 ? void 0 : error.message);
            return false;
        }
    }
    async getDevices() {
        return lock.acquire('api-call', async () => {
            var _a, _b, _c;
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
                    }), 3, 1000);
                    if (!(response === null || response === void 0 ? void 0 : response.data)) {
                        return { purifiers: [], humidifiers: [] };
                    }
                    if (response.data.code !== 0 && response.data.code !== undefined) {
                        const errorCode = response.data.code;
                        if (isTokenInvalidCode(errorCode) && attempt === 0) {
                            this.clearPersistedSession();
                            const loginSuccess = await this.loginInternal();
                            if (loginSuccess)
                                continue;
                        }
                        return { purifiers: [], humidifiers: [] };
                    }
                    if (!Array.isArray((_b = (_a = response.data) === null || _a === void 0 ? void 0 : _a.result) === null || _b === void 0 ? void 0 : _b.list)) {
                        return { purifiers: [], humidifiers: [] };
                    }
                    const { list } = (_c = response.data.result) !== null && _c !== void 0 ? _c : { list: [] };
                    this.debugMode.debug('[GET DEVICES]', 'Device List:', JSON.stringify(list));
                    let purifiers = list
                        .filter(({ deviceType, type, extension }) => !!deviceTypes_1.default.find(({ isValid }) => isValid(deviceType)) &&
                        type === 'wifi-air' &&
                        !!(extension === null || extension === void 0 ? void 0 : extension.fanSpeedLevel))
                        .map(VeSyncFan_1.default.fromResponse(this));
                    purifiers = purifiers.concat(list
                        .filter(({ deviceType, type, deviceProp }) => !!deviceTypes_1.default.find(({ isValid }) => isValid(deviceType)) &&
                        type === 'wifi-air' &&
                        !!deviceProp)
                        .map((fan) => ({
                        ...fan,
                        extension: {
                            ...fan.deviceProp,
                            airQualityLevel: fan.deviceProp.AQLevel,
                            mode: fan.deviceProp.workMode
                        }
                    }))
                        .map(VeSyncFan_1.default.fromResponse(this)));
                    const humidifiers = list
                        .filter(({ deviceType, type, extension }) => !!deviceTypes_1.humidifierDeviceTypes.find(({ isValid }) => isValid(deviceType)) &&
                        type === 'wifi-air' &&
                        !extension)
                        .map(VeSyncHumidifier_1.default.fromResponse(this));
                    await delay(1500);
                    return { purifiers, humidifiers };
                }
                return { purifiers: [], humidifiers: [] };
            }
            catch (error) {
                this.log.error('Failed to get devices:', error === null || error === void 0 ? void 0 : error.message);
                return { purifiers: [], humidifiers: [] };
            }
        });
    }
}
exports.default = VeSync;
//# sourceMappingURL=VeSync.js.map