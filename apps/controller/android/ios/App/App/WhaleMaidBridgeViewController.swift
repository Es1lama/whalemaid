import Capacitor

@objc(WhaleMaidBridgeViewController)
final class WhaleMaidBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(WhaleMaidTunnelPlugin())
        bridge?.registerPluginInstance(WhaleMaidNativePlugin())
    }
}
