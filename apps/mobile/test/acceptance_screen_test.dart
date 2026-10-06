import 'package:bioflow_mobile/main.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('acceptance combines warehouse and waybill responses and selects a warehouse', (tester) async {
    final paths = <String>[];
    final dio = Dio(BaseOptions(baseUrl: 'http://127.0.0.1:9/api/v1'));
    dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
      paths.add(options.path);
      handler.resolve(Response<dynamic>(
        requestOptions: options,
        statusCode: 200,
        data: options.path == '/warehouses'
            ? {'data': [{'id': 'warehouse-1', 'name': 'Warehouse A'}]}
            : {'status': 'ARRIVED'},
      ));
    }));

    await tester.pumpWidget(ProviderScope(
      overrides: [apiProvider.overrideWithValue(dio)],
      child: const MaterialApp(home: AcceptanceScreen(waybillId: 'waybill-1')),
    ));
    await tester.pumpAndSettle();
    expect(paths, containsAll(['/warehouses', '/waybills/waybill-1']));
    expect(find.text('Статус: ARRIVED'), findsOneWidget);
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Warehouse A').last);
    await tester.pumpAndSettle();
    expect(find.text('Warehouse A'), findsOneWidget);
    expect(tester.takeException(), isNull);
    dio.close(force: true);
  });
}
