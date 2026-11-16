import { describe, expect, test } from 'bun:test'
import { REDACTED, isPrivatePath, isTrustedParent, redactSensitive, redactText } from '../../src/lib/traceSafety'

describe('NB-14 telemetry only goes to a verified parent and never carries secrets', () => {
  test('only Arc Studio and explicitly listed origins are trusted; there is no wildcard', () => {
    expect(isTrustedParent('https://studio.arc.io')).toBe(true)
    expect(isTrustedParent('https://abc.studio.arc.io')).toBe(true)
    expect(isTrustedParent('*')).toBe(false)
    expect(isTrustedParent(null)).toBe(false)
    expect(isTrustedParent('')).toBe(false)
    expect(isTrustedParent('https://evil.example')).toBe(false)
    expect(isTrustedParent('https://studio.arc.io.evil.example')).toBe(false)
    expect(isTrustedParent('http://studio.arc.io')).toBe(false)
    expect(isTrustedParent('https://my.tool.example', 'https://my.tool.example')).toBe(true)
  })

  test('passwords, PINs and tokens are removed from request and response bodies', () => {
    const body = { email: 'a@b.co', password: 'hunter2hunter2', pin: '2468', currentPin: '1357', nested: { token: 'abc.def.ghi', authorization: 'Bearer abcdefghijkl', shipping: 'Lagos' }, list: [{ newPin: '9753' }] }
    const out = JSON.stringify(redactSensitive(JSON.stringify(body)))
    for (const secret of ['hunter2hunter2', '2468', '1357', 'abc.def.ghi', 'abcdefghijkl', '9753']) expect(out).not.toContain(secret)
    expect(out).toContain('a@b.co')
    expect(out).toContain('Lagos') // "shipping" is not a PIN
    expect(out).toContain(REDACTED)
  })

  test('free text is scrubbed too', () => {
    expect(redactText('sent Authorization: Bearer abcdef123456789 and password=hunter2')).not.toMatch(/abcdef123456789|hunter2/)
  })

  test('auth and PIN endpoints never have a body sent at all', () => {
    expect(isPrivatePath('https://x.test/api/auth/login')).toBe(true)
    expect(isPrivatePath('/api/naira/pin')).toBe(true)
    expect(isPrivatePath('/api/orders')).toBe(false)
  })
})
