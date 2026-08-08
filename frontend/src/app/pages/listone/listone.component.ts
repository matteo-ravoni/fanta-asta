import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

interface Giocatore {
  id: number;
  nome: string;
  squadra_reale: string;
  ruolo_classico: string;
  ruolo_mantra: string;
  quotazione_classica: number;
  quotazione_mantra: number;
  fvm_classica: number | null;
  fvm_mantra: number | null;
  stato: string;
}

@Component({
  selector: 'app-listone',
  imports: [FormsModule],
  templateUrl: './listone.component.html',
  styleUrl: './listone.component.css'
})
export class ListoneComponent implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly giocatori = signal<Giocatore[]>([]);
  protected readonly ruoloFiltro = signal<string>('');
  protected ricerca = '';

  protected readonly ruoli = ['', 'P', 'D', 'C', 'A'];

  ngOnInit(): void {
    this.carica();
  }

  protected filtraRuolo(ruolo: string): void {
    this.ruoloFiltro.set(ruolo);
    this.carica();
  }

  protected cerca(): void {
    this.carica();
  }

  private carica(): void {
    const params: Record<string, string> = {};
    if (this.ruoloFiltro()) params['ruolo'] = this.ruoloFiltro();
    if (this.ricerca.trim()) params['q'] = this.ricerca.trim();
    this.http.get<Giocatore[]>('/api/giocatori', { params }).subscribe((g) => this.giocatori.set(g));
  }
}
