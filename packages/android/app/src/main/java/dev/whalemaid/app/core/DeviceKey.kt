// SPEC: docs/adr/INDEX.md#ADR-033 设备密钥：AndroidKeyStore ECDSA P-256（硬件级不可导出，原生等价 WebCrypto）
package dev.whalemaid.app.core

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.util.Base64

object DeviceKey {
  private const val ALIAS = "whalemaid-device-key"

  fun getOrCreateKeyPair(): KeyPair {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (!ks.containsAlias(ALIAS)) {
      val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
      gen.initialize(
        KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
          .setDigests(KeyProperties.DIGEST_SHA256)
          .build(),
      )
      gen.generateKeyPair()
    }
    val entry = ks.getEntry(ALIAS, null) as KeyStore.PrivateKeyEntry
    return KeyPair(entry.certificate.publicKey, entry.privateKey)
  }

  /** JWK（PROTO-003）：EC P-256 x/y base64url 无填充 */
  fun publicJwk(pair: KeyPair): JsonObject {
    val ec = pair.public as ECPublicKey
    val params = ec.params
    val fieldSize = params.curve.field.fieldSize
    val x = ByteArray(fieldSize)
    val y = ByteArray(fieldSize)
    ec.w.affineX.toByteArray().copyInto(x, x.size - ec.w.affineX.toByteArray().size)
    ec.w.affineY.toByteArray().copyInto(y, y.size - ec.w.affineY.toByteArray().size)
    return buildJsonObject {
      put("kty", "EC")
      put("crv", "P-256")
      put("x", base64Url(x))
      put("y", base64Url(y))
    }
  }

  fun signNonce(pair: KeyPair, nonce: String): String {
    val sig = Signature.getInstance("SHA256withECDSA")
    sig.initSign(pair.private)
    sig.update(nonce.toByteArray(Charsets.UTF_8))
    return Base64.getEncoder().encodeToString(sig.sign())
  }

  private fun base64Url(bytes: ByteArray): String =
    Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}
