import axios, { AxiosInstance } from 'axios';
import { Logger } from 'homebridge';
import AsyncLock from 'async-lock';
import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import deviceTypes, { humidifierDeviceTypes } from './deviceTypes';
import VeSyncHumidifier from './VeSyncHumidifier';
import { VeSyncGeneric } from './VeSyncGeneric';
import DebugMode from '../debugMode';
import VeSyncFan from './VeSyncFan';

export enum BypassMethod {
  STATUS = 'getPurifierStatus',
  MODE = 'setPurifierMode',
  NIGHT = 'setNightLight',
  DISPLAY = 'setDisplay',
  LOCK = 'setChildLock',
  SWITCH = 'setSwitch',
  SPEED = 'setLevel'
}

export enum HumidifierBypassMethod {
  HUMIDITY = 'setTargetHumidity',
  STATUS = 'getHumidifierStatus',
  MIST_LEVEL = 'setVirtualLevel',
  MODE = 'setHumidityMode',
  DISPLAY = 'setDisplay',
  SWITCH = 'setSwitch',
  LEVEL = 'setLevel',
}

const lock = new AsyncLock();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000,
  retryableErrors?: number[]
): Promise<T> => {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const statusCode = error?.response?.status;
      const errorCode = error?.response?.data?.code;
      
      const isRetryable = 
        statusCode === 429 ||
        statusCode === 503 ||
        statusCode === 502 ||
        statusCode === 504 ||
        (statusCode >= 500 && statusCode < 600) ||
        (retryableErrors && retryableErrors.includes(errorCode)) ||
        error?.code === 'ECONNRESET' ||
        error?.code === 'ETIMEDOUT' ||
        error?.code === 'ENOTFOUND';
      
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      
      const delayMs = baseDelay * Math.pow(2, attempt);
      await delay(delayMs);
    }
  }
  throw lastError;
};

const isTokenInvalidCode = (code: unknown) =>
  code === -11012001 || code === -11012002;

const CROSS_REGION_ERROR_CODES = [-11260022, -11261022];
const CREDENTIAL_ERROR_CODES = [-11201129];

export interface VeSyncClientOptions {
  countryCode?: string;
  storagePath?: string;
}

interface PersistedSession {
  token: string;
  accountId: string;
  baseURL: string;
  expiresAt?: number;
  terminalId?: string;
  appId?: string;
}

