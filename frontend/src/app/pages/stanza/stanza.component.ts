import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CollegamentoComponent } from '../collegamento/collegamento.component';
import { AdminPanelComponent } from './admin-panel/admin-panel.component';
import { SocketService } from '../../socket.service';

interface Giocatore {
  id: number;
  nome: string;
  squadra_reale: string;
  ruolo_classico: string;
  quotazione_classica: number;
  fvm_classica: number | null;
}

interface RilancioInAttesa {
  id: number;
  importo: number;
  partecipante: { id: number; nome_squadra: string };
}

interface Rosa {
  id: number;
  nome_squadra: string;
  crediti_residui: number;
  ruoli: Record<string, number>;
  totale: number;
}

interface StatoAsta {
  stato: 'non_iniziata' | 'in_corso' | 'sospesa' | 'conclusa';
  giocatore_corrente: Giocatore | null;
  offerta_corrente: number | null;
  partecipante_in_testa: { id: number; nome_squadra: string } | null;
  countdown_scadenza: string | null;
  partecipante_disconnesso: { id: number; nome_squadra: string } | null;
  rilanci_in_attesa: RilancioInAttesa[];
  rose: Rosa[];
  asta_esaurita: boolean;
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
  selector: 'app-stanza',
  imports: [CollegamentoComponent, AdminPanelComponent],
  templateUrl: './stanza.component.html',
  styleUrl: './stanza.component.css'
})
export class StanzaComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly socketService = inject(SocketService);

  protected readonly caricamento = signal(true);
  protected readonly asta = signal<StatoAsta | null>(null);
  protected readonly configurazione = signal<Configurazione | null>(null);
  protected readonly countdownSecondi = signal<number | null>(null);
  protected readonly erroreAzione = signal<string | null>(null);
  protected readonly azioneInCorso = signal(false);
  protected readonly pannelloAdminAperto = signal(false);

  private intervalloCountdown: ReturnType<typeof setInterval> | null = null;

  private readonly aggiorna = (payload: StatoAsta) => {
    this.asta.set(payload);
    this.caricamento.set(false);
    this.erroreAzione.set(null);
  };

  ngOnInit(): void {
    this.http.get<StatoAsta>('/api/asta/stato').subscribe({
      next: (a) => {
        this.asta.set(a);
        this.caricamento.set(false);
      },
      error: () => this.caricamento.set(false),
    });
    this.http.get<{ configurazione: Configurazione }>('/api/configurazione').subscribe((r) => this.configurazione.set(r.configurazione));
    this.socketService.on('asta:stato', this.aggiorna);

    this.intervalloCountdown = setInterval(() => {
      const scadenza = this.asta()?.countdown_scadenza;
      if (!scadenza) {
        this.countdownSecondi.set(null);
        return;
      }
      const restanti = Math.ceil((new Date(scadenza).getTime() - Date.now()) / 1000);
      this.countdownSecondi.set(Math.max(0, restanti));
    }, 200);
  }

  ngOnDestroy(): void {
    this.socketService.off('asta:stato', this.aggiorna);
    if (this.intervalloCountdown) clearInterval(this.intervalloCountdown);
  }

  private eseguiAzione(url: string, body: unknown = {}): void {
    this.erroreAzione.set(null);
    this.azioneInCorso.set(true);
    this.http.post(url, body).subscribe({
      next: () => this.azioneInCorso.set(false),
      error: (err) => {
        this.erroreAzione.set(err.error?.errori?.[0] ?? 'Errore imprevisto.');
        this.azioneInCorso.set(false);
      },
    });
  }

  protected assegna(): void {
    this.eseguiAzione('/api/asta/assegna');
  }

  protected salta(): void {
    this.eseguiAzione('/api/asta/salta');
  }

  protected sospendi(): void {
    this.eseguiAzione('/api/asta/sospendi');
  }

  protected riprendi(): void {
    this.eseguiAzione('/api/asta/riprendi');
  }

  protected accetta(rilancioId: number): void {
    this.eseguiAzione(`/api/rilanci/${rilancioId}/accetta`);
  }

  protected rifiuta(rilancioId: number): void {
    this.eseguiAzione(`/api/rilanci/${rilancioId}/rifiuta`);
  }

  protected chiudiAsta(): void {
    if (!confirm("Chiudere l'asta ed esportare i file? L'operazione non è reversibile.")) return;
    this.eseguiAzione('/api/asta/chiudi');
  }
}
