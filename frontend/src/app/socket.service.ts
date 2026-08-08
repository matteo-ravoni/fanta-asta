import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private readonly socket: Socket = io();

  readonly connesso = signal(false);
  readonly partecipantiOnline = signal(0);

  constructor() {
    this.socket.on('connect', () => this.connesso.set(true));
    this.socket.on('disconnect', () => this.connesso.set(false));
    this.socket.on('partecipanti:online', (n: number) => this.partecipantiOnline.set(n));
  }
}
