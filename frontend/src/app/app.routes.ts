import { Routes } from '@angular/router';
import { HostShellComponent } from './shell/host-shell/host-shell.component';
import { ConfigComponent } from './pages/config/config.component';
import { ListoneComponent } from './pages/listone/listone.component';
import { StanzaComponent } from './pages/stanza/stanza.component';
import { JoinComponent } from './pages/join/join.component';
import { MobileComponent } from './pages/mobile/mobile.component';

export const routes: Routes = [
  {
    path: '',
    component: HostShellComponent,
    children: [
      { path: '', redirectTo: 'config', pathMatch: 'full' },
      { path: 'config', component: ConfigComponent },
      { path: 'listone', component: ListoneComponent },
      { path: 'stanza', component: StanzaComponent },
    ],
  },
  { path: 'join', component: JoinComponent },
  { path: 'mobile', component: MobileComponent },
];
