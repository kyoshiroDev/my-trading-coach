import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterModule, RouterLink, RouterLinkActive } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TradovateLiveSocketService } from '../../../core/services/tradovate-live-socket.service';
import {
  LucideDynamicIcon,
  LucideChevronLeft as ChevronLeft,
  LucideChevronRight as ChevronRight,
  LucideLayoutDashboard as LayoutDashboard,
  LucideActivity as Activity,
  LucideBriefcase as Briefcase,
  LucideBookOpen as BookOpen,
  LucideClipboardList as ClipboardList,
  LucideTrendingUp as TrendingUp,
  LucideSparkles as Sparkles,
  LucideCalendarCheck as CalendarCheck,
  LucideGlobe as Globe,
  LucideUsers as Users,
  LucideGift as Gift,
  LucideAward as Award,
  LucideUser as User,
  LucideLogOut as LogOut,
  LucideLock as Lock,
} from '@lucide/angular';
import { UserStore } from '../../../core/stores/user.store';
import { AuthService } from '../../../core/auth/auth.service';
import { UsersApi } from '../../../core/api/users.api';
import { AmbassadorNotifService } from '../../../core/services/ambassador-notif.service';
import { LiveModeService } from '../../../core/services/live-mode.service';
import { DemoService } from '../../../core/services/demo.service';
import { OnboardingComponent } from '../../../features/onboarding/onboarding.component';
import { environment } from '../../../../environments/environment';
import { DialogDirective, ScrollMemoryDirective } from '@mtc/front-ui';

