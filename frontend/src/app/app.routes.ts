import { Routes } from '@angular/router';
import { ConfigComponent } from './pages/config/config.component';

export const routes: Routes = [
  { path: '', redirectTo: 'config', pathMatch: 'full' },
  { path: 'config', component: ConfigComponent },
];
