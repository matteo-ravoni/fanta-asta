import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CollegamentoComponent } from '../collegamento/collegamento.component';
import { SocketService } from '../../socket.service';

interface StatoAsta {
  stato: 'non_iniziata' | 'in_corso' | 'sospesa' | 'conclusa';
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
  protected readonly stato = signal<StatoAsta['stato'] | null>(null);

  private readonly aggiorna = () => this.carica();

  ngOnInit(): void {
    this.carica();
    this.socketService.on('stato_asta:aggiornato', this.aggiorna);
  }

  ngOnDestroy(): void {
    this.socketService.off('stato_asta:aggiornato', this.aggiorna);
  }

  private carica(): void {
    this.http.get<StatoAsta>('/api/stato').subscribe({
      next: (s) => {
        this.stato.set(s.stato);
        this.caricamento.set(false);
      },
      error: () => this.caricamento.set(false),
    });
  }
}