function generateAppId(): string {
  const chars = 'ABCDEFGHIJKLMNOPqRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateTerminalId(): string {
  const chars = 'abcdef0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default class VeSync {
  private api?: AxiosInstance;
  private accountId?: string;
  private token?: string;
  private tokenExpiresAt?: number;
  private loginInterval?: ReturnType<typeof setInterval>;
  
  // Persistent device identifiers - prevents "new device" emails
  private terminalId?: string;
  private appId?: string;

  private readonly APP_VERSION = '5.7.16';
  private readonly CLIENT_VERSION = `VeSync ${this.APP_VERSION}`;
  private readonly COUNTRY_CODE: string;
  private baseURL: string;
  private readonly AGENT = 'okhttp/3.12.1';
  private readonly TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  private readonly OS = 'Android';
  private readonly LANG = 'en';
  private readonly PHONE_BRAND = 'SM N9005';
  private readonly CLIENT_INFO = 'SM N9005';

  private readonly sessionFilePath?: string;

  private get AXIOS_OPTIONS() {
    return {
      baseURL: this.baseURL,
      timeout: 30000
    };
  }

  constructor(
    private readonly email: string,
    private readonly password: string,
    public readonly debugMode: DebugMode,
    public readonly log: Logger,
    private readonly options: VeSyncClientOptions = {}
  ) {
    this.COUNTRY_CODE = (this.options.countryCode ?? 'US').toUpperCase();

    this.baseURL = this.isEuCountryCode(this.COUNTRY_CODE)
      ? 'https://smartapi.vesync.eu'
      : 'https://smartapi.vesync.com';

    // Token Persistence: Speicherpfad für Session
    if (this.options.storagePath) {
      this.sessionFilePath = path.join(this.options.storagePath, '.vesync-session.json');
    }
  }

  private isEuCountryCode(countryCode: string) {
    const euLike = new Set([
      'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
      'GB','NO','IS','LI','CH'
    ]);
    return euLike.has((countryCode ?? '').toUpperCase());
  }

  private getAlternateBaseURL() {
    return this.baseURL.includes('vesync.eu')
      ? 'https://smartapi.vesync.com'
      : 'https://smartapi.vesync.eu';
  }

  // === Token Persistence ===
  private loadPersistedSession(): PersistedSession | null {
    if (!this.sessionFilePath) return null;

    try {
      if (fs.existsSync(this.sessionFilePath)) {
        const data = fs.readFileSync(this.sessionFilePath, 'utf8');
        const session: PersistedSession = JSON.parse(data);
        
        // Immer terminalId und appId laden (um "neues Gerät" E-Mails zu vermeiden)
        if (session.terminalId) this.terminalId = session.terminalId;
        if (session.appId) this.appId = session.appId;
        
        // Prüfe ob Token noch gültig (mit 5 Minuten Puffer)
        if (session.expiresAt && Date.now() > (session.expiresAt - 5 * 60 * 1000)) {
          this.debugMode.debug('[SESSION]', 'Persisted session expired, will login fresh (keeping device IDs)');
          return null;
        }

        this.debugMode.debug('[SESSION]', 'Loaded persisted session');
        return session;
      }
    } catch (error: any) {
      this.debugMode.debug('[SESSION]', 'Failed to load persisted session:', error?.message);
    }
    return null;
  }

  private saveSession(): void {
    if (!this.sessionFilePath || !this.token || !this.accountId) return;

    try {
      const session: PersistedSession = {
        token: this.token,
        accountId: this.accountId,
        baseURL: this.baseURL,
        expiresAt: this.tokenExpiresAt,
        terminalId: this.terminalId,
        appId: this.appId
      };
      fs.writeFileSync(this.sessionFilePath, JSON.stringify(session), 'utf8');
      this.debugMode.debug('[SESSION]', 'Session persisted (with device IDs)');
    } catch (error: any) {
      this.debugMode.debug('[SESSION]', 'Failed to persist session:', error?.message);
    }
  }

  private clearPersistedSession(): void {
    if (!this.sessionFilePath) return;
    try {
      if (fs.existsSync(this.sessionFilePath)) {
        fs.unlinkSync(this.sessionFilePath);
      }
    } catch {
      // ignore
    }
  }

  private generateDetailBody() {
    return {
      appVersion: this.APP_VERSION,
      phoneBrand: this.PHONE_BRAND,
      traceId: String(Date.now()),
      phoneOS: this.OS
    };
  }

  private generateBody(includeAuth = false) {
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

  private generateV2Body(fan: VeSyncGeneric, method: BypassMethod | HumidifierBypassMethod, data = {}) {
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

  public async sendCommand(
    fan: VeSyncGeneric,
    method: BypassMethod | HumidifierBypassMethod,
    body = {}
  ): Promise<boolean> {
    return lock.acquire('api-call', async () => {
      try {
        if (!this.api) {
          throw new Error('The user is not logged in!');
        }

        this.debugMode.debug('[SEND COMMAND]', `${method} to ${fan.name}`);

        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await retryWithBackoff(
            () =>
              this.api!.put('cloud/v2/deviceManaged/bypassV2', {
                ...this.generateV2Body(fan, method, body),
                ...this.generateDetailBody(),
                ...this.generateBody(true)
              }),
            3,
            1000
          );

          if (!response?.data) return false;

          if (response?.data?.code === 0) {
            await delay(500);
            return true;
          }

          const errorCode = response?.data?.code;
          if (isTokenInvalidCode(errorCode) && attempt === 0) {
            this.debugMode.debug('[SEND COMMAND]', 'Token expired, re-login...');
            this.clearPersistedSession();
            const loginSuccess = await this.loginInternal();
            if (loginSuccess) continue;
          }

          this.log.error(`Command ${method} failed: ${response?.data?.msg} (${errorCode})`);
          return false;
        }
        return false;
      } catch (error: any) {
        this.log.error(`Command ${method} error:`, error?.message);
        return false;
      }
    });
  }

  public async getDeviceInfo(fan: VeSyncGeneric, humidifier = false): Promise<any> {
    return lock.acquire('api-call', async () => {
      try {
        if (!this.api) {
          throw new Error('The user is not logged in!');
        }

        this.debugMode.debug('[GET DEVICE INFO]', 'Fetching...');

        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await retryWithBackoff(
            () =>
              this.api!.post('cloud/v2/deviceManaged/bypassV2', {
                ...this.generateV2Body(
                  fan,
                  humidifier ? HumidifierBypassMethod.STATUS : BypassMethod.STATUS
                ),
                ...this.generateDetailBody(),
                ...this.generateBody(true)
              }),
            3,
            1000
          );

          if (!response?.data) return null;

          if (response.data.code !== 0 && response.data.code !== undefined) {
            const errorCode = response.data.code;
            if (isTokenInvalidCode(errorCode) && attempt === 0) {
              this.clearPersistedSession();
              const loginSuccess = await this.loginInternal();
              if (loginSuccess) continue;
            }
            return null;
          }

          await delay(500);
          this.debugMode.debug('[GET DEVICE INFO]', 'JSON:', JSON.stringify(response.data));
          return response.data;
        }
        return null;
      } catch (error: any) {
        this.log.error(`Device info error for ${fan?.name}:`, error?.message);
        return null;
      }
    });
  }

  public async startSession(): Promise<boolean> {
    this.debugMode.debug('[START SESSION]', 'Starting auth session...');

    // Versuche zuerst, gespeicherte Session zu laden
    const persisted = this.loadPersistedSession();
    if (persisted) {
      this.token = persisted.token;
      this.accountId = persisted.accountId;
      this.baseURL = persisted.baseURL;
      this.tokenExpiresAt = persisted.expiresAt;
      // Device IDs werden bereits in loadPersistedSession() geladen

      this.api = axios.create({
        ...this.AXIOS_OPTIONS,
        headers: {
          'content-type': 'application/json',
          'accept-language': this.LANG,
          accountid: this.accountId!,
          'user-agent': this.AGENT,
          appversion: this.APP_VERSION,
          tz: this.TIMEZONE,
          tk: this.token!
        }
      });

      this.log.info('Reusing persisted VeSync session (no new login required)');
      this.debugMode.debug('[SESSION]', `Token expires: ${this.tokenExpiresAt ? new Date(this.tokenExpiresAt).toISOString() : 'unknown'}`);
    } else {
      const loginSuccess = await this.login();
      if (!loginSuccess) return false;
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

  public stopSession(): void {
    if (this.loginInterval) {
      clearInterval(this.loginInterval);
      this.loginInterval = undefined;
      this.debugMode.debug('[STOP SESSION]', 'Session stopped');
    }
  }

  private async login(): Promise<boolean> {
    return lock.acquire('api-call', async () => this.loginInternal());
  }

  private async loginInternal(): Promise<boolean> {
    try {
      if (!this.email || !this.password) {
        throw new Error('Email and password are required');
      }

      this.debugMode.debug('[LOGIN]', 'Starting new auth flow...');

      const pwdHashed = crypto.createHash('md5').update(this.password).digest('hex');
      
      // Reuse existing device IDs or generate new ones (prevents "new device" emails)
      if (!this.appId) {
        this.appId = generateAppId();
        this.debugMode.debug('[LOGIN]', 'Generated new appId');
      }
      if (!this.terminalId) {
        this.terminalId = generateTerminalId();
        this.debugMode.debug('[LOGIN]', 'Generated new terminalId');
      }
      
      const appId = this.appId;
      const terminalId = this.terminalId;

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
          const step1Response = await axios.post(
            `${baseUrl}/globalPlatform/api/accountAuth/v1/authByPWDOrOTM`,
            step1Body,
            { headers: authHeaders, timeout: 15000 }
          );

          if (!step1Response?.data || step1Response.data.code !== 0) {
            const code = step1Response?.data?.code;

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
          if (!authorizeCode) continue;

          this.debugMode.debug('[LOGIN]', 'Step 1 success');

          const step2Body: Record<string, unknown> = {
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

          if (bizToken) step2Body.bizToken = bizToken;

          const step2Response = await axios.post(
            `${baseUrl}/user/api/accountManage/v1/loginByAuthorizeCode4Vesync`,
            step2Body,
            { headers: authHeaders, timeout: 15000 }
          );

          if (!step2Response?.data || step2Response.data.code !== 0) {
            const code = step2Response?.data?.code;
            if (CROSS_REGION_ERROR_CODES.includes(code)) continue;
            continue;
          }

          const { token, accountID } = step2Response.data.result || {};
          if (!token || !accountID) continue;

          this.debugMode.debug('[LOGIN]', 'Authentication successful!');
          this.baseURL = baseUrl;
          this.token = token;
          this.accountId = accountID;

          // Token-Ablauf berechnen (typisch 1 Jahr, aber wir refreshen alle 55 Min)
          this.tokenExpiresAt = Date.now() + (365 * 24 * 60 * 60 * 1000);

          this.api = axios.create({
            ...this.AXIOS_OPTIONS,
            headers: {
              'content-type': 'application/json',
              'accept-language': this.LANG,
              accountid: this.accountId!,
              'user-agent': this.AGENT,
              appversion: this.APP_VERSION,
              tz: this.TIMEZONE,
              tk: this.token!
            }
          });

          // Session persistieren
          this.saveSession();

          await delay(500);
          return true;

        } catch (error: any) {
          this.debugMode.debug('[LOGIN]', `Request error: ${error?.message}`);
          continue;
        }
      }

      this.log.error('Login failed: Could not authenticate with any endpoint');
      return false;

    } catch (error: any) {
      this.log.error('Login failed:', error?.message);
      return false;
    }
  }

  private async loginLegacy(pwdHashed: string, baseUrl: string): Promise<boolean> {
    this.debugMode.debug('[LOGIN LEGACY]', 'Trying legacy login...');

    try {
      const response = await axios.post(
        `${baseUrl}/cloud/v1/user/login`,
        {
          email: this.email,
          password: pwdHashed,
          devToken: '',
          userType: 1,
          method: 'login',
          token: '',
          ...this.generateDetailBody(),
          ...this.generateBody()
        },
        {
          headers: {
            'content-type': 'application/json',
            'accept-language': this.LANG,
            'user-agent': this.AGENT,
            appversion: this.APP_VERSION,
            tz: this.TIMEZONE,
          },
          timeout: 15000
        }
      );

      if (!response?.data || (response.data.code !== 0 && response.data.code !== undefined)) {
        return false;
      }

      const { token, accountID } = response.data.result || {};
      if (!token || !accountID) return false;

      this.debugMode.debug('[LOGIN LEGACY]', 'Success!');
      this.baseURL = baseUrl;
      this.token = token;
      this.accountId = accountID;
      this.tokenExpiresAt = Date.now() + (365 * 24 * 60 * 60 * 1000);

      this.api = axios.create({
        ...this.AXIOS_OPTIONS,
        headers: {
          'content-type': 'application/json',
          'accept-language': this.LANG,
          accountid: this.accountId!,
          'user-agent': this.AGENT,
          appversion: this.APP_VERSION,
          tz: this.TIMEZONE,
          tk: this.token!
        }
      });

      this.saveSession();

      await delay(500);
      return true;

    } catch (error: any) {
      this.debugMode.debug('[LOGIN LEGACY]', 'Error:', error?.message);
      return false;
    }
  }

  public async getDevices() {
    return lock.acquire<{
      purifiers: VeSyncFan[];
      humidifiers: VeSyncHumidifier[];
    }>('api-call', async () => {
      try {
        if (!this.api) {
          throw new Error('The user is not logged in!');
        }

        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await retryWithBackoff(
            () =>
              this.api!.post('cloud/v2/deviceManaged/devices', {
                method: 'devices',
                pageNo: 1,
                pageSize: 1000,
                ...this.generateDetailBody(),
                ...this.generateBody(true)
              }),
            3,
            1000
          );

          if (!response?.data) {
            return { purifiers: [], humidifiers: [] };
          }

          if (response.data.code !== 0 && response.data.code !== undefined) {
            const errorCode = response.data.code;
            if (isTokenInvalidCode(errorCode) && attempt === 0) {
              this.clearPersistedSession();
              const loginSuccess = await this.loginInternal();
              if (loginSuccess) continue;
            }
            return { purifiers: [], humidifiers: [] };
          }

          if (!Array.isArray(response.data?.result?.list)) {
            return { purifiers: [], humidifiers: [] };
          }

          const { list } = response.data.result ?? { list: [] };

          this.debugMode.debug('[GET DEVICES]', 'Device List:', JSON.stringify(list));

          let purifiers = list
            .filter(
              ({ deviceType, type, extension }) =>
                !!deviceTypes.find(({ isValid }) => isValid(deviceType)) &&
                type === 'wifi-air' &&
                !!extension?.fanSpeedLevel
            )
            .map(VeSyncFan.fromResponse(this));

          purifiers = purifiers.concat(list
            .filter(
              ({ deviceType, type, deviceProp }) =>
                !!deviceTypes.find(({ isValid }) => isValid(deviceType)) &&
                type === 'wifi-air' &&
                !!deviceProp
            )
            .map((fan: any) => ({
              ...fan,
              extension: {
                ...fan.deviceProp,
                airQualityLevel: fan.deviceProp.AQLevel,
                mode: fan.deviceProp.workMode
              }
            }))
            .map(VeSyncFan.fromResponse(this)));

          const humidifiers = list
            .filter(
              ({ deviceType, type, extension }) =>
                !!humidifierDeviceTypes.find(({ isValid }) => isValid(deviceType)) &&
                type === 'wifi-air' &&
                !extension
            )
            .map(VeSyncHumidifier.fromResponse(this));

          await delay(1500);

          return { purifiers, humidifiers };
        }

        return { purifiers: [], humidifiers: [] };
      } catch (error: any) {
        this.log.error('Failed to get devices:', error?.message);
        return { purifiers: [], humidifiers: [] };
      }
    });
  }
}
