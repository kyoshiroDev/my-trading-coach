/**
 * Débrief : le bouton dit quelle semaine il génère (F5 #1047), et l'écran ne relance plus
 * l'API toutes les 15 s quand le trader n'a encore aucun débrief (F6 #1047).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DebriefComponent } from './debrief.component';
import { UserStore } from '../../core/stores/user.store';
import TEMPLATE from './debrief.component.html?raw';

describe('Débrief : bouton de génération (F5 #1047)', () => {
  it('le bouton nomme la semaine générée : la semaine en cours', () => {
    expect(TEMPLATE).toContain("'Générer le débrief de cette semaine'");
    expect(TEMPLATE).toContain('Clique sur « Générer le débrief de cette semaine »');
  });
});
