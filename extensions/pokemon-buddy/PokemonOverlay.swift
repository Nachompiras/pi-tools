import AppKit
import Foundation

// MARK: - Protocol (JSON over stdin)

struct Command: Codable {
    let type: String   // mood | message | quit | mode | position
    let value: String?
}

// MARK: - AnimData.xml parser

struct AnimInfo {
    let frameWidth: Int
    let frameHeight: Int
    let durations: [Int]  // ticks per frame (1 tick ≈ 1/12s in PMD)
}

func parseAnimData(xmlPath: String) -> [String: AnimInfo] {
    guard let data = try? String(contentsOfFile: xmlPath, encoding: .utf8) else { return [:] }
    var result: [String: AnimInfo] = [:]

    // Simple regex-based XML parsing (no Foundation XML parser needed)
    let animPattern = try! NSRegularExpression(pattern: "<Anim>(.*?)</Anim>", options: .dotMatchesLineSeparators)
    let matches = animPattern.matches(in: data, range: NSRange(data.startIndex..., in: data))

    for match in matches {
        guard let range = Range(match.range(at: 1), in: data) else { continue }
        let block = String(data[range])

        let name = extractTag(block, "Name") ?? ""
        let fw = Int(extractTag(block, "FrameWidth") ?? "") ?? 0
        let fh = Int(extractTag(block, "FrameHeight") ?? "") ?? 0

        var durations: [Int] = []
        let durPattern = try! NSRegularExpression(pattern: "<Duration>(\\d+)</Duration>")
        let durMatches = durPattern.matches(in: block, range: NSRange(block.startIndex..., in: block))
        for dm in durMatches {
            if let r = Range(dm.range(at: 1), in: block), let d = Int(block[r]) {
                durations.append(d)
            }
        }

        if !name.isEmpty && fw > 0 && fh > 0 && !durations.isEmpty {
            result[name] = AnimInfo(frameWidth: fw, frameHeight: fh, durations: durations)
        }
    }
    return result
}

func extractTag(_ xml: String, _ tag: String) -> String? {
    let pattern = try! NSRegularExpression(pattern: "<\(tag)>(.*?)</\(tag)>")
    if let m = pattern.firstMatch(in: xml, range: NSRange(xml.startIndex..., in: xml)),
       let r = Range(m.range(at: 1), in: xml) {
        return String(xml[r])
    }
    return nil
}

// MARK: - Sprite Sheet loader

struct SpriteAnimation {
    let frames: [CGImage]
    let durations: [TimeInterval]  // seconds per frame
    let frameSize: NSSize
}

func loadSpriteSheet(pngPath: String, info: AnimInfo) -> SpriteAnimation? {
    guard let nsImage = NSImage(contentsOfFile: pngPath),
          let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil)
    else { return nil }

    let sheetWidth = cgImage.width
    let sheetHeight = cgImage.height
    let fw = info.frameWidth
    let fh = info.frameHeight
    let cols = sheetWidth / fw

    // PMD sprite sheets: rows are directions (8 dirs), cols are frames
    // Row 0 = South, Row 2 = East (right), Row 6 = West (left)
    // We use row 2 (facing right) as our walking direction
    let dirRow = min(2, sheetHeight / fh - 1) // East-facing row
    let numFrames = info.durations.count

    var frames: [CGImage] = []
    var durations: [TimeInterval] = []

    for i in 0..<numFrames {
        let col = i % cols
        let x = col * fw
        let y = dirRow * fh

        if x + fw <= sheetWidth && y + fh <= sheetHeight {
            if let cropped = cgImage.cropping(to: CGRect(x: x, y: y, width: fw, height: fh)) {
                frames.append(cropped)
                // PMD ticks: ~12 ticks/sec → each tick ≈ 0.083s
                durations.append(Double(info.durations[i]) * 0.083)
            }
        }
    }

    guard !frames.isEmpty else { return nil }
    return SpriteAnimation(
        frames: frames,
        durations: durations,
        frameSize: NSSize(width: CGFloat(fw), height: CGFloat(fh))
    )
}

// MARK: - Pokemon Sprite Manager

class SpriteManager {
    let spriteDir: String
    let animData: [String: AnimInfo]
    var animations: [String: SpriteAnimation] = [:]  // action name → animation

