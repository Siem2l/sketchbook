// blueprintd — a web page as the wallpaper, on every screen, framed right.
//
// Plash showed the way but sizes its desktop window off the wrong screen on
// mixed-DPI setups, and covers neither the menu-bar region (so the bar's
// translucency samples the system wallpaper instead of the page) nor more
// than one display per instance. This is the ~150 lines that do only the
// part we need: one full-frame desktop-level WKWebView per screen, rebuilt
// whenever displays change, driven from a status item.
//
//   defaults write nl.siem2l.blueprintd url -string "https://…"   # all screens
//   defaults write nl.siem2l.blueprintd url-<displayID> -string … # one screen
//
// Build: tools/blueprintd/build.sh

import Cocoa
import WebKit

let DEFAULT_URL =
  "https://sketches.siem2l.nl/sketches/2026-08-blueprint/?bare&hue=245&icon=boid-white.svg&wind=3"

final class WallWindow: NSWindow {
  init(screen: NSScreen, url: URL) {
    super.init(
      contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    // The full screen frame, menu-bar region included — the bar's blur then
    // samples the page, so the strip beside the notch matches the sheet.
    setFrame(screen.frame, display: true)
    level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
    collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    ignoresMouseEvents = true
    isReleasedWhenClosed = false
    backgroundColor = .black
    hasShadow = false

    let config = WKWebViewConfiguration()
    let web = WKWebView(frame: contentRect(forFrameRect: frame), configuration: config)
    web.autoresizingMask = [.width, .height]
    web.load(URLRequest(url: url))
    contentView = web
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
