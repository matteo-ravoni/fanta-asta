import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Partecipante, SessioneService } from '../../sessione.service';
import { SocketService } from '../../socket.service';

interface Giocatore {
  id: number;
  nome: string;
  squadra_reale: string;
  ruolo_classico: string;
  quotazione_classica: number;
  fvm_classica: number | null;
}

interface GiocatoreAcquistato {
  nome: string;
  ruolo_classico: string;
  prezzo: number;
}

interface Rosa {
  id: number;
  nome_squadra: string;
  crediti_residui: number;
  ruoli: Record<string, number>;
  totale: number;
  giocatori: GiocatoreAcquistato[];
}

interface StatoAsta {
  stato: 'non_iniziata' | 'in_corso' | 'sospesa' | 'conclusa';
  giocatore_corrente: Giocatore | null;
  offerta_corrente: number | null;
  partecipante_in_testa: { id: number; nome_squadra: string } | null;
  countdown_scadenza: string | null;
  partecipante_disconnesso: { id: number; nome_squadra: string } | null;
  rilanci_in_attesa: { id: number; importo: number; partecipante: { id: number; nome_squadra: string } }[];
  rose: Rosa[];
  tipo_asta: 'classica' | 'mantra' | null;
}

interface Configurazione {
  slot_portieri: number;
  slot_difensori: number;
  slot_centrocampisti: number;
  slot_attaccanti: number;
  slot_totale_mantra: number;
}

@Component({
  selector: 'app-mobile',
  imports: [FormsModule],
  templateUrl: './mobile.component.html',
  styleUrl: './mobile.component.css'
})
export class MobileComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly sessione = inject(SessioneService);
  private readonly socketService = inject(SocketService);

  protected readonly caricamento = signal(true);
  protected readonly partecipante = signal<Partecipante | null>(null);
  protected readonly asta = signal<StatoAsta | null>(null);
  protected readonly configurazione = signal<Configurazione | null>(null);
  protected readonly countdownSecondi = signal<number | null>(null);
  protected readonly erroreRilancio = signal<string | null>(null);
  protected readonly invioInCorso = signal(false);
  protected readonly deltaInCorso = signal<number | null>(null);
  protected importoManuale: number | null = null;

  private intervalloCountdown: ReturnType<typeof setInterval> | null = null;

  private readonly aggiornaAsta = (payload: StatoAsta) => {
    this.asta.set(payload);
    this.erroreRilancio.set(null);
  };

  protected readonly miaRosa = () => this.asta()?.rose.find((r) => r.id === this.partecipante()?.id) ?? null;

  protected readonly mioRilancioInAttesa = () =>
    this.asta()?.rilanci_in_attesa.some((r) => r.partecipante.id === this.partecipante()?.id) ?? false;

  ngOnInit(): void {
    this.sessione.verificaToken().subscribe((p) => {
      if (!p) {
        this.router.navigateByUrl('/join');
        return;
      }
      this.partecipante.set(p);
      this.socketService.identifica(this.sessione.getToken()!);

      this.http.get<StatoAsta>('/api/asta/stato').subscribe((a) => this.asta.set(a));
      this.http.get<{ configurazione: Configurazione }>('/api/configurazione').subscribe((r) => this.configurazione.set(r.configurazione));
      this.socketService.on('asta:stato', this.aggiornaAsta);

      this.caricamento.set(false);
    });

    this.intervalloCountdown = setInterval(() => {
      const scadenza = this.asta()?.countdown_scadenza;
      if (!scadenza) {
        this.countdownSecondi.set(null);
        return;
      }
      const restanti = Math.ceil((new Date(scadenza).getTime() - this.socketService.oraServer()) / 1000);
      this.countdownSecondi.set(Math.max(0, restanti));
    }, 200);
  }

  ngOnDestroy(): void {
    this.socketService.off('asta:stato', this.aggiornaAsta);
    if (this.intervalloCountdown) clearInterval(this.intervalloCountdown);
  }

  protected rilanciaRapido(delta: number): void {
    const base = this.asta()?.offerta_corrente ?? 0;
    this.deltaInCorso.set(delta);
    this.rilancia(base + delta);
  }

  protected rilanciaManuale(): void {
    if (this.importoManuale) this.rilancia(this.importoManuale);
  }

  private rilancia(importo: number): void {
    this.erroreRilancio.set(null);
    this.invioInCorso.set(true);
    this.http.post<{ ok: true; stato: string }>('/api/rilancio', { token: this.sessione.getToken(), importo }).subscribe({
      next: () => {
        this.invioInCorso.set(false);
        this.deltaInCorso.set(null);
        this.importoManuale = null;
      },
      error: (err) => {
        this.erroreRilancio.set(err.error?.errori?.[0] ?? 'Errore imprevisto.');
        this.invioInCorso.set(false);
        this.deltaInCorso.set(null);
      },
    });
  }
}
