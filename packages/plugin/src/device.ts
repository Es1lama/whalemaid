// SPEC: docs/protocol.md#PROTO-003 设备 ID 与密码生成
import { randomBytes } from 'node:crypto'

/** 排除易混字符（0/O/1/I）的 base32 字母表（PROTO-003） */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function base32(bytes: Buffer, groups: [number, number]): string {
  let bits = 0
  let value = 0
  let out = ''
  const size = groups[0] + groups[1]
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += ALPHABET[(value >>> bits) & 31]
    }
  }
  return out.slice(0, size)
}

/** 设备 ID：WHALE-XXXX-XXXX（8 字节随机） */
export function generateDeviceId(): string {
  const raw = base32(randomBytes(8), [4, 4])
  return `WHALE-${raw.slice(0, 4)}-${raw.slice(4, 8)}`
}

/** 长期密码：12 字符随机（TM-009 抗暴力破解） */
export function generatePassword(): string {
  return randomBytes(9).toString('base64url').slice(0, 12)
}

/** 一次性临时密码：40 bit 随机量 + 独立前缀，主控端必须显式选择 temporary 类型。 */
export function generateTemporaryPassword(): string {
  const raw = base32(randomBytes(8), [4, 4])
  return `WMT-${raw.slice(0, 4)}-${raw.slice(4, 8)}`
}
