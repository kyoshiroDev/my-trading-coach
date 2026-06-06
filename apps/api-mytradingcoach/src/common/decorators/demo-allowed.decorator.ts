import { SetMetadata } from '@nestjs/common';

export const DEMO_ALLOWED_KEY = 'demoAllowed';

/**
 * Autorise explicitement une route de mutation (POST/PUT/PATCH/DELETE) pour le
 * compte démo (isDemo). Par défaut, DemoReadOnlyGuard bloque TOUTES les mutations
 * en démo — n'utiliser que pour une exception réfléchie et inoffensive.
 */
export const DemoAllowed = () => SetMetadata(DEMO_ALLOWED_KEY, true);
