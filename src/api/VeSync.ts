import axios, { AxiosInstance } from 'axios';
import { Logger } from 'homebridge';
import AsyncLock from 'async-lock';
import crypto from 'crypto';

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

// Retry-Logik mit exponential backoff
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

// Cross-Region und Credential Error Codes (aus tsvesync)
const CROSS_REGION_ERROR_CODES = [-11260022, -11261022];
const CREDENTIAL_ERROR_CODES = [-11201129];

export interface VeSyncClientOptions {
  appVersion?: string;
  deviceId?: string;
  countryCode?: string;
  baseURL?: string;
}

// Helper: Generiere 8-stellige alphanumerische App-ID
function generateAppId(): string {
  const chars = 'ABCDEFGHIJKLMNOPqRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Helper: Generiere 16-stellige Hex Terminal-ID
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
  private loginInterval?: ReturnType<typeof setInterval>;

  private readonly APP_VERSION: string;
  private readonly CLIENT_VERSION: string;
  private readonly COUNTRY_CODE: string;
  private baseURL: string;
  private readonly AGENT = 'okhttp/3.12.1';
  private readonly TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  private readonly OS = 'Android';
  private readonly LANG = 'en';
  private readonly PHONE_BRAND = 'SM N9005';
  private readonly CLIENT_INFO = 'SM N9005';

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
    this.APP_VERSION = this.options.appVersion ?? '5.7.16';
    this.CLIENT_VERSION = `VeSync ${this.APP_VERSION}`;
    this.COUNTRY_CODE = (this.options.countryCode ?? 'US').toUpperCase();

    // Endpoint-Handling: EU-Accounts laufen über smartapi.vesync.eu
    this.baseURL = this.options.baseURL ?? (this.isEuCountryCode(this.COUNTRY_CODE)
      ? 'https://smartapi.vesync.eu'
      : 'https://smartapi.vesync.com');
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

        this.debugMode.debug(
          '[SEND COMMAND]',
          `Sending command ${method} to ${fan.name}`,
          `with (${JSON.stringify(body)})...`
        );

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

          if (!response?.data) {
            this.debugMode.debug('[SEND COMMAND]', 'No response data!!');
            return false;
          }

          const isSuccess = response?.data?.code === 0;
          if (isSuccess) {
            await delay(500);
            return true;
          }

          const errorCode = response?.data?.code;
          if (isTokenInvalidCode(errorCode) && attempt === 0) {
            this.debugMode.debug('[SEND COMMAND]', 'Token expired, re-login...');
            const loginSuccess = await this.loginInternal();
            if (loginSuccess) continue;
          }

          this.log.error(`Failed to send command ${method}: ${response?.data?.msg} (${errorCode})`);
          return false;
        }
        return false;
      } catch (error: any) {
        const errorMessage = error?.response?.data 
          ? JSON.stringify(error.response.data)
          : error?.message || 'Unknown error';
        this.log.error(`Failed to send command ${method}`, errorMessage);
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

        this.debugMode.debug('[GET DEVICE INFO]', 'Getting device info...');

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
        const errorMessage = error?.message || 'Unknown error';
        this.log.error(`Failed to get device info for ${fan?.name}`, errorMessage);
        return null;
      }
    });
  }

  public async startSession(): Promise<boolean> {
    this.debugMode.debug('[START SESSION]', 'Starting auth session...');
    const firstLoginSuccess = await this.login();
    
    if (this.loginInterval) {
      clearInterval(this.loginInterval);
    }
    
    // Token alle 55 Minuten erneuern
    this.loginInterval = setInterval(async () => {
      this.debugMode.debug('[TOKEN REFRESH]', 'Refreshing token...');
      await this.login();
    }, 1000 * 60 * 55);
    
    return firstLoginSuccess;
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

  /**
   * Neuer 2-Schritt-Auth-Flow (wie tsvesync)
   * Step 1: authByPWDOrOTM -> authorizeCode
   * Step 2: loginByAuthorizeCode4Vesync -> token, accountID
   * Fallback: Legacy Login (/cloud/v1/user/login)
   */
  private async loginInternal(): Promise<boolean> {
    try {
      if (!this.email || !this.password) {
        throw new Error('Email and password are required');
      }

      this.debugMode.debug('[LOGIN]', 'Starting new auth flow...');

      const pwdHashed = crypto.createHash('md5').update(this.password).digest('hex');
      const appId = generateAppId();
      const terminalId = generateTerminalId();

      const authHeaders = {
        'Content-Type': 'application/json; charset=UTF-8',
        'User-Agent': this.AGENT,
        'accept-language': this.LANG,
        'appVersion': this.APP_VERSION,
        'clientVersion': this.CLIENT_VERSION
      };

      // Versuche mit aktuellem Endpoint, dann ggf. alternate
      for (const baseUrl of [this.baseURL, this.getAlternateBaseURL()]) {
        this.debugMode.debug('[LOGIN]', `Trying endpoint: ${baseUrl}`);

        // === STEP 1: Get Authorization Code ===
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

        this.debugMode.debug('[LOGIN]', 'Step 1: Getting authorization code...');

        try {
          const step1Response = await axios.post(
            `${baseUrl}/globalPlatform/api/accountAuth/v1/authByPWDOrOTM`,
            step1Body,
            { headers: authHeaders, timeout: 15000 }
          );

          if (!step1Response?.data || step1Response.data.code !== 0) {
            const code = step1Response?.data?.code;
            const msg = step1Response?.data?.msg;
            this.debugMode.debug('[LOGIN]', `Step 1 failed: ${msg} (${code})`);

            // Bei Credential-Error sofort abbrechen
            if (CREDENTIAL_ERROR_CODES.includes(code)) {
              this.log.error('Login failed: Invalid email or password');
              return false;
            }

            // Bei Cross-Region-Error: nächsten Endpoint probieren
            if (CROSS_REGION_ERROR_CODES.includes(code)) {
              this.debugMode.debug('[LOGIN]', 'Cross-region error, trying alternate endpoint...');
              continue;
            }

            // Anderer Fehler in Step 1 -> Legacy-Flow probieren
            this.debugMode.debug('[LOGIN]', 'Step 1 failed, trying legacy login...');
            return await this.loginLegacy(pwdHashed, baseUrl);
          }

          const { authorizeCode, bizToken } = step1Response.data.result || {};
          if (!authorizeCode) {
            this.debugMode.debug('[LOGIN]', 'No authorizeCode in Step 1 response');
            continue;
          }

          this.debugMode.debug('[LOGIN]', 'Step 1 success, got authorizeCode');

          // === STEP 2: Login with Authorization Code ===
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

          if (bizToken) {
            step2Body.bizToken = bizToken;
          }

          this.debugMode.debug('[LOGIN]', 'Step 2: Logging in with authorizeCode...');

          const step2Response = await axios.post(
            `${baseUrl}/user/api/accountManage/v1/loginByAuthorizeCode4Vesync`,
            step2Body,
            { headers: authHeaders, timeout: 15000 }
          );

          if (!step2Response?.data || step2Response.data.code !== 0) {
            const code = step2Response?.data?.code;
            const msg = step2Response?.data?.msg;
            this.debugMode.debug('[LOGIN]', `Step 2 failed: ${msg} (${code})`);

            if (CROSS_REGION_ERROR_CODES.includes(code)) {
              this.debugMode.debug('[LOGIN]', 'Cross-region error in Step 2, trying alternate...');
              continue;
            }

            continue;
          }

          const { token, accountID } = step2Response.data.result || {};
          if (!token || !accountID) {
            this.debugMode.debug('[LOGIN]', 'Missing token/accountID in Step 2 response');
            continue;
          }

          // Erfolg!
          this.debugMode.debug('[LOGIN]', 'Authentication successful!');
          this.baseURL = baseUrl;
          this.token = token;
          this.accountId = accountID;

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

          await delay(500);
          return true;

        } catch (error: any) {
          this.debugMode.debug('[LOGIN]', `Request error: ${error?.message}`);
          continue;
        }
      }

      // Alle Endpoints fehlgeschlagen
      this.log.error('Login failed: Could not authenticate with any endpoint');
      return false;

    } catch (error: any) {
      const errorMessage = error?.response?.data
        ? JSON.stringify(error.response.data)
        : error?.message || 'Unknown error';
      this.log.error('Login failed', errorMessage);
      this.debugMode.debug('[LOGIN]', 'Error:', errorMessage);
      return false;
    }
  }

  /**
   * Legacy Login als Fallback (wie vorher)
   */
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
        this.debugMode.debug('[LOGIN LEGACY]', 'Failed:', JSON.stringify(response?.data));
        return false;
      }

      const { token, accountID } = response.data.result || {};
      if (!token || !accountID) {
        this.debugMode.debug('[LOGIN LEGACY]', 'Missing token/accountID');
        return false;
      }

      this.debugMode.debug('[LOGIN LEGACY]', 'Success!');
      this.baseURL = baseUrl;
      this.token = token;
      this.accountId = accountID;

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
              this.debugMode.debug('[GET DEVICES]', 'Token expired, re-login...');
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

          // Newer Vital purifiers
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
        const errorMessage = error?.message || 'Unknown error';
        this.log.error('Failed to get devices', errorMessage);
        return { purifiers: [], humidifiers: [] };
      }
    });
  }
}
