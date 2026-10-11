import Cocoa
import WebKit

/// Serves the Vite build through a private folio:// origin so the studio
/// runs as a Mac app without a loopback server.
final class StudioScheme: NSObject, WKURLSchemeHandler {
  private let root: URL
  private var stopped: Set<ObjectIdentifier> = []

  init(root: URL) {
    self.root = root
  }

  func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
    let id = ObjectIdentifier(urlSchemeTask)
    guard let url = urlSchemeTask.request.url, let file = file(for: url) else {
      fail(urlSchemeTask, 404, id)
      return
    }
    do {
      let data = try Data(contentsOf: file)
      if stopped.contains(id) { return }
      let headers = [
        "Content-Type": mime(for: file),
        "Content-Length": String(data.count),
        "Cache-Control": "no-cache",
      ]
      guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else {
        fail(urlSchemeTask, 500, id)
        return
      }
      urlSchemeTask.didReceive(response)
      urlSchemeTask.didReceive(data)
      urlSchemeTask.didFinish()
    } catch {
      fail(urlSchemeTask, 500, id)
    }
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
    stopped.insert(ObjectIdentifier(urlSchemeTask))
  }

  private func file(for url: URL) -> URL? {
    var path = url.path
    if path.isEmpty || path == "/" { path = "/index.html" }
    if path.contains("..") { return nil }
    let relative = String(path.dropFirst())
    let target = root.appendingPathComponent(relative).standardizedFileURL
    let base = root.standardizedFileURL.path
    guard target.path == base || target.path.hasPrefix(base + "/") else { return nil }
    var isDir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: target.path, isDirectory: &isDir), !isDir.boolValue else { return nil }
    return target
  }

  private func mime(for file: URL) -> String {
    switch file.pathExtension.lowercased() {
    case "html": return "text/html; charset=utf-8"
    case "js", "mjs": return "text/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "json", "map": return "application/json"
    case "svg": return "image/svg+xml"
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "woff2": return "font/woff2"
    case "woff": return "font/woff"
    default: return "application/octet-stream"
    }
  }

  private func fail(_ task: any WKURLSchemeTask, _ status: Int, _ id: ObjectIdentifier) {
    if stopped.contains(id) { return }
    guard let url = task.request.url,
          let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil) else {
      task.didFailWithError(URLError(.badURL))
      return
    }
    task.didReceive(response)
    task.didReceive(Data())
    task.didFinish()
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKDownloadDelegate, WKUIDelegate {
  private var window: NSWindow!
  private var webView: WKWebView!
  private var scheme: StudioScheme?

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    guard let root = Bundle.main.resourceURL?.appendingPathComponent("studio") else {
      NSApp.terminate(nil)
      return
    }
    let handler = StudioScheme(root: root)
    scheme = handler
    // Underline misspelled words and list suggestions in the right-click menu,
    // without autocorrect changing character names.
    UserDefaults.standard.register(defaults: [
      "WebContinuousSpellCheckingEnabled": true,
      "WebAutomaticSpellingCorrectionEnabled": false,
    ])
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(handler, forURLScheme: "folio")
    let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 840), configuration: config)
    view.navigationDelegate = self
    view.uiDelegate = self
    webView = view

    let screen = NSScreen.main ?? NSScreen.screens.first
    let visible = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 840)
    let window = NSWindow(
      contentRect: visible.insetBy(dx: 80, dy: 50),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "Folio"
    window.minSize = NSSize(width: 960, height: 640)
    window.contentView = view
    window.isReleasedWhenClosed = false
    window.collectionBehavior = [.moveToActiveSpace, .fullScreenPrimary]
    self.window = window
    window.makeKeyAndOrderFront(nil)
    window.orderFrontRegardless()
    NSApp.activate(ignoringOtherApps: true)
    view.load(URLRequest(url: URL(string: "folio://studio/index.html")!))
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    preferences: WKWebpagePreferences,
    decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
  ) {
    if navigationAction.shouldPerformDownload {
      decisionHandler(.download, preferences)
      return
    }
    if let url = navigationAction.request.url, let scheme = url.scheme, scheme != "folio" {
      if navigationAction.targetFrame == nil {
        NSWorkspace.shared.open(url)
      }
      decisionHandler(.cancel, preferences)
      return
    }
    decisionHandler(.allow, preferences)
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  func download(
    _ download: WKDownload,
    decideDestinationUsing response: URLResponse,
    suggestedFilename: String,
    completionHandler: @escaping (URL?) -> Void
  ) {
    DispatchQueue.main.async {
      let panel = NSSavePanel()
      panel.title = "Save"
      panel.nameFieldStringValue = suggestedFilename.isEmpty ? "screenplay.fdx" : suggestedFilename
      panel.canCreateDirectories = true
      panel.beginSheetModal(for: self.window) { result in
        completionHandler(result == .OK ? panel.url : nil)
      }
    }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping () -> Void
  ) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "OK")
    alert.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (Bool) -> Void
  ) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    alert.beginSheetModal(for: window) { response in
      completionHandler(response == .alertFirstButtonReturn)
    }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptTextInputPanelWithPrompt prompt: String,
    defaultText: String?,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (String?) -> Void
  ) {
    let alert = NSAlert()
    alert.messageText = prompt
    let field = NSTextField(string: defaultText ?? "")
    field.frame = NSRect(x: 0, y: 0, width: 280, height: 24)
    alert.accessoryView = field
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    alert.beginSheetModal(for: window) { response in
      completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil)
    }
  }

  func webView(
    _ webView: WKWebView,
    runOpenPanelWith parameters: WKOpenPanelParameters,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping ([URL]?) -> Void
  ) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.canChooseFiles = true
    panel.beginSheetModal(for: window) { response in
      completionHandler(response == .OK ? panel.urls : nil)
    }
  }

  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = navigationAction.request.url, url.scheme != "folio" {
      NSWorkspace.shared.open(url)
    }
    return nil
  }
}

@main
enum FolioMain {
  static func main() {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    app.run()
  }
}
