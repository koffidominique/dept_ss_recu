/* ============================================================================
 * LOT 4 — PHASE 4 : Qualité transversale et sécurité opérationnelle
 *
 * Module de règles pures, sans dépendance UI :
 *  - masquage de données sensibles dans les messages d'erreur ;
 *  - classification du message d'erreur réellement affichable ;
 *  - distinction entre « navigateur hors ligne » et « serveur local arrêté » ;
 *  - fraîcheur et lisibilité des sauvegardes ;
 *  - préservation des saisies de formulaire contre la perte accidentelle.
 * ============================================================================ */

/* ----------------------------------------------------------------------------
 * 1. Ne jamais exposer de secret dans une erreur
 * -------------------------------------------------------------------------- */

/**
 * Motifs de secrets qui ne doivent **jamais** atteindre l'écran ni un log.
 * Volontairement conservateurs : on masque dès qu'un motif ressemble à un
 * identifiant, pas seulement quand il est certain.
 */
/**
 * Motifs nommés : le **libellé** du champ est conservé, seule la valeur est
 * masquée. Cela garde le message diagnosticable (« Authorization: [masqué] »
 * indique où était le problème) sans jamais révéler le secret.
 */
const LABELED_SECRET_PATTERN =
  /\b(authorization|bearer|token|passphrase|password|secret|api[_-]?key|pin)\b(\s*[:=]?\s*)(?:bearer\s+)?[\w.\-+/=]{4,}/gi;

const SECRET_PATTERNS: RegExp[] = [
  // Clés JWT / base64 longues
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
  // Chaînes hexadécimales longues (clés, hashes de secret)
  /\b[a-f0-9]{32,}\b/gi,
  // Clés de type sk-... / pk_live_...
  /\b(sk|pk)_(live|test)_[A-Za-z0-9]{8,}\b/g,
];

export const REDACTED_PLACEHOLDER = '[masqué]';

/**
 * Masque tout secret potentiel dans un texte destiné à l'affichage.
 * Ne supprime jamais la structure du message : seul le secret devient illisible.
 */
export function redactSecrets(text: string): string {
  if (!text) return '';
  // 1) Champs nommés : on garde « Authorization : » et on masque la valeur.
  let out = text.replace(
    LABELED_SECRET_PATTERN,
    (_match, label: string, sep: string) => `${label}${sep || ' '}${REDACTED_PLACEHOLDER}`
  );
  // 2) Motifs autonomes (JWT, hex long, clés préfixées) : remplacement sec.
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED_PLACEHOLDER);
  }
  return out;
}

/** `true` si le texte contenait au moins un secret masquable. */
export function containsSecret(text: string): boolean {
  if (!text) return false;
  return redactSecrets(text) !== text;
}

/* ----------------------------------------------------------------------------
 * 2. Message d'erreur réellement affichable
 * -------------------------------------------------------------------------- */

export interface DisplayableError {
  /** Message sûr, masqué, affichable tel quel à l'opérateur. */
  message: string;
  /** Code machine quand il est connu (`NETWORK_ERROR`, `TIMEOUT_ERROR`, …). */
  code: string | null;
  /** L'opération n'a pas pu être confirmée : il faut vérifier avant de relancer. */
  isUnconfirmed: boolean;
  /** Un secret a été détecté et masqué dans le message brut. */
  secretsRedacted: boolean;
}

const FALLBACK_ERROR_MESSAGE =
  'L’opération a échoué. Vérifiez l’état de l’enregistrement avant de réessayer.';

/**
 * Transforme n'importe quelle erreur en message affichable, jamais silencieux
 * et jamais bavard sur les secrets.
 */
