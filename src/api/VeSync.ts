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
      
      // Prüfe ob Fehler retrybar ist
      const isRetryable = 
        statusCode === 429 || // Rate Limiting
        statusCode === 503 || // Service Unavailable
        statusCode === 502 || // Bad Gateway
        statusCode === 504 || // Gateway Timeout
        (statusCode >= 500 && statusCode < 600) || // Server Errors
        (retryableErrors && retryableErrors.includes(errorCode)) ||
        error?.code === 'ECONNRESET' ||
        error?.code === 'ETIMEDOUT' ||
        error?.code === 'ENOTFOUND';
      
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

const isTokenInvalidCode = (code: unknown) =>
  code === -11012001 || code === -11012002;

export interface VeSyncClientOptions {
  /** Override für die VeSync App-Version (Server-Gatekeeping). */
  appVersion?: string;
  /** Stabile Device-ID / devToken (einige Backends verlangen das beim Login). */
  deviceId?: string;
  /** Country Code (wichtig für internationale Accounts; EU-Accounts laufen i. d. R. über smartapi.vesync.eu). */
  countryCode?: string;
  /** Optional: Endpoint override, z.B. https://smartapi.vesync.eu */
  baseURL?: string;
}

export default class VeSync {
  private api?: AxiosInstance;
  private accountId?: string;
  private token?: string;
  private loginInterval?: ReturnType<typeof setInterval>;

  // VeSync Server blockiert gelegentlich zu alte appVersion Werte ("app version is too low").
  // Daher nutzen wir hier eine "moderne" App-Version als Kompatibilitätswert.
  private readonly APP_VERSION: string;
  private readonly DEVICE_ID: string;
  private readonly COUNTRY_CODE: string;
  private baseURL: string;
  // WICHTIG: VeSync validiert die App-Version offenbar auch (oder primär) über den User-Agent Prefix `VeSync/VeSync <version>`.
  // Daher muss hier ebenfalls eine "moderne" App-Version stehen, sonst kommt `app version is too low`.
  private readonly AGENT: string;
  private readonly TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  // Wir imitieren für die API bewusst ein Android-Device-Fingerprint, da VeSync Server teilweise nach Client-Typ gatekeept.
  private readonly OS = 'Android';
  private readonly LANG = 'en';

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
    this.APP_VERSION = this.options.appVersion ?? '5.7.60';
    this.COUNTRY_CODE = (this.options.countryCode ?? 'US').toUpperCase();

    // Stabile Device-ID: wenn nicht gesetzt, deterministisch aus der E-Mail ableiten,
    // damit sich die "Device Identität" über Neustarts nicht ändert.
    const emailKey = (this.email ?? '').trim().toLowerCase();
    const hex = crypto.createHash('md5').update(emailKey).digest('hex'); // 32 chars
    // Einige Backends akzeptieren hier nur ein "Token"-Format ohne Trennzeichen.
    this.DEVICE_ID = this.options.deviceId ?? hex;

    this.AGENT = `VeSync/VeSync ${this.APP_VERSION}(F5321;HomeBridge-VeSync)`;

