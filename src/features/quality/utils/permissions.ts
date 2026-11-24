import type { SessionUser } from '../../../types/erp.ts';

/**
 * LOT 8 · Contrôle d'accès côté interface.
 *
 * Le serveur est **l'autorité** : chaque handler appelle `require_perm` et
 * renvoie 403 si le rôle ne dispose pas de la permission (voir
 * `crates/depotpro-core/src/application/auth/rbac.rs`). Ce module ne remplace
 * donc pas la sécurité : il évite à l'utilisateur d'ouvrir un écran ou de
 * cliquer un bouton qui sera de toute façon refusé, et masque les entrées de
 * navigation inaccessibles.
 *
 * Les codes sont exactement ceux produits par `Permission::code()` dans
 * `crates/depotpro-core/src/application/auth/rbac.rs` et renvoyés par
 * `/api/auth/me` dans `SessionIdentity.permissions` : `catalog:read`,
 * `sales:cancel_return`, `supplier_debts:pay`, etc.
 */

export const PERMISSIONS = {
  catalogRead: 'catalog:read',
  catalogWrite: 'catalog:write',
  catalogDelete: 'catalog:delete',
  salesRead: 'sales:read',
  salesWrite: 'sales:write',
  salesCancelReturn: 'sales:cancel_return',
  receivablesRead: 'receivables:read',
  receivablesPay: 'receivables:pay',
  purchasesRead: 'purchases:read',
  purchasesWrite: 'purchases:write',
  supplierDebtsPay: 'supplier_debts:pay',
  stockRead: 'stock:read',
  stockAdjust: 'stock:adjust',
  inventoryValidate: 'inventory:validate',
  consignmentsRead: 'consignments:read',
  consignmentsWrite: 'consignments:write',
  deliveryRunsRead: 'delivery_runs:read',
  deliveryRunsManage: 'delivery_runs:manage',
  deliveryRunsExecute: 'delivery_runs:execute',
  deliveryRunsReconcile: 'delivery_runs:reconcile',
  cashRead: 'cash:read',
  cashOperate: 'cash:operate',
  expensesWrite: 'expenses:write',
  reportsRead: 'reports:read',
  settingsRead: 'settings:read',
  settingsWrite: 'settings:write',
  backupsRead: 'backups:read',
  backupsCreate: 'backups:create',
  backupsRestore: 'backups:restore',
  securityManageUsers: 'security:manage_users',
  securityChangeOwnerPin: 'security:change_owner_pin',
} as const;

export type PermissionName = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Normalise un code de permission pour la comparaison : minuscules et retrait
 * de tout séparateur (`:` et `_`). `catalog:write`, `CatalogWrite` et
 * `catalog_write` se réduisent alors à la même clé, ce qui évite un faux refus
 * d'accès si la sérialisation change côté serveur.
 */
export function normalizePermission(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** L'utilisateur possède-t-il cette permission ? */
export function hasPermission(
  user: Pick<SessionUser, 'permissions'> | null | undefined,
  permission: PermissionName | PermissionName[]
): boolean {
  if (!user || !Array.isArray(user.permissions)) return false;
  const owned = new Set(user.permissions.map(normalizePermission));
  const needed = Array.isArray(permission) ? permission : [permission];
  // Les deux cotes passent par la normalisation : sinon un code serveur
  // `catalog:read` ne correspondrait jamais a la constante `catalog:read`.
  return needed.every((p) => owned.has(normalizePermission(p)));
}

/** L'utilisateur possède-t-il au moins une des permissions listées ? */
export function hasAnyPermission(
  user: Pick<SessionUser, 'permissions'> | null | undefined,
  permissions: PermissionName[]
): boolean {
  if (!user || !Array.isArray(user.permissions)) return false;
  const owned = new Set(user.permissions.map(normalizePermission));
  return permissions.some((p) => owned.has(normalizePermission(p)));
}

/**
 * Permission minimale pour atteindre un écran. `null` = écran ouvert à tout
 * utilisateur authentifié (tableau de bord, point de vente).
 */
export const ROUTE_PERMISSIONS: Record<string, PermissionName | null> = {
  '/': null,
  '/sales/new': PERMISSIONS.salesWrite,
  '/orders': PERMISSIONS.salesRead,
  '/sales': PERMISSIONS.salesRead,
  '/commercial-documents': PERMISSIONS.salesRead,
  '/clients': PERMISSIONS.receivablesRead,
  '/debts': PERMISSIONS.receivablesRead,
  '/products': PERMISSIONS.catalogRead,
  '/catalogue-admin': PERMISSIONS.catalogWrite,
  '/stock': PERMISSIONS.stockRead,
  '/inventories': PERMISSIONS.stockRead,
  '/consignments': PERMISSIONS.consignmentsRead,
  '/delivery-runs': PERMISSIONS.deliveryRunsRead,
  '/suppliers': PERMISSIONS.purchasesRead,
  '/purchases': PERMISSIONS.purchasesRead,
  '/cash': PERMISSIONS.cashRead,
  '/expenses': PERMISSIONS.expensesWrite,
  '/reports': PERMISSIONS.reportsRead,
  '/settings': PERMISSIONS.settingsRead,
  '/backups': PERMISSIONS.backupsRead,
};

/** L'utilisateur peut-il ouvrir cette route ? */
export function canAccessRoute(
  user: Pick<SessionUser, 'permissions'> | null | undefined,
  pathname: string
): boolean {
  const needed = ROUTE_PERMISSIONS[pathname];
  if (needed === undefined) return true; // route inconnue : le serveur tranchera
  if (needed === null) return true;
  return hasPermission(user, needed);
}

/**
 * Tant que `/api/auth/me` n'a pas répondu, `currentUser` est `null`. Refuser
 * l'accès à ce moment-là éjecterait l'utilisateur de force au rechargement.
 * On distingue donc explicitement « inconnu » de « permissions insuffisantes ».
 */
export function accessDecision(
  user: Pick<SessionUser, 'permissions'> | null | undefined,
  pathname: string
): 'allow' | 'deny' | 'unknown' {
  if (!user || !Array.isArray(user.permissions)) return 'unknown';
  return canAccessRoute(user, pathname) ? 'allow' : 'deny';
}
