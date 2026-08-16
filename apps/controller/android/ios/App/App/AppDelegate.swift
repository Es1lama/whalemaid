import UIKit
import Capacitor

@objc(WhaleMaidTunnelPlugin)
public class WhaleMaidTunnelPlugin: CAPPlugin {
    private static let sharedProxy = TunnelProxy.shared

    @objc func start(_ call: CAPPluginCall) {
        WhaleMaidTunnelPlugin.sharedProxy.start { port in
            call.resolve(["port": port])
        }
    }

    /// 记住上次登录状态（UserDefaults；与 Android SharedPreferences 同语义，不放 localStorage）
    @objc func saveState(_ call: CAPPluginCall) {
        let prefs = UserDefaults.standard
        prefs.set(call.getString("server") ?? "", forKey: "wm.server")
        prefs.set(call.getString("deviceId") ?? "", forKey: "wm.deviceId")
        prefs.set(call.getString("password") ?? "", forKey: "wm.password")
        call.resolve()
    }

    @objc func loadState(_ call: CAPPluginCall) {
        let prefs = UserDefaults.standard
        call.resolve([
            "server": prefs.string(forKey: "wm.server") ?? "",
            "deviceId": prefs.string(forKey: "wm.deviceId") ?? "",
            "password": prefs.string(forKey: "wm.password") ?? "",
        ])
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
