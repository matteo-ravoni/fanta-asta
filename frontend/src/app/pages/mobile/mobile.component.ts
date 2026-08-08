import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Partecipante, SessioneService } from '../../sessione.service';
import { SocketService } from '../../socket.service';

@Component({
  selector: 'app-mobile',
  imports: [],
  templateUrl: './mobile.component.html',
  styleUrl: './mobile.component.css'
})
export class MobileComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly sessione = inject(SessioneService);
  private readonly socketService = inject(SocketService);

  protected readonly caricamento = signal(true);
  protected readonly partecipante = signal<Partecipante | null>(null);

  ngOnInit(): void {
    this.sessione.verificaToken().subscribe((p) => {
      if (!p) {
        this.router.navigateByUrl('/join');
        return;
      }
      this.partecipante.set(p);
      this.socketService.identifica(this.sessione.getToken()!);
      this.caricamento.set(false);
    });
  }
}
