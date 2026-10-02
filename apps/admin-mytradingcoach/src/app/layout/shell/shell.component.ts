import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideDynamicIcon,
  LucideLayoutDashboard as LayoutDashboard,
  LucideUsers as Users,
  LucideCreditCard as CreditCard,
  LucideActivity as Activity,
  LucideDatabase as Database,
  LucideTrendingUp as TrendingUp,
  LucideRadar as Radar,
  LucideBrain as Brain,
  LucideFileSpreadsheet as FileSpreadsheet,
  LucideMail as Mail,
  LucideLogOut as LogOut,
  LucideHandshake as Handshake,
  LucideMenu as Menu,
  LucideUserX as UserX,
  LucideGift as Gift,
} from '@lucide/angular';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { ScrollMemoryDirective } from '@mtc/front-ui';

@Component({
  selector: 'mtc-admin-shell',
  imports: [ScrollMemoryDirective, RouterOutlet, RouterLink, RouterLinkActive, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './shell.component.css',
  templateUrl: './shell.component.html',
})
export class ShellComponent {
  protected readonly auth = inject(AdminAuthService);
  protected readonly navOpen = signal(false);

  protected readonly MenuIcon = Menu;
  protected readonly UserXIcon = UserX;
  protected readonly DashboardIcon = LayoutDashboard;
  protected readonly UsersIcon = Users;
  protected readonly CreditCardIcon = CreditCard;
  protected readonly ActivityIcon = Activity;
  protected readonly DatabaseIcon = Database;
  protected readonly TrendingUpIcon = TrendingUp;
  protected readonly RadarIcon = Radar;
  protected readonly BrainIcon = Brain;
  protected readonly FileSpreadsheetIcon = FileSpreadsheet;
  protected readonly MailIcon      = Mail;
  protected readonly LogOutIcon    = LogOut;
  protected readonly HandshakeIcon = Handshake;
  protected readonly GiftIcon      = Gift;
}
