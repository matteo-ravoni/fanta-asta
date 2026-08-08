import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as QRCode from 'qrcode';
import { SocketService } from '../../socket.service';

interface Partecipante {
  id: number;
  nome_squadra: string;
  ordine: number;
  crediti_residui: number;
  connesso: boolean;
}

@Component({
  selector: 'app-collegamento',
  imports: [],
  templateUrl: './collegamento.component.html',
  styleUrl: './collegamento.component.css'
})
export class CollegamentoComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly socketService = inject(SocketService);

  protected readonly url = `${location.origin}/join`;
  protected readonly urlLocale = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  protected readonly qrDataUrl = signal<string | null>(null);
  protected readonly copiato = signal(false);

  protected readonly partecipanti = signal<Partecipante[]>([]);
  protected readonly accessiBloccati = signal(false);
  protected readonly erroreAzione = signal<string | null>(null);
  protected readonly avvioInCorso = signal(false);

  protected readonly numeroCollegati = () => this.partecipanti().filter((p) => p.connesso).length;

  private readonly aggiornaPartecipanti = () => this.caricaPartecipanti();

  ngOnInit(): void {
    QRCode.toDataURL(this.url, { margin: 1, width: 260 }).then((dataUrl) => this.qrDataUrl.set(dataUrl));
    this.caricaPartecipanti();
    this.caricaStato();
    this.socketService.on('partecipanti:aggiornati', this.aggiornaPartecipanti);
  }

  ngOnDestroy(): void {
    this.socketService.off('partecipanti:aggiornati', this.aggiornaPartecipanti);
  }

  private caricaPartecipanti(): void {
    this.http.get<Partecipante[]>('/api/partecipanti').subscribe((p) => this.partecipanti.set(p));
  }

  private caricaStato(): void {
    this.http.get<{ accessi_bloccati: boolean }>('/api/stato').subscribe((s) => this.accessiBloccati.set(!!s.accessi_bloccati));
  }

  protected copiaUrl(): void {
    navigator.clipboard.writeText(this.url).then(() => {
      this.copiato.set(true);
      setTimeout(() => this.copiato.set(false), 2000);
    });
  }

  protected toggleBloccoAccessi(): void {
    const nuovoValore = !this.accessiBloccati();
    this.http.post<{ ok: true; accessi_bloccati: boolean }>('/api/accessi', { bloccato: nuovoValore }).subscribe({
      next: (r) => this.accessiBloccati.set(r.accessi_bloccati),
      error: (err) => this.erroreAzione.set(err.error?.errori?.[0] ?? 'Errore imprevisto.'),
    });
  }

  protected iniziaAsta(): void {
    this.erroreAzione.set(null);
    this.avvioInCorso.set(true);
    this.http.post('/api/asta/inizia', {}).subscribe({
      next: () => this.avvioInCorso.set(false),
      error: (err) => {
        this.erroreAzione.set(err.error?.errori?.[0] ?? 'Errore imprevisto.');
        this.avvioInCorso.set(false);
      },
    });
  }
}
