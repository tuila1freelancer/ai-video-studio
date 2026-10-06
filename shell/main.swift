// AI Video Studio — native macOS shell.
// Boots the Node backend as a child process, waits for /api/health, then loads it in a
// native WKWebView (Safari engine) — lightweight, no bundled Chromium for the UI.
import Cocoa
import WebKit
import ServiceManagement

// Height of the strip below, in points. Must stay equal to the web UI's `--pad-titlebar`, which is
// pure padding at the top of the topbar — the strip covers no control.
let TITLEBAR_INSET: CGFloat = 40

// The window's only drag handle. `-webkit-app-region:drag` is a Chromium extension that WKWebView
// ignores, and `fullSizeContentView` makes the titlebar band hit-test straight through to the web
// view (which reports `mouseDownCanMoveWindow == false`) — so without this the window cannot be
// moved from anywhere at all. The traffic lights live in the titlebar view above and stay clickable.
final class TitlebarDragView: NSView {
  override func mouseDown(with event: NSEvent) {
    guard let window = window else { return }
    guard event.clickCount < 2 else {
      switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
      case "Minimize": window.miniaturize(nil)
      case "None": break
      default: window.zoom(nil)
      }
      return
    }
    window.performDrag(with: event)
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
  var window: NSWindow!  // nil only before applicationDidFinishLaunching; see showWindow's guard
  var webView: WKWebView!
  var backend: Process?
  var statusItem: NSStatusItem?
  // One boot, one nonce. The window trades it for a session cookie on its first request, so the
  // user never has to paste a token into their own app once agent access is on.
  let uiKey = UUID().uuidString
  // Learned from the backend's own AVS_READY line rather than assumed. A fixed port meant a second
  // copy of the app silently loaded the FIRST copy's server (its own died with AVS_PORT_IN_USE and
  // nobody read that), and it made the port unknowable to anything else — the agent kit included.
  var baseURL: String?

  func applicationDidFinishLaunching(_ note: Notification) {
    buildMenu()
    buildStatusItem()
    setupWindow()
    startBackend()
    NSApp.activate(ignoringOtherApps: true)
  }

