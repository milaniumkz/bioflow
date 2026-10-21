import 'package:flutter_test/flutter_test.dart';
import 'package:bioflow_mobile/role_access.dart';

void main() {
  test('permissions decide access, not a displayed role name', () {
    final p = <String, dynamic>{
      'roles': ['OWNER'],
      'permissions': ['inventory.read'],
      'accessAllObjects': false
    };
    expect(canOpenSection('ledger', p), true);
    expect(canOpenSection('users', p), false);
    expect(canOpenSection('settings', p), false);
    expect(canOpenSection('dashboard', p), false);
    expect(canOpenSection('sessions', p), true);
    expect(canOpenSection('arbitrary', p), false);
  });
  test('combined server permissions and object scopes match the Web cabinet',
      () {
    final p = <String, dynamic>{
      'roles': ['AUDITOR', 'ADMIN'],
      'permissions': [
        'inventory.read',
        'references.read',
        'users.manage',
        'reports.read',
        'references.manage',
        'dashboard.read',
        'audit.read'
      ],
      'accessAllObjects': false
    };
    expect(canOpenSection('users', p), true);
    expect(canOpenSection('roles', p), true);
    expect(canOpenSection('settings', p), true);
    expect(canOpenSection('reports', p), true);
    expect(canOpenSection('plants', p), false);
    expect(canOpenSection('audit', p), false);
    p['accessAllObjects'] = true;
    expect(canOpenSection('plants', p), true);
    expect(canOpenSection('audit', p), true);
    expect(canOpenSection('dashboard', p), true);
  });
  test('all standard roles have Russian labels and multiple roles are visible',
      () {
    expect(roleNames.length, 11);
    expect(
        roleSummary({
          'roles': ['ADMIN', 'AUDITOR']
        }),
        'Администратор, Наблюдатель/аудитор');
    expect(roleSummary({'roles': []}), 'Роли не назначены');
    expect(canOpenSection('sessions', null), false);
  });
}
