import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:dio/dio.dart';
import 'package:bioflow_mobile/client.dart';
import 'package:bioflow_mobile/main.dart';

class DelayedTokenStorage extends FlutterSecureStorage {
  final String blockedKey;
  DelayedTokenStorage({this.blockedKey = 'accessToken'});
  final started = Completer<void>();
  final release = Completer<void>();
  bool delayNextToken = true;
  @override
  Future<String?> read({
    required String key,
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (key == blockedKey && delayNextToken) {
      delayNextToken = false;
      started.complete();
      await release.future;
    }
    return super.read(
        key: key,
        iOptions: iOptions,
        aOptions: aOptions,
        lOptions: lOptions,
        webOptions: webOptions,
        mOptions: mOptions,
        wOptions: wOptions);
  }
}

class DelayedTokenClient extends BioflowClient {
  final FlutterSecureStorage testStorage;
  DelayedTokenClient(this.testStorage);
  @override
  FlutterSecureStorage get storage => testStorage;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  test('Network errors queue commands under the current user', () async {
    final api = BioflowClient()..profile = {'id': 'user-a'};
    api.dio.interceptors.add(InterceptorsWrapper(
        onRequest: (o, h) => h.reject(DioException(
            requestOptions: o, type: DioExceptionType.connectionError))));
    final body = {'idempotencyKey': 'stable', 'quantity': '1.001'};
    expect((await api.send('/ledger/batches', body))['queued'], true);
    final q = await api.pending();
    expect(q.single['data']['idempotencyKey'], 'stable');
    api.profile = {'id': 'user-b'};
    expect(await api.pending(), isEmpty);
  });
  test('Permission and stock conflicts do not enter offline queue', () async {
    final api = BioflowClient()..profile = {'id': 'user-a'};
    api.dio.interceptors.add(InterceptorsWrapper(
        onRequest: (o, h) => h.reject(DioException(
            requestOptions: o,
            type: DioExceptionType.badResponse,
            response: Response(requestOptions: o, statusCode: 409, data: {
              'error': {'message': 'Недостаточно остатка'}
            })))));
    await expectLater(api.send('/ledger/operations', {'idempotencyKey': 'id'}),
        throwsA(isA<DioException>()));
    expect(await api.pending(), isEmpty);
  });
  test('Offline retry keeps original idempotency key', () async {
    final api = BioflowClient()..profile = {'id': 'user-a'};
    bool online = false;
    final seen = <String>[];
    api.dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
      seen.add(o.data['idempotencyKey']);
      if (!online) {
        h.reject(DioException(
            requestOptions: o, type: DioExceptionType.connectionError));
      } else {
        h.resolve(
            Response(requestOptions: o, statusCode: 201, data: {'ok': true}));
      }
    }));
    await api.send('/ledger/operations', {'quantity': '2'});
    online = true;
    await api.sync();
    expect(seen.length, 2);
    expect(seen.first, seen.last);
    expect(await api.pending(), isEmpty);
  });
  test('Late offline failure cannot enqueue into a different user account',
      () async {
    final api = BioflowClient()..profile = {'id': 'user-a'};
    final started = Completer<void>();
    final release = Completer<void>();
    api.dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
      started.complete();
      await release.future;
      h.reject(DioException(
          requestOptions: o, type: DioExceptionType.connectionError));
    }));
    final request = api.send('/ledger/batches', {'quantity': '1.001'});
    final rejected = expectLater(request, throwsA(isA<StateError>()));
    await started.future;
    api.profile = {'id': 'user-b'};
    release.complete();
    await rejected;
    expect(await api.pending(), isEmpty);
    api.profile = {'id': 'user-a'};
    expect(await api.pending(), isEmpty);
  });
  test('Late read cannot return old data after an account switch', () async {
    final api = BioflowClient()..profile = {'id': 'user-a'};
    final started = Completer<void>();
    final release = Completer<void>();
    api.dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
      started.complete();
      await release.future;
      h.resolve(Response(
          requestOptions: o, statusCode: 200, data: {'private': 'user-a'}));
    }));
    final request = api.get('/ledger/batches');
    final rejected = expectLater(request, throwsA(isA<StateError>()));
    await started.future;
    api.profile = {'id': 'user-b'};
    release.complete();
    await rejected;
    expect(await api.storage.read(key: 'cache:user-b:/ledger/batches'), isNull);
  });
  test('A delayed token read cannot dispatch an old command with a new login',
      () async {
    FlutterSecureStorage.setMockInitialValues(
        {'accessToken': 'old-user-token'});
    final delayed = DelayedTokenStorage();
    final api = DelayedTokenClient(delayed)..profile = {'id': 'user-a'};
    var ledgerDispatches = 0;
    api.dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
      if (o.path.startsWith('/ledger/')) ledgerDispatches++;
      final data = o.path == '/auth/login'
          ? {'accessToken': 'new-user-token', 'refreshToken': 'new-refresh'}
          : o.path == '/auth/me'
              ? {'id': 'user-b', 'permissions': <String>[]}
              : {'ok': true};
      h.resolve(Response(requestOptions: o, statusCode: 201, data: data));
    }));
    final request = api.send('/ledger/batches', {'quantity': '1.001'});
    final rejected = expectLater(request, throwsA(isA<StateError>()));
    await delayed.started.future;
    await api.logout();
    await api.login('user-b@unit.test', 'fake-unit-password');
    delayed.release.complete();
    await rejected;
    expect(ledgerDispatches, 0);
    expect(await api.pending(), isEmpty);
  });
  test('A delayed offline cache read cannot return another account data',
      () async {
    FlutterSecureStorage.setMockInitialValues({
      'accessToken': 'old-user-token',
      'cache:user-a:/ledger/batches': '{"private":"user-a"}',
    });
    final delayed =
        DelayedTokenStorage(blockedKey: 'cache:user-a:/ledger/batches');
    final api = DelayedTokenClient(delayed)..profile = {'id': 'user-a'};
    api.dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
      if (o.path.startsWith('/ledger/')) {
        h.reject(DioException(
            requestOptions: o, type: DioExceptionType.connectionError));
        return;
      }
      final data = o.path == '/auth/login'
          ? {'accessToken': 'new-user-token', 'refreshToken': 'new-refresh'}
          : o.path == '/auth/me'
              ? {'id': 'user-b', 'permissions': <String>[]}
              : {'ok': true};
      h.resolve(Response(requestOptions: o, statusCode: 201, data: data));
    }));
    final request = api.get('/ledger/batches');
    final rejected = expectLater(request, throwsA(isA<StateError>()));
    await delayed.started.future;
    await api.logout();
    await api.login('user-b@unit.test', 'fake-unit-password');
    delayed.release.complete();
    await rejected;
  });
  testWidgets('Login has no prefilled demo credentials', (tester) async {
    await tester.pumpWidget(const BioflowApp());
    await tester.pumpAndSettle();
    expect(find.text('BIOFLOW'), findsOneWidget);
    expect(find.text('Войти'), findsOneWidget);
    expect(find.text('owner@bioflow.local'), findsNothing);
  });
}
