#!/usr/bin/env node
// Génère une paire de clés VAPID pour le Web Push de l'admin, à ajouter au .env de l'API
// (VPS prod : /opt/apps/mytradingcoach/prod/.env.production). La clé privée ne doit JAMAIS être
// commitée. Une nouvelle paire invalide tous les abonnements existants (réabonner les appareils).
// Usage : node tools/scripts/vapid-generate.mjs
import { createRequire } from 'node:module';

// web-push est une dépendance de l'API (apps/api-mytradingcoach/package.json).
const require = createRequire(new URL('../../apps/api-mytradingcoach/package.json', import.meta.url));
const webpush = require('web-push');

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.error("À ajouter au .env de l'API (la clé privée ne doit jamais être commitée) :\n");
console.log('PUSH_ENABLED=true');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:hello@mytradingcoach.app');
