declare module 'steam-user' {
  import { EventEmitter } from 'node:events';

  class SteamUser extends EventEmitter {
    static readonly EPersonaState: { Online: number; [key: string]: number };
    steamID?: { getSteamID64(): string };
    constructor(options?: Record<string, unknown>);
    logOn(details: Record<string, unknown>): void;
    logOff(): void;
    setPersona(state: number): void;
    gamesPlayed(apps: Array<number | string>): void;
  }

  export = SteamUser;
}

declare module 'steam-totp' {
  const SteamTotp: {
    generateAuthCode(secret: string, timeOffset?: number): string;
  };
  export = SteamTotp;
}
