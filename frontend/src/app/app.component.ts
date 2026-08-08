import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SocketService } from './socket.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  protected readonly socketService = inject(SocketService);
}
