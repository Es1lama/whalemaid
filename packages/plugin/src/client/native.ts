/** Browser-side contract for the Capacitor WhaleMaidNative plugin. */

export const MAX_NATIVE_CHUNK_BYTES = 256 * 1024
export const MAX_NATIVE_ASSET_BYTES = 64 * 1024 * 1024

export interface NativeAsset {
  readonly id: string
  readonly name: string
  readonly mimeType: string
  readonly size: number
}

interface NativeAssetResponse {
  readonly asset?: NativeAsset
  readonly assets?: readonly NativeAsset[]
}

interface NativeChunkResponse {
  readonly data: string
  readonly offset: number
  readonly done: boolean
}

interface NativeRecordingResponse {
  readonly handle: string
}

export interface WhaleMaidNativeBridge {
  capabilities(): Promise<{ readonly camera: boolean; readonly gallery: boolean; readonly files: boolean }>
  capturePhoto(): Promise<NativeAssetResponse>
  pickGallery(options?: { readonly multiple?: boolean }): Promise<NativeAssetResponse>
  pickFiles(options?: { readonly multiple?: boolean; readonly mimeTypes?: readonly string[] }): Promise<NativeAssetResponse>
  startRecording(): Promise<NativeRecordingResponse>
  stopRecording(options: { readonly handle: string }): Promise<NativeAssetResponse>
  cancelRecording(options: { readonly handle: string }): Promise<void>
  readAsset(options: { readonly id: string; readonly offset: number; readonly length: number }): Promise<NativeChunkResponse>
  releaseAsset(options: { readonly id: string }): Promise<void>
}

interface CapacitorGlobal {
  readonly Plugins?: {
    readonly WhaleMaidNative?: Partial<WhaleMaidNativeBridge>
  }
}

/** Resolve the native bridge without making the desktop web surface fail. */
export function getNativeBridge(): WhaleMaidNativeBridge | null {
  const capacitor = (globalThis as typeof globalThis & { Capacitor?: CapacitorGlobal }).Capacitor
  const candidate = capacitor?.Plugins?.WhaleMaidNative
  if (candidate === undefined) return null
  const methods: (keyof WhaleMaidNativeBridge)[] = [
    'capabilities', 'capturePhoto', 'pickGallery', 'pickFiles',
    'startRecording', 'stopRecording', 'cancelRecording', 'readAsset', 'releaseAsset',
  ]
  if (methods.some(method => typeof candidate[method] !== 'function')) return null
  return candidate as WhaleMaidNativeBridge
}

function checkedAsset(value: NativeAsset | undefined): NativeAsset {
  if (
    value === undefined
    || typeof value.id !== 'string'
    || value.id === ''
    || typeof value.name !== 'string'
    || typeof value.mimeType !== 'string'
    || !Number.isSafeInteger(value.size)
    || value.size <= 0
    || value.size > MAX_NATIVE_ASSET_BYTES
  ) {
    throw new Error('ASSET_UNREADABLE')
  }
  return value
}

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Read one native asset into a browser File and release its opaque native id. */
export async function readNativeAsset(bridge: WhaleMaidNativeBridge, rawAsset: NativeAsset): Promise<File> {
  const releasableId = typeof rawAsset?.id === 'string' && rawAsset.id !== '' ? rawAsset.id : null
  const chunks: ArrayBuffer[] = []
  let offset = 0
  try {
    const asset = checkedAsset(rawAsset)
    while (offset < asset.size) {
      const chunk = await bridge.readAsset({
        id: asset.id,
        offset,
        length: Math.min(MAX_NATIVE_CHUNK_BYTES, asset.size - offset),
      })
      if (chunk.offset !== offset) throw new Error('ASSET_UNREADABLE')
      const bytes = decodeBase64(chunk.data)
      if (bytes.length === 0 || bytes.length > MAX_NATIVE_CHUNK_BYTES) throw new Error('ASSET_UNREADABLE')
      if (offset + bytes.length > asset.size) throw new Error('ASSET_UNREADABLE')
      const copy = new Uint8Array(bytes.length)
      copy.set(bytes)
      chunks.push(copy.buffer)
      offset += bytes.length
      if (chunk.done !== (offset >= asset.size)) throw new Error('ASSET_UNREADABLE')
    }
    return new File(chunks, asset.name, { type: asset.mimeType || 'application/octet-stream' })
  } finally {
    if (releasableId !== null) await bridge.releaseAsset({ id: releasableId }).catch(() => undefined)
  }
}

/** Read and release a native selection as browser files, preserving selection order. */
export async function readNativeAssets(bridge: WhaleMaidNativeBridge, response: NativeAssetResponse): Promise<File[]> {
  const assets = response.assets ?? (response.asset === undefined ? [] : [response.asset])
  if (assets.length === 0) throw new Error('ASSET_UNREADABLE')
  return await Promise.all(assets.map(asset => readNativeAsset(bridge, asset)))
}

/** Dispatches native files through the official InputBar paste intake. */
export function pasteFilesIntoComposer(files: readonly File[]): boolean {
  if (files.length === 0) return false
  const active = document.activeElement
  const target = active instanceof HTMLTextAreaElement && active.closest('[data-composer-card]') !== null
    ? active
    : document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')
  if (target === null) return false
  const transfer = new DataTransfer()
  for (const file of files) transfer.items.add(file)
  target.focus()
  const event = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: transfer,
  })
  target.dispatchEvent(event)
  return true
}
