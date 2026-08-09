import { Component, Input, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { SocketService } from '../../../socket.service';

interface Assegnazione {
  id: number;
  giocatore_id: number;
  giocatore_nome: string;
  ruolo_classico: string;
  ruolo_mantra: string;
  partecipante_id: number;
  nome_squadra: string;
  prezzo: number;
  assegnato_il: string;
}

interface LogRiga {
  id: number;
  creato_il: string;
  tipo_azione: string;
  giocatore_nome: string | null;
  nome_squadra: string | null;
  dettagli: Record<string, unknown>;
}

interface Partecipante {
  id: number;
  nome_squadra: string;
}

@Component({
  selector: 'app-admin-panel',
  imports: [FormsModule],
  templateUrl: './admin-panel.component.html',
  styleUrl: './admin-panel.component.css'
})
export class AdminPanelComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly socketService = inject(SocketService);

  @Input() tipoAsta: 'classica' | 'mantra' | null = null;

  protected readonly assegnazioni = signal<Assegnazione[]>([]);
  protected readonly log = signal<LogRiga[]>([]);
  protected readonly partecipanti = signal<Partecipante[]>([]);
  protected readonly errore = signal<string | null>(null);
  protected readonly modificaApertaId = signal<number | null>(null);
  protected nuovaSquadraId: number | null = null;
  protected nuovoPrezzo: number | null = null;

  private readonly aggiorna = () => this.carica();

  ngOnInit(): void {
    this.carica();
    this.http.get<Partecipante[]>('/api/partecipanti').subscribe((p) => this.partecipanti.set(p));
    this.socketService.on('asta:stato', this.aggiorna);
  }

  ngOnDestroy(): void {
    this.socketService.off('asta:stato', this.aggiorna);
  }

  private carica(): void {
    this.http.get<Assegnazione[]>('/api/assegnazioni').subscribe((a) => this.assegnazioni.set(a));
    this.http.get<LogRiga[]>('/api/log-admin').subscribe((l) => this.log.set(l));
  }

  private eseguiAzione(url: string, body: unknown = {}): void {
    this.errore.set(null);
    this.http.post(url, body).subscribe({
      next: () => this.carica(),
      error: (err) => this.errore.set(err.error?.errori?.[0] ?? 'Errore imprevisto.'),
    });
  }

  protected annullaUltima(): void {
    if (!confirm("Annullare l'ultima assegnazione? Il giocatore torna in asta, i crediti vengono restituiti.")) return;
    this.eseguiAzione('/api/admin/annulla-ultima');
  }

  protected svincola(a: Assegnazione): void {
    if (!confirm(`Svincolare ${a.giocatore_nome} da ${a.nome_squadra}? Torna nel listone, i crediti vengono restituiti.`)) return;
    this.eseguiAzione('/api/admin/svincola', { giocatore_id: a.giocatore_id });
  }

  protected apriModifica(a: Assegnazione): void {
    this.modificaApertaId.set(a.id);
    this.nuovaSquadraId = a.partecipante_id;
    this.nuovoPrezzo = a.prezzo;
  }

  protected annullaModifica(): void {
    this.modificaApertaId.set(null);
  }

  protected confermaModifica(assegnazioneId: number): void {
    if (!confirm('Confermare la modifica di questa assegnazione?')) return;
    this.eseguiAzione('/api/admin/modifica-assegnazione', {
      assegnazione_id: assegnazioneId,
      partecipante_id: this.nuovaSquadraId,
      prezzo: this.nuovoPrezzo,
    });
    this.modificaApertaId.set(null);
  }

  protected resetRose(): void {
    if (!confirm('Reset rose: svuota tutte le rose e le offerte, ma tiene configurazione, listone e partecipanti. Continuare?')) return;
    this.eseguiAzione('/api/admin/reset-rose');
  }

  protected resetCompleto(): void {
    if (!confirm('Reset completo: torna tutto a zero, inclusa la configurazione. Continuare?')) return;
    this.eseguiAzione('/api/admin/reset-completo');
  }
}
