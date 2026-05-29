import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LiveModeService {
  readonly isLive = signal(false);

  activate():   void { this.isLive.set(true);  }
  deactivate(): void { this.isLive.set(false); }
}