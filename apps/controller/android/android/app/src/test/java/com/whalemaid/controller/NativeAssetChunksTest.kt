package com.whalemaid.controller

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class NativeAssetChunksTest {
    @Test
    fun readsRequestedRange() {
        val file = tempFile(byteArrayOf(0, 1, 2, 3, 4, 5))
        assertArrayEquals(byteArrayOf(2, 3, 4), NativeAssetChunks.read(file, 2, 3))
        file.delete()
    }

    @Test
    fun returnsEmptyAtEndOfFile() {
        val file = tempFile(byteArrayOf(1, 2, 3))
        assertEquals(0, NativeAssetChunks.read(file, 3, 8).size)
        file.delete()
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsNegativeOffset() {
        val file = tempFile(byteArrayOf(1))
        try {
            NativeAssetChunks.read(file, -1, 1)
        } finally {
            file.delete()
        }
    }

    @Test
    fun capsChunksAtBridgeMaximum() {
        val file = tempFile(ByteArray(300 * 1024) { 7 })
        assertEquals(256 * 1024, NativeAssetChunks.read(file, 0, Int.MAX_VALUE).size)
        file.delete()
    }

    private fun tempFile(bytes: ByteArray): File = File.createTempFile("whalemaid-asset-", ".bin").apply {
        writeBytes(bytes)
    }
}
