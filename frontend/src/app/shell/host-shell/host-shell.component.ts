import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-host-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './host-shell.component.html',
  styleUrl: './host-shell.component.css'
})
export class HostShellComponent {
}
