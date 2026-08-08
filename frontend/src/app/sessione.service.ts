import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

const CHIAVE_TOKEN = 'fantalega_token';

export interface Partecipante {
  id: number;
  nome_squadra: string;
  ordine: number;
  crediti_residui: number;
}

@Injectable({ providedIn: 'root' })
export class SessioneService {
  private readonly http = inject(HttpClient);

  getToken(): string | null {
    return localStorage.getItem(CHIAVE_TOKEN);
  }

  setToken(token: string): void {
    localStorage.setItem(CHIAVE_TOKEN, token);
  }

  clearToken(): void {
    localStorage.removeItem(CHIAVE_TOKEN);
  }

  verificaToken(): Observable<Partecipante | null> {
    const token = this.getToken();
    if (!token) return of(null);
    return this.http.get<Partecipante>('/api/partecipanti/me', { params: { token } }).pipe(
      catchError(() => {
        this.clearToken();
        return of(null);
      })
    );
  }
}
