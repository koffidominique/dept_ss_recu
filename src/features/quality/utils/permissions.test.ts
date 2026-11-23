import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PERMISSIONS,
  ROUTE_PERMISSIONS,
  accessDecision,
  canAccessRoute,
  hasAnyPermission,
  hasPermission,
  normalizePermission,
} from './permissions.ts';

/**
 * Contrat de permissions (LOT 8).
 *
 * Les codes attendus doivent rester identiques à ceux produits par
 * `Permission::code()` dans `crates/depotpro-core/src/application/auth/rbac.rs`.
 * Si le serveur change un code, ces tests le signalent avant que l'interface
 * ne masque un écran à tort.
 */

function user(permissions: string[]): { permissions: string[] } {
  return { permissions };
}

describe('normalizePermission accepte les trois sérialisations', () => {
  it('réduit catalog:write, CatalogWrite et catalog_write à la même clé', () => {
    const key = normalizePermission(PERMISSIONS.catalogWrite);
    assert.equal(normalizePermission('catalog:write'), key);
    assert.equal(normalizePermission('CatalogWrite'), key);
    assert.equal(normalizePermission('catalog_write'), key);
    assert.equal(normalizePermission('CATALOG_WRITE'), key);
  });

  it('ne confond pas read et write', () => {
    assert.notEqual(
      normalizePermission(PERMISSIONS.catalogRead),
      normalizePermission(PERMISSIONS.catalogWrite)
    );
  });
});

describe('hasPermission', () => {
  it('refuse un utilisateur absent', () => {
    assert.equal(hasPermission(null, PERMISSIONS.catalogRead), false);
    assert.equal(hasPermission(undefined, PERMISSIONS.catalogRead), false);
  });

  it('refuse une liste de permissions manquante ou malformée', () => {
    assert.equal(hasPermission({} as never, PERMISSIONS.catalogRead), false);
  });

  it('accepte la forme exacte du serveur (separateur deux-points)', () => {
    assert.equal(hasPermission(user(['catalog:read', 'catalog:write']), PERMISSIONS.catalogWrite), true);
  });

  it('exige toutes les permissions quand une liste est fournie', () => {
    const u = user(['catalog:read']);
    assert.equal(hasPermission(u, [PERMISSIONS.catalogRead, PERMISSIONS.catalogWrite]), false);
    assert.equal(hasPermission(user(['catalog:read', 'catalog:write']), [PERMISSIONS.catalogRead, PERMISSIONS.catalogWrite]), true);
  });

  it('hasAnyPermission n exige qu une seule correspondance', () => {
    assert.equal(
      hasAnyPermission(user(['cash:read']), [PERMISSIONS.catalogWrite, PERMISSIONS.cashRead]),
      true
    );
    assert.equal(
      hasAnyPermission(user(['cash:read']), [PERMISSIONS.catalogWrite, PERMISSIONS.backupsRestore]),
      false
    );
  });
});

describe('canAccessRoute', () => {
  it('laisse passer les écrans ouverts à tout utilisateur authentifié', () => {
    assert.equal(canAccessRoute(user([]), '/'), true);
    assert.equal(canAccessRoute(user([]), '/sales/new'), false);
    assert.equal(canAccessRoute(user(['sales:write']), '/sales/new'), true);
  });

  it('réserve /catalogue-admin à catalog:write', () => {
    assert.equal(canAccessRoute(user(['catalog:read']), '/catalogue-admin'), false);
    assert.equal(canAccessRoute(user(['catalog:write']), '/catalogue-admin'), true);
  });

  it('ne bloque pas une route inconnue (le serveur tranche)', () => {
    assert.equal(canAccessRoute(user([]), '/route-inexistante'), true);
  });

  it('couvre toutes les entrées de navigation déclarées', () => {
    const routes = Object.keys(ROUTE_PERMISSIONS);
    assert.ok(routes.includes('/catalogue-admin'));
    assert.ok(routes.includes('/sales/new'));
    assert.equal(routes.length >= 19, true);
  });
});

describe('accessDecision distingue inconnu et refus', () => {
  it('renvoie unknown quand la session n est pas encore chargée', () => {
    assert.equal(accessDecision(null, '/reports'), 'unknown');
    assert.equal(accessDecision(undefined, '/catalogue-admin'), 'unknown');
    assert.equal(accessDecision({} as never, '/reports'), 'unknown');
  });

  it('renvoie deny pour un rôle sans permission', () => {
    assert.equal(accessDecision(user(['sales:read']), '/catalogue-admin'), 'deny');
    assert.equal(accessDecision(user(['backups:read']), '/products'), 'deny');
  });

  it('renvoie allow pour un rôle habilité', () => {
    assert.equal(accessDecision(user(['catalog:write']), '/catalogue-admin'), 'allow');
  });
});

describe('cohérence avec la matrice RBAC du serveur', () => {
  it('owner détient toutes les permissions du catalogue', () => {
    const owner = [
      'catalog:read',
      'catalog:write',
      'catalog:delete',
      'sales:read',
      'sales:write',
      'sales:cancel_return',
      'receivables:read',
      'receivables:pay',
      'purchases:read',
      'purchases:write',
      'supplier_debts:pay',
      'stock:read',
      'stock:adjust',
      'inventory:validate',
      'consignments:read',
      'consignments:write',
      'cash:read',
      'cash:operate',
      'expenses:write',
      'reports:read',
      'settings:read',
      'settings:write',
      'backups:read',
      'backups:create',
      'backups:restore',
      'security:manage_users',
      'security:change_owner_pin',
    ];
    for (const route of Object.keys(ROUTE_PERMISSIONS)) {
      assert.equal(canAccessRoute(user(owner), route), true, `owner refusé sur ${route}`);
    }
  });

  it('un caissier ne voit ni sauvegardes ni administration catalogue', () => {
    // Permissions réelles de Role::Cashier dans rbac.rs.
    const cashier = [
      'catalog:read',
      'sales:read',
      'sales:write',
      'sales:cancel_return',
      'receivables:read',
      'receivables:pay',
      'consignments:read',
      'consignments:write',
      'cash:read',
      'cash:operate',
      'expenses:write',
      'settings:read',
    ];
    assert.equal(canAccessRoute(user(cashier), '/backups'), false);
    assert.equal(canAccessRoute(user(cashier), '/catalogue-admin'), false);
    assert.equal(canAccessRoute(user(cashier), '/sales/new'), true);
    assert.equal(canAccessRoute(user(cashier), '/cash'), true);
  });

  it('un comptable accède aux rapports mais pas aux dépenses validées', () => {
    // Role::Accountant : catalog/sales/receivables/purchases/stock/consignments/
    // cash/reports/settings en lecture + backups:read. Pas de expenses:write.
    const accountant = [
      'catalog:read',
      'sales:read',
      'receivables:read',
      'purchases:read',
      'stock:read',
      'consignments:read',
      'cash:read',
      'reports:read',
      'settings:read',
      'backups:read',
    ];
    assert.equal(canAccessRoute(user(accountant), '/reports'), true);
    assert.equal(canAccessRoute(user(accountant), '/expenses'), false);
    assert.equal(canAccessRoute(user(accountant), '/backups'), true);
    assert.equal(canAccessRoute(user(accountant), '/stock'), true);
  });
});