@Component({
  selector: 'mtc-sidebar',
  imports: [
    ScrollMemoryDirective,
    DialogDirective,
    RouterModule,
    RouterLink,
    RouterLinkActive,
    LucideDynamicIcon,
    OnboardingComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sidebar.component.css',
  templateUrl: './sidebar.component.html',
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class SidebarComponent {
  protected readonly userStore = inject(UserStore);
  private readonly auth = inject(AuthService);
  private readonly usersApi = inject(UsersApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly ambassadorNotif = inject(AmbassadorNotifService);
  protected readonly liveModeService = inject(LiveModeService);
  protected readonly demo = inject(DemoService);
  private readonly tradovateLive = inject(TradovateLiveSocketService);
  protected readonly landingUrl = environment.landingUrl;

  protected readonly ChevronLeftIcon = ChevronLeft;
  protected readonly ChevronRightIcon = ChevronRight;

  // Icônes de navigation (Lucide) : fidélité design « The Terminal » (chrome.jsx)
  protected readonly DashboardIcon = LayoutDashboard;
  protected readonly SessionIcon   = Activity;
  protected readonly AccountsIcon  = Briefcase;
  protected readonly JournalIcon   = BookOpen;
  protected readonly SessionsIcon  = ClipboardList;
  protected readonly AnalyticsIcon = TrendingUp;
  protected readonly AiIcon        = Sparkles;
  protected readonly DebriefIcon   = CalendarCheck;
  protected readonly EcoIcon       = Globe;
  protected readonly AmbassadorIcon = Users;
  protected readonly ParrainageIcon = Gift;
  protected readonly ScoringIcon   = Award;
  protected readonly ProfilIcon    = User;
  protected readonly LogoutIcon    = LogOut;
  protected readonly LockIcon      = Lock;

  protected readonly sidebarOpen   = signal(false);

  // Préférence d'UI desktop : sidebar repliée en mode icônes. Persistée en
  // localStorage (préférence purement visuelle, pas besoin du backend).
  private static readonly COLLAPSE_KEY = 'sidebar_collapsed';
  protected readonly collapsed = signal<boolean>(this.readCollapsed());

  private readCollapsed(): boolean {
    try {
      return localStorage.getItem(SidebarComponent.COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private readonly burger = viewChild<ElementRef<HTMLButtonElement>>('burger');
  private readonly drawer = viewChild<ElementRef<HTMLElement>>('drawer');

  /** Menu mobile : à l'ouverture, le focus clavier entre dans le menu (1er lien). */
  protected toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
    if (this.sidebarOpen()) {
      setTimeout(() => this.drawer()?.nativeElement.querySelector<HTMLElement>('.nav-item')?.focus());
    }
  }

  /** Échap ferme le menu mobile ouvert et rend le focus au bouton qui l'a ouvert. */
  protected onEscape(): void {
    if (!this.sidebarOpen()) return;
    this.sidebarOpen.set(false);
    this.burger()?.nativeElement.focus();
  }
  protected closeSidebar(): void {
    this.sidebarOpen.set(false);
  }
  protected toggleCollapse(): void {
    this.collapsed.update((v) => {
      const next = !v;
      try {
        localStorage.setItem(SidebarComponent.COLLAPSE_KEY, next ? '1' : '0');
      } catch { /* préférence non persistée, sans gravité */ }
      return next;
    });
  }

  // Signal local : une fois mis à true, le wizard ne peut plus revenir dans la session
  // même si fetchMe() renvoie onboardingCompleted: false (race condition réseau)
  private readonly onboardingDismissed = signal(false);

  protected readonly showOnboarding = computed(() => {
    if (this.onboardingDismissed()) return false;
    const user = this.userStore.user();
    return !!user && user.onboardingCompleted === false;
  });

  /**
   * Mode focus : la sidebar se replie en icônes **pendant qu'on regarde l'onglet
   * Session live**, et seulement là.
   *
   * Le déclencheur était `hasActiveSession()`, c'est-à-dire « une session est ouverte »
   * — un état qui dure toute la journée de trading. La sidebar restait donc repliée sur
   * le Dashboard, le Journal et partout ailleurs, sans rapport avec le focus voulu.
   * `liveModeService.isLive()` vaut vrai uniquement tant que l'onglet live est affiché
   * (posé par session-day, retiré au changement d'onglet ET en quittant la route).
   *
   * L'état d'avant est mémorisé puis restauré en sortant : la préférence localStorage
   * n'est jamais écrasée, `collapsed.set` ne l'écrit pas (seul `toggleCollapse` le fait).
   * L'effet ne lit `collapsed()` que dans un `untracked` : replier ou déplier à la main
   * pendant le live ne le redéclenche pas, donc le choix de l'utilisateur tient.
   */
  private collapsedBeforeLive: boolean | null = null;

  constructor() {
    effect(() => {
      const live = this.liveModeService.isLive();
      if (live && this.collapsedBeforeLive === null) {
        this.collapsedBeforeLive = untracked(() => this.collapsed());
        this.collapsed.set(true);
      } else if (!live && this.collapsedBeforeLive !== null) {
        this.collapsed.set(this.collapsedBeforeLive);
        this.collapsedBeforeLive = null;
      }
    });

    // Temps réel Tradovate (PROMPT-210 live) : ouvert tant que l'app l'est (le shell vit sur
    // toutes les pages connectées), fermé au logout / à la fermeture de l'onglet. Démo exclue.
    effect(() => {
      const on = this.auth.isAuthenticated() && !this.userStore.isDemo();
      untracked(() => (on ? this.tradovateLive.connect() : this.tradovateLive.disconnect()));
    });
    this.destroyRef.onDestroy(() => this.tradovateLive.disconnect());

    const onFocus = () => {
      if (!this.auth.isAuthenticated()) return;
      this.auth.fetchMe()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          error: () => { /* silently ignore */ },
        });
    };
    window.addEventListener('focus', onFocus);
    this.destroyRef.onDestroy(() =>
      window.removeEventListener('focus', onFocus),
    );
  }

  onOnboardingCompleted() {
    this.onboardingDismissed.set(true);
    const user = this.userStore.user();
    if (user) {
      // setCurrentUser (et non currentUser.set) pour persister dans le localStorage
      this.auth.setCurrentUser({ ...user, onboardingCompleted: true });
    }
    // C'est ICI (écran final du wizard) que l'onboarding est marqué terminé en
    // base : jamais à l'étape stratégie, sinon les étapes Actifs/Premier trade
    // seraient sautées. Optimiste : le flag local est déjà posé ci-dessus.
    this.usersApi
      .finishOnboarding()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => { /* flag local déjà posé, resync au prochain fetchMe */ } });
  }

  logout() {
    // En mode démo : retour à la landing plutôt que l'écran de login.
    if (this.userStore.isDemo()) {
      this.auth.logout();
      window.location.href = this.landingUrl;
      return;
    }
    this.auth.logout();
  }
}
