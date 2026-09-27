import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import * as angularCore from '@angular/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfirmDialogComponent } from './confirm-dialog.component';
import { ConfirmService } from './confirm.service';

const DIR = join(import.meta.dirname);
const { provideZonelessChangeDetection } = angularCore;
// API interne d'Angular (JIT) : charge templateUrl / styleUrl depuis le disque.
const resolveResources = (angularCore as Record<string, unknown>)['\u0275resolveComponentResources'] as (
  resolver: (url: string) => Promise<{ text(): Promise<string> }>,
) => Promise<void>;

describe('ConfirmDialogComponent', () => {
  let service: ConfirmService;
  let host: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<ConfirmDialogComponent>>;

  beforeAll(async () => {
    // JIT : le template et le CSS sont lus sur le disque.
    await resolveResources((url: string) =>
      Promise.resolve({ text: () => Promise.resolve(readFileSync(join(DIR, url), 'utf8')) }),
    );
  });

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(ConfirmDialogComponent);
    service = TestBed.inject(ConfirmService);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.autoDetectChanges();
  });

  const open = async (danger = false) => {
    const answer = service.ask({ title: 'Supprimer le compte ?', message: 'Action irréversible.', danger });
    await new Promise((r) => setTimeout(r));
    return answer;
  };

  it('affiche un dialogue accessible avec titre et message', async () => {
    void open();
    await new Promise((r) => setTimeout(r));
    const dialog = host.querySelector('[role="alertdialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(host.querySelector('#cd-title')?.textContent).toContain('Supprimer le compte ?');
  });

  it('« Confirmer » résout true et ferme', async () => {
    const answer = open();
    await new Promise((r) => setTimeout(r));
    (host.querySelector('[data-testid="confirm-ok"]') as HTMLButtonElement).click();
    await expect(answer).resolves.toBe(true);
    await new Promise((r) => setTimeout(r));
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('Échap annule', async () => {
    const answer = open();
    await new Promise((r) => setTimeout(r));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(answer).resolves.toBe(false);
  });

  // Le focus (Annuler à l'ouverture, retour à l'élément d'origine) est vérifié dans un vrai
  // navigateur : jsdom n'exécute pas fidèlement les hooks après rendu.
  it('action destructive : bouton de confirmation marqué danger', async () => {
    void open(true);
    await fixture.whenStable();
    expect(host.querySelector('.cd-danger')).not.toBeNull();
  });

  it('une nouvelle demande annule la précédente', async () => {
    const first = service.ask({ title: 'A', message: 'a' });
    void service.ask({ title: 'B', message: 'b' });
    await expect(first).resolves.toBe(false);
  });
});
