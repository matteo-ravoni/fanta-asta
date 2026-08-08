import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private readonly socket: Socket = io();
  private tokenAttuale: string | null = null;

  // stima di (ora del server - ora locale), calcolata via round-trip sul socket.
  // Necessaria perché i dispositivi sono su WiFi isolata senza internet, quindi senza NTP:
  // l'orologio del telefono può essere disallineato rispetto al laptop/server.
  private scartoOrario = 0;

  readonly connesso = signal(false);
  readonly partecipantiOnline = signal(0);

  constructor() {
    this.socket.on('connect', () => {
      this.connesso.set(true);
      if (this.tokenAttuale) {
        this.socket.emit('identifica', { token: this.tokenAttuale });
      }
      this.sincronizzaOrario();
    });
    this.socket.on('disconnect', () => this.connesso.set(false));
    this.socket.on('partecipanti:online', (n: number) => this.partecipantiOnline.set(n));
  }

  private sincronizzaOrario(): void {
    const t0 = Date.now();
    this.socket.emit('ping-tempo', null, (tempoServer: number) => {
      const t1 = Date.now();
      this.scartoOrario = tempoServer - (t0 + t1) / 2;
    });
  }

  // Ora stimata del server: da usare al posto di Date.now() per confrontare i timestamp
  // assoluti del countdown, altrimenti un orologio locale disallineato falsa il conto alla rovescia.
  oraServer(): number {
    return Date.now() + this.scartoOrario;
  }

  identifica(token: string): void {
    this.tokenAttuale = token;
    if (this.socket.connected) {
      this.socket.emit('identifica', { token });
    }
  }

  on(evento: string, callback: (...args: any[]) => void): void {
    this.socket.on(evento, callback);
  }

  off(evento: string, callback: (...args: any[]) => void): void {
    this.socket.off(evento, callback);
  }
}
