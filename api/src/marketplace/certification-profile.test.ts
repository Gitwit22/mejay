import {describe, expect, it} from 'vitest'

import {artistLinkProblem, artistProfileSchema, slugifyArtistName} from './artist-profile'
import {
  CERTIFICATION_VERSION,
  certificationDraftSchema,
  certificationProblems,
  missingCertifications,
  requiredCertificationKeys,
  submissionRightsStatus,
} from './release-certification'
import {uploadInitSchema} from './schemas'
import {inspectUpload, validateInspectedUpload} from './upload-validation'

const CORE = ['original_recording', 'beat_rights', 'distribution_rights', 'collaborators_authorized', 'information_accurate', 'platform_authorization']

describe('release certification policy', () => {
  it('requires the six core statements, plus the ISRC statement only when a track lacks an ISRC', () => {
    expect(requiredCertificationKeys(0)).toEqual(CORE)
    expect(requiredCertificationKeys(2)).toEqual([...CORE, 'no_prior_isrc'])
    expect(missingCertifications(CORE, 1)).toEqual(['no_prior_isrc'])
    expect(missingCertifications(CORE.slice(1), 0)).toEqual(['original_recording'])
  })

  it('maps the third-party answer to a rights status without deciding ownership', () => {
    expect(submissionRightsStatus('none', [])).toBe('CERTIFIED_ORIGINAL')
    expect(submissionRightsStatus('unsure', [{documentAssetId: 'doc'}])).toBe('RIGHTS_REVIEW_REQUIRED')
    expect(submissionRightsStatus('licensed', [{documentAssetId: 'doc'}, {documentAssetId: 'doc2'}])).toBe('RIGHTS_DOCUMENTATION_ATTACHED')
    expect(submissionRightsStatus('licensed', [{documentAssetId: 'doc'}, {documentAssetId: null}])).toBe('RIGHTS_REVIEW_REQUIRED')
    expect(submissionRightsStatus('licensed', [])).toBe('RIGHTS_REVIEW_REQUIRED')
  })

  it('reports exactly what blocks submission', () => {
    expect(certificationProblems({draft: null, tracksWithoutIsrc: 0, materialCount: 0})).toEqual(['rights certification'])
    expect(certificationProblems({draft: {version: CERTIFICATION_VERSION, thirdPartyMaterial: 'none', accepted: CORE as never}, tracksWithoutIsrc: 0, materialCount: 0})).toEqual([])
    expect(certificationProblems({draft: {version: 'old' as never, thirdPartyMaterial: 'none', accepted: CORE as never}, tracksWithoutIsrc: 0, materialCount: 0})[0]).toMatch(/accepted again/)
    expect(certificationProblems({draft: {version: CERTIFICATION_VERSION, thirdPartyMaterial: 'licensed', accepted: CORE as never}, tracksWithoutIsrc: 0, materialCount: 0})[0]).toMatch(/third-party material/)
  })

  it('rejects stale wording versions and unknown statements', () => {
    expect(certificationDraftSchema.safeParse({version: CERTIFICATION_VERSION, thirdPartyMaterial: 'none', accepted: CORE}).success).toBe(true)
    expect(certificationDraftSchema.safeParse({version: '2020-01', thirdPartyMaterial: 'none', accepted: CORE}).success).toBe(false)
    expect(certificationDraftSchema.safeParse({version: CERTIFICATION_VERSION, thirdPartyMaterial: 'none', accepted: ['made_up']}).success).toBe(false)
    expect(certificationDraftSchema.safeParse({version: CERTIFICATION_VERSION, thirdPartyMaterial: 'maybe', accepted: CORE}).success).toBe(false)
  })
})

