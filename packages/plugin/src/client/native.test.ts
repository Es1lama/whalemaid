import { describe, expect, it, vi } from 'vitest'
import { MAX_NATIVE_CHUNK_BYTES, readNativeAsset, readNativeAssets, type NativeAsset, type WhaleMaidNativeBridge } from './native.ts'

function encoded(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function bridgeFor(bytesById: Record<string, Uint8Array>): WhaleMaidNativeBridge {
  return {
    capabilities: vi.fn(),
    capturePhoto: vi.fn(),
    pickGallery: vi.fn(),
    pickFiles: vi.fn(),
    readAsset: vi.fn(async ({ id, offset, length }) => {
      const source = bytesById[id]
      if (source === undefined) throw new Error('ASSET_NOT_FOUND')
      const chunk = source.slice(offset, offset + length)
      return { data: encoded(chunk), offset, done: offset + chunk.length >= source.length }
    }),
    releaseAsset: vi.fn(async () => undefined),
  }
}

function asset(id: string, size: number, name = `${id}.png`): NativeAsset {
  return { id, size, name, mimeType: 'image/png' }
}

describe('native asset reconstruction', () => {
  it('reads bounded chunks into a File and releases the native asset', async () => {
    const bytes = new Uint8Array(MAX_NATIVE_CHUNK_BYTES + 3).fill(7)
    const bridge = bridgeFor({ photo: bytes })

    const file = await readNativeAsset(bridge, asset('photo', bytes.length))

    expect(file.name).toBe('photo.png')
    expect(file.type).toBe('image/png')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
    expect(bridge.readAsset).toHaveBeenCalledTimes(2)
    expect(bridge.readAsset).toHaveBeenNthCalledWith(1, {
      id: 'photo', offset: 0, length: MAX_NATIVE_CHUNK_BYTES,
    })
    expect(bridge.releaseAsset).toHaveBeenCalledWith({ id: 'photo' })
  })

  it('preserves selection order and releases every native asset', async () => {
    const bridge = bridgeFor({ first: new Uint8Array([1]), second: new Uint8Array([2]) })

    const files = await readNativeAssets(bridge, {
      assets: [asset('first', 1), asset('second', 1)],
    })

    expect(files.map(file => file.name)).toEqual(['first.png', 'second.png'])
    expect(bridge.releaseAsset).toHaveBeenCalledTimes(2)
  })

  it('rejects inconsistent chunk completion and still releases the asset', async () => {
    const bridge = bridgeFor({ broken: new Uint8Array([1, 2]) })
    vi.mocked(bridge.readAsset).mockResolvedValue({ data: encoded(new Uint8Array([1])), offset: 0, done: true })

    await expect(readNativeAsset(bridge, asset('broken', 2))).rejects.toThrow('ASSET_UNREADABLE')
    expect(bridge.releaseAsset).toHaveBeenCalledWith({ id: 'broken' })
  })

  it('rejects native metadata larger than the bridge limit without reading bytes', async () => {
    const bridge = bridgeFor({})

    await expect(readNativeAsset(bridge, asset('huge', 64 * 1024 * 1024 + 1))).rejects.toThrow('ASSET_UNREADABLE')
    expect(bridge.readAsset).not.toHaveBeenCalled()
    expect(bridge.releaseAsset).toHaveBeenCalledWith({ id: 'huge' })
  })
})
