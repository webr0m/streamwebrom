import SwiftUI
import WebKit

@main
struct StreamWebRomApp: App {
    var body: some Scene { WindowGroup { StudioView() } }
}

struct StudioView: View {
    @AppStorage("serverOrigin") private var savedOrigin = ""
    @State private var address = ""
    @State private var destination: URL?
    @State private var pageID = UUID()
    @State private var error = false
    @Environment(\.scenePhase) private var phase

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                TextField("https://tu-servidor o enlace de invitación", text: $address)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .keyboardType(.URL).textFieldStyle(.roundedBorder)
                    .onSubmit(open)
                Button("Abrir", action: open)
            }.padding(.horizontal)
            Text("Conecta tu servidor HTTPS. Cámara y micrófono se solicitan al usarlos.")
                .font(.caption).padding(.horizontal)
            if let url = destination {
                StudioWebView(url: url, active: phase == .active).id(pageID)
            } else {
                Spacer()
                Image(systemName: "video.fill").font(.system(size: 52)).foregroundStyle(.purple)
                Text("Tu estudio, desde iPhone o iPad")
                Spacer()
            }
        }
        .padding(.top, 8)
        .onAppear { if address.isEmpty { address = savedOrigin } }
        .alert("URL inválida", isPresented: $error) {
            Button("Aceptar", role: .cancel) {}
        } message: { Text("Usa HTTPS con un certificado válido y sin usuario ni contraseña en la URL.") }
        .onChange(of: phase) { value in UIApplication.shared.isIdleTimerDisabled = value == .active && destination != nil }
    }

    private func open() {
        guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme?.lowercased() == "https", url.host != nil,
              url.user == nil, url.password == nil, !url.absoluteString.contains("\\") else { error = true; return }
        var origin = URLComponents()
        origin.scheme = "https"; origin.host = url.host; origin.port = url.port
        savedOrigin = origin.string ?? "" // Keys and room passwords stay out of preferences.
        address = savedOrigin
        destination = url; pageID = UUID()
        UIApplication.shared.isIdleTimerDisabled = true
    }
}

struct StudioWebView: UIViewRepresentable {
    let url: URL
    let active: Bool

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = .all
        // A session's host/invitation keys must not end up in persistent web data.
        config.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.load(URLRequest(url: url))
        return web
    }
    func updateUIView(_ web: WKWebView, context: Context) {
        // Release capture when the app leaves the foreground. Returning reloads
        // the page and uses the existing guest reconnect protocol.
        if !active && !context.coordinator.suspended {
            context.coordinator.suspended = true
            context.coordinator.resumeURL = web.url ?? url
            web.loadHTMLString("", baseURL: nil)
        } else if active && context.coordinator.suspended {
            context.coordinator.suspended = false
            web.load(URLRequest(url: context.coordinator.resumeURL ?? url))
        }
    }
    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        web.stopLoading(); web.loadHTMLString("", baseURL: nil)
        web.navigationDelegate = nil; web.uiDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let origin: URL
        var suspended = false
        var resumeURL: URL?
        init(url: URL) { origin = url }
        func matches(_ url: URL) -> Bool {
            url.scheme?.lowercased() == "https" && url.host?.lowercased() == origin.host?.lowercased()
                && (url.port ?? 443) == (origin.port ?? 443) && url.user == nil && url.password == nil
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = action.request.url else { decisionHandler(.cancel); return }
            if target.absoluteString == "about:blank" || matches(target) { decisionHandler(.allow); return }
            if action.targetFrame?.isMainFrame == false && officialVdo(target) { decisionHandler(.allow); return }
            if action.navigationType == .linkActivated && target.scheme == "https" {
                UIApplication.shared.open(target)
            }
            decisionHandler(.cancel)
        }
        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            let localOrigin = origin.protocol == "https" && origin.host.lowercased() == self.origin.host?.lowercased()
                && (origin.port == 0 ? 443 : origin.port) == (self.origin.port ?? 443)
            let embeddedVdo = origin.protocol == "https" && origin.host.lowercased() == "vdo.ninja"
                && (origin.port == 0 || origin.port == 443) && webView.url.map { matches($0) && $0.path == "/vdo" } == true
            let permitted = !suspended && UIApplication.shared.applicationState == .active && (localOrigin || embeddedVdo)
            decisionHandler(permitted ? .prompt : .deny)
        }
        func officialVdo(_ url: URL) -> Bool {
            url.scheme?.lowercased() == "https" && url.host?.lowercased() == "vdo.ninja"
                && (url.port ?? 443) == 443 && url.user == nil && url.password == nil
        }
    }
}
