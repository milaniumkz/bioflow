import CoreLocation
import Flutter
import UIKit

// The location manager and durable outbox live outside the Flutter view lifecycle.
final class DriverTrackingController: NSObject, CLLocationManagerDelegate, URLSessionTaskDelegate {
  private let manager = CLLocationManager()
  private var document: [String: Any] = [:]
  private var permissionResult: FlutterResult?
  private var requestedAlways = false
  private var permissionRequestId: UUID?
  private var inFlight = false
  private var timer: Timer?
  var backgroundCompletion: (() -> Void)?
  private var channels: [FlutterMethodChannel] = []
  private let directory: URL = {
    let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("CollectionDriver", isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    var excluded = folder
    var values = URLResourceValues(); values.isExcludedFromBackup = true
    try? excluded.setResourceValues(values)
    return folder
  }()
  private lazy var session: URLSession = {
    let configuration = URLSessionConfiguration.background(withIdentifier: Bundle.main.bundleIdentifier! + ".driver-outbox")
    configuration.waitsForConnectivity = true
    configuration.isDiscretionary = false
    configuration.sessionSendsLaunchEvents = true
    configuration.allowsCellularAccess = true
    return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
  }()
  private var current: [String: Any] {
    get { document["current"] as? [String: Any] ?? [:] }
    set { document["current"] = newValue }
  }
  private var points: [[String: Any]] {
    get { document["points"] as? [[String: Any]] ?? [] }
    set { document["points"] = newValue }
  }
  private var events: [[String: Any]] {
    get { document["events"] as? [[String: Any]] ?? [] }
    set { document["events"] = newValue }
  }
  private var stops: [[String: Any]] {
    get { document["stops"] as? [[String: Any]] ?? [] }
    set { document["stops"] = newValue }
  }
  override init() {
    super.init()
    if let data = try? Data(contentsOf: directory.appendingPathComponent("outbox.json")), let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { document = saved }
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.distanceFilter = 10
    manager.activityType = .automotiveNavigation
    manager.pausesLocationUpdatesAutomatically = false
    if Bundle.main.bundleIdentifier?.hasSuffix(".driver") == true {
      manager.allowsBackgroundLocationUpdates = true
      manager.showsBackgroundLocationIndicator = true
    }
    session.getAllTasks { tasks in
      DispatchQueue.main.async { self.inFlight = !tasks.isEmpty; self.resume() }
    }
    timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in self?.pump() }
  }
  private func persist() {
    guard let data = try? JSONSerialization.data(withJSONObject: document) else { return }
    try? data.write(to: directory.appendingPathComponent("outbox.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }
  func attach(_ messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(name: "collection/driver-tracking", binaryMessenger: messenger)
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else { return }
      let args = call.arguments as? [String: Any] ?? [:]
      switch call.method {
      case "permission":
        if self.manager.authorizationStatus == .authorizedAlways { result(true) }
        else {
          if self.permissionResult != nil { result(FlutterError(code: "busy", message: "Подтвердите разрешение геолокации", details: nil)); return }
          self.permissionResult = result
          let requestId = UUID(); self.permissionRequestId = requestId
          DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            guard let self = self, self.permissionRequestId == requestId, let pending = self.permissionResult else { return }
            self.permissionResult = nil; self.permissionRequestId = nil
            pending(self.manager.authorizationStatus == .authorizedAlways)
          }
          if self.manager.authorizationStatus == .authorizedWhenInUse { self.requestedAlways = true; self.manager.requestAlwaysAuthorization() }
          else if self.manager.authorizationStatus == .notDetermined { self.manager.requestWhenInUseAuthorization() }
          else { self.permissionResult = nil; result(false) }
        }
      case "start":
        guard self.manager.authorizationStatus == .authorizedAlways, CLLocationManager.locationServicesEnabled(), let token = args["token"] as? String, let api = args["api"] as? String, api.hasPrefix("https://"), let expires = args["expires"] as? NSNumber else {
          result(FlutterError(code: "permission", message: "Разрешите геолокацию «Всегда» и включите её в настройках iPhone", details: nil)); return
        }
        if self.current["active"] as? Bool == true { result(FlutterError(code: "active", message: "Сначала завершите текущий рейс", details: nil)); return }
        var stage = args["stage"] as? String ?? "CREATED"; if stage == "IN_TRANSIT" { stage = "DEPARTED" }
        self.current = ["active": true, "token": token, "api": api, "expires": expires.doubleValue, "number": args["number"] as? String ?? "", "destination": args["destination"] as? String ?? "", "stage": stage, "sequence": 0, "sent": 0, "error": ""]
        self.persist(); self.manager.startUpdatingLocation(); self.pump(); result(true)
      case "event":
        guard self.current["active"] as? Bool == true, let type = args["type"] as? String else { result(FlutterError(code: "inactive", message: "Сначала начните рейс", details: nil)); return }
        let expected = ["LOADED": "CREATED", "DEPARTED": "LOADED", "ARRIVED": "DEPARTED"][type]
        guard expected != nil, self.current["stage"] as? String == expected else { result(FlutterError(code: "order", message: "Сначала отметьте предыдущий этап рейса", details: nil)); return }
        let payload: [String: Any] = ["requestId": UUID().uuidString, "type": type, "recordedAt": Self.timestamp(Date())]
        var rows = self.events; rows.append(["token": self.current["token"]!, "api": self.current["api"]!, "payload": payload]); self.events = rows
        self.current["stage"] = type; self.persist()
        if type == "ARRIVED" { self.stop() } else { self.pump() }
        result(true)
      case "stop": self.stop(); result(true)
      case "resume": self.resume(); result(true)
      case "mapSession": result(self.current["token"] as? String)
      case "status":
        var status = self.current
        status.removeValue(forKey: "token"); status.removeValue(forKey: "api")
        status["queued"] = self.points.count + self.events.count
        result(status)
      default: result(FlutterMethodNotImplemented)
      }
    }
    channels.append(channel)
    let files = FlutterMethodChannel(name: "bioflow/mobile-files", binaryMessenger: messenger)
    files.setMethodCallHandler { call, result in
      let args = call.arguments as? [String: Any] ?? [:]
      if call.method == "printQr" || call.method == "shareQr" {
        guard let image = args["image"] as? String, image.hasPrefix("data:image/png;base64,"), let data = Data(base64Encoded: String(image.dropFirst("data:image/png;base64,".count))), data.count < 4 * 1024 * 1024, let picture = UIImage(data: data) else { result(FlutterError(code: "image", message: "Некорректный QR", details: nil)); return }
        if call.method == "printQr" {
          let printer = UIPrintInteractionController.shared
          printer.printingItem = picture
          printer.present(animated: true) { _, completed, _ in result(completed) }
        } else { self.share(items: [picture], result: result) }
      } else if call.method == "saveFile" {
        guard let encoded = args["data"] as? String, let data = Data(base64Encoded: encoded), data.count <= 20 * 1024 * 1024 else { result(FlutterError(code: "file", message: "Файл слишком большой", details: nil)); return }
        let name = URL(fileURLWithPath: args["filename"] as? String ?? "Collection.png").lastPathComponent
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
          try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
          let file = folder.appendingPathComponent(name)
          try data.write(to: file, options: .completeFileProtectionUntilFirstUserAuthentication)
          self.share(items: [file], result: result)
        } catch { result(FlutterError(code: "file", message: "Не удалось сохранить файл", details: nil)) }
      } else { result(FlutterMethodNotImplemented) }
    }
    channels.append(files)
  }
  private func share(items: [Any], result: @escaping FlutterResult) {
    let root = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }.first { $0.isKeyWindow }?.rootViewController
    var presenter = root; while let presented = presenter?.presentedViewController { presenter = presented }
    guard let presenter = presenter else { result(FlutterError(code: "view", message: "Откройте приложение для отправки файла", details: nil)); return }
    let activity = UIActivityViewController(activityItems: items, applicationActivities: nil)
    activity.popoverPresentationController?.sourceView = presenter.view
    activity.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
    activity.completionWithItemsHandler = { _, completed, _, _ in result(completed) }
    presenter.present(activity, animated: true)
  }
  func resume() {
    if current["active"] as? Bool == true {
      if (current["expires"] as? Double ?? 0) <= Date().timeIntervalSince1970 * 1000 { stop() }
      else if manager.authorizationStatus == .authorizedAlways { manager.startUpdatingLocation() }
      else { current["error"] = "Разрешите геолокацию «Всегда» в настройках iPhone"; persist() }
    }
    pump()
  }
  private func stop() {
    manager.stopUpdatingLocation()
    if current["active"] as? Bool == true, let token = current["token"] as? String, let api = current["api"] as? String {
      var pending = stops; if !pending.contains(where: { $0["token"] as? String == token }) { pending.append(["token": token, "api": api]) }; stops = pending
    }
    current["active"] = false; persist(); pump()
  }
  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard let result = permissionResult else { return }
    if manager.authorizationStatus == .authorizedAlways { permissionResult = nil; result(true) }
    else if manager.authorizationStatus == .authorizedWhenInUse && !requestedAlways { requestedAlways = true; manager.requestAlwaysAuthorization() }
    else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted { permissionResult = nil; result(false) }
    else if manager.authorizationStatus == .authorizedWhenInUse && requestedAlways {
      // The user may keep “When In Use” without a status-change callback.
      // The bounded permission request above then completes with an actionable error.
    }
  }
  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard current["active"] as? Bool == true else { return }
    guard (current["expires"] as? Double ?? 0) > Date().timeIntervalSince1970 * 1000 else { stop(); return }
    for location in locations where location.horizontalAccuracy >= 0 && location.timestamp > Date().addingTimeInterval(-120) {
      let last = current["lastRecordedAt"] as? Double ?? 0
      if location.timestamp.timeIntervalSince1970 - last < 15 { continue }
      current["lastRecordedAt"] = location.timestamp.timeIntervalSince1970
      let sequence = (current["sequence"] as? Int ?? 0) + 1; current["sequence"] = sequence
      let payload: [String: Any] = ["sequence": sequence, "latitude": location.coordinate.latitude, "longitude": location.coordinate.longitude, "accuracy": location.horizontalAccuracy, "recordedAt": Self.timestamp(location.timestamp)]
      var rows = points; rows.append(["token": current["token"]!, "api": current["api"]!, "payload": payload]); points = rows
    }
    persist(); pump()
  }
  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    current["error"] = "Нет сигнала геолокации. Проверьте разрешения и приём GPS"; persist()
  }
  private static func timestamp(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return formatter.string(from: date)
  }
  private func pump() {
    guard !inFlight else { return }
    var kind = "", token = "", api = "", payload: [String: Any] = [:], ids: [String] = []
    if let first = points.first, let key = first["token"] as? String {
      kind = "points"; token = key; api = first["api"] as? String ?? ""
      let rows = Array(points.filter { $0["token"] as? String == key }.prefix(100))
      payload = ["points": rows.compactMap { $0["payload"] }]
      ids = rows.compactMap { ($0["payload"] as? [String: Any])?["sequence"] as? Int }.map(String.init)
    } else if let first = events.first {
      kind = "events"; token = first["token"] as? String ?? ""; api = first["api"] as? String ?? ""; payload = first["payload"] as? [String: Any] ?? [:]; ids = [payload["requestId"] as? String ?? ""]
    } else if let first = stops.first { kind = "stop"; token = first["token"] as? String ?? ""; api = first["api"] as? String ?? "" }
    guard !kind.isEmpty, api.hasPrefix("https://"), let url = URL(string: api + "/" + kind), let body = try? JSONSerialization.data(withJSONObject: payload) else { return }
    let file = directory.appendingPathComponent(UUID().uuidString + ".upload")
    do { try body.write(to: file, options: .completeFileProtectionUntilFirstUserAuthentication) } catch { return }
    var request = URLRequest(url: url); request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
    let task = session.uploadTask(with: request, fromFile: file)
    let metadata: [String: Any] = ["kind": kind, "token": token, "ids": ids, "file": file.lastPathComponent]
    task.taskDescription = (try? JSONSerialization.data(withJSONObject: metadata)).flatMap { String(data: $0, encoding: .utf8) }
    inFlight = true; task.resume()
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let text = task.taskDescription, let bytes = text.data(using: .utf8), let metadata = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { return }
    let code = (task.response as? HTTPURLResponse)?.statusCode ?? 0
    DispatchQueue.main.async {
      self.inFlight = false
      let kind = metadata["kind"] as? String ?? "", token = metadata["token"] as? String ?? "", ids = Set(metadata["ids"] as? [String] ?? [])
      if error == nil && ((200..<300).contains(code) || kind == "stop" && code == 401) {
        if kind == "points" { self.points = self.points.filter { row in guard row["token"] as? String == token, let seq = (row["payload"] as? [String: Any])?["sequence"] as? Int else { return true }; return !ids.contains(String(seq)) } }
        if kind == "events" { self.events = self.events.filter { row in !(row["token"] as? String == token && ids.contains((row["payload"] as? [String: Any])?["requestId"] as? String ?? "")) } }
        if kind == "stop" { self.stops = self.stops.filter { $0["token"] as? String != token } }
        self.current["sent"] = Date().timeIntervalSince1970 * 1000; self.current["error"] = ""
        if let name = metadata["file"] as? String { try? FileManager.default.removeItem(at: self.directory.appendingPathComponent(name)) }
        self.persist(); self.pump()
      } else { self.current["error"] = "Нет связи или сервер не принял пакет (\(code)). Данные сохранены на iPhone"; self.persist() }
    }
  }
  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    DispatchQueue.main.async { self.backgroundCompletion?(); self.backgroundCompletion = nil }
  }
}
