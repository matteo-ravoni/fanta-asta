import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private readonly socket: Socket = io();
  private tokenAttuale: string | null = null;

  readonly connesso = signal(false);
  readonly partecipantiOnline = signal(0);

  constructor() {
    this.socket.on('connect', () => {
      this.connesso.set(true);
      if (this.tokenAttuale) {
        this.socket.emit('identifica', { token: this.tokenAttuale });
      }
    });
    this.socket.on('disconnect', () => this.connesso.set(false));
    this.socket.on('partecipanti:online', (n: number) => this.partecipantiOnline.set(n));
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