export function toDisplayableError(
  err: unknown,
  options: { fallback?: string } = {}
): DisplayableError {
  const fallback = options.fallback ?? FALLBACK_ERROR_MESSAGE;
  let rawMessage: string;
  let code: string | null = null;

  if (err instanceof Error) {
    rawMessage = err.message || fallback;
    const maybeCode = (err as { code?: unknown }).code;
    if (typeof maybeCode === 'string' && /^[A-Z][A-Z0-9_]*$/.test(maybeCode)) {
      code = maybeCode;
    }
  } else if (typeof err === 'string') {
    rawMessage = err;
  } else {
    rawMessage = fallback;
  }

  const secretsRedacted = containsSecret(rawMessage);
  const message = redactSecrets(rawMessage).trim() || fallback;

  const isUnconfirmed =
    code === 'NETWORK_ERROR' ||
    code === 'TIMEOUT_ERROR' ||
    /aucune écriture n’a été validée|n’a pas pu être confirmée|n’a pas été confirmée/i.test(
      message
    );

  return { message, code, isUnconfirmed, secretsRedacted };
}

/* ----------------------------------------------------------------------------
 * 3. Serveur local : vivant ou arrêté ?
 * -------------------------------------------------------------------------- */

export type LocalServerState = 'online' | 'offline' | 'server-unreachable';

export interface LocalServerProbeInput {
  /** `navigator.onLine` — la carte réseau du poste répond-elle ? */
  browserOnline: boolean;
  /** Résultat du dernier appel API réussi, `null` si aucun appel n'a encore abouti. */
  lastSuccessfulApiCallAt: Date | null;
  /** Code d'erreur du dernier appel API en échec, `null` si le dernier a réussi. */
  lastApiErrorCode: string | null;
  now: Date;
}

/** Au-delà de ce délai sans succès, le serveur local est considéré injoignable. */
export const SERVER_PROBE_STALE_MS = 60_000;

/**
 * Distingue trois situations que l'interface confondait auparavant :
 *  - `offline` : le navigateur lui-même est hors ligne (carte réseau, wifi) ;
 *  - `server-unreachable` : le navigateur a du réseau, mais le **serveur local**
 *    ne répond pas (processus arrêté, port fermé) ;
 *  - `online` : le dernier appel API a abouti récemment.
 */
export function resolveLocalServerState(input: LocalServerProbeInput): LocalServerState {
  if (!input.browserOnline) return 'offline';

  if (input.lastApiErrorCode === 'NETWORK_ERROR' || input.lastApiErrorCode === 'TIMEOUT_ERROR') {
    if (!input.lastSuccessfulApiCallAt) return 'server-unreachable';
    const age = input.now.getTime() - input.lastSuccessfulApiCallAt.getTime();
    if (age >= 0) return 'server-unreachable';
  }

  // Aucun appel réussi connu : l'état n'est **pas prouvé**. Le déclarer
  // « en ligne » reviendrait à afficher une confiance sans preuve, exactement ce
  // que la Phase 4 interdit. On reste donc prudent jusqu'au premier succès.
  if (!input.lastSuccessfulApiCallAt) return 'server-unreachable';
  return 'online';
}

export interface LocalServerMessage {
  title: string;
  detail: string;
  /** Sévérité pour la couleur du bandeau, mais le titre porte déjà l'information. */
  severity: 'warning' | 'critical';
}

