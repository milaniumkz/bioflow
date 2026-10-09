import 'dart:convert';
import 'dart:math';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

String commandId() {
  final r = Random.secure();
  return List.generate(
      24, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
}

class BioflowClient {
  final storage = const FlutterSecureStorage();
  final Dio dio = Dio(BaseOptions(
      baseUrl: const String.fromEnvironment('API_URL',
          defaultValue: 'http://10.0.2.2:4000/api/v1'),
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30)));
  Map<String, dynamic>? profile;
  Future<void> _queueLock = Future.value();
  Future<bool>? _refreshing;
  int _sessionEpoch = 0;
  Future<void> _authWrites = Future.value();

  void _checkIdentity(int epoch, String user) {
    if (epoch != _sessionEpoch || user != owner) {
      throw StateError('Сессия изменилась. Повторите действие.');
    }
  }

  Future<T> _authLocked<T>(Future<T> Function() action) {
    final result = _authWrites.then((_) => action());
    _authWrites =
        result.then<void>((_) {}, onError: (Object _, StackTrace __) {});
    return result;
  }

  BioflowClient() {
    dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
      if (o.extra['sessionEpoch'] != null &&
          o.extra['sessionEpoch'] != _sessionEpoch) {
        h.reject(DioException(
            requestOptions: o,
            type: DioExceptionType.cancel,
            message: 'Сессия изменилась'));
        return;
      }
      final token = await storage.read(key: 'accessToken');
      if (token != null) o.headers['Authorization'] = 'Bearer $token';
      h.next(o);
    }, onError: (e, h) async {
      if (e.response?.statusCode == 401 &&
          e.requestOptions.extra['retried'] != true &&
          !e.requestOptions.path.startsWith('/auth/') &&
          (e.requestOptions.extra['sessionEpoch'] == null ||
              e.requestOptions.extra['sessionEpoch'] == _sessionEpoch)) {
        _refreshing ??= _refresh();
        final success = await _refreshing!;
        _refreshing = null;
        if (success) {
          final o = e.requestOptions;
          o.extra['retried'] = true;
          try {
            h.resolve(await dio.fetch(o));
            return;
          } on DioException catch (retry) {
            h.next(retry);
            return;
          }
        }
      }
      h.next(e);
    }));
  }
  Future<bool> _refresh() async {
    final epoch = _sessionEpoch;
    try {
      final refresh = await storage.read(key: 'refreshToken');
      if (refresh == null) return false;
      final d = Dio(dio.options);
      final r = await d.post('/auth/refresh', data: {
        'refreshToken': refresh,
        'deviceId': await storage.read(key: 'deviceId')
      });
      return await _tokens(r.data, epoch);
    } catch (_) {
      return false;
    }
  }

  Future<bool> _tokens(dynamic data, int epoch) => _authLocked(() async {
        if (epoch != _sessionEpoch) return false;
        await storage.write(key: 'accessToken', value: data['accessToken']);
        await storage.write(key: 'refreshToken', value: data['refreshToken']);
        if (data['deviceId'] != null) {
          await storage.write(key: 'deviceId', value: data['deviceId']);
        }
        return true;
      });

  Future<void> login(String email, String password) async {
    final epoch = ++_sessionEpoch;
    var device = await storage.read(key: 'deviceId');
    device ??= commandId();
    await storage.write(key: 'deviceId', value: device);
    final r = await dio.post('/auth/login', data: {
      'email': email,
      'password': password,
      'platform': 'android',
      'deviceId': device
    });
    if (!await _tokens(r.data, epoch)) throw StateError('Сессия изменилась');
    final response = await dio.get('/auth/me',
        options: Options(extra: {'sessionEpoch': epoch}));
    await _authLocked(() async {
      if (epoch != _sessionEpoch) throw StateError('Сессия изменилась');
      profile = Map<String, dynamic>.from(response.data);
      await storage.write(key: 'profile', value: jsonEncode(profile));
    });
  }

  Future<bool> restore() async {
    final p = await storage.read(key: 'profile');
    if (p != null) profile = Map<String, dynamic>.from(jsonDecode(p));
    return profile != null && await storage.read(key: 'accessToken') != null;
  }

  bool can(String p) => (profile?['permissions'] as List? ?? []).contains(p);
  String get owner => profile?['id'] as String? ?? 'anonymous';
  Future<dynamic> get(String path) async {
    final epoch = _sessionEpoch, user = owner;
    final k = 'cache:$user:$path';
    try {
      final r =
          await dio.get(path, options: Options(extra: {'sessionEpoch': epoch}));
      _checkIdentity(epoch, user);
      await storage.write(key: k, value: jsonEncode(r.data));
      _checkIdentity(epoch, user);
      return r.data;
    } on DioException catch (e) {
      _checkIdentity(epoch, user);
      if (!networkError(e)) rethrow;
      final cached = await storage.read(key: k);
      if (cached == null) rethrow;
      return jsonDecode(cached);
    }
  }

  static bool networkError(DioException e) =>
      e.response == null &&
      [
        DioExceptionType.connectionError,
        DioExceptionType.connectionTimeout,
        DioExceptionType.receiveTimeout,
        DioExceptionType.sendTimeout,
        DioExceptionType.unknown
      ].contains(e.type);
  Future<dynamic> send(String path, Map<String, dynamic> data,
      {bool queue = true}) async {
    final epoch = _sessionEpoch, user = owner;
    final payload = {...data};
    if (path.startsWith('/ledger/') &&
        !path.endsWith('/access') &&
        !path.endsWith('/qr/resolve')) {
      payload.putIfAbsent('idempotencyKey', commandId);
    }
    try {
      final response = await dio.post(path,
          data: payload, options: Options(extra: {'sessionEpoch': epoch}));
      _checkIdentity(epoch, user);
      return response.data;
    } on DioException catch (e) {
      _checkIdentity(epoch, user);
      if (!queue || !networkError(e)) rethrow;
      await _locked(() async {
        _checkIdentity(epoch, user);
        final q = await pending();
        _checkIdentity(epoch, user);
        q.add({
          'path': path,
          'data': payload,
          'createdAt': DateTime.now().toIso8601String(),
          'status': 'pending'
        });
        await storage.write(key: 'queue:$user', value: jsonEncode(q));
      });
      return {'queued': true};
    }
  }

  Future<void> _locked(Future<void> Function() action) async {
    final previous = _queueLock;
    final run = previous.catchError((_) {}).then((_) => action());
    _queueLock = run.catchError((_) {});
    await run;
  }

  Future<List<dynamic>> pending() async {
    final s = await storage.read(key: 'queue:$owner');
    return s == null ? [] : jsonDecode(s) as List<dynamic>;
  }

  Future<void> sync() async {
    final epoch = _sessionEpoch, user = owner;
    await _locked(() async {
      final q = await pending();
      final remaining = <dynamic>[];
      for (final item in q) {
        _checkIdentity(epoch, user);
        try {
          await dio.post(item['path'],
              data: item['data'],
              options: Options(extra: {'sessionEpoch': epoch}));
        } on DioException catch (e) {
          item['status'] = networkError(e) ? 'pending' : 'conflict';
          item['error'] = errorText(e);
          remaining.add(item);
        }
      }
      await storage.write(key: 'queue:$user', value: jsonEncode(remaining));
    });
  }

  Future<void> discard(String id) async {
    await _locked(() async {
      final q = await pending();
      q.removeWhere((x) => x['data']['idempotencyKey'] == id);
      await storage.write(key: 'queue:$owner', value: jsonEncode(q));
    });
  }

  Future<String> upload(String filename, List<int> bytes, String mime) async {
    final r = await dio.post('/files/upload-url',
        data: {'fileName': filename, 'mimeType': mime, 'size': bytes.length});
    final data = r.data;
    await Dio().put(data['uploadUrl'],
        data: Stream.fromIterable([bytes]),
        options: Options(
            headers: {'Content-Type': mime, 'Content-Length': bytes.length}));
    await dio.post('/files/${data['file']['id']}/complete', data: {});
    return data['file']['id'];
  }

  Future<void> logout() async {
    final epoch = ++_sessionEpoch;
    try {
      await dio.post('/auth/logout-all', data: {});
    } catch (_) {}
    await _authLocked(() async {
      if (epoch != _sessionEpoch) return;
      await storage.delete(key: 'accessToken');
      await storage.delete(key: 'refreshToken');
      await storage.delete(key: 'profile');
      profile = null;
    });
  }
}

String errorText(Object e) {
  if (e is DioException) {
    final data = e.response?.data;
    if (data is Map) {
      final error = data['error'];
      if (error is Map) {
        final messages = error['message'];
        final values = messages is List ? messages : [messages];
        return values.map((v) {
          final text = '$v';
          if (text.contains('email must be an email')) {
            return 'Введите корректный email';
          }
          if (text.contains('fileIds must contain')) {
            return 'Добавьте фотографию весов или документа';
          }
          if (text.contains('password') && text.contains('longer than')) {
            return 'Пароль должен содержать не менее 8 символов';
          }
          if (text == 'Invalid credentials') return 'Неверный email или пароль';
          if (text == 'Forbidden resource') {
            return 'Нет доступа к этому действию';
          }
          if (text == 'Unauthorized') return 'Сессия истекла. Войдите заново';
          return text;
        }).join('\n');
      }
    }
    return e.response == null
        ? 'Нет соединения с сервером'
        : 'Ошибка ${e.response?.statusCode}';
  }
  return e.toString();
}
