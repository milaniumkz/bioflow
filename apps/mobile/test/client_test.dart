import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:dio/dio.dart';
import 'package:bioflow_mobile/client.dart';
import 'package:bioflow_mobile/main.dart';

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
  testWidgets('Login has no prefilled demo credentials', (tester) async {
    await tester.pumpWidget(const BioflowApp());
    await tester.pumpAndSettle();
    expect(find.text('BIOFLOW'), findsOneWidget);
    expect(find.text('Войти'), findsOneWidget);
    expect(find.text('owner@bioflow.local'), findsNothing);
  });
}