    // Endpoint-Handling: EU-Accounts laufen i. d. R. über smartapi.vesync.eu
    this.baseURL = this.options.baseURL ?? (this.isEuCountryCode(this.COUNTRY_CODE)
      ? 'https://smartapi.vesync.eu'
      : 'https://smartapi.vesync.com');
  }

  private isEuCountryCode(countryCode: string) {
    // Basierend auf TSVESync Doku: EU Accounts => smartapi.vesync.eu
    // (siehe https://github.com/mickgiles/homebridge-tsvesync)
    const euLike = new Set([
      // EU27
      'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
      // EEA/Europe often routed to EU endpoint
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
      // VeSync erwartet hier in der Praxis mobile-like Felder
      phoneBrand: 'samsung',
      // traceId als String, da einige Backends bei Number-Format "illegal argument" liefern
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

        // WICHTIG: Kein rekursiver Aufruf innerhalb des Locks (Deadlock-Risiko).
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await retryWithBackoff(
            () =>
              this.api!.put('cloud/v2/deviceManaged/bypassV2', {
                ...this.generateV2Body(fan, method, body),
                ...this.generateDetailBody(),
                ...this.generateBody(true)
              }),
            3, // maxRetries
            1000 // baseDelay
          );

          if (!response?.data) {
            this.debugMode.debug(
              '[SEND COMMAND]',
              'No response data!! JSON:',
              JSON.stringify(response)
            );
            return false;
          }

          const isSuccess = response?.data?.code === 0;
          if (isSuccess) {
            await delay(500);
            return true;
          }

          const errorMsg = response?.data?.msg || 'Unknown error';
          const errorCode = response?.data?.code;

          // Bei Token-Fehlern: EINMAL Re-Login und erneut versuchen (ohne Rekursion/Lock-Reentry)
          if (isTokenInvalidCode(errorCode) && attempt === 0) {
            this.debugMode.debug('[SEND COMMAND]', 'Token expired, attempting re-login...');
            const loginSuccess = await this.loginInternal();
            if (loginSuccess) {
              continue;
            }
          }

          this.debugMode.debug(
            '[SEND COMMAND]',
            `Failed to send command ${method} to ${fan.name}`,
            `with (${JSON.stringify(body)})!`,
            `Response: ${JSON.stringify(response.data)}`
          );
          this.log.error(
            `Failed to send command ${method} to ${fan.name}: ${errorMsg} (Code: ${errorCode})`
          );

          await delay(500);
          return false;
        }

        return false;
      } catch (error: any) {
        const statusCode = error?.response?.status;
        const errorMessage = error?.response?.data 
          ? JSON.stringify(error.response.data)
          : error?.message || 'Unknown error';
        
        // Rate Limiting Fehler separat behandeln
        if (statusCode === 429) {
          this.log.warn(
            `Rate limit erreicht für ${fan?.name}. Bitte warten...`
          );
        } else {
          this.log.error(
            `Failed to send command ${method} to ${fan?.name}`,
            `Error: ${errorMessage}`
          );
        }
        this.debugMode.debug('[SEND COMMAND]', 'Error details:', errorMessage);
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

        // Kein rekursiver Aufruf innerhalb des Locks (Deadlock-Risiko).
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
            3, // maxRetries
            1000 // baseDelay
          );

          if (!response?.data) {
            this.debugMode.debug(
              '[GET DEVICE INFO]',
              'No response data!! JSON:',
              JSON.stringify(response)
            );
            return null;
          }

          // Prüfe auf API-Fehler
          if (response.data.code !== 0 && response.data.code !== undefined) {
            const errorMsg = response.data.msg || 'Unknown error';
            const errorCode = response.data.code;
            this.debugMode.debug(
              '[GET DEVICE INFO]',
              `API error: ${errorMsg} (Code: ${errorCode})`,
              JSON.stringify(response.data)
            );

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

          this.debugMode.debug(
            '[GET DEVICE INFO]',
            'JSON:',
            JSON.stringify(response.data)
          );

          return response.data;
        }

        return null;
      } catch (error: any) {
        const statusCode = error?.response?.status;
        const errorMessage = error?.response?.data 
          ? JSON.stringify(error.response.data)
          : error?.message || 'Unknown error';
        
        // Rate Limiting Fehler separat behandeln
        if (statusCode === 429) {
          this.log.warn(
            `Rate limit erreicht beim Abrufen von Geräteinformationen für ${fan?.name}. Bitte warten...`
          );
        } else {
          this.log.error(
            `Failed to get device info for ${fan?.name}`,
            `Error: ${errorMessage}`
          );
        }
        this.debugMode.debug('[GET DEVICE INFO]', 'Error details:', errorMessage);

        return null;
      }
    });
  }

  public async startSession(): Promise<boolean> {
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
   * Login ohne Lock.acquire – nur aufrufen, wenn das Lock bereits gehalten wird.
   * (Wichtig, um Deadlocks bei Token-Refresh innerhalb anderer API-Calls zu vermeiden.)
   */
  private async loginInternal(): Promise<boolean> {
    try {
      if (!this.email || !this.password) {
        throw new Error('Email and password are required');
      }

      this.debugMode.debug('[LOGIN]', 'Logging in...');

      const pwdHashed = crypto
        .createHash('md5')
        .update(this.password)
        .digest('hex');

      // Manche Accounts schlagen fehl, wenn man den falschen regionalen Endpoint nutzt.
      // Daher: erst aktueller baseURL, bei bestimmten Fehlern einmal den Alternate probieren.
      const tryLoginOnce = async () => {
        return axios.post(
          'cloud/v1/user/login',
          {
            email: this.email,
            password: pwdHashed,
            // devToken muss beim Login leer sein; einige Backends lehnen self-generated IDs ab.
            devToken: '',
            userType: 1,
            method: 'login',
            token: '',
            ...this.generateDetailBody(),
            ...this.generateBody()
          },
          {
            ...this.AXIOS_OPTIONS,
            // Auch beim Login die erwarteten Header setzen (einige Backends prüfen appversion/user-agent bereits hier).
            headers: {
              'content-type': 'application/json',
              'accept-language': this.LANG,
              'user-agent': this.AGENT,
              appversion: this.APP_VERSION,
              tz: this.TIMEZONE,
            }
          }
        );
      };

      let response = await tryLoginOnce();

      if (!response?.data) {
        this.debugMode.debug(
          '[LOGIN]',
          'No response data!! JSON:',
          JSON.stringify(response)
        );
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

        if (response?.data?.code !== 0 && response?.data?.code !== undefined) {
          this.debugMode.debug(
            '[LOGIN]',
            'The authentication failed!! JSON:',
            JSON.stringify(response.data)
          );
          this.log.error(
            `Login failed: ${response.data.msg || 'Unknown error'} (Code: ${response.data.code})`
          );
          return false;
        }
      }

      const { result } = response.data;
      const { token, accountID } = result ?? {};

      if (!token || !accountID) {
        this.debugMode.debug(
          '[LOGIN]',
          'The authentication failed!! JSON:',
          JSON.stringify(response.data)
        );
        this.log.error('Login failed: Missing token or accountID');
        return false;
      }

      this.debugMode.debug('[LOGIN]', 'The authentication success');

      this.accountId = accountID;
      this.token = token;

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
      const errorMessage = error?.response?.data
        ? JSON.stringify(error.response.data)
        : error?.message || 'Unknown error';
      this.log.error('Failed to login', `Error: ${errorMessage}`);
      this.debugMode.debug('[LOGIN]', 'Login error details:', errorMessage);
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
            3, // maxRetries
            1000 // baseDelay
          );

          if (!response?.data) {
            this.debugMode.debug(
              '[GET DEVICES]',
              'No response data!! JSON:',
              JSON.stringify(response)
            );

            return {
              purifiers: [],
              humidifiers: []
            };
          }

          // Prüfe auf API-Fehler
          if (response.data.code !== 0 && response.data.code !== undefined) {
            const errorMsg = response.data.msg || 'Unknown error';
            const errorCode = response.data.code;
            this.debugMode.debug(
              '[GET DEVICES]',
              `API error: ${errorMsg} (Code: ${errorCode})`,
              JSON.stringify(response.data)
            );

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

          if (!Array.isArray(response.data?.result?.list)) {
            this.debugMode.debug(
              '[GET DEVICES]',
              'No list found!! JSON:',
              JSON.stringify(response.data)
            );

            return {
              purifiers: [],
              humidifiers: []
            };
          }

          const { list } = response.data.result ?? { list: [] };

          this.debugMode.debug(
            '[GET DEVICES]',
            'Device List -> JSON:',
            JSON.stringify(list)
          );


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
          .map((fan: any) => ({ ...fan, extension: { ...fan.deviceProp, airQualityLevel: fan.deviceProp.AQLevel, mode: fan.deviceProp.workMode } }))
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

          return {
            purifiers,
            humidifiers
          };
        }

        return {
          purifiers: [],
          humidifiers: []
        };
      } catch (error: any) {
        const statusCode = error?.response?.status;
        const errorMessage = error?.response?.data 
          ? JSON.stringify(error.response.data)
          : error?.message || 'Unknown error';
        
        // Rate Limiting Fehler separat behandeln
        if (statusCode === 429) {
          this.log.warn('Rate limit erreicht beim Abrufen der Geräteliste. Bitte warten...');
        } else {
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
