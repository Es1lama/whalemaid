import AVFoundation
import Capacitor
import Foundation
import ImageIO
import MobileCoreServices
import PhotosUI
import UIKit

private let maxChunkBytes = 256 * 1024
private let maxAssetBytes = 64 * 1024 * 1024

private struct WhaleMaidNativeAsset {
    let id: String
    let url: URL
    let name: String
    let mimeType: String
    let width: Int?
    let height: Int?
    let durationMs: Int?

    var json: JSObject {
        var value: JSObject = [
            "id": id,
            "name": name,
            "mimeType": mimeType,
            "size": (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0,
        ]
        if let width = width { value["width"] = width }
        if let height = height { value["height"] = height }
        if let durationMs = durationMs { value["durationMs"] = durationMs }
        return value
    }
}

@objc(WhaleMaidNativePlugin)
public final class WhaleMaidNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WhaleMaidNativePlugin"
    public let jsName = "WhaleMaidNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capturePhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickGallery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pauseRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resumeRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readAsset", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "releaseAsset", returnType: CAPPluginReturnPromise),
    ]

    private let assetLock = NSLock()
    private var assets: [String: WhaleMaidNativeAsset] = [:]
    private var pendingPickerCall: CAPPluginCall?
    private var pendingPickerReturnsSingle = false
    private var recorder: AVAudioRecorder?
    private var recordingHandle: String?
    private var recordingURL: URL?

    public override func load() {
        super.load()
        resetAssetDirectory()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        cancelActiveRecording()
        clearAssets()
    }

    @objc func capabilities(_ call: CAPPluginCall) {
        call.resolve([
            "camera": UIImagePickerController.isSourceTypeAvailable(.camera),
            "gallery": true,
            "microphone": true,
            "files": true,
            "maxChunkBytes": maxChunkBytes,
            "maxAssetBytes": maxAssetBytes,
        ])
    }

    @objc func capturePhoto(_ call: CAPPluginCall) {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            call.reject("CAMERA_UNAVAILABLE")
            return
        }
        guard beginPicker(call, returnsSingle: true) else { return }
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = self
        present(picker, call: call)
    }

    @objc func pickGallery(_ call: CAPPluginCall) {
        let multiple = call.getBool("multiple", true)
        guard beginPicker(call, returnsSingle: false) else { return }
        if #available(iOS 14.0, *) {
            var configuration = PHPickerConfiguration(photoLibrary: .shared())
            configuration.filter = .images
            configuration.selectionLimit = multiple ? 0 : 1
            let picker = PHPickerViewController(configuration: configuration)
            picker.delegate = self
            present(picker, call: call)
        } else {
            let picker = UIImagePickerController()
            picker.sourceType = .photoLibrary
            picker.delegate = self
            present(picker, call: call)
        }
    }

    @objc func pickFiles(_ call: CAPPluginCall) {
        let multiple = call.getBool("multiple", true)
        let mimeTypes = call.getArray("mimeTypes", String.self) ?? []
        guard beginPicker(call, returnsSingle: false) else { return }
        let picker = UIDocumentPickerViewController(documentTypes: documentTypes(for: mimeTypes), in: .import)
        picker.allowsMultipleSelection = multiple
        picker.delegate = self
        present(picker, call: call)
    }

    @objc func startRecording(_ call: CAPPluginCall) {
        guard recorder == nil else {
            call.reject("RECORDING_IN_PROGRESS")
            return
        }
        let session = AVAudioSession.sharedInstance()
        switch session.recordPermission {
        case .granted:
            startRecorder(call)
        case .denied:
            call.reject("PERMISSION_DENIED")
        case .undetermined:
            session.requestRecordPermission { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    if granted { self.startRecorder(call) } else { call.reject("PERMISSION_DENIED") }
                }
            }
        @unknown default:
            call.reject("PERMISSION_DENIED")
        }
    }

    @objc func pauseRecording(_ call: CAPPluginCall) {
        guard let recorder = matchingRecorder(call) else { return }
        recorder.pause()
        call.resolve()
    }

    @objc func resumeRecording(_ call: CAPPluginCall) {
        guard let recorder = matchingRecorder(call) else { return }
        guard recorder.record() else {
            call.reject("RECORDING_RESUME_FAILED")
            return
        }
        call.resolve()
    }

    @objc func stopRecording(_ call: CAPPluginCall) {
        guard let recorder = matchingRecorder(call), let url = recordingURL else { return }
        let durationMs = Int(recorder.currentTime * 1000)
        recorder.stop()
        clearRecorderState()
        deactivateAudioSession()
        do {
            let asset = try registerFile(url: url, name: url.lastPathComponent, mimeType: "audio/mp4", durationHint: durationMs)
            call.resolve(["asset": asset.json])
        } catch {
            try? FileManager.default.removeItem(at: url)
            call.reject("RECORDING_STOP_FAILED", nil, error)
        }
    }

    @objc func cancelRecording(_ call: CAPPluginCall) {
        guard matchingRecorder(call) != nil else { return }
        cancelActiveRecording()
        call.resolve()
    }

    @objc func readAsset(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty else {
            call.reject("ASSET_ID_REQUIRED")
            return
        }
        let offset = call.getInt("offset", 0)
        let requested = call.getInt("length", maxChunkBytes)
        guard offset >= 0 else {
            call.reject("ASSET_UNREADABLE")
            return
        }
        guard let asset = lockedAsset(id) else {
            call.reject("ASSET_NOT_FOUND")
            return
        }
        do {
            let size = try asset.url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            let handle = try FileHandle(forReadingFrom: asset.url)
            defer { try? handle.close() }
            try handle.seek(toOffset: UInt64(offset))
            let length = min(max(requested, 1), maxChunkBytes)
            let data = try handle.readData(ofLength: length)
            call.resolve([
                "data": data.base64EncodedString(),
                "offset": offset,
                "done": offset + data.count >= size,
            ])
        } catch {
            call.reject("ASSET_UNREADABLE", nil, error)
        }
    }

    @objc func releaseAsset(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty else {
            call.reject("ASSET_ID_REQUIRED")
            return
        }
        releaseAsset(id)
        call.resolve()
    }

    private func beginPicker(_ call: CAPPluginCall, returnsSingle: Bool) -> Bool {
        guard pendingPickerCall == nil else {
            call.reject("PICKER_IN_PROGRESS")
            return false
        }
        pendingPickerCall = call
        pendingPickerReturnsSingle = returnsSingle
        return true
    }

    private func present(_ controller: UIViewController, call: CAPPluginCall) {
        guard let host = bridge?.viewController else {
            pendingPickerCall = nil
            call.reject("PICKER_UNAVAILABLE")
            return
        }
        host.present(controller, animated: true)
    }

    private func resolvePicker(_ selected: [WhaleMaidNativeAsset]) {
        guard let call = pendingPickerCall else { return }
        let single = pendingPickerReturnsSingle
        pendingPickerCall = nil
        pendingPickerReturnsSingle = false
        if selected.isEmpty {
            call.reject("ASSET_UNREADABLE")
        } else if single {
            call.resolve(["asset": selected[0].json])
        } else {
            call.resolve(["assets": selected.map(\.json)])
        }
    }

    private func rejectPicker(_ message: String, error: Error? = nil) {
        guard let call = pendingPickerCall else { return }
        pendingPickerCall = nil
        pendingPickerReturnsSingle = false
        call.reject(message, nil, error)
    }

    private func startRecorder(_ call: CAPPluginCall) {
        let id = UUID().uuidString
        let url = assetDirectory().appendingPathComponent("recording-\(id).m4a")
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)
            let next = try AVAudioRecorder(url: url, settings: [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 128_000,
            ])
            guard next.prepareToRecord(), next.record() else {
                try? FileManager.default.removeItem(at: url)
                deactivateAudioSession()
                call.reject("RECORDING_START_FAILED")
                return
            }
            recorder = next
            recordingHandle = id
            recordingURL = url
            call.resolve(["handle": id])
        } catch {
            try? FileManager.default.removeItem(at: url)
            deactivateAudioSession()
            call.reject("RECORDING_START_FAILED", nil, error)
        }
    }

    private func matchingRecorder(_ call: CAPPluginCall) -> AVAudioRecorder? {
        guard let handle = call.getString("handle"), handle == recordingHandle, let recorder = recorder else {
            call.reject("NO_RECORDING")
            return nil
        }
        return recorder
    }

    @objc private func applicationDidEnterBackground() {
        cancelActiveRecording()
    }

    private func cancelActiveRecording() {
        recorder?.stop()
        if let url = recordingURL { try? FileManager.default.removeItem(at: url) }
        clearRecorderState()
        deactivateAudioSession()
    }

    private func clearRecorderState() {
        recorder = nil
        recordingHandle = nil
        recordingURL = nil
    }

    private func deactivateAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func assetDirectory() -> URL {
        let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("whalemaid-assets", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private func resetAssetDirectory() {
        let root = assetDirectory()
        try? FileManager.default.removeItem(at: root)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    private func registerImage(_ image: UIImage, name: String) throws -> WhaleMaidNativeAsset {
        guard let data = image.jpegData(compressionQuality: 0.92), !data.isEmpty, data.count <= maxAssetBytes else {
            throw NativeAssetError.invalidSize
        }
        let url = assetDirectory().appendingPathComponent("image-\(UUID().uuidString).jpg")
        try data.write(to: url, options: .atomic)
        return try registerFile(url: url, name: normalizedJpegName(name), mimeType: "image/jpeg")
    }

    private func copyFile(_ source: URL, name: String? = nil, typeIdentifier: String? = nil) throws -> WhaleMaidNativeAsset {
        let accessed = source.startAccessingSecurityScopedResource()
        defer { if accessed { source.stopAccessingSecurityScopedResource() } }
        let sourceName = name ?? source.lastPathComponent
        let mime = mimeType(for: source, typeIdentifier: typeIdentifier)
        if mime.hasPrefix("image/"), !["image/png", "image/jpeg", "image/webp", "image/gif"].contains(mime),
           let image = UIImage(contentsOfFile: source.path) {
            return try registerImage(image, name: sourceName)
        }
        let suffix = source.pathExtension.isEmpty ? "bin" : String(source.pathExtension.prefix(12))
        let destination = assetDirectory().appendingPathComponent("asset-\(UUID().uuidString).\(suffix)")
        do {
            let input = try FileHandle(forReadingFrom: source)
            FileManager.default.createFile(atPath: destination.path, contents: nil)
            let output = try FileHandle(forWritingTo: destination)
            defer {
                try? input.close()
                try? output.close()
            }
            var copied = 0
            while true {
                let chunk = try input.readData(ofLength: 8192)
                guard !chunk.isEmpty else { break }
                copied += chunk.count
                guard copied <= maxAssetBytes else { throw NativeAssetError.invalidSize }
                try output.write(chunk)
            }
            guard copied > 0 else { throw NativeAssetError.invalidSize }
            return try registerFile(url: destination, name: sourceName, mimeType: mime)
        } catch {
            try? FileManager.default.removeItem(at: destination)
            throw error
        }
    }

    private func registerFile(url: URL, name: String, mimeType: String, durationHint: Int? = nil) throws -> WhaleMaidNativeAsset {
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0, size <= maxAssetBytes else { throw NativeAssetError.invalidSize }
        let dimensions = mimeType.hasPrefix("image/") ? imageDimensions(url) : nil
        let duration = mimeType.hasPrefix("audio/") ? audioDuration(url) ?? durationHint : nil
        let asset = WhaleMaidNativeAsset(
            id: UUID().uuidString,
            url: url,
            name: name,
            mimeType: mimeType,
            width: dimensions?.0,
            height: dimensions?.1,
            durationMs: duration
        )
        assetLock.lock()
        assets[asset.id] = asset
        assetLock.unlock()
        return asset
    }

    private func lockedAsset(_ id: String) -> WhaleMaidNativeAsset? {
        assetLock.lock()
        defer { assetLock.unlock() }
        return assets[id]
    }

    private func releaseAsset(_ id: String) {
        assetLock.lock()
        let asset = assets.removeValue(forKey: id)
        assetLock.unlock()
        if let asset = asset { try? FileManager.default.removeItem(at: asset.url) }
    }

    private func clearAssets() {
        assetLock.lock()
        let current = Array(assets.values)
        assets.removeAll()
        assetLock.unlock()
        for asset in current { try? FileManager.default.removeItem(at: asset.url) }
    }

    private func releaseAssets(_ selected: [WhaleMaidNativeAsset]) {
        for asset in selected { releaseAsset(asset.id) }
    }

    private func imageDimensions(_ url: URL) -> (Int, Int)? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int else { return nil }
        return (width, height)
    }

    private func audioDuration(_ url: URL) -> Int? {
        let seconds = CMTimeGetSeconds(AVURLAsset(url: url).duration)
        return seconds.isFinite && seconds >= 0 ? Int(seconds * 1000) : nil
    }

    private func mimeType(for url: URL, typeIdentifier: String?) -> String {
        if let typeIdentifier = typeIdentifier,
           let mime = UTTypeCopyPreferredTagWithClass(typeIdentifier as CFString, kUTTagClassMIMEType)?.takeRetainedValue() {
            return mime as String
        }
        if !url.pathExtension.isEmpty,
           let uti = UTTypeCreatePreferredIdentifierForTag(kUTTagClassFilenameExtension, url.pathExtension as CFString, nil)?.takeRetainedValue(),
           let mime = UTTypeCopyPreferredTagWithClass(uti, kUTTagClassMIMEType)?.takeRetainedValue() {
            return mime as String
        }
        return "application/octet-stream"
    }

    private func normalizedJpegName(_ name: String) -> String {
        let stem = (name as NSString).deletingPathExtension
        return "\(stem.isEmpty ? "image" : stem).jpg"
    }

    private func documentTypes(for mimeTypes: [String]) -> [String] {
        if mimeTypes.isEmpty { return [kUTTypeData as String] }
        var values: [String] = []
        for mime in mimeTypes {
            if mime == "image/*" { values.append(kUTTypeImage as String); continue }
            if mime == "audio/*" { values.append(kUTTypeAudio as String); continue }
            if let uti = UTTypeCreatePreferredIdentifierForTag(kUTTagClassMIMEType, mime as CFString, nil)?.takeRetainedValue() {
                values.append(uti as String)
            }
        }
        return values.isEmpty ? [kUTTypeData as String] : Array(Set(values))
    }
}

private enum NativeAssetError: Error {
    case invalidSize
}

extension WhaleMaidNativePlugin: UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        rejectPicker("USER_CANCELLED")
    }

    public func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
        picker.dismiss(animated: true)
        do {
            if let image = info[.originalImage] as? UIImage {
                let asset = try registerImage(image, name: picker.sourceType == .camera ? "camera.jpg" : "photo.jpg")
                resolvePicker([asset])
            } else if let url = info[.imageURL] as? URL {
                resolvePicker([try copyFile(url)])
            } else {
                rejectPicker("ASSET_UNREADABLE")
            }
        } catch {
            rejectPicker("ASSET_UNREADABLE", error: error)
        }
    }
}

