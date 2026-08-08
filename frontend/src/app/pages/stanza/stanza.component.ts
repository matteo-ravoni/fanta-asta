import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CollegamentoComponent } from '../collegamento/collegamento.component';
import { SocketService } from '../../socket.service';

interface Giocatore {
  id: number;
  nome: string;
  squadra_reale: string;
  ruolo_classico: string;
  quotazione_classica: number;
  fvm_classica: number | null;
}

interface StatoAsta {
  stato: 'non_iniziata' | 'in_corso' | 'sospesa' | 'conclusa';
  giocatore_corrente: Giocatore | null;
  offerta_corrente: number | null;
  partecipante_in_testa: { id: number; nome_squadra: string } | null;
  countdown_scadenza: string | null;
  partecipante_disconnesso: { id: number; nome_squadra: string } | null;
  rilanci_in_attesa: { id: number; importo: number; partecipante: { id: number; nome_squadra: string } }[];
  rose: { id: number; nome_squadra: string; crediti_residui: number; ruoli: Record<string, number>; totale: number }[];
  asta_esaurita: boolean;
}

@Component({
  selector: 'app-stanza',
  imports: [CollegamentoComponent],
  templateUrl: './stanza.component.html',
  styleUrl: './stanza.component.css'
})
export class StanzaComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly socketService = inject(SocketService);

  protected readonly caricamento = signal(true);
  protected readonly asta = signal<StatoAsta | null>(null);

  private readonly aggiorna = (payload: StatoAsta) => {
    this.asta.set(payload);
    this.caricamento.set(false);
  };

  ngOnInit(): void {
    this.http.get<StatoAsta>('/api/asta/stato').subscribe({
      next: (a) => {
        this.asta.set(a);
        this.caricamento.set(false);
      },
      error: () => this.caricamento.set(false),
    });
    this.socketService.on('asta:stato', this.aggiorna);
  }

  ngOnDestroy(): void {
    this.socketService.off('asta:stato', this.aggiorna);
  }
}
