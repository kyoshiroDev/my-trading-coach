import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import type { BrokerMappingColumns as ChampsColonnes } from '../../core/api/admin.api';
import {
  AdminApi,
  type BrokerMapping,
  type BrokerMappingAnalysis,
  type BrokerMappingRow,
} from '../../core/api/admin.api';

/**
 * Registre des brokers : débloquer un export CSV que l'app ne reconnaît pas.
 *
 * Pensé pour être utilisable depuis un téléphone, parce que c'est là que le besoin arrive —
 * un utilisateur signale sur Discord que son fichier ne passe pas, et il faut pouvoir le
 * débloquer sans ordinateur. D'où le collage de texte plutôt qu'un envoi de fichier, et un
 * aperçu qui reste lisible sur un écran étroit.
 *
 * Trois étapes, dont une seule coûte de l'IA :
 *  1. « Analyser » : un appel modèle (~0,003 $) qui propose la fiche ;
 *  2. corriger un champ si besoin → « Revoir l'aperçu », GRATUIT, autant de fois qu'on veut ;
 *  3. « Enregistrer » : le broker est reconnu pour tous, sans déploiement.
 */
@Component({
  selector: 'mtc-admin-broker-mappings',
  imports: [FormsModule, DatePipe, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './broker-mappings.component.css',
  templateUrl: './broker-mappings.component.html',
})
export class BrokerMappingsComponent {
  private readonly api = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly fiches = signal<BrokerMappingRow[]>([]);
  protected readonly chargement = signal(true);

  protected readonly sample = signal('');
  protected readonly brokerName = signal('');
  protected readonly analyse = signal<BrokerMappingAnalysis | null>(null);
  protected readonly enCours = signal(false);
  protected readonly erreur = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);

  /** Colonnes du fichier collé, pour peupler les listes déroulantes. */
  protected readonly colonnes = computed<string[]>(() => {
    const a = this.analyse();
    const entete = a?.header ?? this.sample().split('\n')[0] ?? '';
    if (!entete.trim()) return [];
    const sep = a?.mapping?.delimiter ?? (entete.includes(';') ? ';' : ',');
    return entete.split(sep).map((c, i) => `${i} · ${c.trim().slice(0, 28)}`);
  });

  /**
   * Le contrôle arithmétique du sens, traduit pour l'écran. C'est LUI qui dit si la fiche est
   * fiable, pas la confiance dans le modèle : l'admin doit le lire avant de valider.
   */
  protected readonly verdict = computed<{ ton: 'ok' | 'alerte' | 'bloque'; texte: string } | null>(() => {
    const a = this.analyse();
    if (!a) return null;
    if (a.pnlRatio == null) {
      return {
        ton: 'bloque',
        texte: "Sens non vérifiable : cet export ne donne pas de prix d'entrée exploitable. "
          + 'Impossible de valider, demande un export plus complet.',
      };
    }
    const pct = Math.round(a.pnlRatio * 100);
    if (a.pnlRatio < 0.8) {
      return { ton: 'bloque', texte: `Le signe du P&L ne confirme le sens que sur ${pct} % des lignes. Corrige la colonne de sens.` };
    }
    if (a.flipped) {
      return { ton: 'alerte', texte: `Sens confirmé à ${pct} %, après redressement automatique : le modèle l'avait inversé. La fiche enregistrée sera la version corrigée.` };
    }
    return { ton: 'ok', texte: `Sens confirmé sur ${pct} % des lignes testables.` };
  });

  /**
   * Les frais additionnés au P&L : le seul champ que le code ne peut pas vérifier. Mesuré le
   * 2026-09-28 : sur le même fichier, le modèle a répondu « commission déjà incluse » puis
   * « commission à additionner » à l'essai suivant, ce qui comptait les frais deux fois.
   * On n'empêche pas d'enregistrer, on met l'admin devant le fait.
   */
  protected readonly avertissementFrais = computed<string | null>(() => {
    const a = this.analyse();
    if (!a?.fraisAdditionnes?.length) return null;
    const noms = a.fraisAdditionnes.map((i) => this.colonnes()[i] ?? `colonne ${i}`).join(', ');
    return `Le P&L additionne : ${noms}. Le code ne peut pas vérifier si ces frais sont déjà `
      + "déduits du P&L. Regarde l'aperçu : si la colonne de P&L s'appelle « net », ils y sont "
      + 'déjà et il faut les retirer.';
  });

  protected setDateFormat(v: string): void {
    this.majMapping((m) => ({
      ...m,
      dateFormat: v === 'dmy' ? 'dmy' : v === 'mdy' ? 'mdy' : 'iso',
    }));
  }

  /** Retire toutes les colonnes de frais additionnees au P&L. */
  protected viderFrais(): void {
    this.majMapping((m) => ({ ...m, pnlExtraColumns: [] }));
  }

  protected readonly enregistrable = computed(() => {
    const v = this.verdict();
    const a = this.analyse();
    return !!a?.mapping && a.preview.length > 0 && v?.ton !== 'bloque' && this.brokerName().trim().length >= 2;
  });

  constructor() {
    this.recharger();
  }

  private recharger(): void {
    this.chargement.set(true);
    this.api.brokerMappings()
      .pipe(catchError(() => of({ data: [] as BrokerMappingRow[] })), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.fiches.set(r.data);
        this.chargement.set(false);
      });
  }

  /** Étape 1 : un appel modèle. La seule qui coûte. */
  protected analyser(): void {
    if (!this.sample().trim()) return;
    this.enCours.set(true);
    this.erreur.set(null);
    this.message.set(null);
    this.api.analyseBrokerSample(this.sample())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.analyse.set(r.data);
          this.enCours.set(false);
        },
        error: (e: { error?: { message?: string } }) => {
          this.erreur.set(e.error?.message ?? "L'analyse a échoué.");
          this.enCours.set(false);
        },
      });
  }

  /** Étape 2 : rejoue la fiche corrigée. AUCUN appel IA, donc répétable sans coût. */
  protected revoir(): void {
    const m = this.analyse()?.mapping;
    if (!m) return;
    this.enCours.set(true);
    this.erreur.set(null);
    this.api.previewBrokerMapping(this.sample(), m)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.analyse.set({ ...r.data, header: this.analyse()?.header ?? r.data.header });
          this.enCours.set(false);
        },
        error: (e: { error?: { message?: string } }) => {
          this.erreur.set(e.error?.message ?? "L'aperçu a échoué.");
          this.enCours.set(false);
        },
      });
  }

  /** Étape 3 : le broker devient reconnu pour tous les utilisateurs. */
  protected enregistrer(): void {
    const m = this.analyse()?.mapping;
    if (!m || !this.enregistrable()) return;
    this.enCours.set(true);
    this.erreur.set(null);
    this.api.saveBrokerMapping(this.sample(), m, this.brokerName().trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.message.set(`« ${this.brokerName().trim()} » est maintenant reconnu pour tous les utilisateurs.`);
          this.analyse.set(null);
          this.sample.set('');
          this.brokerName.set('');
          this.enCours.set(false);
          this.recharger();
        },
        error: (e: { error?: { message?: string } }) => {
          this.erreur.set(e.error?.message ?? "L'enregistrement a échoué.");
          this.enCours.set(false);
        },
      });
  }

  protected basculer(f: BrokerMappingRow): void {
    this.api.setBrokerMappingEnabled(f.id, !f.enabled)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.recharger());
  }

  // ── Édition d'un champ de la fiche ──────────────────────────────────────────

  private majMapping(maj: (m: BrokerMapping) => BrokerMapping): void {
    const a = this.analyse();
    if (!a?.mapping) return;
    this.analyse.set({ ...a, mapping: maj({ ...a.mapping }) });
  }

  /**
   * Champs de colonne modifiables, typés : le gabarit boucle dessus plutôt que d'indexer
   * `columns` avec une chaîne, ce que le compilateur Angular refuse à juste titre.
   */
  protected readonly champsColonnes = [
    { cle: 'symbol', libelle: 'Actif' },
    { cle: 'entry', libelle: "Prix d'entrée" },
    { cle: 'exit', libelle: 'Prix de sortie' },
    { cle: 'quantity', libelle: 'Quantité' },
    { cle: 'pnl', libelle: 'P&L' },
    { cle: 'tradedAt', libelle: 'Date de clôture' },
  ] as const satisfies ReadonlyArray<{ cle: keyof ChampsColonnes; libelle: string }>;

  protected colonneDe(m: BrokerMapping, cle: keyof ChampsColonnes): string {
    const v = m.columns[cle];
    return v == null ? '' : String(v);
  }

  protected setColonne(champ: keyof BrokerMapping['columns'], valeur: string): void {
    const i = valeur === '' ? null : Number(valeur);
    this.majMapping((m) => ({
      ...m,
      columns: { ...m.columns, [champ]: champ === 'entry' ? i : (i ?? 0) },
    }));
  }

  protected setSideMode(mode: string): void {
    this.majMapping((m) => ({
      ...m,
      side: { ...m.side, mode: mode === 'derived_from_timestamps' ? 'derived_from_timestamps' : 'column' },
    }));
  }

  protected setSideChamp(champ: 'index' | 'buyTimeIndex' | 'sellTimeIndex', valeur: string): void {
    const i = valeur === '' ? null : Number(valeur);
    this.majMapping((m) => ({ ...m, side: { ...m.side, [champ]: i } }));
  }

  protected setSideValeurs(champ: 'longValues' | 'shortValues', valeur: string): void {
    const liste = valeur.split(',').map((v) => v.trim()).filter(Boolean);
    this.majMapping((m) => ({ ...m, side: { ...m.side, [champ]: liste } }));
  }

  protected setDelimiter(v: string): void {
    if (v.length !== 1) return;
    this.majMapping((m) => ({ ...m, delimiter: v }));
  }

  protected setDecimal(v: string): void {
    this.majMapping((m) => ({ ...m, decimalSeparator: v === ',' ? ',' : '.' }));
  }
}
