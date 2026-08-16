import UIKit
import Capacitor

@objc(WhaleMaidTunnelPlugin)
public class WhaleMaidTunnelPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WhaleMaidTunnelPlugin"
    public let jsName = "WhaleMaidTunnel"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
    ]

    private static let sharedProxy = TunnelProxy.shared

    @objc func start(_ call: CAPPluginCall) {
        WhaleMaidTunnelPlugin.sharedProxy.start { port in
            call.resolve(["port": port])
        }
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // 主控端入口：启动本地隧道代理并把 WebView 指向代理（同源 = 页面相对请求全走隧道；与 Android 同语义）
        TunnelProxy.shared.start { port in
            DispatchQueue.main.async {
                let vc = self.window?.rootViewController as? CAPBridgeViewController
                let url = URL(string: "http://127.0.0.1:\(port)/")!
                vc?.webView?.load(URLRequest(url: url))
            }
        }
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {}

    func applicationDidEnterBackground(_ application: UIApplication) {}

    func applicationWillEnterForeground(_ application: UIApplication) {}

    func applicationDidBecomeActive(_ application: UIApplication) {}

    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}
