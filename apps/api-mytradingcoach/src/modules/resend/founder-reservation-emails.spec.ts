import { describe, it, expect } from 'vitest';
import { founderReservationTemplate, paymentActionRequiredTemplate } from './templates';

// #769, B1 : e-mails de la réservation fondateur pendant le Premium offert et du 3D Secure.
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\u00a0|\u202f/g, ' ').replace(/\s+/g, ' ');

describe('réservation fondateur', () => {
  const mail = founderReservationTemplate({
    userName: 'Alex', number: 12, priceLabel: '29,00 € par mois', firstChargeAt: new Date('2026-11-16T10:00:00Z'), appUrl: 'https://app.test',
  });
  it('place, date du premier prélèvement, annulation possible, place rendue si échec, garantie à partir du prélèvement', () => {
    const t = text(mail.html);
    expect(mail.subject).toBe('Ta place fondateur n° 12 est réservée');
    expect(t).toContain('Premier prélèvement de 29,00 € par mois le 16 novembre 2026, pas avant.');
    expect(t).toContain('Tu peux annuler avant le 16 novembre 2026 depuis ton profil : aucun prélèvement, la place est rendue.');
    expect(t).toContain('Si le prélèvement échoue définitivement, la place est rendue.');
    expect(t).toContain('Satisfait ou remboursé 14 jours à partir du premier prélèvement.');
    expect(t).not.toMatch(/remboursé jusqu/);
  });
});

describe('paiement à confirmer (3D Secure)', () => {
  it('lien de la facture Stripe, sans montant ni promesse', () => {
    const mail = paymentActionRequiredTemplate({ userName: 'Alex', invoiceUrl: 'https://invoice.stripe.test/i' });
    expect(mail.subject).toBe('Confirme ton paiement');
    expect(mail.html).toContain('href="https://invoice.stripe.test/i"');
    expect(text(mail.html)).toContain('ta banque demande une confirmation pour ce prélèvement');
  });
});
