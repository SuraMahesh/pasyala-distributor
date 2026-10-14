import { afterEach, describe, expect, it } from 'vitest'
import { storageKind, storageStatus } from './services/files'

const saved = { ...process.env }
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
  Object.assign(process.env, saved)
})

describe('photo storage detection', () => {
  it('on Vercel with no Blob store: not ready, says what it can see', () => {
    process.env.VERCEL = '1'
    process.env.VERCEL_ENV = 'production'
    delete process.env.BLOB_READ_WRITE_TOKEN
    delete process.env.BLOB_STORE_ID
    expect(storageStatus()).toMatchObject({ ready: false, found: [], environment: 'production' })
    expect(() => storageKind()).toThrow(/Photo storage is not set up/)
  })
  it('classic token', () => {
    process.env.VERCEL = '1'
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_abc_123'
    expect(storageStatus()).toMatchObject({ ready: true, kind: 'blob', via: 'token', found: ['BLOB_READ_WRITE_TOKEN'] })
  })
  it('newer stores: BLOB_STORE_ID + Vercel login (no token variable)', () => {
    process.env.VERCEL = '1'
    process.env.BLOB_STORE_ID = 'store_abc123'
    expect(storageStatus()).toMatchObject({ ready: true, kind: 'blob', via: 'oidc' })
    expect(storageKind()).toBe('blob')
  })
  it('custom prefix chosen when connecting the store', () => {
    process.env.VERCEL = '1'
    process.env.PHOTOS_READ_WRITE_TOKEN = 'vercel_blob_rw_xyz_789'
    expect(storageStatus()).toMatchObject({ ready: true, via: 'token', found: ['PHOTOS_READ_WRITE_TOKEN'] })
  })
  it('on your own computer: local folder', () => {
    delete process.env.VERCEL
    expect(storageStatus()).toMatchObject({ ready: true, kind: 'local' })
  })
})