    init(spriteDir: String) {
        self.spriteDir = spriteDir
        self.animData = parseAnimData(xmlPath: "\(spriteDir)/AnimData.xml")
        // Preload key animations
        for action in ["Walk", "Idle", "Hop", "Hurt", "Sleep", "Attack", "Pain"] {
            loadAction(action)
        }
    }

    @discardableResult
    func loadAction(_ action: String) -> SpriteAnimation? {
        if let cached = animations[action] { return cached }
        guard let info = animData[action] else { return nil }
        let pngPath = "\(spriteDir)/\(action)-Anim.png"
        guard let anim = loadSpriteSheet(pngPath: pngPath, info: info) else { return nil }
        animations[action] = anim
        return anim
    }

    func animationForMood(_ mood: String) -> SpriteAnimation? {
        let actionPriority: [String]
        switch mood {
        case "walk":            actionPriority = ["Walk", "Idle"]
        case "idle":            actionPriority = ["Sleep", "Idle"]
        case "happy":           actionPriority = ["Hop", "Idle"]
        case "sad":             actionPriority = ["Pain", "Hurt", "Idle"]
        case "confused":        actionPriority = ["Idle", "Walk"]
        case "working":         actionPriority = ["Attack", "Walk"]
        default:                actionPriority = ["Idle", "Walk"]
        }
        for action in actionPriority {
            if let anim = loadAction(action) { return anim }
        }
        return animations.values.first
    }
}

// MARK: - Pokemon View

class PokemonView: NSView {
    var spriteManager: SpriteManager?
    var currentMood: String = "idle"
    var frameIndex: Int = 0
    var direction: CGFloat = 1  // 1 = right, -1 = left
    var message: String = ""
    var messageOpacity: CGFloat = 0
    var moodEmoji: String = ""
    var moodEmojiOpacity: CGFloat = 0

    let scale: CGFloat = 2.0

    override var isFlipped: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext,
              let mgr = spriteManager,
              let anim = mgr.animationForMood(currentMood)
        else { return }

        let frame = anim.frames[frameIndex % anim.frames.count]
        let spriteW = anim.frameSize.width * scale
        let spriteH = anim.frameSize.height * scale
        let spriteX = (bounds.width - spriteW) / 2
        let spriteY: CGFloat = 0

        ctx.saveGState()

        if direction < 0 {
            ctx.translateBy(x: bounds.width, y: 0)
            ctx.scaleBy(x: -1, y: 1)
        }

        ctx.interpolationQuality = .none
        ctx.draw(frame, in: CGRect(x: spriteX, y: spriteY, width: spriteW, height: spriteH))

        ctx.restoreGState()

        // Mood emoji
        if !moodEmoji.isEmpty && moodEmojiOpacity > 0 {
            let font = NSFont.systemFont(ofSize: 20)
            let attrs: [NSAttributedString.Key: Any] = [.font: font]
            let str = NSAttributedString(string: moodEmoji, attributes: attrs)
            let size = str.size()
            let bounce = sin(Double(frameIndex) * 0.8) * 3
            str.draw(at: NSPoint(x: (bounds.width - size.width) / 2, y: spriteY + spriteH + 2 + CGFloat(bounce)))
        }

        // Speech bubble
        if !message.isEmpty && messageOpacity > 0 {
            let bubbleBase = spriteY + spriteH + (moodEmojiOpacity > 0 ? 28 : 0)
            drawBubble(ctx: ctx, text: message, opacity: messageOpacity, baseY: bubbleBase)
        }
    }

    private func drawBubble(ctx: CGContext, text: String, opacity: CGFloat, baseY: CGFloat) {
        let font = NSFont.systemFont(ofSize: 11, weight: .medium)
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: NSColor.black.withAlphaComponent(opacity)
        ]
        let str = NSAttributedString(string: text, attributes: attrs)
        let textSize = str.size()
        let padding: CGFloat = 8
        let bubbleW = textSize.width + padding * 2
        let bubbleH = textSize.height + padding * 1.4
        let bubbleX = (bounds.width - bubbleW) / 2
        let bubbleY = baseY + 4

        // Shadow
        let shadowPath = NSBezierPath(roundedRect: NSRect(x: bubbleX + 1, y: bubbleY - 1, width: bubbleW, height: bubbleH), xRadius: 8, yRadius: 8)
        NSColor.black.withAlphaComponent(0.12 * opacity).setFill()
        shadowPath.fill()

        // Bubble
        let bubbleRect = NSRect(x: bubbleX, y: bubbleY, width: bubbleW, height: bubbleH)
        let path = NSBezierPath(roundedRect: bubbleRect, xRadius: 8, yRadius: 8)
        NSColor.white.withAlphaComponent(0.95 * opacity).setFill()
        path.fill()
        NSColor(white: 0.8, alpha: opacity).setStroke()
        path.lineWidth = 0.5
        path.stroke()

        // Tail
        let tailX = bounds.width / 2
        let tail = NSBezierPath()
        tail.move(to: NSPoint(x: tailX - 4, y: bubbleY))
        tail.line(to: NSPoint(x: tailX, y: bubbleY - 6))
        tail.line(to: NSPoint(x: tailX + 4, y: bubbleY))
        tail.close()
        NSColor.white.withAlphaComponent(0.95 * opacity).setFill()
        tail.fill()

        str.draw(at: NSPoint(x: bubbleX + padding, y: bubbleY + padding * 0.3))
    }
}