  // The app is a server with a window on it, not a window with a server behind it. Closing the
  // window used to end the process — and with it any agent's access and any render in flight. Now
  // it hides, and the menu-bar item is the honest sign that something is still running.
  func buildStatusItem() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    // A symbol name that this macOS does not know returns nil, and a button with neither image nor
    // title is an invisible zero-width item — so there is always a title to fall back to.
    if let icon = NSImage(systemSymbolName: "film.stack", accessibilityDescription: "AI Video Studio")
      ?? NSImage(systemSymbolName: "film", accessibilityDescription: "AI Video Studio") {
      icon.isTemplate = true
      item.button?.image = icon
    } else {
      item.button?.title = "AVS"
    }
    item.button?.toolTip = "AI Video Studio"
    let menu = NSMenu()
    menu.addItem(withTitle: "Mở cửa sổ", action: #selector(showWindow), keyEquivalent: "")
    let login = NSMenuItem(title: "Mở cùng máy", action: #selector(toggleLoginItem), keyEquivalent: "")
    login.state = loginItemEnabled() ? .on : .off
    menu.addItem(login)
    menu.addItem(NSMenuItem.separator())
    menu.addItem(withTitle: "Thoát hẳn", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
    for entry in menu.items where entry.action != #selector(NSApplication.terminate(_:)) { entry.target = self }
    item.menu = menu
    statusItem = item
  }

  @objc func showWindow() {
    guard let window else { return }
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  /** Registered with launchd through SMAppService (macOS 13+); older systems simply cannot. */
  func loginItemEnabled() -> Bool {
    if #available(macOS 13.0, *) { return SMAppService.mainApp.status == .enabled }
    return false
  }

  @objc func toggleLoginItem(_ sender: NSMenuItem) {
    guard #available(macOS 13.0, *) else {
      sender.isEnabled = false
      sender.title = "Mở cùng máy (cần macOS 13+)"
      return
    }
    do {
      if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
      else { try SMAppService.mainApp.register() }
    } catch { NSSound.beep() }
    sender.state = loginItemEnabled() ? .on : .off
  }

  func setupWindow() {
    let frame = NSRect(x: 0, y: 0, width: 1280, height: 840)
    // fullSizeContentView + transparent titlebar: the web topbar runs under the traffic
    // lights (Linear/Arc-style chrome). The web UI reserves its top 40px via
    // html.is-shell → --pad-titlebar, and TitlebarDragView below makes that band drag.
    window = NSWindow(contentRect: frame,
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered, defer: false)
    window.title = "AI Video Studio"
    // The app outlives its window now, so the window has to outlive being closed: AppKit frees a
    // programmatically created window on close by default, and the next "open it again" then sends
    // a message to freed memory. That is a segfault, and it is what the first build of this did.
    window.isReleasedWhenClosed = false
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.backgroundColor = NSColor(red: 0.027, green: 0.027, blue: 0.043, alpha: 1) // #07070b — no white flash on resize
    window.center()
    window.setFrameAutosaveName("AVSMainWindow")
    window.minSize = NSSize(width: 960, height: 640)

    let cfg = WKWebViewConfiguration()
    // Inspect Element in a shipped build hands the customer the whole frontend and every API call.
    cfg.preferences.setValue(EXTRA_ENV["AVS_DIST"] != "1", forKey: "developerExtrasEnabled")
    // Tag the document so CSS can reserve titlebar space only inside the native shell.
    let shellFlag = WKUserScript(
      source: "document.documentElement.classList.add('is-shell');",
      injectionTime: .atDocumentStart, forMainFrameOnly: true)
    cfg.userContentController.addUserScript(shellFlag)
    webView = WKWebView(frame: frame, configuration: cfg)
    webView.autoresizingMask = [.width, .height]
    webView.navigationDelegate = self
    // WITHOUT THIS, EVERY <input type="file"> IN THE APP IS DEAD. WKWebView does not open a file
    // picker on its own — it asks its uiDelegate, and with no delegate the click is silently
    // dropped: no panel, no error, nothing in the console. That broke the Brand Kit logo, the
    // library uploads (brand art / BGM / SFX / fonts) and the edit-video source picker, but only
    // inside this app — the same page in a normal browser worked fine, which is what made it
    // look like a web bug for so long.
    webView.uiDelegate = self

    // The web view can no longer BE the content view: the drag strip has to sit above it.
    let content = NSView(frame: frame)
    content.addSubview(webView)
    let dragStrip = TitlebarDragView(frame: NSRect(
      x: 0, y: frame.height - TITLEBAR_INSET, width: frame.width, height: TITLEBAR_INSET))
    dragStrip.autoresizingMask = [.width, .minYMargin] // stays pinned to the top on resize
    content.addSubview(dragStrip)
    window.contentView = content
    window.makeKeyAndOrderFront(nil)
    loadSplash("Đang khởi động AI Video Studio…")
  }

  func loadSplash(_ msg: String) {
    let html = """
    <html><head><meta charset='utf-8'><style>
    html,body{margin:0;height:100%;background:#07070b;color:#f4f4fa;font-family:-apple-system,Helvetica,sans-serif;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}
    .l{filter:drop-shadow(0 6px 26px rgba(109,92,255,.45))}
    .by{font-size:11px;color:#62687a;letter-spacing:.06em}
    .s{width:26px;height:26px;border:3px solid rgba(255,255,255,.12);border-top-color:#6d5cff;border-radius:50%;animation:r 1s linear infinite}
    @keyframes r{to{transform:rotate(360deg)}}</style></head>
    <body>
    <div class='l'><svg width='76' height='76' viewBox='0 0 48 48' fill='none'>
      <defs>
        <linearGradient id='bg' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#282854'/><stop offset='.5' stop-color='#141430'/><stop offset='1' stop-color='#0b0b18'/></linearGradient>
        <linearGradient id='br' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#8b7cff'/><stop offset='1' stop-color='#b04df7'/></linearGradient>
        <linearGradient id='arc' x1='0' y1='1' x2='1' y2='0'><stop offset='0' stop-color='#6d5cff'/><stop offset='1' stop-color='#22d3ee'/></linearGradient>
      </defs>
      <rect x='1' y='1' width='46' height='46' rx='11.5' fill='url(#bg)'/>
      <rect x='1.5' y='1.5' width='45' height='45' rx='11' stroke='#ffffff' stroke-opacity='.12'/>
      <path d='M 13.7 13.7 A 14.6 14.6 0 0 1 38.1 27.8' stroke='url(#arc)' stroke-width='2.6' stroke-linecap='round' opacity='.95'/>
      <circle cx='38.1' cy='27.8' r='2' fill='#8ff4ff'/>
      <path d='M20.6 17.6 L32.2 24 L20.6 30.4 Z' fill='url(#br)' stroke='url(#br)' stroke-width='4.4' stroke-linejoin='round'/>
    </svg></div>
    <div>\(msg)</div><div class='by'>by TuiLa1Freelancer</div><div class='s'></div></body></html>
    """
    webView.loadHTMLString(html, baseURL: nil)
  }

  func startBackend() {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: NODE_PATH)
    p.arguments = NODE_ARGS
    p.currentDirectoryURL = URL(fileURLWithPath: PROJECT_ROOT)
    var env = ProcessInfo.processInfo.environment
    env["AVS_PORT"] = AVS_PORT
    env["AVS_UI_KEY"] = uiKey
    // Build-mode settings (AVS_DIST, AVS_DATA_DIR) come from Config.swift, which the build script
    // writes per mode. They are set HERE, inside the app, so nothing a customer puts in their
    // shell can change what the bundle thinks it is.
    for (k, v) in EXTRA_ENV { env[k] = v }
    p.environment = env
    // The key that unlocks the bytecode goes down stdin and nowhere else. Passed as an argument or
    // in the environment, `ps` would hand it straight back to whoever asked.
    let stdinPipe = Pipe()
    p.standardInput = stdinPipe
    // The backend prints `AVS_READY <url>` once it is listening; that line is the only thing that
    // knows which port the OS handed out.
    let outPipe = Pipe()
    p.standardOutput = outPipe
    var seen = ""
    outPipe.fileHandleForReading.readabilityHandler = { handle in
      let chunk = String(decoding: handle.availableData, as: UTF8.self)
      guard !chunk.isEmpty else { return }
      FileHandle.standardOutput.write(Data(chunk.utf8)) // keep the log readable from a terminal
      seen += chunk
      guard let range = seen.range(of: "AVS_READY "), let end = seen[range.upperBound...].firstIndex(where: { $0.isWhitespace }) else { return }
      let url = String(seen[range.upperBound..<end])
      outPipe.fileHandleForReading.readabilityHandler = nil
      DispatchQueue.main.async { self.serverReady(url) }
    }
    do {
      try p.run()
      backend = p
      if !APP_KEY.isEmpty { stdinPipe.fileHandleForWriting.write(Data((APP_KEY + "\n").utf8)) }
      // Closed either way: the loader reads stdin to EOF, so leaving it open hangs the boot.
      try? stdinPipe.fileHandleForWriting.close()
    } catch {
      loadSplash("Không khởi động được backend: \(error.localizedDescription)")
    }
  }

  func serverReady(_ url: String) {
    guard baseURL == nil else { return }
    baseURL = url
    waitForHealthThenLoad(attempt: 0)
  }

  func waitForHealthThenLoad(attempt: Int) {
    guard let base = baseURL else { return }
    if attempt > 120 { loadSplash("Backend không phản hồi. Kiểm tra Node tại \(NODE_PATH)"); return }
    guard let url = URL(string: base + "/api/health") else { return }
    var req = URLRequest(url: url); req.timeoutInterval = 2
    URLSession.shared.dataTask(with: req) { data, resp, _ in
      let ok = (resp as? HTTPURLResponse)?.statusCode == 200
      DispatchQueue.main.async {
        if ok, let url = URL(string: base + "/?uikey=" + self.uiKey) { self.webView.load(URLRequest(url: url)) }
        else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.waitForHealthThenLoad(attempt: attempt + 1) } }
      }
    }.resume()
  }

  func buildMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem(); main.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "Về AI Video Studio",
      action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appMenu.addItem(NSMenuItem.separator())
    appMenu.addItem(withTitle: "Ẩn", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(withTitle: "Thoát", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu
    // Edit menu (so copy/paste/select-all work in inputs)
    let editItem = NSMenuItem(); main.addItem(editItem)
    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
    edit.addItem(NSMenuItem.separator())
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit
    NSApp.mainMenu = main
  }

  // The file picker for every <input type="file"> in the web UI. WKWebView hands the request
  // here; returning nil to the completion handler means "user cancelled". The handler MUST be
  // called exactly once on every path or the page's input stays stuck and can never be clicked
  // again.
  func webView(_ webView: WKWebView,
               runOpenPanelWith parameters: WKOpenPanelParameters,
               initiatedByFrame frame: WKFrameInfo,
               completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.canChooseFiles = true
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.resolvesAliases = true
    panel.beginSheetModal(for: window) { result in
      completionHandler(result == .OK ? panel.urls : nil)
    }
  }

  // False, deliberately: the backend keeps serving agents and finishing renders after the window
  // is closed. "Thoát hẳn" in the menu-bar item is how someone ends it.
  func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { false }
  // Clicking the dock icon with no window open brings the app back rather than doing nothing.
  func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    if !flag { showWindow() }
    return true
  }
  func applicationWillTerminate(_ note: Notification) { backend?.terminate() }
}

// One copy per machine. Two copies used to mean two servers on one database — and, with the fixed
// port, a second window quietly showing the FIRST copy's server while its own backend had already
// died. Activating the running copy is what a person meant by opening the app again.
let mine = Bundle.main.bundleIdentifier ?? "com.aivideostudio.app"
let others = NSRunningApplication.runningApplications(withBundleIdentifier: mine)
  .filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
if let running = others.first {
  running.activate(options: [.activateAllWindows])
  exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
