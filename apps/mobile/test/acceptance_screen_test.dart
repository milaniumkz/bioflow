import 'package:bioflow_mobile/main.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('receipt form loads warehouses and selects destination',
      (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    final paths = <String>[];
    final interceptor = InterceptorsWrapper(onRequest: (options, handler) {
      paths.add(Uri.parse(options.path).path);
      handler.resolve(
          Response<dynamic>(requestOptions: options, statusCode: 200, data: {
        'data': [
          {'id': 'warehouse-1', 'name': 'Warehouse A'}
        ]
      }));
    });
    api.dio.interceptors.add(interceptor);
    addTearDown(() => api.dio.interceptors.remove(interceptor));
    await tester.pumpWidget(const MaterialApp(
        home: CommandForm(
      title: 'Приёмка',
      path: '/ledger/trips/waybill-1/receipt',
      fields: [Field('warehouseId', 'Склад', reference: 'warehouses')],
    )));
    await tester.pumpAndSettle();
    expect(paths, contains('/warehouses'));
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Warehouse A').last);
    await tester.pumpAndSettle();
    expect(find.text('Warehouse A'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
