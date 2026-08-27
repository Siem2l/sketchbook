// blueprintd — a web page as the wallpaper, on every screen, framed right.
//
// Plash showed the way but sizes its desktop window off the wrong screen on
// mixed-DPI setups and covers one display per instance. This is the ~150
// lines that do only the part we need: one full-frame desktop-level
// WKWebView per screen, rebuilt whenever displays change, driven from a
// status item.
//
// The menu bar's tint, Mission Control's chrome, and the lock screen are
// rendered from the system wallpaper setting, which a desktop-level window
// never reaches — so once the page has drawn, a snapshot of it is mirrored
// into the real wallpaper per screen.
//
//   defaults write nl.siem2l.blueprintd url -string "https://…"   # all screens
//   defaults write nl.siem2l.blueprintd url-<displayID> -string … # one screen
//
// Build: tools/blueprintd/build.sh

import Cocoa
import WebKit

let DEFAULT_URL =
  "https://sketches.siem2l.nl/sketches/2026-08-blueprint/?bare&hue=245&icon=boid-white.svg&wind=3"

final class WallWindow: NSWindow, WKNavigationDelegate {
  let web: WKWebView

  init(screen: NSScreen, url: URL) {
    web = WKWebView(
      frame: NSRect(origin: .zero, size: screen.frame.size),
      configuration: WKWebViewConfiguration())
    super.init(
      contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    // The full screen frame, menu-bar region included.
    setFrame(screen.frame, display: true)
    level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
    collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    ignoresMouseEvents = true
    isReleasedWhenClosed = false
    backgroundColor = .black
    hasShadow = false

    web.autoresizingMask = [.width, .height]
    web.navigationDelegate = self
    web.load(URLRequest(url: url))
    contentView = web
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    // A beat after load, so the sheet has drawn its first frames.
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
      self?.mirrorToSystemWallpaper()
    }
  }

  func mirrorToSystemWallpaper() {
    web.takeSnapshot(with: nil) { [weak self] image, _ in
      guard let self, let screen = self.screen,
        let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")],
        let tiff = image?.tiffRepresentation,
        let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:])
      else { return }
      let fm = FileManager.default
      let dir = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("blueprintd")
      try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
      // A fresh filename every time — the wallpaper server caches by URL.
      let file = dir.appendingPathComponent(
        "wall-\(id)-\(Int(Date().timeIntervalSince1970)).png")
      guard (try? png.write(to: file)) != nil else { return }
      try? NSWorkspace.shared.setDesktopImageURL(file, for: screen, options: [:])
      (try? fm.contentsOfDirectory(atPath: dir.path))?
        .filter { $0.hasPrefix("wall-\(id)-") && $0 != file.lastPathComponent }
        .forEach { try? fm.removeItem(at: dir.appendingPathComponent($0)) }
    }
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  var windows: [WallWindow] = []
  var statusItem: NSStatusItem!
  var activity: NSObjectProtocol?

  func applicationDidFinishLaunching(_ note: Notification) {
    // Keep App Nap from throttling the page's animation frames.
    activity = ProcessInfo.processInfo.beginActivity(
      options: [.userInitiated], reason: "live wallpaper")

    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    statusItem.button?.title = "▦"
    let menu = NSMenu()
    menu.addItem(
      NSMenuItem(title: "Reload", action: #selector(rebuild), keyEquivalent: "r"))
    menu.addItem(
      NSMenuItem(
        title: "Set URL from Clipboard", action: #selector(setURLFromClipboard),
        keyEquivalent: ""))
    menu.addItem(NSMenuItem.separator())
    menu.addItem(
      NSMenuItem(title: "Quit blueprintd", action: #selector(quit), keyEquivalent: "q"))
    menu.items.forEach { $0.target = self }
    statusItem.menu = menu

    NotificationCenter.default.addObserver(
      self, selector: #selector(rebuild),
      name: NSApplication.didChangeScreenParametersNotification, object: nil)
    rebuild()
  }

  func url(for screen: NSScreen) -> URL {
    let d = UserDefaults.standard
    let key = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")]
      .flatMap { "url-\($0)" }
    let s = key.flatMap { d.string(forKey: $0) } ?? d.string(forKey: "url") ?? DEFAULT_URL
    return URL(string: s) ?? URL(string: DEFAULT_URL)!
  }

  @objc func rebuild() {
    windows.forEach { $0.close() }
    windows = NSScreen.screens.map { screen in
      let w = WallWindow(screen: screen, url: url(for: screen))
      w.orderFront(nil)
      return w
    }
  }

  @objc func setURLFromClipboard() {
    guard let s = NSPasteboard.general.string(forType: .string),
      let _ = URL(string: s), s.hasPrefix("http")
    else { return }
    UserDefaults.standard.set(s, forKey: "url")
    rebuild()
  }

  @objc func quit() { NSApp.terminate(nil) }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
