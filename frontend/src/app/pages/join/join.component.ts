import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { SessioneService } from '../../sessione.service';
import { SocketService } from '../../socket.service';

interface Squadra {
  nome_squadra: string;
  ordine: number;
  occupata: boolean;
}

@Component({
  selector: 'app-join',
  imports: [],
  templateUrl: './join.component.html',
  styleUrl: './join.component.css'
})
export class JoinComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly sessione = inject(SessioneService);
  private readonly socketService = inject(SocketService);

  protected readonly caricamento = signal(true);
  protected readonly accessiBloccati = signal(false);
  protected readonly squadre = signal<Squadra[]>([]);
  protected readonly errore = signal<string | null>(null);
  protected readonly inCorso = signal(false);

  ngOnInit(): void {
    this.sessione.verificaToken().subscribe((p) => {
      if (p) {
        this.router.navigateByUrl('/mobile');
        return;
      }
      this.caricaSquadre();
    });
  }

  private caricaSquadre(): void {
    this.http.get<{ accessi_bloccati: boolean; squadre: Squadra[] }>('/api/squadre').subscribe({
      next: (r) => {
        this.accessiBloccati.set(r.accessi_bloccati);
        this.squadre.set(r.squadre);
        this.caricamento.set(false);
      },
      error: () => this.caricamento.set(false),
    });
  }

  protected scegli(squadra: Squadra): void {
    if (squadra.occupata || this.inCorso()) return;
    this.errore.set(null);
    this.inCorso.set(true);

    this.http.post<{ token: string }>('/api/join', { nome_squadra: squadra.nome_squadra }).subscribe({
      next: (r) => {
        this.sessione.setToken(r.token);
        this.socketService.identifica(r.token);
        this.router.navigateByUrl('/mobile');
      },
      error: (err) => {
        this.errore.set(err.error?.errori?.[0] ?? 'Errore imprevisto.');
        this.inCorso.set(false);
        this.caricaSquadre();
      },
    });
  }
}