describe('artist profile validation', () => {
  it('builds URL-safe slugs', () => {
    expect(slugifyArtistName('John Blaze')).toBe('john-blaze')
    expect(slugifyArtistName('Beyoncé & The Crew!!')).toBe('beyonce-the-crew')
    expect(slugifyArtistName('???')).toBe('artist')
  })

  it('only accepts https links on each platform\'s own domain', () => {
    expect(artistLinkProblem('instagram', 'https://www.instagram.com/johnblaze')).toBeNull()
    expect(artistLinkProblem('spotify', 'https://open.spotify.com/artist/abc')).toBeNull()
    expect(artistLinkProblem('website', 'https://johnblaze.com')).toBeNull()
    expect(artistLinkProblem('instagram', 'https://evil.example/instagram.com')).toMatch(/instagram link/)
    expect(artistLinkProblem('spotify', 'https://notspotify.com/artist/x')).toMatch(/spotify link/)
    expect(artistLinkProblem('website', 'http://johnblaze.com')).toMatch(/https/)
    expect(artistLinkProblem('website', 'javascript:alert(1)')).toBeTruthy()
  })

  it('validates the profile payload', () => {
    expect(artistProfileSchema.safeParse({name: 'John Blaze', genres: ['Hip-Hop'], links: {x: 'https://x.com/jb'}}).success).toBe(true)
    expect(artistProfileSchema.safeParse({name: 'John Blaze', slug: 'John Blaze'}).success).toBe(false)
    expect(artistProfileSchema.safeParse({name: 'John Blaze', genres: ['a', 'b', 'c', 'd', 'e', 'f']}).success).toBe(false)
    expect(artistProfileSchema.safeParse({name: 'John Blaze', links: {myspace: 'https://myspace.com'}}).success).toBe(false)
    expect(artistProfileSchema.safeParse({name: 'John Blaze', spotifyArtistId: 'short'}).success).toBe(false)
  })
})

describe('profile image and rights document uploads', () => {
  function png(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(24)
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
    const view = new DataView(bytes.buffer)
    view.setUint32(16, width)
    view.setUint32(20, height)
    return bytes
  }

  it('enforces type, size and dimensions at upload start', () => {
    expect(uploadInitSchema.safeParse({kind: 'artist_photo', artistId: 'a1', fileName: 'me.png', byteSize: 1000, mimeType: 'image/png', width: 800, height: 800}).success).toBe(true)
    expect(uploadInitSchema.safeParse({kind: 'artist_photo', artistId: 'a1', fileName: 'me.png', byteSize: 11 * 1024 * 1024, mimeType: 'image/png', width: 800, height: 800}).success).toBe(false)
    expect(uploadInitSchema.safeParse({kind: 'artist_photo', artistId: 'a1', fileName: 'me.gif', byteSize: 1000, mimeType: 'image/gif', width: 800, height: 800}).success).toBe(false)
    expect(uploadInitSchema.safeParse({kind: 'artist_banner', artistId: 'a1', fileName: 'b.png', byteSize: 1000, mimeType: 'image/png', width: 1200, height: 1200}).success).toBe(false)
    expect(uploadInitSchema.safeParse({kind: 'rights_document', releaseId: 'r1', fileName: 'lease.pdf', byteSize: 1000, mimeType: 'application/pdf'}).success).toBe(true)
    expect(uploadInitSchema.safeParse({kind: 'rights_document', releaseId: 'r1', fileName: 'lease.exe', byteSize: 1000, mimeType: 'application/octet-stream'}).success).toBe(false)
  })

  it('checks the uploaded bytes, not just the declared type', () => {
    expect(validateInspectedUpload({declaredMimeType: 'image/png', kind: 'artist_photo', metadata: {width: 800, height: 800}, inspected: inspectUpload(png(800, 800))})).toEqual([])
    expect(validateInspectedUpload({declaredMimeType: 'image/png', kind: 'artist_photo', metadata: {width: 200, height: 200}, inspected: inspectUpload(png(200, 200))})).toEqual(['image_dimensions_too_small'])
    expect(validateInspectedUpload({declaredMimeType: 'image/png', kind: 'artist_banner', metadata: {width: 1500, height: 1500}, inspected: inspectUpload(png(1500, 1500))})).toEqual(['banner_aspect_invalid'])
    const pdf = new TextEncoder().encode('%PDF-1.7\n...')
    expect(validateInspectedUpload({declaredMimeType: 'application/pdf', kind: 'rights_document', metadata: {}, inspected: inspectUpload(pdf)})).toEqual([])
    expect(validateInspectedUpload({declaredMimeType: 'application/pdf', kind: 'rights_document', metadata: {}, inspected: inspectUpload(png(10, 10))})).toEqual(['file_type_mismatch'])
  })
})