/** Message exact à afficher selon l'état — jamais une fausse confirmation. */
export function describeLocalServerState(
  state: LocalServerState,
  offlineSince: Date | null
): LocalServerMessage | null {
  if (state === 'online') return null;

  const sinceLabel = offlineSince
    ? ` depuis ${offlineSince.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : '';

  if (state === 'offline') {
    return {
      title: `Poste hors ligne${sinceLabel}`,
      detail:
        'La connexion réseau de ce poste est indisponible. Vos saisies restent affichées, mais aucune écriture n’est validée tant que la connexion n’est pas rétablie.',
      severity: 'warning',
    };
  }

  return {
    title: `Serveur local injoignable${sinceLabel}`,
    detail:
      'Le poste a du réseau, mais le serveur local ne répond pas (processus arrêté ou port fermé). Aucune écriture n’est validée : relancez le serveur local, puis vérifiez l’enregistrement avant de réessayer.',
    severity: 'critical',
  };
}

/* ----------------------------------------------------------------------------
 * 4. Sauvegardes : fraîcheur lisible
 * -------------------------------------------------------------------------- */

export const BACKUP_OK_DAYS = 7;
export const BACKUP_CRITICAL_DAYS = 14;

export type BackupFreshness = 'none' | 'fresh' | 'aging' | 'stale';

export interface BackupHealth {
  freshness: BackupFreshness;
  /** Nombre de jours entiers depuis la dernière sauvegarde, `null` si aucune. */
  daysSinceLastBackup: number | null;
  label: string;
  detail: string;
}

/**
 * Qualifie la fraîcheur d'une sauvegarde. Le calcul est une **durée**, pas un
 * indicateur métier : aucune donnée comptable n'est dérivée ici.
 */
export function evaluateBackupHealth(
  lastBackupAt: string | null | undefined,
  now: Date
): BackupHealth {
  if (!lastBackupAt) {
    return {
      freshness: 'none',
      daysSinceLastBackup: null,
      label: 'Aucune sauvegarde',
      detail:
        'Aucune sauvegarde cohérente n’est enregistrée. Une panne disque entraînerait une perte définitive des données.',
    };
  }

  const last = new Date(lastBackupAt).getTime();
  if (Number.isNaN(last)) {
    return {
      freshness: 'none',
      daysSinceLastBackup: null,
      label: 'Date de sauvegarde illisible',
      detail: 'La date de la dernière sauvegarde est inexploitable : vérifiez le dossier de sauvegardes.',
    };
  }

  const days = Math.floor((now.getTime() - last) / 86_400_000);

  if (days >= BACKUP_CRITICAL_DAYS) {
    return {
      freshness: 'stale',
      daysSinceLastBackup: days,
      label: `Sauvegarde critique · ${days} j`,
      detail: `La dernière sauvegarde date de ${days} jours (seuil ${BACKUP_CRITICAL_DAYS} j). Une panne disque entraînerait la perte de ${days} jours d’activité.`,
    };
  }
  if (days >= BACKUP_OK_DAYS) {
    return {
      freshness: 'aging',
      daysSinceLastBackup: days,
      label: `Sauvegarde à renouveler · ${days} j`,
      detail: `La dernière sauvegarde date de ${days} jours (seuil ${BACKUP_OK_DAYS} j).`,
    };
  }
  return {
    freshness: 'fresh',
    daysSinceLastBackup: days,
    label: days === 0 ? 'Sauvegarde du jour' : `Sauvegarde récente · ${days} j`,
    detail:
      days === 0
        ? 'Une sauvegarde cohérente a été créée aujourd’hui.'
        : `La dernière sauvegarde date de ${days} jour(s).`,
  };
}

/* ----------------------------------------------------------------------------
 * 5. Protection des saisies : formulaire modifié non soumis
 * -------------------------------------------------------------------------- */

export interface DirtyFormState {
  dirty: boolean;
  /** `true` s'il existe au moins un champ non enregistré. */
  hasUnsavedChanges: boolean;
  /** Message à afficher dans la confirmation de fermeture. */
  leaveWarning: string | null;
}

/**
 * Décide s'il faut demander confirmation avant de fermer un formulaire.
 * `dirty === true` et `submitting === false` : ne jamais fermer silencieusement.
 */
export function evaluateUnsavedChanges(input: {
  dirty: boolean;
  submitting: boolean;
  contextLabel?: string;
}): DirtyFormState {
  const hasUnsavedChanges = input.dirty && !input.submitting;
  return {
    dirty: input.dirty,
    hasUnsavedChanges,
    leaveWarning: hasUnsavedChanges
      ? `Des saisies non enregistrées sont présentes${input.contextLabel ? ` dans « ${input.contextLabel} »` : ''}. Fermer maintenant les perdra définitivement.`
      : null,
  };
}

/* ----------------------------------------------------------------------------
 * 6. Focus visible : utilitaire de testabilité (aucun style inline)
 * -------------------------------------------------------------------------- */

/** Classes de focus à appliquer aux éléments interactifs non stylés par le DS. */
export const FOCUS_RING_CLASS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#111A2E]';

/**
 * En-têtes de tableau : détermine le `scope` correct.
 * Un tableau de données simple a des en-têtes de colonne ; un tableau à double
 * entrée a besoin d'en-têtes de ligne.
 */
export function headerScope(isRowHeader = false): 'row' | 'col' {
  return isRowHeader ? 'row' : 'col';
}
