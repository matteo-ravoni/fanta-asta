import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

interface StatoAsta {
  stato: 'non_iniziata' | 'in_corso' | 'sospesa' | 'conclusa';
}

interface RispostaConfigurazione {
  ok: true;
  numero_giocatori: number;
  numero_partecipanti: number;
}

interface RispostaErrore {
  errori: string[];
}

@Component({
  selector: 'app-config',
  imports: [ReactiveFormsModule],
  templateUrl: './config.component.html',
  styleUrl: './config.component.css'
})
export class ConfigComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);

  protected readonly caricamento = signal(true);
  protected readonly astaBloccata = signal(false);
  protected readonly salvataggioInCorso = signal(false);
  protected readonly errori = signal<string[]>([]);
  protected readonly esito = signal<RispostaConfigurazione | null>(null);
  protected readonly nomeFile = signal<string | null>(null);

  private file: File | null = null;

  protected readonly form = this.fb.nonNullable.group({
    numero_partecipanti: this.fb.nonNullable.control(8, [Validators.required, Validators.min(2), Validators.max(20)]),
    nomi_squadre: this.fb.array(
      Array.from({ length: 8 }, () => this.fb.nonNullable.control('', Validators.required))
    ),
    crediti_iniziali: this.fb.nonNullable.control(500, [Validators.required, Validators.min(1)]),
    tipo_asta: this.fb.nonNullable.control<'classica' | 'mantra'>('classica'),
    slot_portieri: this.fb.nonNullable.control(3, [Validators.required, Validators.min(1)]),
    slot_difensori: this.fb.nonNullable.control(8, [Validators.required, Validators.min(1)]),
    slot_centrocampisti: this.fb.nonNullable.control(8, [Validators.required, Validators.min(1)]),
    slot_attaccanti: this.fb.nonNullable.control(6, [Validators.required, Validators.min(1)]),
    slot_totale_mantra: this.fb.nonNullable.control(25, [Validators.required, Validators.min(1)]),
    ordine_uscita: this.fb.nonNullable.control<'casuale' | 'per_ruolo' | 'alfabetico'>('casuale'),
  });

  ngOnInit(): void {
    this.http.get<StatoAsta>('/api/stato').subscribe({
      next: (stato) => {
        this.astaBloccata.set(stato.stato !== 'non_iniziata');
        this.caricamento.set(false);
      },
      error: () => this.caricamento.set(false),
    });

    this.form.controls.numero_partecipanti.valueChanges.subscribe((n) => this.aggiornaNumeroSquadre(n));
  }

  protected get nomiSquadre(): FormArray {
    return this.form.controls.nomi_squadre;
  }

  private aggiornaNumeroSquadre(numero: number): void {
    const n = Number.isInteger(numero) && numero > 0 ? numero : 0;
    while (this.nomiSquadre.length < n) {
      this.nomiSquadre.push(this.fb.nonNullable.control('', Validators.required));
    }
    while (this.nomiSquadre.length > n) {
      this.nomiSquadre.removeAt(this.nomiSquadre.length - 1);
    }
  }

  protected onFileSelezionato(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.file = input.files?.[0] ?? null;
    this.nomeFile.set(this.file?.name ?? null);
  }

  protected salva(): void {
    this.errori.set([]);
    this.esito.set(null);

    if (this.form.invalid) {
      this.errori.set(['Compila tutti i campi obbligatori prima di salvare.']);
      return;
    }
    if (!this.file) {
      this.errori.set(['Carica il file del listone (.xlsx).']);
      return;
    }

    const v = this.form.getRawValue();
    const fd = new FormData();
    fd.append('numero_partecipanti', String(v.numero_partecipanti));
    fd.append('nomi_squadre', JSON.stringify(v.nomi_squadre));
    fd.append('crediti_iniziali', String(v.crediti_iniziali));
    fd.append('tipo_asta', v.tipo_asta);
    fd.append('ordine_uscita', v.ordine_uscita);
    if (v.tipo_asta === 'classica') {
      fd.append('slot_portieri', String(v.slot_portieri));
      fd.append('slot_difensori', String(v.slot_difensori));
      fd.append('slot_centrocampisti', String(v.slot_centrocampisti));
      fd.append('slot_attaccanti', String(v.slot_attaccanti));
    } else {
      fd.append('slot_portieri', String(v.slot_portieri));
      fd.append('slot_totale_mantra', String(v.slot_totale_mantra));
    }
    fd.append('listone', this.file);

    this.salvataggioInCorso.set(true);
    this.http.post<RispostaConfigurazione>('/api/configurazione', fd).subscribe({
      next: (risposta) => {
        this.esito.set(risposta);
        this.salvataggioInCorso.set(false);
      },
      error: (err) => {
        const corpo = err.error as RispostaErrore | undefined;
        this.errori.set(corpo?.errori ?? ['Errore imprevisto durante il salvataggio.']);
        this.salvataggioInCorso.set(false);
      },
    });
  }
}