// MARK: - Window

class PokemonOverlayWindow: NSWindow {
    init(size: NSSize, origin: NSPoint) {
        super.init(
            contentRect: NSRect(origin: origin, size: size),
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )
        self.isOpaque = false
        self.backgroundColor = .clear
        self.level = .floating
        self.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        self.ignoresMouseEvents = true
        self.hasShadow = false
    }
}

// MARK: - App Controller

class AppController {
    let window: PokemonOverlayWindow
    let pokemonView: PokemonView
    var walkTimer: Timer?
    var animTimer: Timer?
    var moodTimer: Timer?
    var messageTimer: Timer?
    var posX: CGFloat
    var direction: CGFloat
    var speed: CGFloat
    var baseY: CGFloat = 0
    var mode: String = "static"
    var staticX: CGFloat = 0
    var spriteManager: SpriteManager

    init(spriteDir: String, initialMode: String, staticXPos: CGFloat) {
        self.spriteManager = SpriteManager(spriteDir: spriteDir)
        self.mode = initialMode
        self.staticX = staticXPos
        self.direction = Bool.random() ? 1 : -1
        self.speed = CGFloat.random(in: 0.8...2.5)

        let screen = NSScreen.main!
        let dockHeight = screen.visibleFrame.origin.y - screen.frame.origin.y
        self.baseY = max(dockHeight - 50, 0)

        let winSize = NSSize(width: 200, height: 180)
        let startX: CGFloat
        if initialMode == "static" {
            startX = staticXPos
        } else {
            startX = CGFloat.random(in: 50...(screen.frame.width - winSize.width - 50))
        }
        self.posX = startX

        self.window = PokemonOverlayWindow(size: winSize, origin: NSPoint(x: startX, y: baseY))
        self.pokemonView = PokemonView()
        self.pokemonView.spriteManager = spriteManager
        self.pokemonView.direction = initialMode == "static" ? 1 : direction
        self.pokemonView.frame = NSRect(origin: .zero, size: winSize)
        self.window.contentView = pokemonView
        self.window.orderFrontRegardless()

        startAnimation()
        startWalking()
        startStdinReader()
    }

    func startAnimation() {
        animateNextFrame()
    }

    func animateNextFrame() {
        guard let anim = spriteManager.animationForMood(pokemonView.currentMood),
              !anim.frames.isEmpty else {
            animTimer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: false) { [weak self] _ in
                self?.pokemonView.frameIndex += 1
                self?.pokemonView.needsDisplay = true
                self?.animateNextFrame()
            }
            return
        }

        let idx = pokemonView.frameIndex % anim.durations.count
        let delay = max(anim.durations[idx], 0.03)

        animTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            guard let self = self, let anim = self.spriteManager.animationForMood(self.pokemonView.currentMood) else { return }
            self.pokemonView.frameIndex = (self.pokemonView.frameIndex + 1) % anim.frames.count
            self.pokemonView.needsDisplay = true
            self.animateNextFrame()
        }
    }

    func startWalking() {
        walkTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            guard let self = self else { return }

            if self.mode == "static" {
                let dx = self.staticX - self.posX
                if abs(dx) > 1 {
                    self.posX += dx * 0.08
                    self.pokemonView.direction = dx > 0 ? 1 : -1
                    self.pokemonView.needsDisplay = true
                } else {
                    self.posX = self.staticX
                    self.pokemonView.direction = 1
                }
                self.window.setFrameOrigin(NSPoint(x: self.posX, y: self.baseY))
                return
            }

            let screen = NSScreen.main!
            self.posX += self.direction * self.speed
            let maxX = screen.frame.width - self.window.frame.width
            if self.posX > maxX { self.direction = -1; self.pokemonView.direction = -1 }
            if self.posX < 0 { self.direction = 1; self.pokemonView.direction = 1 }
            self.pokemonView.needsDisplay = true
            self.window.setFrameOrigin(NSPoint(x: self.posX, y: self.baseY))
        }
    }

    func setMood(_ mood: String, duration: TimeInterval = 4.0) {
        pokemonView.currentMood = mood

        let emojis: [String: String] = [
            "happy": "✨", "sad": "💥", "confused": "❓",
            "working": "", "walk": "", "idle": "",
        ]
        pokemonView.moodEmoji = emojis[mood] ?? ""
        pokemonView.moodEmojiOpacity = emojis[mood]?.isEmpty == false ? 1 : 0
        pokemonView.frameIndex = 0
        pokemonView.needsDisplay = true

        moodTimer?.invalidate()
        // confused + working stay until cleared
        if mood != "walk" && mood != "idle" && mood != "confused" && mood != "working" {
            moodTimer = Timer.scheduledTimer(withTimeInterval: duration, repeats: false) { [weak self] _ in
                self?.clearMood()
            }
        }
    }

    func clearMood() {
        pokemonView.currentMood = mode == "static" ? "idle" : "walk"
        pokemonView.moodEmoji = ""
        pokemonView.moodEmojiOpacity = 0
        pokemonView.frameIndex = 0
        pokemonView.needsDisplay = true
    }

    func showMessage(_ text: String, duration: TimeInterval = 4.0) {
        if text.isEmpty {
            pokemonView.message = ""
            pokemonView.messageOpacity = 0
            pokemonView.needsDisplay = true
            messageTimer?.invalidate()
            return
        }
        pokemonView.message = text
        pokemonView.messageOpacity = 1.0
        pokemonView.needsDisplay = true

        messageTimer?.invalidate()
        messageTimer = Timer.scheduledTimer(withTimeInterval: duration, repeats: false) { [weak self] _ in
            self?.fadeMessage()
        }
    }

    func fadeMessage() {
        Timer.scheduledTimer(withTimeInterval: 0.04, repeats: true) { [weak self] timer in
            guard let self = self else { timer.invalidate(); return }
            self.pokemonView.messageOpacity -= 0.08
            if self.pokemonView.messageOpacity <= 0 {
                self.pokemonView.messageOpacity = 0
                self.pokemonView.message = ""
                timer.invalidate()
            }
            self.pokemonView.needsDisplay = true
        }
    }

    func startStdinReader() {
        DispatchQueue.global(qos: .background).async { [weak self] in
            while let line = readLine() {
                guard let data = line.data(using: .utf8),
                      let cmd = try? JSONDecoder().decode(Command.self, from: data)
                else { continue }
                DispatchQueue.main.async { self?.handleCommand(cmd) }
            }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }

    func handleCommand(_ cmd: Command) {
        switch cmd.type {
        case "mood":
            setMood(cmd.value ?? "walk")
        case "message":
            showMessage(cmd.value ?? "", duration: cmd.value?.isEmpty == true ? 0 : 4.0)
        case "mode":
            mode = cmd.value ?? "static"
            if mode == "walk" {
                direction = Bool.random() ? 1 : -1
                pokemonView.direction = direction
                speed = CGFloat.random(in: 0.8...2.5)
                pokemonView.currentMood = "walk"
            } else {
                pokemonView.currentMood = "idle"
            }
            pokemonView.frameIndex = 0
        case "position":
            if let x = Double(cmd.value ?? "") { staticX = CGFloat(x) }
        case "quit":
            NSApp.terminate(nil)
        default:
            break
        }
    }
}

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate {
    var controller: AppController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = CommandLine.arguments
        let spriteDir = args.count > 1 ? args[1] : "."
        let initialMode = args.count > 2 ? args[2] : "static"
        let staticXPos = args.count > 3 ? CGFloat(Double(args[3]) ?? 0) : 0

        controller = AppController(spriteDir: spriteDir, initialMode: initialMode, staticXPos: staticXPos)
        controller?.showMessage("I choose you!", duration: 3.0)
        controller?.setMood("happy", duration: 3.0)
    }
}

// MARK: - Main

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
