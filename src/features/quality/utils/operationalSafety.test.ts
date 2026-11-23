import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BACKUP_CRITICAL_DAYS,
  BACKUP_OK_DAYS,
  containsSecret,
  describeLocalServerState,
  evaluateBackupHealth,
  evaluateUnsavedChanges,
  headerScope,
  redactSecrets,
  resolveLocalServerState,
  toDisplayableError,
} from './operationalSafety.ts';

const NOW = new Date('2026-11-23T12:00:00Z');

test('redactSecrets masque jetons, phrases secrètes et clés longues sans détruire le message', () => {
  assert.equal(
    redactSecrets('Authorization: Bearer abcdef123456789'),
    'Authorization: [masqué]'
  );
  assert.equal(redactSecrets('Mot de passe refusé.'), 'Mot de passe refusé.');
  assert.match(redactSecrets('passphrase=super-secret-2026'), /\[masqué\]/);
  assert.match(redactSecrets('token: 9f8e7d6c5b4a39281706'), /\[masqué\]/);
  assert.match(
    redactSecrets('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk'),
    /\[masqué\]/
  );
  assert.match(redactSecrets('clé sk_live_ABCDEFGH12345678'), /\[masqué\]/);
  // Une empreinte SHA-256 longue est masquée
  assert.match(redactSecrets('sha256 ' + 'a'.repeat(64)), /\[masqué\]/);
  // Le message reste lisible et le libellé du champ est conservé (diagnosticable)
  assert.equal(
    redactSecrets('Échec pour le fournisseur Alpha avec token=abc123'),
    'Échec pour le fournisseur Alpha avec token=[masqué]'
  );
  assert.equal(
    redactSecrets('Authorization: Bearer abcdef123456789'),
    'Authorization: [masqué]'
  );
});

test('containsSecret détecte la présence d’un secret sans le révéler', () => {
  assert.equal(containsSecret('Bonjour'), false);
  assert.equal(containsSecret(''), false);
  assert.equal(containsSecret('password=hunter22026'), true);
});

test('toDisplayableError ne divulgue jamais un secret et signale une opération non confirmée', () => {
  const withSecret = new Error('Réponse 401 : Authorization: Bearer eyJabc123def456');
  const displayable = toDisplayableError(withSecret);
  assert.equal(displayable.secretsRedacted, true);
  assert.doesNotMatch(displayable.message, /eyJabc123def456/);
  assert.match(displayable.message, /\[masqué\]/);

  const networkErr = Object.assign(new Error('Connexion au serveur local indisponible'), {
    code: 'NETWORK_ERROR',
  });
  const net = toDisplayableError(networkErr);
  assert.equal(net.code, 'NETWORK_ERROR');
  assert.equal(net.isUnconfirmed, true);
  assert.equal(net.secretsRedacted, false);

  const timeout = Object.assign(new Error('Délai dépassé'), { code: 'TIMEOUT_ERROR' });
  assert.equal(toDisplayableError(timeout).isUnconfirmed, true);

  // Validation métier : ce n'est pas une opération « non confirmée »
  const validation = Object.assign(new Error('Le motif est obligatoire.'), {
    code: 'VALIDATION_ERROR',
  });
  assert.equal(toDisplayableError(validation).isUnconfirmed, false);

  // Entrées non-Error : jamais de message vide
  assert.match(toDisplayableError(null).message, /L’opération a échoué/);
  assert.match(toDisplayableError(undefined).message, /L’opération a échoué/);
  assert.equal(toDisplayableError('Erreur brute').message, 'Erreur brute');
  assert.equal(toDisplayableError(new Error('')).secretsRedacted, false);
  assert.match(toDisplayableError(new Error('')).message, /L’opération a échoué/);
});

