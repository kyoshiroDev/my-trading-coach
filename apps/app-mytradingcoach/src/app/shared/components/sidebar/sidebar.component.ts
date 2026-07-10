import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterModule, RouterLink, RouterLinkActive } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  LucideAngularModule,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Activity,
  Briefcase,
  BookOpen,
  ClipboardList,
  TrendingUp,
  Sparkles,
  CalendarCheck,
  Globe,
  Users,
  Gift,
  Award,
  User,
  LogOut,
} from 'lucide-angular';
import { UserStore } from '../../../core/stores/user.store';
import { TradesStore } from '../../../core/stores/trades.store';
import { AuthService } from '../../../core/auth/auth.service';
import { UsersApi } from '../../../core/api/users.api';
import { AmbassadorNotifService } from '../../../core/services/ambassador-notif.service';
import { LiveModeService } from '../../../core/services/live-mode.service';
import { SessionStore } from '../../../core/stores/session.store';
import { DemoService } from '../../../core/services/demo.service';
import { OnboardingComponent } from '../../../features/onboarding/onboarding.component';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'mtc-sidebar',
  standalone: true,
  imports: [
    RouterModule,
    RouterLink,
    RouterLinkActive,
    LucideAngularModule,
    OnboardingComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sidebar.component.css',
  template: `
    @if (showOnboarding()) {
      <mtc-onboarding (completed)="onOnboardingCompleted()" />
    }

    <button class="burger" (click)="toggleSidebar()" aria-label="Menu">
      <span></span><span></span><span></span>
    </button>

    <button
      class="sidebar-overlay"
      [class.open]="sidebarOpen()"
      (click)="closeSidebar()"
      aria-label="Fermer le menu"
      tabindex="-1"
    ></button>

    <div class="app-layout">
      <!-- ─── SIDEBAR ─── -->
      <aside class="sidebar" [class.open]="sidebarOpen()" [class.collapsed]="collapsed()">
        <!-- Logo (complet déplié / marque seule replié) -->
        <a routerLink="/dashboard" class="logo">
          <img class="logo-full" src="icon/logo-horizontal.svg" alt="MyTradingCoach" height="40" />
          <img class="logo-mark" src="logo.svg" alt="MyTradingCoach" height="32" width="32" />
        </a>

        <!-- Nav -->
        <nav class="nav">
          <div class="nav-section">OVERVIEW</div>

          <a
            routerLink="/dashboard"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-dashboard"
            [attr.title]="collapsed() ? 'Dashboard' : null"
            (click)="closeSidebar()"
          >
            <lucide-icon [img]="DashboardIcon" [size]="16" class="nav-icon" />
            <span class="nav-label">Dashboard</span>
          </a>

          <a
            routerLink="/session"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-session"
            [attr.title]="collapsed() ? 'Ma session' : null"
            (click)="closeSidebar()"
          >
            <lucide-icon [img]="SessionIcon" [size]="16" class="nav-icon" />
            <span class="nav-label">Ma session</span>
          </a>

          @if (userStore.isStarterOrAbove()) {
            <a
              routerLink="/accounts"
              routerLinkActive="active"
              class="nav-item"
              data-testid="nav-accounts"
              [attr.title]="collapsed() ? 'Mes comptes' : null"
              (click)="closeSidebar()"
            >
              <lucide-icon [img]="AccountsIcon" [size]="16" class="nav-icon" />
              <span class="nav-label">Mes comptes</span>
            </a>
          }

          <a
            routerLink="/journal"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-journal"
            [attr.title]="collapsed() ? 'Journal' : null"
            (click)="closeSidebar()"
          >
            <lucide-icon [img]="JournalIcon" [size]="16" class="nav-icon" />
            <span class="nav-label">Journal</span>
          </a>

          <a
            routerLink="/sessions"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-sessions"
            [attr.title]="collapsed() ? 'Mes sessions' : null"
            (click)="closeSidebar()"
          >
            <lucide-icon [img]="SessionsIcon" [size]="16" class="nav-icon" />
            <span class="nav-label">Mes sessions</span>
          </a>

          <a
            routerLink="/analytics"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-analytics"
            [attr.title]="collapsed() ? 'Analytics' : null"
            (click)="closeSidebar()"
          >
            <lucide-icon [img]="AnalyticsIcon" [size]="16" class="nav-icon" />
            <span class="nav-label">Analytics</span>
            @if (!userStore.isStarterOrAbove()) {
              <span class="badge starter">STARTER</span>
            }
          </a>

          <div class="nav-section">ANALYSE &amp; IA</div>

          <a
            routerLink="/ai-insights"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-ai-insights"
            [attr.title]="collapsed() ? 'IA Insights' : null"
            (click)="closeSidebar()"
          >
            <lucide-icon [img]="AiIcon" [size]="16" class="nav-icon" />
            <span class="nav-label">IA Insights</span>
            @if (!userStore.isPremium()) {
              <span class="badge">AI</span>
            }
          </a>

          <a
            routerLink="/debrief"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-debrief"
            [attr.title]="collapsed() ? 'Weekly Debrief' : null"
            (click)="closeSidebar()"
          >
            <lucide-icon [img]="DebriefIcon" [size]="16" class="nav-icon" />
            <span class="nav-label">Weekly Debrief</span>
            @if (!userStore.isStarterOrAbove()) {
              <span class="badge starter">STARTER</span>
            }
          </a>

          <a
            routerLink="/eco-calendar"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-eco-calendar"
            [attr.title]="collapsed() ? 'Calendrier éco' : null"
            (click)="closeSidebar()"
          >
            <lucide-icon [img]="EcoIcon" [size]="16" class="nav-icon" />
            <span class="nav-label">Calendrier éco</span>
          </a>

          <!-- Surface(s) de parrainage selon le rôle. L'admin voit les DEUX. -->
          @if (userStore.isAmbassador()) {
            <a
              routerLink="/ambassador"
              routerLinkActive="active"
              class="nav-item"
              data-testid="nav-ambassador"
              [attr.title]="collapsed() ? 'Ambassadeur' : null"
              (click)="closeSidebar()"
            >
              <lucide-icon [img]="AmbassadorIcon" [size]="16" class="nav-icon" />
              <span class="nav-label">Ambassadeur</span>
              @if (ambassadorNotif.newReferrals() > 0) {
                <span class="nav-badge-notif">{{ ambassadorNotif.newReferrals() }}</span>
              }
            </a>
          }
          @if (!userStore.isAmbassador() || userStore.isAdmin()) {
            <a
              routerLink="/parrainage"
              routerLinkActive="active"
              class="nav-item"
              data-testid="nav-parrainage"
              [attr.title]="collapsed() ? 'Parrainage' : null"
              (click)="closeSidebar()"
            >
              <lucide-icon [img]="ParrainageIcon" [size]="16" class="nav-icon" />
              <span class="nav-label">Parrainage</span>
            </a>
          }

          <div class="nav-section">ACCOUNT</div>

          <a
            routerLink="/scoring"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-scoring"
            [attr.title]="collapsed() ? 'Scoring' : null"
            (click)="closeSidebar()"
          >
            <lucide-icon [img]="ScoringIcon" [size]="16" class="nav-icon" />
            <span class="nav-label">Scoring</span>
            @if (!userStore.isStarterOrAbove()) {
              <span class="badge starter">STARTER</span>
            }
          </a>

          <a
            routerLink="/profil"
            routerLinkActive="active"
            class="nav-item"
            data-testid="nav-settings"
            [attr.title]="collapsed() ? 'Profil' : null"
            (click)="closeSidebar()"
          >
            <lucide-icon [img]="ProfilIcon" [size]="16" class="nav-icon" />
            <span class="nav-label">Profil</span>
          </a>

          <button
            class="nav-item settings-item"
            data-testid="logout-btn"
            [attr.title]="collapsed() ? (userStore.isDemo() ? 'Quitter la démo' : 'Déconnexion') : null"
            (click)="closeSidebar(); logout()"
          >
            <lucide-icon [img]="LogoutIcon" [size]="16" class="nav-icon" />
            <span class="nav-label">@if (userStore.isDemo()) { Quitter la démo } @else { Déconnexion }</span>
          </button>
        </nav>

        <!-- Profil (design chrome.jsx : logo → nav → logout → profil ;
             le quota + Discord vivent désormais dans la topbar) -->
        <div class="sidebar-footer">
          <div class="user-card" [attr.title]="collapsed() ? userStore.displayName() : null">
            <div class="avatar">{{ userStore.initials() }}</div>
            <div class="user-info">
              <div class="user-name">{{ userStore.displayName() }}</div>
              <div class="user-plan"
                [class.premium]="userStore.isPremium()"
                [class.starter]="!userStore.isPremium() && userStore.isStarterOrAbove()"
                [class.free]="!userStore.isStarterOrAbove()">
                @if (userStore.isPremium()) {
                  ★ PREMIUM
                } @else if (userStore.isStarterOrAbove()) {
                  ★ STARTER
                } @else {
                  GRATUIT
                }
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- Flèche de repli sur le bord (desktop) — ancrée sur .app-layout pour ne pas
           être coupée par l'overflow:hidden de .sidebar -->
      <button
        type="button"
        class="collapse-edge"
        [class.collapsed]="collapsed()"
        data-testid="sidebar-collapse-toggle"
        (click)="toggleCollapse()"
        [attr.aria-label]="collapsed() ? 'Déplier la barre latérale' : 'Replier la barre latérale'"
      >
        <lucide-icon [img]="collapsed() ? ChevronRightIcon : ChevronLeftIcon" [size]="16" />
      </button>

      <!-- ─── MAIN ─── -->
      <main class="main-content"
            [style.overflow]="liveModeService.isLive() ? 'hidden' : null">
        @if (userStore.isDemo()) {
          <div class="demo-banner">
            <span class="demo-banner-text">
              🔍 <strong>Mode démo</strong> : tu explores MyTradingCoach avec des données d'exemple.
            </span>
            <a class="demo-banner-cta" [href]="landingUrl + '/#pricing'">Créer mon compte gratuit →</a>
          </div>
        }
        <router-outlet />
      </main>
    </div>

    @if (demo.showSignupPrompt()) {
      <div class="demo-modal-overlay" role="button" tabindex="-1"
           (click)="demo.dismiss()" (keydown.escape)="demo.dismiss()">
        <div class="demo-modal" role="dialog"
             (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
          <div class="demo-modal-emoji">🚀</div>
          <h2 class="demo-modal-title">Crée ton compte pour aller plus loin</h2>
          <p class="demo-modal-text">
            En mode démo, les données sont en lecture seule. Crée ton compte gratuit
            pour logger tes vrais trades et débloquer ton coaching personnalisé.
          </p>
          <a class="demo-modal-cta" [href]="landingUrl + '/#pricing'">Créer mon compte gratuit →</a>
          <button class="demo-modal-dismiss" (click)="demo.dismiss()">Continuer la démo</button>
        </div>
      </div>
    }
  `,
})
export class SidebarComponent {
  protected readonly userStore = inject(UserStore);
  protected readonly tradesStore = inject(TradesStore);
  private readonly auth = inject(AuthService);
  private readonly usersApi = inject(UsersApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly ambassadorNotif = inject(AmbassadorNotifService);
  protected readonly liveModeService = inject(LiveModeService);
  private readonly sessionStore = inject(SessionStore);
  protected readonly demo = inject(DemoService);
  protected readonly landingUrl = environment.landingUrl;

  protected readonly ChevronLeftIcon = ChevronLeft;
  protected readonly ChevronRightIcon = ChevronRight;

  // Icônes de navigation (Lucide) — fidélité design « The Terminal » (chrome.jsx)
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

  protected toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
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

  // Signal local — une fois mis à true, le wizard ne peut plus revenir dans la session
  // même si fetchMe() renvoie onboardingCompleted: false (race condition réseau)
  private readonly onboardingDismissed = signal(false);

  protected readonly showOnboarding = computed(() => {
    if (this.onboardingDismissed()) return false;
    const user = this.userStore.user();
    return !!user && user.onboardingCompleted === false;
  });

  // Mode focus « session live » : quand une session est active, on replie la
  // sidebar en icônes (fidélité maquette). L'état manuel de l'utilisateur est
  // mémorisé puis restauré à la clôture — la préférence localStorage n'est jamais
  // écrasée (collapsed.set n'écrit pas le localStorage, seul toggleCollapse le fait).
  private collapsedBeforeSession: boolean | null = null;

  constructor() {
    this.tradesStore.loadMonthlyCount();

    effect(() => {
      const active = this.sessionStore.hasActiveSession();
      if (active && this.collapsedBeforeSession === null) {
        this.collapsedBeforeSession = untracked(() => this.collapsed());
        this.collapsed.set(true);
      } else if (!active && this.collapsedBeforeSession !== null) {
        this.collapsed.set(this.collapsedBeforeSession);
        this.collapsedBeforeSession = null;
      }
    });

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
    // base — jamais à l'étape stratégie, sinon les étapes Actifs/Premier trade
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