@available(iOS 14.0, *)
extension WhaleMaidNativePlugin: PHPickerViewControllerDelegate {
    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard !results.isEmpty else {
            rejectPicker("USER_CANCELLED")
            return
        }
        let group = DispatchGroup()
        let resultLock = NSLock()
        var selected: [Int: WhaleMaidNativeAsset] = [:]
        var firstError: Error?
        for (index, result) in results.enumerated() {
            guard let identifier = result.itemProvider.registeredTypeIdentifiers.first else { continue }
            group.enter()
            result.itemProvider.loadFileRepresentation(forTypeIdentifier: identifier) { [weak self] url, error in
                defer { group.leave() }
                guard let self = self else { return }
                do {
                    if let error = error { throw error }
                    guard let url = url else { throw NativeAssetError.invalidSize }
                    let asset = try self.copyFile(url, typeIdentifier: identifier)
                    resultLock.lock()
                    selected[index] = asset
                    resultLock.unlock()
                } catch {
                    resultLock.lock()
                    if firstError == nil { firstError = error }
                    resultLock.unlock()
                }
            }
        }
        group.notify(queue: .main) { [weak self] in
            guard let self = self else { return }
            resultLock.lock()
            let ordered = selected.keys.sorted().compactMap { selected[$0] }
            let error = firstError
            resultLock.unlock()
            if error != nil || ordered.count != results.count {
                self.releaseAssets(ordered)
                self.rejectPicker("ASSET_UNREADABLE", error: error)
            } else {
                self.resolvePicker(ordered)
            }
        }
    }
}

extension WhaleMaidNativePlugin: UIDocumentPickerDelegate {
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        rejectPicker("USER_CANCELLED")
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        var selected: [WhaleMaidNativeAsset] = []
        do {
            for url in urls { selected.append(try copyFile(url)) }
            resolvePicker(selected)
        } catch {
            releaseAssets(selected)
            rejectPicker("ASSET_UNREADABLE", error: error)
        }
    }
}