test('resolveLocalServerState distingue poste hors ligne et serveur local arrêté', () => {
  const base = {
    browserOnline: true,
    lastSuccessfulApiCallAt: new Date(NOW.getTime() - 5_000),
    lastApiErrorCode: null as string | null,
    now: NOW,
  };

  assert.equal(resolveLocalServerState(base), 'online');
  assert.equal(
    resolveLocalServerState({ ...base, browserOnline: false, lastApiErrorCode: 'NETWORK_ERROR' }),
    'offline'
  );
  assert.equal(
    resolveLocalServerState({ ...base, lastApiErrorCode: 'NETWORK_ERROR' }),
    'server-unreachable'
  );
  assert.equal(
    resolveLocalServerState({ ...base, lastApiErrorCode: 'TIMEOUT_ERROR' }),
    'server-unreachable'
  );
  // Une erreur métier (validation) ne signifie pas que le serveur est mort
  assert.equal(resolveLocalServerState({ ...base, lastApiErrorCode: 'VALIDATION_ERROR' }), 'online');
  // Aucun appel réussi connu : l'état n'est pas prouvé, donc on n'affirme PAS
  // que le serveur répond. (Comportement corrigé au Lot 6 : la version
  // précédente retournait « online » sans preuve.)
  assert.equal(
    resolveLocalServerState({ ...base, lastSuccessfulApiCallAt: null }),
    'server-unreachable'
  );
});

test('describeLocalServerState ne dit jamais qu’une écriture est validée', () => {
  assert.equal(describeLocalServerState('online', null), null);

  const offline = describeLocalServerState('offline', new Date('2026-11-23T08:00:00Z'));
  assert.ok(offline);
  assert.match(offline.title, /Poste hors ligne/);
  assert.match(offline.detail, /aucune écriture n’est validée/);
  assert.equal(offline.severity, 'warning');

  const unreachable = describeLocalServerState('server-unreachable', null);
  assert.ok(unreachable);
  assert.match(unreachable.title, /Serveur local injoignable/);
  assert.match(unreachable.detail, /processus arrêté ou port fermé/);
  assert.match(unreachable.detail, /vérifiez l’enregistrement avant de réessayer/);
  assert.equal(unreachable.severity, 'critical');

  for (const msg of [offline, unreachable]) {
    assert.doesNotMatch(msg.detail, /validée avec succès|enregistrée avec succès|opération réussie/);
  }
});

test('evaluateBackupHealth qualifie absence, fraîcheur, vieillissement et criticité', () => {
  const none = evaluateBackupHealth(null, NOW);
  assert.equal(none.freshness, 'none');
  assert.equal(none.daysSinceLastBackup, null);

  const illisible = evaluateBackupHealth('pas-une-date', NOW);
  assert.equal(illisible.freshness, 'none');

  const fresh = evaluateBackupHealth(new Date(NOW.getTime() - 3_600_000).toISOString(), NOW);
  assert.equal(fresh.freshness, 'fresh');
  assert.equal(fresh.daysSinceLastBackup, 0);
  assert.match(fresh.label, /du jour/);

  const aging = evaluateBackupHealth(
    new Date(NOW.getTime() - (BACKUP_OK_DAYS + 1) * 86_400_000).toISOString(),
    NOW
  );
  assert.equal(aging.freshness, 'aging');
  assert.equal(aging.daysSinceLastBackup, BACKUP_OK_DAYS + 1);

  const stale = evaluateBackupHealth(
    new Date(NOW.getTime() - (BACKUP_CRITICAL_DAYS + 3) * 86_400_000).toISOString(),
    NOW
  );
  assert.equal(stale.freshness, 'stale');
  assert.match(stale.detail, /perte de 17 jours d’activité/);
});

test('evaluateUnsavedChanges protège une saisie en cours sans bloquer une soumission', () => {
  const clean = evaluateUnsavedChanges({ dirty: false, submitting: false });
  assert.equal(clean.hasUnsavedChanges, false);
  assert.equal(clean.leaveWarning, null);

  const dirty = evaluateUnsavedChanges({
    dirty: true,
    submitting: false,
    contextLabel: 'Clôture de caisse',
  });
  assert.equal(dirty.hasUnsavedChanges, true);
  assert.match(dirty.leaveWarning ?? '', /Clôture de caisse/);
  assert.match(dirty.leaveWarning ?? '', /perdra définitivement/);

  // Pendant la soumission, on ne propose pas de « perdre » : l'écriture est en cours
  const submitting = evaluateUnsavedChanges({ dirty: true, submitting: true });
  assert.equal(submitting.hasUnsavedChanges, false);
  assert.equal(submitting.leaveWarning, null);
});

test('headerScope documente le scope ARIA attendu pour les en-têtes', () => {
  assert.equal(headerScope(false), 'col');
  assert.equal(headerScope(true), 'row');
});
